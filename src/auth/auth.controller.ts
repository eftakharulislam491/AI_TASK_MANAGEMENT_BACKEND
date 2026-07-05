import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from './interfaces/jwt-user.interface';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './auth.constants';
import {
  loginSchema,
  logoutSchema,
  parseWithSchema,
  refreshSchema,
  registerSchema,
} from './auth.schemas';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(
      parseWithSchema(registerSchema, body),
    );
    this.setAuthCookies(response, result.accessToken, result.refreshToken);
    return result;
  }

  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(parseWithSchema(loginSchema, body));
    this.setAuthCookies(response, result.accessToken, result.refreshToken);
    return result;
  }

  @Post('refresh')
  async refresh(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsedBody = refreshSchema.safeParse(body);
    const refreshToken =
      request.cookies?.[REFRESH_TOKEN_COOKIE] ??
      (parsedBody.success ? parsedBody.data.refreshToken : undefined);

    const result = await this.authService.refresh(
      parseWithSchema(refreshSchema, { refreshToken }),
    );
    this.setAuthCookies(response, result.accessToken, result.refreshToken);
    return result;
  }

  @Post('logout')
  async logout(
    @Headers('x-refresh-token') refreshTokenHeader: string | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = logoutSchema.safeParse(body);
    const refreshToken =
      refreshTokenHeader?.trim() ||
      request.cookies?.[REFRESH_TOKEN_COOKIE] ||
      (parsed.success ? parsed.data.refreshToken : undefined);

    const result = await this.authService.logout(refreshToken);
    this.clearAuthCookies(response);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtUser) {
    return this.authService.getProfile(user.sub);
  }

  private setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    response.cookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      this.authService.getCookieConfig('access'),
    );
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken,
      this.authService.getCookieConfig('refresh'),
    );
  }

  private clearAuthCookies(response: Response) {
    response.clearCookie(
      ACCESS_TOKEN_COOKIE,
      this.authService.getCookieConfig('access'),
    );
    response.clearCookie(
      REFRESH_TOKEN_COOKIE,
      this.authService.getCookieConfig('refresh'),
    );
  }
}

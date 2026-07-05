import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  acceptInvitationSchema,
  listInvitationsQuerySchema,
  parseWithSchema,
  resourceIdValue,
  sendInvitationSchema,
} from './invitations.schemas';
import { InvitationsService } from './invitations.service';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('accept')
  acceptInvitation(@Body() body: unknown) {
    return this.invitationsService.acceptInvitation(
      parseWithSchema(acceptInvitationSchema, body),
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @TenantAccess()
  sendInvitation(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.invitationsService.sendInvitation(
      currentUser,
      parseWithSchema(sendInvitationSchema, body),
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @TenantAccess()
  listInvitations(
    @CurrentUser() currentUser: JwtUser,
    @Query() query: unknown,
  ) {
    return this.invitationsService.listInvitations(
      currentUser,
      parseWithSchema(listInvitationsQuerySchema, query),
    );
  }

  @Post(':invitationId/resend')
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @TenantAccess()
  resendInvitation(
    @CurrentUser() currentUser: JwtUser,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.resendInvitation(
      currentUser,
      parseWithSchema(resourceIdValue, invitationId),
    );
  }

  @Patch(':invitationId/cancel')
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @TenantAccess()
  cancelInvitation(
    @CurrentUser() currentUser: JwtUser,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.cancelInvitation(
      currentUser,
      parseWithSchema(resourceIdValue, invitationId),
    );
  }
}

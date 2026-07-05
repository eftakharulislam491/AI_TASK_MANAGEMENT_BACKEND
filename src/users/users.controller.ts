import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { UsersService } from './users.service';
import {
  cancelRoleChangeRequestSchema,
  createRoleChangeRequestSchema,
  createUserAbilitySchema,
  listRoleChangeRequestsQuerySchema,
  listUsersQuerySchema,
  parseWithSchema,
  resourceIdValue,
  reviewRoleChangeRequestSchema,
  updateMyProfileSchema,
  updateUserAbilitySchema,
} from './users.schemas';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() currentUser: JwtUser) {
    return this.usersService.getMe(currentUser);
  }

  @Patch('me/profile')
  updateMyProfile(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.usersService.updateMyProfile(
      currentUser,
      parseWithSchema(updateMyProfileSchema, body),
    );
  }

  @Post('me/abilities')
  createMyAbility(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.usersService.createMyAbility(
      currentUser,
      parseWithSchema(createUserAbilitySchema, body),
    );
  }

  @Patch('me/abilities/:abilityId')
  updateMyAbility(
    @CurrentUser() currentUser: JwtUser,
    @Param('abilityId') abilityId: string,
    @Body() body: unknown,
  ) {
    return this.usersService.updateMyAbility(
      currentUser,
      parseWithSchema(resourceIdValue, abilityId),
      parseWithSchema(updateUserAbilitySchema, body),
    );
  }

  @Delete('me/abilities/:abilityId')
  deleteMyAbility(
    @CurrentUser() currentUser: JwtUser,
    @Param('abilityId') abilityId: string,
  ) {
    return this.usersService.deleteMyAbility(
      currentUser,
      parseWithSchema(resourceIdValue, abilityId),
    );
  }

  @Get('directory')
  listDirectory(@CurrentUser() currentUser: JwtUser, @Query() query: unknown) {
    return this.usersService.listDirectory(
      currentUser,
      parseWithSchema(listUsersQuerySchema, query),
    );
  }

  @Get('directory/:userId')
  getDirectoryUser(
    @CurrentUser() currentUser: JwtUser,
    @Param('userId') userId: string,
  ) {
    return this.usersService.getDirectoryUser(
      currentUser,
      parseWithSchema(resourceIdValue, userId),
    );
  }

  @Post('role-change-requests')
  createRoleChangeRequest(
    @CurrentUser() currentUser: JwtUser,
    @Body() body: unknown,
  ) {
    return this.usersService.createRoleChangeRequest(
      currentUser,
      parseWithSchema(createRoleChangeRequestSchema, body),
    );
  }

  @Get('role-change-requests')
  listRoleChangeRequests(
    @CurrentUser() currentUser: JwtUser,
    @Query() query: unknown,
  ) {
    return this.usersService.listRoleChangeRequests(
      currentUser,
      parseWithSchema(listRoleChangeRequestsQuerySchema, query),
    );
  }

  @Patch('role-change-requests/:requestId/review')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'MANAGER')
  reviewRoleChangeRequest(
    @CurrentUser() currentUser: JwtUser,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    return this.usersService.reviewRoleChangeRequest(
      currentUser,
      parseWithSchema(resourceIdValue, requestId),
      parseWithSchema(reviewRoleChangeRequestSchema, body),
    );
  }

  @Post('role-change-requests/:requestId/cancel')
  cancelRoleChangeRequest(
    @CurrentUser() currentUser: JwtUser,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    parseWithSchema(cancelRoleChangeRequestSchema, body);

    return this.usersService.cancelRoleChangeRequest(
      currentUser,
      parseWithSchema(resourceIdValue, requestId),
    );
  }
}

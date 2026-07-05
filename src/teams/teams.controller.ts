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
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import {
  addTeamMemberSchema,
  createTeamSchema,
  listTeamsQuerySchema,
  parseWithSchema,
  resourceIdValue,
  updateTeamSchema,
} from './teams.schemas';
import { TeamsService } from './teams.service';

@Controller('teams')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  createTeam(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.teamsService.createTeam(
      currentUser,
      parseWithSchema(createTeamSchema, body),
    );
  }

  @Get()
  listTeams(@CurrentUser() currentUser: JwtUser, @Query() query: unknown) {
    return this.teamsService.listTeams(
      currentUser,
      parseWithSchema(listTeamsQuerySchema, query),
    );
  }

  @Get(':teamId')
  getTeam(
    @CurrentUser() currentUser: JwtUser,
    @Param('teamId') teamId: string,
  ) {
    return this.teamsService.getTeam(
      currentUser,
      parseWithSchema(resourceIdValue, teamId),
    );
  }

  @Patch(':teamId')
  updateTeam(
    @CurrentUser() currentUser: JwtUser,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ) {
    return this.teamsService.updateTeam(
      currentUser,
      parseWithSchema(resourceIdValue, teamId),
      parseWithSchema(updateTeamSchema, body),
    );
  }

  @Delete(':teamId')
  deleteTeam(
    @CurrentUser() currentUser: JwtUser,
    @Param('teamId') teamId: string,
  ) {
    return this.teamsService.deleteTeam(
      currentUser,
      parseWithSchema(resourceIdValue, teamId),
    );
  }

  @Post(':teamId/members')
  addTeamMember(
    @CurrentUser() currentUser: JwtUser,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ) {
    return this.teamsService.addTeamMember(
      currentUser,
      parseWithSchema(resourceIdValue, teamId),
      parseWithSchema(addTeamMemberSchema, body),
    );
  }

  @Delete(':teamId/members/:userId')
  removeTeamMember(
    @CurrentUser() currentUser: JwtUser,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.teamsService.removeTeamMember(
      currentUser,
      parseWithSchema(resourceIdValue, teamId),
      parseWithSchema(resourceIdValue, userId),
    );
  }
}

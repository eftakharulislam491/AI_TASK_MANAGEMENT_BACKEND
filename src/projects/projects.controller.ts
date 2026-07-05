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
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  addProjectMemberSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  parseWithSchema,
  resourceIdValue,
  updateProjectSchema,
} from './projects.schemas';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.projectsService.createProject(
      currentUser,
      parseWithSchema(createProjectSchema, body),
    );
  }

  @Get()
  listProjects(@CurrentUser() currentUser: JwtUser, @Query() query: unknown) {
    return this.projectsService.listProjects(
      currentUser,
      parseWithSchema(listProjectsQuerySchema, query),
    );
  }

  @Get(':projectId')
  getProject(
    @CurrentUser() currentUser: JwtUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.getProject(
      currentUser,
      parseWithSchema(resourceIdValue, projectId),
    );
  }

  @Patch(':projectId')
  updateProject(
    @CurrentUser() currentUser: JwtUser,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projectsService.updateProject(
      currentUser,
      parseWithSchema(resourceIdValue, projectId),
      parseWithSchema(updateProjectSchema, body),
    );
  }

  @Delete(':projectId')
  deleteProject(
    @CurrentUser() currentUser: JwtUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.deleteProject(
      currentUser,
      parseWithSchema(resourceIdValue, projectId),
    );
  }

  @Post(':projectId/members')
  addProjectMember(
    @CurrentUser() currentUser: JwtUser,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projectsService.addProjectMember(
      currentUser,
      parseWithSchema(resourceIdValue, projectId),
      parseWithSchema(addProjectMemberSchema, body),
    );
  }

  @Delete(':projectId/members/:userId')
  removeProjectMember(
    @CurrentUser() currentUser: JwtUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.projectsService.removeProjectMember(
      currentUser,
      parseWithSchema(resourceIdValue, projectId),
      parseWithSchema(resourceIdValue, userId),
    );
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  listActivityQuerySchema,
  listTaskActivityQuerySchema,
  parseWithSchema,
  resourceIdValue,
} from './activity.schemas';
import { ActivityService } from './activity.service';

@Controller()
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('activity')
  listOrganizationActivity(
    @CurrentUser() currentUser: JwtUser,
    @Query() query: unknown,
  ) {
    return this.activityService.listOrganizationActivity(
      currentUser,
      parseWithSchema(listActivityQuerySchema, query),
    );
  }

  @Get('tasks/:taskId/activity')
  listTaskActivity(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
    @Query() query: unknown,
  ) {
    return this.activityService.listTaskActivity(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      parseWithSchema(listTaskActivityQuerySchema, query),
    );
  }
}

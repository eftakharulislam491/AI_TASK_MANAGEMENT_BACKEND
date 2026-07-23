import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import { parseWithSchema, resourceIdValue } from '../tasks/tasks.schemas';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: JwtUser) {
    return this.monitoring.getDashboardMetrics(user);
  }

  @Get('workload')
  workload(@CurrentUser() user: JwtUser) {
    return this.monitoring.getWorkloadBreakdown(user);
  }

  @Get('projects/risk')
  projects(@CurrentUser() user: JwtUser) {
    return this.monitoring.getProjectRisks(user);
  }

  @Get('projects/:projectId/risk')
  project(@CurrentUser() user: JwtUser, @Param('projectId') projectId: string) {
    return this.monitoring.calculateProjectRisk(
      user,
      parseWithSchema(resourceIdValue, projectId),
    );
  }
}

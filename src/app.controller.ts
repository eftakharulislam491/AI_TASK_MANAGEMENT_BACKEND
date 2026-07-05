import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantAccessGuard } from './common/guards/tenant-access.guard';
import { Roles } from './common/decorators/roles.decorator';
import { TenantAccess } from './common/decorators/tenant-access.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('admin/health')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  getAdminHealth() {
    return this.appService.getAdminHealth();
  }

  @Get('organization/health')
  @UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard)
  @TenantAccess()
  @Roles('MANAGER', 'TEAM_LEADER', 'MEMBER')
  getOrganizationHealth() {
    return this.appService.getOrganizationHealth();
  }
}

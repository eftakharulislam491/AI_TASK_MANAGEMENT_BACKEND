import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'AI Task Management backend is running';
  }

  getAdminHealth() {
    return {
      scope: 'global',
      status: 'ok',
    };
  }

  getOrganizationHealth() {
    return {
      scope: 'tenant',
      status: 'ok',
    };
  }
}

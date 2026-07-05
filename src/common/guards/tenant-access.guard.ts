import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_ACCESS_KEY } from '../constants/auth.constants';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import type { TenantAccessOptions } from '../decorators/tenant-access.decorator';

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<TenantAccessOptions>(
      TENANT_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    const organizationId =
      request.tenantContext?.organizationId ?? user.currentOrganizationId;

    if (!organizationId) {
      if (options.required === false) {
        return true;
      }

      throw new ForbiddenException('Organization context is required');
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.sub,
          organizationId,
        },
      },
      select: {
        status: true,
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'You do not have active access to this organization',
      );
    }

    return true;
  }
}

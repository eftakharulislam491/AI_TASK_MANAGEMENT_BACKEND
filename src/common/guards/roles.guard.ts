import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ROLES_KEY } from '../constants/auth.constants';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) {
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

    const activeOrganizationId =
      request.tenantContext?.organizationId ?? user.currentOrganizationId;
    const membershipRole = activeOrganizationId
      ? user.memberships.find(
          (membership) => membership.organizationId === activeOrganizationId,
        )?.role
      : undefined;

    if (
      requiredRoles.includes(user.role) ||
      (membershipRole && requiredRoles.includes(membershipRole))
    ) {
      return true;
    }

    throw new ForbiddenException('Insufficient role for this resource');
  }
}

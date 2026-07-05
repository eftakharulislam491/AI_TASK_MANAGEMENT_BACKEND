import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
    const organizationIdHeader = request.header('x-organization-id');
    const organizationId =
      organizationIdHeader ??
      (typeof request.params?.organizationId === 'string'
        ? request.params.organizationId
        : undefined) ??
      (typeof request.query?.organizationId === 'string'
        ? request.query.organizationId
        : undefined);

    request.tenantContext = { organizationId };
    next();
  }
}

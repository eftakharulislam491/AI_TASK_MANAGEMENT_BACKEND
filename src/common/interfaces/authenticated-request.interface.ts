import type { Request } from 'express';
import type { JwtUser } from '../../auth/interfaces/jwt-user.interface';

export interface AuthenticatedRequest extends Request {
  user?: JwtUser;
  tenantContext?: {
    organizationId?: string;
  };
}

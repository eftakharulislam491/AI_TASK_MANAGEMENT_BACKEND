import { SetMetadata } from '@nestjs/common';
import { TENANT_ACCESS_KEY } from '../constants/auth.constants';

export type TenantAccessOptions = {
  required?: boolean;
};

export const TenantAccess = (options: TenantAccessOptions = { required: true }) =>
  SetMetadata(TENANT_ACCESS_KEY, options);

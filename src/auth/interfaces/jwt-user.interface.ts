import type { Role } from '@prisma/client';

export interface JwtMembership {
  organizationId: string;
  role: Role;
  status: string;
}

export interface JwtUser {
  sub: string;
  email: string;
  type: 'ORGANIZATION' | 'MEMBER';
  role: Role;
  currentOrganizationId?: string | null;
  memberships: JwtMembership[];
  iat?: number;
  exp?: number;
}

import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import type { Prisma } from '@prisma/client';
import type { ActivityService } from '../activity/activity.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { requirementQuerySchema } from './requirements.schemas';
import { RequirementsService } from './requirements.service';

describe('RequirementsService access', () => {
  let capturedWhere: Prisma.RequirementWhereInput | undefined;
  const findMany = jest.fn((args: Prisma.RequirementFindManyArgs) => {
    capturedWhere = args.where;
    return Promise.resolve([]);
  });
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    requirement: { findMany, count },
  } as unknown as PrismaService;
  const service = new RequirementsService(
    prisma,
    {} as ActivityService,
    {} as NotificationsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    capturedWhere = undefined;
  });

  it('limits members to requirements linked to their assigned tasks', async () => {
    await service.listRequirements(userWithRole('MEMBER'), query());

    expect(capturedWhere).toMatchObject({
      organizationId: 'org-1',
      tasks: { some: { task: { assigneeId: 'user-1' } } },
    });
  });

  it.each(['MANAGER', 'TEAM_LEADER'] as const)(
    'allows %s to see all organization requirements',
    async (role) => {
      await service.listRequirements(userWithRole(role), query());

      expect(capturedWhere).toMatchObject({ organizationId: 'org-1' });
      expect(capturedWhere).not.toHaveProperty('tasks');
    },
  );
});

function userWithRole(role: 'MEMBER' | 'MANAGER' | 'TEAM_LEADER'): JwtUser {
  return {
    sub: 'user-1',
    email: 'user@example.com',
    type: 'MEMBER',
    role,
    currentOrganizationId: 'org-1',
    memberships: [{ organizationId: 'org-1', role, status: 'ACTIVE' }],
  };
}

function query() {
  return requirementQuerySchema.parse({ page: 1, limit: 20 });
}

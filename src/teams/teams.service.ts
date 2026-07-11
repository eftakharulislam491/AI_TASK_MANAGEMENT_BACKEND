import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  ListTeamsQueryInput,
  UpdateTeamInput,
} from './teams.schemas';

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

const teamListSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  description: true,
  leaderId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  leader: {
    select: userSummarySelect,
  },
  _count: {
    select: {
      members: true,
    },
  },
} satisfies Prisma.TeamSelect;

const teamDetailSelect = {
  ...teamListSelect,
  members: {
    orderBy: {
      joinedAt: 'asc',
    },
    select: {
      id: true,
      userId: true,
      joinedAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: userSummarySelect,
      },
    },
  },
  _count: {
    select: {
      members: true,
      projects: true,
    },
  },
} satisfies Prisma.TeamSelect;

type TeamListRow = Prisma.TeamGetPayload<{ select: typeof teamListSelect }>;
type TeamDetailRow = Prisma.TeamGetPayload<{ select: typeof teamDetailSelect }>;

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTeam(currentUser: JwtUser, input: CreateTeamInput) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);

    await this.assertSlugAvailable(organizationId, input.slug);

    if (input.leaderId) {
      await this.assertActiveOrganizationMember(
        organizationId,
        input.leaderId,
        'Team leader must be an active member of this organization.',
      );
    }

    const team = await this.prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          leaderId: input.leaderId ?? null,
        },
        select: {
          id: true,
        },
      });

      if (input.leaderId) {
        await tx.teamMember.create({
          data: {
            teamId: created.id,
            userId: input.leaderId,
          },
        });
      }

      return tx.team.findUnique({
        where: { id: created.id },
        select: teamListSelect,
      });
    });

    return serializeResponse({
      message: 'Team created successfully.',
      team: this.mapTeamListItem(team as TeamListRow),
    });
  }

  async listTeams(currentUser: JwtUser, query: ListTeamsQueryInput) {
    const organizationId = this.getOrganizationId(currentUser);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            name: {
              contains: query.search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    } satisfies Prisma.TeamWhereInput;

    const [teams, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        select: teamListSelect,
      }),
      this.prisma.team.count({ where }),
    ]);

    return serializeResponse({
      data: teams.map((team) => this.mapTeamListItem(team)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async getTeam(currentUser: JwtUser, teamId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const team = await this.getTeamOrThrow(
      organizationId,
      teamId,
      teamDetailSelect,
    );

    return serializeResponse(this.mapTeamDetail(team));
  }

  async updateTeam(
    currentUser: JwtUser,
    teamId: string,
    input: UpdateTeamInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const existing = await this.getTeamOrThrow(organizationId, teamId, {
      id: true,
      slug: true,
      leaderId: true,
      organizationId: true,
    } satisfies Prisma.TeamSelect);

    this.assertCanManageTeam(currentUser, organizationId, existing.leaderId);

    if (input.slug && input.slug !== existing.slug) {
      await this.assertSlugAvailable(organizationId, input.slug, teamId);
    }

    if (input.leaderId) {
      await this.assertActiveOrganizationMember(
        organizationId,
        input.leaderId,
        'Team leader must be an active member of this organization.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.update({
        where: { id: teamId },
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          ...(input.leaderId === undefined ? {} : { leaderId: input.leaderId }),
        },
        select: teamListSelect,
      });

      if (input.leaderId) {
        await tx.teamMember.upsert({
          where: {
            teamId_userId: {
              teamId,
              userId: input.leaderId,
            },
          },
          create: {
            teamId,
            userId: input.leaderId,
          },
          update: {},
        });
      }

      return team;
    });

    return serializeResponse({
      message: 'Team updated successfully.',
      team: this.mapTeamListItem(updated),
    });
  }

  async deleteTeam(currentUser: JwtUser, teamId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    await this.getTeamOrThrow(organizationId, teamId, { id: true });
    this.assertManager(currentUser, organizationId);

    await this.prisma.team.update({
      where: { id: teamId },
      data: {
        isActive: false,
      },
    });

    return serializeResponse({
      message: 'Team deleted successfully.',
    });
  }

  async addTeamMember(
    currentUser: JwtUser,
    teamId: string,
    input: AddTeamMemberInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const team = await this.getTeamOrThrow(organizationId, teamId, {
      id: true,
      leaderId: true,
    } satisfies Prisma.TeamSelect);

    this.assertCanManageTeam(currentUser, organizationId, team.leaderId);

    await this.assertActiveOrganizationMember(
      organizationId,
      input.userId,
      'User must be an active member of this organization.',
    );

    const existing = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: input.userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member of this team.');
    }

    await this.prisma.teamMember.create({
      data: {
        teamId,
        userId: input.userId,
      },
    });

    return this.getTeamMembers(teamId);
  }

  async removeTeamMember(currentUser: JwtUser, teamId: string, userId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const team = await this.getTeamOrThrow(organizationId, teamId, {
      id: true,
      leaderId: true,
    } satisfies Prisma.TeamSelect);

    this.assertCanManageTeam(currentUser, organizationId, team.leaderId);

    const member = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!member) {
      throw new NotFoundException('Team member not found.');
    }

    await this.prisma.teamMember.delete({
      where: {
        id: member.id,
      },
    });

    return serializeResponse({
      message: 'Team member removed successfully.',
    });
  }

  private async getTeamMembers(teamId: string) {
    const members = await this.prisma.teamMember.findMany({
      where: {
        teamId,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      select: {
        id: true,
        userId: true,
        joinedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: userSummarySelect,
        },
      },
    });

    return serializeResponse({
      message: 'Team member added successfully.',
      members,
    });
  }

  private getOrganizationId(currentUser: JwtUser) {
    if (!currentUser.currentOrganizationId) {
      throw new ForbiddenException('Organization context is required.');
    }

    return currentUser.currentOrganizationId;
  }

  private getRoleForOrganization(
    currentUser: JwtUser,
    organizationId: string,
  ): Role | undefined {
    if (currentUser.role === 'SUPER_ADMIN') {
      return 'SUPER_ADMIN';
    }

    return currentUser.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    )?.role;
  }

  private assertManager(currentUser: JwtUser, organizationId: string) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (role !== 'SUPER_ADMIN' && role !== 'MANAGER') {
      throw new ForbiddenException('Only managers can perform this action.');
    }
  }

  private assertCanManageTeam(
    currentUser: JwtUser,
    organizationId: string,
    leaderId?: string | null,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      (role === 'TEAM_LEADER' && leaderId === currentUser.sub)
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to manage this team.');
  }

  private async assertSlugAvailable(
    organizationId: string,
    slug: string,
    ignoredTeamId?: string,
  ) {
    const existing = await this.prisma.team.findUnique({
      where: {
        organizationId_slug: {
          organizationId,
          slug,
        },
      },
      select: {
        id: true,
      },
    });

    if (existing && existing.id !== ignoredTeamId) {
      throw new ConflictException(
        'Team slug is already used in this organization.',
      );
    }
  }

  private async assertActiveOrganizationMember(
    organizationId: string,
    userId: string,
    message: string,
  ) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      select: {
        status: true,
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException(message);
    }
  }

  private async getTeamOrThrow<T extends Prisma.TeamSelect>(
    organizationId: string,
    teamId: string,
    select: T,
  ): Promise<Prisma.TeamGetPayload<{ select: T }>> {
    const team = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        organizationId,
      },
      select,
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    return team;
  }

  private mapTeamListItem(team: TeamListRow) {
    return {
      ...team,
      memberCount: team._count.members,
      _count: undefined,
    };
  }

  private mapTeamDetail(team: TeamDetailRow) {
    return {
      ...team,
      memberCount: team._count.members,
      projectCount: team._count.projects,
      _count: undefined,
    };
  }
}

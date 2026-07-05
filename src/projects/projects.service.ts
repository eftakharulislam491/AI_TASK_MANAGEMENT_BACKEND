import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role, TaskStatus } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  ListProjectsQueryInput,
  UpdateProjectInput,
} from './projects.schemas';

const taskStatuses: TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
];

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

const teamSummarySelect = {
  id: true,
  name: true,
  slug: true,
  leaderId: true,
} satisfies Prisma.TeamSelect;

const projectListSelect = {
  id: true,
  organizationId: true,
  teamId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  ownerId: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: userSummarySelect,
  },
  team: {
    select: teamSummarySelect,
  },
  _count: {
    select: {
      members: true,
      tasks: true,
    },
  },
} satisfies Prisma.ProjectSelect;

const projectDetailSelect = {
  ...projectListSelect,
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
} satisfies Prisma.ProjectSelect;

type ProjectListRow = Prisma.ProjectGetPayload<{
  select: typeof projectListSelect;
}>;
type ProjectDetailRow = Prisma.ProjectGetPayload<{
  select: typeof projectDetailSelect;
}>;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(currentUser: JwtUser, input: CreateProjectInput) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    await this.assertSlugAvailable(organizationId, input.slug);

    if (input.teamId) {
      await this.assertTeamBelongsToOrganization(organizationId, input.teamId);
    }

    this.assertValidDateRange(input.startDate, input.endDate);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          organizationId,
          ownerId: currentUser.sub,
          teamId: input.teamId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          startDate: input.startDate,
          endDate: input.endDate,
          members: {
            create: {
              userId: currentUser.sub,
            },
          },
        },
        select: {
          id: true,
        },
      });

      return tx.project.findUnique({
        where: { id: created.id },
        select: projectListSelect,
      });
    });

    return serializeResponse({
      message: 'Project created successfully.',
      project: this.mapProjectListItem(project as ProjectListRow),
    });
  }

  async listProjects(currentUser: JwtUser, query: ListProjectsQueryInput) {
    const organizationId = this.getOrganizationId(currentUser);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                name: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                slug: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.ProjectWhereInput;

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        select: projectListSelect,
      }),
      this.prisma.project.count({ where }),
    ]);
    const taskSummaries = await this.getTaskSummaries(
      projects.map((project) => project.id),
    );

    return serializeResponse({
      data: projects.map((project) =>
        this.mapProjectListItem(project, taskSummaries.get(project.id)),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async getProject(currentUser: JwtUser, projectId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const project = await this.getProjectOrThrow(
      organizationId,
      projectId,
      projectDetailSelect,
    );
    const taskSummaries = await this.getTaskSummaries([project.id]);

    return serializeResponse(
      this.mapProjectDetail(project, taskSummaries.get(project.id)),
    );
  }

  async updateProject(
    currentUser: JwtUser,
    projectId: string,
    input: UpdateProjectInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const existing = await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
      slug: true,
      ownerId: true,
    } satisfies Prisma.ProjectSelect);

    this.assertCanManageProject(currentUser, organizationId, existing.ownerId);

    if (input.slug && input.slug !== existing.slug) {
      await this.assertSlugAvailable(organizationId, input.slug, projectId);
    }

    if (input.teamId) {
      await this.assertTeamBelongsToOrganization(organizationId, input.teamId);
    }

    this.assertValidDateRange(input.startDate, input.endDate);

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        teamId: input.teamId,
        status: input.status,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      select: projectListSelect,
    });
    const taskSummaries = await this.getTaskSummaries([updated.id]);

    return serializeResponse({
      message: 'Project updated successfully.',
      project: this.mapProjectListItem(updated, taskSummaries.get(updated.id)),
    });
  }

  async deleteProject(currentUser: JwtUser, projectId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    await this.getProjectOrThrow(organizationId, projectId, { id: true });
    this.assertManager(currentUser, organizationId);

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'ARCHIVED',
      },
    });

    return serializeResponse({
      message: 'Project archived successfully.',
    });
  }

  async addProjectMember(
    currentUser: JwtUser,
    projectId: string,
    input: AddProjectMemberInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const project = await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
      ownerId: true,
    } satisfies Prisma.ProjectSelect);

    this.assertCanManageProject(currentUser, organizationId, project.ownerId);
    await this.assertActiveOrganizationMember(
      organizationId,
      input.userId,
      'User must be an active member of this organization.',
    );

    const existing = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: input.userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member of this project.');
    }

    await this.prisma.projectMember.create({
      data: {
        projectId,
        userId: input.userId,
      },
    });

    return this.getProjectMembers(
      projectId,
      'Project member added successfully.',
    );
  }

  async removeProjectMember(
    currentUser: JwtUser,
    projectId: string,
    userId: string,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const project = await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
      ownerId: true,
    } satisfies Prisma.ProjectSelect);

    this.assertCanManageProject(currentUser, organizationId, project.ownerId);

    if (project.ownerId === userId) {
      throw new BadRequestException('Project owner cannot be removed.');
    }

    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!member) {
      throw new NotFoundException('Project member not found.');
    }

    await this.prisma.projectMember.delete({
      where: {
        id: member.id,
      },
    });

    return serializeResponse({
      message: 'Project member removed successfully.',
    });
  }

  private async getProjectMembers(projectId: string, message: string) {
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
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
      message,
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

  private assertCanManageProject(
    currentUser: JwtUser,
    organizationId: string,
    ownerId: string,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      ownerId === currentUser.sub
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to manage this project.');
  }

  private async assertSlugAvailable(
    organizationId: string,
    slug: string,
    ignoredProjectId?: string,
  ) {
    const existing = await this.prisma.project.findUnique({
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

    if (existing && existing.id !== ignoredProjectId) {
      throw new ConflictException(
        'Project slug is already used in this organization.',
      );
    }
  }

  private async assertTeamBelongsToOrganization(
    organizationId: string,
    teamId: string,
  ) {
    const team = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found in this organization.');
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

  private assertValidDateRange(startDate?: Date, endDate?: Date) {
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('End date must be after start date.');
    }
  }

  private async getProjectOrThrow<T extends Prisma.ProjectSelect>(
    organizationId: string,
    projectId: string,
    select: T,
  ): Promise<Prisma.ProjectGetPayload<{ select: T }>> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
      select,
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private async getTaskSummaries(projectIds: string[]) {
    const summaries = new Map<string, Record<TaskStatus, number>>();

    for (const projectId of projectIds) {
      summaries.set(projectId, this.emptyTaskSummary());
    }

    if (projectIds.length === 0) {
      return summaries;
    }

    const rows = await this.prisma.task.groupBy({
      by: ['projectId', 'status'],
      where: {
        projectId: {
          in: projectIds,
        },
      },
      _count: {
        _all: true,
      },
    });

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      const summary = summaries.get(row.projectId) ?? this.emptyTaskSummary();
      summary[row.status] = row._count._all;
      summaries.set(row.projectId, summary);
    }

    return summaries;
  }

  private emptyTaskSummary(): Record<TaskStatus, number> {
    return taskStatuses.reduce(
      (summary, status) => ({
        ...summary,
        [status]: 0,
      }),
      {} as Record<TaskStatus, number>,
    );
  }

  private mapProjectListItem(
    project: ProjectListRow,
    taskSummary = this.emptyTaskSummary(),
  ) {
    return {
      ...project,
      memberCount: project._count.members,
      taskCount: project._count.tasks,
      taskSummary,
      _count: undefined,
    };
  }

  private mapProjectDetail(
    project: ProjectDetailRow,
    taskSummary = this.emptyTaskSummary(),
  ) {
    return {
      ...project,
      memberCount: project._count.members,
      taskCount: project._count.tasks,
      taskSummary,
      _count: undefined,
    };
  }
}

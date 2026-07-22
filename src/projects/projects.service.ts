import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  ProjectLeaveRequestStatus,
  Role,
  TaskStatus,
} from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  CreateProjectLeaveRequestInput,
  ListProjectLeaveRequestsQueryInput,
  ListProjectsQueryInput,
  ReviewProjectLeaveRequestInput,
  UpdateProjectInput,
} from './projects.schemas';

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

const projectLeaveRequestSelect = {
  id: true,
  projectId: true,
  organizationId: true,
  requesterId: true,
  reason: true,
  status: true,
  reviewNote: true,
  reviewedById: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      ownerId: true,
      teamId: true,
    },
  },
  requester: {
    select: userSummarySelect,
  },
  reviewedBy: {
    select: userSummarySelect,
  },
} satisfies Prisma.ProjectLeaveRequestSelect;

type ProjectListRow = Prisma.ProjectGetPayload<{
  select: typeof projectListSelect;
}>;
type ProjectDetailRow = Prisma.ProjectGetPayload<{
  select: typeof projectDetailSelect;
}>;
type ProjectLeaveRequestRow = Prisma.ProjectLeaveRequestGetPayload<{
  select: typeof projectLeaveRequestSelect;
}>;
type TaskSummary = Record<TaskStatus, number>;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createProject(currentUser: JwtUser, input: CreateProjectInput) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    await this.assertSlugAvailable(organizationId, input.slug);
    this.assertValidDateRange(input.startDate, input.endDate);

    if (input.teamId) {
      await this.assertTeamBelongsToOrganization(organizationId, input.teamId);
    }

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
    const role = this.getRoleForOrganization(currentUser, organizationId);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(role === 'MEMBER'
        ? {
            members: {
              some: {
                userId: currentUser.sub,
              },
            },
          }
        : {}),
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
        orderBy: [{ updatedAt: 'desc' }],
        skip,
        take: limit,
        select: projectListSelect,
      }),
      this.prisma.project.count({ where }),
    ]);
    const summaries = await this.getTaskSummaries(
      projects.map((project) => project.id),
      role === 'MEMBER' ? currentUser.sub : undefined,
    );

    return serializeResponse({
      data: projects.map((project) =>
        this.mapProjectListItem(project, summaries.get(project.id)),
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
    this.assertCanViewProject(currentUser, organizationId, project);
    const summaries = await this.getTaskSummaries([project.id]);

    return serializeResponse(
      this.mapProjectDetail(project, summaries.get(project.id)),
    );
  }

  async updateProject(
    currentUser: JwtUser,
    projectId: string,
    input: UpdateProjectInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    const existing = await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
      slug: true,
    } satisfies Prisma.ProjectSelect);

    if (input.slug && input.slug !== existing.slug) {
      await this.assertSlugAvailable(organizationId, input.slug);
    }

    if (input.teamId) {
      await this.assertTeamBelongsToOrganization(organizationId, input.teamId);
    }

    this.assertValidDateRange(input.startDate, input.endDate);

    const project = await this.prisma.project.update({
      where: {
        id: projectId,
      },
      data: {
        teamId: input.teamId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        status: input.status,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      select: projectListSelect,
    });

    return serializeResponse({
      message: 'Project updated successfully.',
      project: this.mapProjectListItem(project),
    });
  }

  async deleteProject(currentUser: JwtUser, projectId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
    } satisfies Prisma.ProjectSelect);

    await this.prisma.project.delete({
      where: {
        id: projectId,
      },
    });

    return serializeResponse({
      message: 'Project deleted successfully.',
    });
  }

  async addProjectMember(
    currentUser: JwtUser,
    projectId: string,
    input: AddProjectMemberInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
    } satisfies Prisma.ProjectSelect);
    await this.assertActiveOrganizationMember(organizationId, input.userId);

    await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId,
          userId: input.userId,
        },
      },
      create: {
        projectId,
        userId: input.userId,
      },
      update: {},
    });

    const members = await this.listProjectMembers(projectId);

    await this.notificationsService.createNotification({
      userId: input.userId,
      organizationId,
      type: 'PROJECT_MEMBER_ADDED',
      title: 'Added to project',
      body: 'You have been added to a project.',
      metadata: {
        projectId,
      },
    });

    return serializeResponse({
      message: 'Project member added successfully.',
      members,
    });
  }

  async removeProjectMember(
    currentUser: JwtUser,
    projectId: string,
    userId: string,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
      ownerId: true,
    } satisfies Prisma.ProjectSelect);

    await this.prisma.projectMember.deleteMany({
      where: {
        projectId,
        userId,
      },
    });
    const members = await this.listProjectMembers(projectId);

    return serializeResponse({
      message: 'Project member removed successfully.',
      members,
    });
  }

  async createProjectLeaveRequest(
    currentUser: JwtUser,
    projectId: string,
    input: CreateProjectLeaveRequestInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const project = await this.getProjectOrThrow(organizationId, projectId, {
      id: true,
      name: true,
      ownerId: true,
      teamId: true,
    } satisfies Prisma.ProjectSelect);
    await this.assertProjectMember(projectId, currentUser.sub);

    const request = await this.prisma.projectLeaveRequest.create({
      data: {
        projectId,
        organizationId,
        requesterId: currentUser.sub,
        reason: input.reason,
      },
      select: projectLeaveRequestSelect,
    });
    const reviewers = await this.getProjectReviewers(
      organizationId,
      project.ownerId,
      project.teamId,
    );

    await this.notificationsService.createBulkNotifications(reviewers, {
      organizationId,
      type: 'PROJECT_LEAVE_REQUESTED',
      title: 'Project leave requested',
      body: `${currentUser.email} requested to leave ${project.name}.`,
      metadata: {
        projectId,
        requestId: request.id,
      },
    });

    return serializeResponse({
      message: 'Leave request submitted successfully.',
      request: this.mapProjectLeaveRequest(request),
    });
  }

  async listProjectLeaveRequests(
    currentUser: JwtUser,
    query: ListProjectLeaveRequestsQueryInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const role = this.getRoleForOrganization(currentUser, organizationId);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const status =
      query.status ?? (query.scope === 'pending' ? 'PENDING' : undefined);
    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.scope === 'mine' || role === 'MEMBER'
        ? { requesterId: currentUser.sub }
        : {}),
    } satisfies Prisma.ProjectLeaveRequestWhereInput;

    const [requests, total] = await Promise.all([
      this.prisma.projectLeaveRequest.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: projectLeaveRequestSelect,
      }),
      this.prisma.projectLeaveRequest.count({ where }),
    ]);

    return serializeResponse({
      data: requests.map((request) => this.mapProjectLeaveRequest(request)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async reviewProjectLeaveRequest(
    currentUser: JwtUser,
    requestId: string,
    input: ReviewProjectLeaveRequestInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertManager(currentUser, organizationId);
    const existing = await this.prisma.projectLeaveRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      select: projectLeaveRequestSelect,
    });

    if (!existing) {
      throw new NotFoundException('Leave request not found.');
    }

    if (existing.status !== 'PENDING') {
      throw new BadRequestException('Leave request has already been reviewed.');
    }

    const nextStatus = input.decision as ProjectLeaveRequestStatus;
    const request = await this.prisma.$transaction(async (tx) => {
      if (nextStatus === 'APPROVED') {
        await tx.projectMember.deleteMany({
          where: {
            projectId: existing.projectId,
            userId: existing.requesterId,
          },
        });
      }

      return tx.projectLeaveRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: nextStatus,
          reviewNote: input.reviewNote,
          reviewedById: currentUser.sub,
          reviewedAt: new Date(),
        },
        select: projectLeaveRequestSelect,
      });
    });

    await this.notificationsService.createNotification({
      userId: request.requesterId,
      organizationId,
      type: 'PROJECT_LEAVE_REVIEWED',
      title: 'Project leave request reviewed',
      body: `Your request to leave ${request.project.name} was ${request.status.toLowerCase()}.`,
      metadata: {
        projectId: request.projectId,
        requestId: request.id,
        status: request.status,
      },
    });

    return serializeResponse({
      message: 'Leave request reviewed successfully.',
      request: this.mapProjectLeaveRequest(request),
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
    if (currentUser.role === 'SUPER_ADMIN') return 'SUPER_ADMIN';

    return currentUser.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    )?.role;
  }

  private assertManager(currentUser: JwtUser, organizationId: string) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      role === 'TEAM_LEADER'
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to manage projects.');
  }

  private assertCanViewProject(
    currentUser: JwtUser,
    organizationId: string,
    project: { members?: Array<{ userId: string }> },
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (role !== 'MEMBER') return;
    if (project.members?.some((member) => member.userId === currentUser.sub)) {
      return;
    }

    throw new ForbiddenException('You can only view your projects.');
  }

  private assertValidDateRange(startDate?: Date, endDate?: Date) {
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('End date must be after start date.');
    }
  }

  private async assertSlugAvailable(organizationId: string, slug: string) {
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

    if (existing) {
      throw new ConflictException('Project slug is already in use.');
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
      },
      select: {
        id: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }
  }

  private async assertActiveOrganizationMember(
    organizationId: string,
    userId: string,
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
      throw new ForbiddenException(
        'User must be an active member of this organization.',
      );
    }
  }

  private async assertProjectMember(projectId: string, userId: string) {
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
      throw new ForbiddenException('You are not a member of this project.');
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

  private listProjectMembers(projectId: string) {
    return this.prisma.projectMember.findMany({
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
        user: {
          select: userSummarySelect,
        },
      },
    });
  }

  private async getProjectReviewers(
    organizationId: string,
    ownerId: string,
    teamId: string | null,
  ) {
    const reviewers = new Set<string>([ownerId]);

    if (teamId) {
      const team = await this.prisma.team.findFirst({
        where: {
          id: teamId,
          organizationId,
        },
        select: {
          leaderId: true,
        },
      });
      if (team?.leaderId) reviewers.add(team.leaderId);
    }

    return [...reviewers];
  }

  private emptyTaskSummary(): TaskSummary {
    return {
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
      CANCELLED: 0,
    };
  }

  private async getTaskSummaries(projectIds: string[], assigneeId?: string) {
    const summaries = new Map<string, TaskSummary>();

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
        ...(assigneeId ? { assigneeId } : {}),
      },
      _count: {
        _all: true,
      },
    });

    for (const row of rows) {
      if (!row.projectId) continue;
      const summary = summaries.get(row.projectId) ?? this.emptyTaskSummary();
      summary[row.status] = row._count._all;
      summaries.set(row.projectId, summary);
    }

    return summaries;
  }

  private mapProjectListItem(
    project: ProjectListRow,
    taskSummary = this.emptyTaskSummary(),
  ) {
    return {
      ...project,
      memberCount: project._count.members,
      taskCount: Object.values(taskSummary).reduce(
        (total, count) => total + count,
        0,
      ),
      taskSummary,
      _count: undefined,
    };
  }

  private mapProjectDetail(
    project: ProjectDetailRow,
    taskSummary = this.emptyTaskSummary(),
  ) {
    return {
      ...this.mapProjectListItem(project, taskSummary),
      members: project.members,
    };
  }

  private mapProjectLeaveRequest(request: ProjectLeaveRequestRow) {
    return {
      ...request,
      memberId: request.requesterId,
      member: request.requester,
    };
  }
}

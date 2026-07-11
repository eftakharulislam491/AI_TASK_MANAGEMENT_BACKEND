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
import { ActivityService } from '../activity/activity.service';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AddProjectMemberInput,
  CreateProjectLeaveRequestInput,
  CreateProjectInput,
  ListProjectLeaveRequestsQueryInput,
  ListProjectsQueryInput,
  ReviewProjectLeaveRequestInput,
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

type ProjectLeaveRequestRow = Prisma.ProjectLeaveRequestGetPayload<{
  select: typeof projectLeaveRequestSelect;
}>;

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
    } satisfies Prisma.ProjectSelect);

    if (project.ownerId === currentUser.sub) {
      throw new BadRequestException('Project owner cannot request to leave.');
    }

    await this.assertActiveOrganizationMember(
      organizationId,
      currentUser.sub,
      'You must be an active organization member to request leaving a project.',
    );

    const projectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: currentUser.sub,
        },
      },
      select: {
        id: true,
      },
    });

    if (!projectMember) {
      throw new ForbiddenException('You are not a member of this project.');
    }

    const existing = await this.prisma.projectLeaveRequest.findFirst({
      where: {
        projectId,
        requesterId: currentUser.sub,
        status: 'PENDING',
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException(
        'You already have a pending leave request for this project.',
      );
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.projectLeaveRequest.create({
        data: {
          projectId,
          organizationId,
          requesterId: currentUser.sub,
          reason: input.reason,
        },
        select: projectLeaveRequestSelect,
      });

      await ActivityService.logActivity(tx, {
        organizationId,
        actorId: currentUser.sub,
        projectId,
        action: 'PROJECT_LEAVE_REQUEST_CREATED',
        metadata: {
          requestId: created.id,
          requesterId: currentUser.sub,
          projectName: project.name,
        },
      });

      return created;
    });

    const recipients = await this.getProjectReviewRecipientIds(
      organizationId,
      projectId,
      currentUser.sub,
    );

    await this.notificationsService.createBulkNotifications(recipients, {
      organizationId,
      type: 'PROJECT_LEAVE_REQUESTED',
      title: 'Project leave request',
      body: `${this.getDisplayName(request.requester)} wants to leave ${project.name}.`,
      metadata: {
        requestId: request.id,
        projectId,
        requesterId: currentUser.sub,
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
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const role = this.getRoleForOrganization(currentUser, organizationId);
    const canReview = role === 'SUPER_ADMIN' || role === 'MANAGER';
    const where = this.buildProjectLeaveRequestWhere(
      organizationId,
      currentUser.sub,
      canReview,
      query,
    );

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
    const request = await this.prisma.projectLeaveRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      select: projectLeaveRequestSelect,
    });

    if (!request) {
      throw new NotFoundException('Leave request not found.');
    }

    this.assertCanManageProject(
      currentUser,
      organizationId,
      request.project.ownerId,
    );

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending leave requests can be reviewed.',
      );
    }

    const reviewed = await this.prisma.$transaction(async (tx) => {
      if (input.decision === 'APPROVED') {
        await tx.projectMember.deleteMany({
          where: {
            projectId: request.projectId,
            userId: request.requesterId,
          },
        });
      }

      const updated = await tx.projectLeaveRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: input.decision,
          reviewNote: input.reviewNote,
          reviewedById: currentUser.sub,
          reviewedAt: new Date(),
        },
        select: projectLeaveRequestSelect,
      });

      await ActivityService.logActivity(tx, {
        organizationId,
        actorId: currentUser.sub,
        projectId: request.projectId,
        action: 'PROJECT_LEAVE_REQUEST_REVIEWED',
        metadata: {
          requestId: request.id,
          decision: input.decision,
          requesterId: request.requesterId,
        },
      });

      return updated;
    });

    await this.notificationsService.createNotification({
      userId: reviewed.requesterId,
      organizationId,
      type: 'PROJECT_LEAVE_REVIEWED',
      title: 'Leave request reviewed',
      body: `Your request to leave ${reviewed.project.name} was ${input.decision.toLowerCase()}.`,
      metadata: {
        requestId: reviewed.id,
        projectId: reviewed.projectId,
        decision: input.decision,
      },
    });

    return serializeResponse({
      message: 'Leave request reviewed successfully.',
      request: this.mapProjectLeaveRequest(reviewed),
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

  private buildProjectLeaveRequestWhere(
    organizationId: string,
    currentUserId: string,
    canReview: boolean,
    query: ListProjectLeaveRequestsQueryInput,
  ) {
    const where = {
      organizationId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
    } satisfies Prisma.ProjectLeaveRequestWhereInput;

    if (!canReview || query.scope === 'mine') {
      return {
        ...where,
        requesterId: currentUserId,
      } satisfies Prisma.ProjectLeaveRequestWhereInput;
    }

    if (query.scope === 'pending') {
      return {
        ...where,
        status: query.status ?? 'PENDING',
        ...(query.requesterId ? { requesterId: query.requesterId } : {}),
      } satisfies Prisma.ProjectLeaveRequestWhereInput;
    }

    return {
      ...where,
      ...(query.requesterId ? { requesterId: query.requesterId } : {}),
    } satisfies Prisma.ProjectLeaveRequestWhereInput;
  }

  private async getProjectReviewRecipientIds(
    organizationId: string,
    projectId: string,
    requesterId: string,
  ) {
    const [project, managerMemberships] = await Promise.all([
      this.prisma.project.findFirst({
        where: {
          id: projectId,
          organizationId,
        },
        select: {
          ownerId: true,
        },
      }),
      this.prisma.organizationMembership.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          role: 'MANAGER',
        },
        select: {
          userId: true,
        },
      }),
    ]);

    return [
      project?.ownerId,
      ...managerMemberships.map((membership) => membership.userId),
    ].filter(
      (userId): userId is string => Boolean(userId) && userId !== requesterId,
    );
  }

  private mapProjectLeaveRequest(request: ProjectLeaveRequestRow) {
    return {
      id: request.id,
      projectId: request.projectId,
      organizationId: request.organizationId,
      requesterId: request.requesterId,
      memberId: request.requesterId,
      reason: request.reason,
      status: this.mapProjectLeaveStatus(request.status),
      rawStatus: request.status,
      reviewNote: request.reviewNote,
      reviewedById: request.reviewedById,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      project: request.project,
      requester: request.requester,
      member: request.requester,
      reviewedBy: request.reviewedBy,
    };
  }

  private mapProjectLeaveStatus(status: ProjectLeaveRequestStatus) {
    const map = {
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      CANCELED: 'canceled',
    } satisfies Record<ProjectLeaveRequestStatus, string>;

    return map[status];
  }

  private getDisplayName(user: {
    firstName: string;
    lastName: string;
    displayName: string | null;
    email: string;
  }) {
    return (
      user.displayName ||
      `${user.firstName} ${user.lastName}`.trim() ||
      user.email
    );
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

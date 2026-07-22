import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Role, TaskStatus } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import type { AppEnv } from '../config/env';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RAGService } from '../rag/rag.service';
import type {
  AssignTaskInput,
  CreateTaskInput,
  ListTasksQueryInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from './tasks.schemas';

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

const taskListSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigneeId: true,
  reporterId: true,
  deadline: true,
  estimatedHours: true,
  tags: true,
  aiMetadata: true,
  createdAt: true,
  updatedAt: true,
  assignee: {
    select: userSummarySelect,
  },
  reporter: {
    select: userSummarySelect,
  },
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      teamId: true,
    },
  },
  _count: {
    select: {
      comments: true,
      attachments: true,
      activities: true,
    },
  },
} satisfies Prisma.TaskSelect;

const taskDetailSelect = {
  ...taskListSelect,
  comments: {
    take: 5,
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      author: {
        select: userSummarySelect,
      },
    },
  },
  attachments: {
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      entityType: true,
      fileName: true,
      fileUrl: true,
      fileSize: true,
      mimeType: true,
      createdAt: true,
      uploadedBy: {
        select: userSummarySelect,
      },
    },
  },
  activities: {
    take: 10,
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      action: true,
      metadata: true,
      createdAt: true,
      actor: {
        select: userSummarySelect,
      },
    },
  },
} satisfies Prisma.TaskSelect;

type TaskListRow = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;
type TaskDetailRow = Prisma.TaskGetPayload<{ select: typeof taskDetailSelect }>;

type OrganizationSettings = {
  autoAssignOnTaskCreate: boolean;
};

type AssignmentCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: Role;
  profile: {
    currentJobTitle: string | null;
    yearsOfExperience: number | null;
  } | null;
  abilities: Array<{ name: string; keywords: string[] }>;
  tasksAssigned: Array<{ estimatedHours: number | null }>;
};

type RankedCandidate = {
  candidate: AssignmentCandidate;
  score: number;
  workload: number;
  matchedSkills: string[];
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly ragService: RAGService,
  ) {}

  async createTask(currentUser: JwtUser, input: CreateTaskInput) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanCreateTask(currentUser, organizationId);

    if (input.projectId) {
      await this.assertProjectBelongsToOrganization(
        organizationId,
        input.projectId,
      );
    }

    const assigneeId =
      input.assigneeId ??
      (await this.resolveAutoAssigneeId(
        organizationId,
        input.projectId,
        input,
      ));
    const autoAssigned = !input.assigneeId && Boolean(assigneeId);
    const assignmentMetadata = autoAssigned
      ? {
          aiAssigned: true,
          assignedAt: new Date().toISOString(),
          method: 'auto-assign',
        }
      : undefined;

    if (assigneeId) {
      await this.assertActiveOrganizationMember(organizationId, assigneeId);
    }

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          organizationId,
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          assigneeId,
          reporterId: currentUser.sub,
          deadline: input.deadline,
          estimatedHours: input.estimatedHours,
          tags: input.tags,
          aiMetadata: assignmentMetadata,
        },
        select: {
          id: true,
        },
      });

      await ActivityService.logActivity(tx, {
        organizationId,
        actorId: currentUser.sub,
        taskId: created.id,
        projectId: input.projectId,
        action: 'TASK_CREATED',
        metadata: {
          title: input.title,
          assigneeId,
          priority: input.priority,
        },
      });

      return tx.task.findUnique({
        where: {
          id: created.id,
        },
        select: taskListSelect,
      });
    });

    if (task?.assigneeId) {
      await this.notifyTaskAssigned(task);
    }
    void this.syncTaskIndex(organizationId, task!.id);

    return serializeResponse({
      message: 'Task created successfully.',
      task: this.mapTaskListItem(task as TaskListRow),
    });
  }

  async listTasks(currentUser: JwtUser, query: ListTasksQueryInput) {
    const organizationId = this.getOrganizationId(currentUser);
    const role = this.getRoleForOrganization(currentUser, organizationId);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = this.buildTaskWhere(
      organizationId,
      query,
      role,
      currentUser.sub,
    );

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        select: taskListSelect,
      }),
      this.prisma.task.count({ where }),
    ]);

    return serializeResponse({
      data: tasks.map((task) => this.mapTaskListItem(task)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async getMyTasks(currentUser: JwtUser, query: ListTasksQueryInput) {
    return this.listTasks(currentUser, {
      ...query,
      assigneeId: currentUser.sub,
    });
  }

  async getTask(currentUser: JwtUser, taskId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const task = await this.getTaskOrThrow(
      organizationId,
      taskId,
      taskDetailSelect,
    );
    this.assertCanViewTask(currentUser, organizationId, task.assigneeId);

    return serializeResponse(this.mapTaskDetail(task));
  }

  async updateTask(
    currentUser: JwtUser,
    taskId: string,
    input: UpdateTaskInput,
    aiMetadata?: Prisma.InputJsonValue,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const existing = await this.getTaskOrThrow(organizationId, taskId, {
      id: true,
      projectId: true,
      assigneeId: true,
      status: true,
      title: true,
    } satisfies Prisma.TaskSelect);
    this.assertCanUpdateTask(
      currentUser,
      organizationId,
      existing.assigneeId,
      input,
    );

    if (input.projectId) {
      await this.assertProjectBelongsToOrganization(
        organizationId,
        input.projectId,
      );
    }

    if (input.assigneeId) {
      await this.assertActiveOrganizationMember(
        organizationId,
        input.assigneeId,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: {
          id: taskId,
        },
        data: {
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          assigneeId: input.assigneeId,
          deadline: input.deadline,
          estimatedHours: input.estimatedHours,
          tags: input.tags,
          aiMetadata,
        },
        select: taskListSelect,
      });

      await ActivityService.logActivity(tx, {
        organizationId,
        actorId: currentUser.sub,
        taskId,
        projectId: task.projectId,
        action: 'TASK_UPDATED',
        metadata: {
          previousStatus: existing.status,
          nextStatus: task.status,
          previousAssigneeId: existing.assigneeId,
          nextAssigneeId: task.assigneeId,
        },
      });

      if (input.status && input.status !== existing.status) {
        await ActivityService.logActivity(tx, {
          organizationId,
          actorId: currentUser.sub,
          taskId,
          projectId: task.projectId,
          action: 'TASK_STATUS_CHANGED',
          metadata: {
            from: existing.status,
            to: input.status,
          },
        });
      }

      if (input.assigneeId && input.assigneeId !== existing.assigneeId) {
        await ActivityService.logActivity(tx, {
          organizationId,
          actorId: currentUser.sub,
          taskId,
          projectId: task.projectId,
          action: 'TASK_ASSIGNED',
          metadata: {
            from: existing.assigneeId,
            to: input.assigneeId,
          },
        });
      }

      return task;
    });

    if (input.status && updated.assigneeId) {
      await this.notificationsService.createNotification({
        userId: updated.assigneeId,
        organizationId,
        type: 'TASK_STATUS_CHANGED',
        title: 'Task status changed',
        body: `${updated.title} moved to ${updated.status}.`,
        metadata: {
          taskId: updated.id,
          status: updated.status,
        },
      });
    }

    if (input.assigneeId && input.assigneeId !== existing.assigneeId) {
      await this.notifyTaskAssigned(updated);
    }
    void this.syncTaskIndex(organizationId, updated.id);

    return serializeResponse({
      message: 'Task updated successfully.',
      task: this.mapTaskListItem(updated),
    });
  }

  async updateTaskStatus(
    currentUser: JwtUser,
    taskId: string,
    input: UpdateTaskStatusInput,
  ) {
    return this.updateTask(currentUser, taskId, { status: input.status });
  }

  async assignTask(
    currentUser: JwtUser,
    taskId: string,
    input: AssignTaskInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanAssignTask(currentUser, organizationId);
    if (input.assigneeId) {
      await this.assertActiveOrganizationMember(
        organizationId,
        input.assigneeId,
      );
    }

    return this.updateTask(
      currentUser,
      taskId,
      { assigneeId: input.assigneeId },
      input.aiAssigned
        ? {
            aiAssigned: true,
            confidence: input.confidence ?? null,
            assignedAt: new Date().toISOString(),
          }
        : { aiAssigned: false },
    );
  }

  async getAssignmentSuggestions(currentUser: JwtUser, taskId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanAssignTask(currentUser, organizationId);
    const task = await this.getTaskOrThrow(organizationId, taskId, {
      id: true,
      projectId: true,
      title: true,
      description: true,
      tags: true,
    } satisfies Prisma.TaskSelect);
    const projectCandidates = await this.getAutoAssignCandidates(
      organizationId,
      task.projectId ?? undefined,
    );
    const candidates = projectCandidates.length
      ? projectCandidates
      : await this.getAutoAssignCandidates(organizationId);
    const ranked = this.rankAssignmentCandidates(task.tags, candidates);

    if (ranked.length === 0) {
      return serializeResponse({
        suggestions: [],
        analysisMethod: 'AI',
        message: 'No eligible assignment candidates were found.',
      });
    }

    try {
      const aiResult = await this.ragService.generateStructuredResponse(
        [
          'Rank the eligible candidates for this task.',
          'Return JSON with a suggestions array.',
          'Each suggestion must contain userId, score (0-100), and a concise reason.',
          'Use only candidate IDs supplied in the context.',
          'Consider task meaning, skill relevance, workload, and experience.',
        ].join(' '),
        [
          JSON.stringify({
            task: {
              title: task.title,
              description: task.description,
              requiredSkills: task.tags,
            },
            candidates: ranked.map((item) => ({
              userId: item.candidate.id,
              skills: item.candidate.abilities.flatMap((ability) => [
                ability.name,
                ...ability.keywords,
              ]),
              workload: item.workload,
              yearsOfExperience: item.candidate.profile?.yearsOfExperience ?? 0,
              baselineScore: item.score,
            })),
          }),
        ],
      );
      const suggestions = this.mapAiAssignmentSuggestions(aiResult, ranked);

      if (suggestions.length > 0) {
        return serializeResponse({
          suggestions,
          analysisMethod: 'AI',
        });
      }
    } catch (error) {
      this.logger.warn(
        `AI assignment ranking failed for task ${taskId}; using the backend scoring fallback. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return serializeResponse({
      suggestions: ranked
        .slice(0, 5)
        .map((item) =>
          this.mapRankedCandidate(item, item.score, this.fallbackReason(item)),
        ),
      analysisMethod: 'HEURISTIC_FALLBACK',
      message: 'AI provider unavailable; backend scoring fallback was used.',
    });
  }

  async deleteTask(currentUser: JwtUser, taskId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const task = await this.getTaskOrThrow(organizationId, taskId, {
      id: true,
      reporterId: true,
    } satisfies Prisma.TaskSelect);

    this.assertCanDeleteTask(currentUser, organizationId, task.reporterId);

    await this.prisma.task.delete({
      where: {
        id: taskId,
      },
    });
    void this.syncTaskIndex(organizationId, taskId);

    return serializeResponse({
      message: 'Task deleted successfully.',
    });
  }

  private buildTaskWhere(
    organizationId: string,
    query: ListTasksQueryInput,
    role?: string,
    userId?: string,
  ) {
    return {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(role === 'MEMBER'
        ? { assigneeId: userId }
        : query.assigneeId
          ? { assigneeId: query.assigneeId }
          : {}),
      ...(query.reporterId ? { reporterId: query.reporterId } : {}),
      ...(query.tags?.length
        ? {
            tags: {
              hasEvery: query.tags,
            },
          }
        : {}),
      ...(query.isOverdue
        ? {
            deadline: {
              lt: new Date(),
            },
            status: {
              notIn: ['DONE', 'CANCELLED'] as TaskStatus[],
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: {
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
    } satisfies Prisma.TaskWhereInput;
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

  private assertCanAssignTask(currentUser: JwtUser, organizationId: string) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      role === 'TEAM_LEADER'
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to assign tasks.');
  }

  private assertCanDeleteTask(
    currentUser: JwtUser,
    organizationId: string,
    reporterId: string,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      (role === 'TEAM_LEADER' && reporterId === currentUser.sub)
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to delete this task.');
  }

  private assertCanCreateTask(currentUser: JwtUser, organizationId: string) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      role === 'TEAM_LEADER'
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to create tasks.');
  }

  private assertCanViewTask(
    currentUser: JwtUser,
    organizationId: string,
    assigneeId: string | null,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (role !== 'MEMBER' || assigneeId === currentUser.sub) {
      return;
    }

    throw new ForbiddenException('You can only view tasks assigned to you.');
  }

  private assertCanUpdateTask(
    currentUser: JwtUser,
    organizationId: string,
    assigneeId: string | null,
    input: UpdateTaskInput,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      role === 'TEAM_LEADER'
    ) {
      return;
    }

    const changedFields = Object.keys(input);
    const isOwnStatusOnlyUpdate =
      role === 'MEMBER' &&
      assigneeId === currentUser.sub &&
      changedFields.length === 1 &&
      changedFields[0] === 'status';

    if (isOwnStatusOnlyUpdate) {
      return;
    }

    throw new ForbiddenException(
      'Members can only update the status of tasks assigned to them.',
    );
  }

  private async assertProjectBelongsToOrganization(
    organizationId: string,
    projectId: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        status: {
          not: 'ARCHIVED',
        },
      },
      select: {
        id: true,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
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

  private async getTaskOrThrow<T extends Prisma.TaskSelect>(
    organizationId: string,
    taskId: string,
    select: T,
  ): Promise<Prisma.TaskGetPayload<{ select: T }>> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        organizationId,
      },
      select,
    });

    if (!task) {
      throw new NotFoundException('Task not found.');
    }

    return task;
  }

  private async notifyTaskAssigned(task: TaskListRow) {
    if (!task.assigneeId || !task.assignee?.email) {
      return;
    }

    const taskUrl = `${this.configService.get('APP_URL', { infer: true })}/tasks/${task.id}`;

    await this.notificationsService.createNotification({
      userId: task.assigneeId,
      organizationId: task.organizationId,
      type: 'TASK_ASSIGNED',
      title: 'New task assigned',
      body: `You have been assigned: ${task.title}.`,
      metadata: {
        taskId: task.id,
        projectId: task.projectId,
        aiMetadata: task.aiMetadata,
      },
    });

    await this.mailService.sendTaskAssignedEmail({
      to: task.assignee.email,
      taskTitle: task.title,
      taskUrl,
      assigneeName: task.assignee.displayName ?? task.assignee.firstName,
      deadline: task.deadline,
    });
  }

  private async syncTaskIndex(organizationId: string, taskId: string) {
    try {
      await this.ragService.syncTaskData(organizationId, taskId);
    } catch (error) {
      this.logger.error(
        `Could not synchronize task ${taskId} with the AI knowledge base: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async resolveAutoAssigneeId(
    organizationId: string,
    projectId: string | undefined,
    input: CreateTaskInput,
  ) {
    const settings = await this.getOrganizationSettings(organizationId);

    if (!settings.autoAssignOnTaskCreate) {
      return null;
    }

    const candidates = await this.getAutoAssignCandidates(
      organizationId,
      projectId,
    );
    const pool =
      candidates.length > 0
        ? candidates
        : await this.getAutoAssignCandidates(organizationId);

    const ranked = this.rankAssignmentCandidates(input.tags ?? [], pool);

    return this.rerankAutoAssignCandidates(input, ranked);
  }

  private async rerankAutoAssignCandidates(
    input: CreateTaskInput,
    ranked: RankedCandidate[],
  ) {
    const topCandidates = ranked.slice(0, 5);

    if (topCandidates.length === 0) {
      return null;
    }

    try {
      const aiResult = await this.ragService.generateStructuredResponse(
        [
          'Choose the single best assignee for this new task.',
          'Return JSON with userId, score (0-100), and reason.',
          'Use only candidate IDs supplied in the context.',
          'Consider task meaning, skill relevance, workload, and experience.',
        ].join(' '),
        [
          JSON.stringify({
            task: {
              title: input.title,
              description: input.description,
              requiredSkills: input.tags,
              priority: input.priority,
              estimatedHours: input.estimatedHours,
              deadline: input.deadline?.toISOString(),
            },
            candidates: topCandidates.map((item) => ({
              userId: item.candidate.id,
              skills: item.candidate.abilities.flatMap((ability) => [
                ability.name,
                ...ability.keywords,
              ]),
              workload: item.workload,
              yearsOfExperience: item.candidate.profile?.yearsOfExperience ?? 0,
              baselineScore: item.score,
            })),
          }),
        ],
      );
      const userId = this.extractAiAssigneeId(aiResult);

      if (
        userId &&
        topCandidates.some((item) => item.candidate.id === userId)
      ) {
        return userId;
      }
    } catch (error) {
      this.logger.warn(
        `AI auto-assignment ranking failed; using the backend scoring fallback. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return topCandidates[0]?.candidate.id ?? null;
  }

  private getAutoAssignCandidates(organizationId: string, projectId?: string) {
    return this.prisma.user.findMany({
      where: {
        memberships: {
          some: {
            organizationId,
            status: 'ACTIVE',
            role: {
              in: ['MEMBER', 'TEAM_LEADER'],
            },
          },
        },
        ...(projectId
          ? {
              OR: [
                {
                  projectMemberships: {
                    some: {
                      projectId,
                    },
                  },
                },
                {
                  teamMemberships: {
                    some: {
                      team: {
                        projects: {
                          some: {
                            id: projectId,
                          },
                        },
                      },
                    },
                  },
                },
                {
                  teamsLed: {
                    some: {
                      projects: {
                        some: {
                          id: projectId,
                        },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        role: true,
        profile: {
          select: {
            currentJobTitle: true,
            yearsOfExperience: true,
          },
        },
        abilities: {
          select: {
            name: true,
            keywords: true,
          },
        },
        tasksAssigned: {
          where: {
            status: {
              notIn: ['DONE', 'CANCELLED'],
            },
          },
          select: {
            estimatedHours: true,
          },
        },
      },
    });
  }

  private rankAssignmentCandidates(
    requiredSkills: string[],
    candidates: AssignmentCandidate[],
  ): RankedCandidate[] {
    const required = requiredSkills.map((item) => item.toLowerCase());

    return candidates
      .map((candidate) => {
        const abilityTokens = candidate.abilities.flatMap((ability) => [
          ability.name,
          ...ability.keywords,
        ]);
        const normalizedTokens = abilityTokens.map((item) =>
          item.toLowerCase(),
        );
        const matchedSkills = requiredSkills.filter((_, index) =>
          normalizedTokens.some((token) => token.includes(required[index])),
        );
        const activeHours = candidate.tasksAssigned.reduce(
          (sum, task) => sum + (task.estimatedHours ?? 5),
          0,
        );
        const workload = Math.min(100, Math.round((activeHours / 40) * 100));
        const skillScore = required.length
          ? Math.round((matchedSkills.length / required.length) * 100)
          : 60;
        const experienceScore = Math.min(
          100,
          (candidate.profile?.yearsOfExperience ?? 0) * 12,
        );

        return {
          candidate,
          workload,
          matchedSkills,
          score: Math.round(
            skillScore * 0.45 + (100 - workload) * 0.35 + experienceScore * 0.2,
          ),
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.workload - right.workload ||
          right.matchedSkills.length - left.matchedSkills.length,
      );
  }

  private mapAiAssignmentSuggestions(
    result: unknown,
    ranked: RankedCandidate[],
  ) {
    const value = result as { suggestions?: unknown };
    const raw = Array.isArray(result)
      ? result
      : Array.isArray(value?.suggestions)
        ? value.suggestions
        : [];
    const candidatesById = new Map(
      ranked.map((item) => [item.candidate.id, item]),
    );

    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const userId = typeof item.userId === 'string' ? item.userId : '';
        const rankedCandidate = candidatesById.get(userId);
        if (!rankedCandidate) return null;
        const score = Number(item.score);
        const safeScore = Number.isFinite(score)
          ? Math.max(0, Math.min(100, Math.round(score)))
          : rankedCandidate.score;
        const reason =
          typeof item.reason === 'string' && item.reason.trim()
            ? item.reason.trim()
            : this.fallbackReason(rankedCandidate);

        return this.mapRankedCandidate(rankedCandidate, safeScore, reason);
      })
      .filter((item) => item !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }

  private extractAiAssigneeId(result: unknown) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const value = result as Record<string, unknown>;
    const userId = value.userId ?? value.assigneeId ?? value.id;

    return typeof userId === 'string' && userId.trim() ? userId : null;
  }

  private mapRankedCandidate(
    item: RankedCandidate,
    score: number,
    reason: string,
  ) {
    const candidate = item.candidate;
    const name =
      candidate.displayName ??
      `${candidate.firstName} ${candidate.lastName}`.trim();

    return {
      user: {
        id: candidate.id,
        name,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        displayName: candidate.displayName,
        role: candidate.role,
        title: candidate.profile?.currentJobTitle ?? '',
        skills: candidate.abilities.map((ability) => ability.name),
        experience: candidate.profile?.yearsOfExperience ?? 0,
        capacity: item.workload,
      },
      score,
      matchedSkills: item.matchedSkills,
      reason,
    };
  }

  private fallbackReason(item: RankedCandidate) {
    return item.matchedSkills.length
      ? `Matches ${item.matchedSkills.length} required skill${
          item.matchedSkills.length === 1 ? '' : 's'
        } with ${100 - item.workload}% availability.`
      : `Has ${100 - item.workload}% availability for assignment review.`;
  }

  private async getOrganizationSettings(
    organizationId: string,
  ): Promise<OrganizationSettings> {
    const organization = await this.prisma.organization.findUnique({
      where: {
        id: organizationId,
      },
      select: {
        settings: true,
      },
    });

    const settings =
      organization?.settings &&
      typeof organization.settings === 'object' &&
      !Array.isArray(organization.settings)
        ? (organization.settings as Record<string, unknown>)
        : {};

    return {
      autoAssignOnTaskCreate: settings.autoAssignOnTaskCreate === true,
    };
  }

  private mapTaskListItem(task: TaskListRow) {
    return {
      ...task,
      commentCount: task._count.comments,
      attachmentCount: task._count.attachments,
      activityCount: task._count.activities,
      _count: undefined,
    };
  }

  private mapTaskDetail(task: TaskDetailRow) {
    return {
      ...task,
      commentCount: task._count.comments,
      attachmentCount: task._count.attachments,
      activityCount: task._count.activities,
      commentsPreview: task.comments,
      recentActivities: task.activities,
      comments: undefined,
      activities: undefined,
      _count: undefined,
    };
  }
}

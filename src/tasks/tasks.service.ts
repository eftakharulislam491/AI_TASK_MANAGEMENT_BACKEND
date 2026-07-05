import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Role, TaskPriority, TaskStatus } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { ActivityService } from '../activity/activity.service';
import { serializeResponse } from '../common/utils/response';
import type { AppEnv } from '../config/env';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {}

  async createTask(currentUser: JwtUser, input: CreateTaskInput) {
    const organizationId = this.getOrganizationId(currentUser);

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

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          organizationId,
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          assigneeId: input.assigneeId,
          reporterId: currentUser.sub,
          deadline: input.deadline,
          estimatedHours: input.estimatedHours,
          tags: input.tags,
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
          assigneeId: input.assigneeId,
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

    return serializeResponse({
      message: 'Task created successfully.',
      task: this.mapTaskListItem(task as TaskListRow),
    });
  }

  async listTasks(currentUser: JwtUser, query: ListTasksQueryInput) {
    const organizationId = this.getOrganizationId(currentUser);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = this.buildTaskWhere(organizationId, query);

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

    return serializeResponse(this.mapTaskDetail(task));
  }

  async updateTask(
    currentUser: JwtUser,
    taskId: string,
    input: UpdateTaskInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const existing = await this.getTaskOrThrow(organizationId, taskId, {
      id: true,
      projectId: true,
      assigneeId: true,
      status: true,
      title: true,
    } satisfies Prisma.TaskSelect);

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
    await this.assertActiveOrganizationMember(organizationId, input.assigneeId);

    return this.updateTask(currentUser, taskId, {
      assigneeId: input.assigneeId,
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

    return serializeResponse({
      message: 'Task deleted successfully.',
    });
  }

  private buildTaskWhere(organizationId: string, query: ListTasksQueryInput) {
    return {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
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
      reporterId === currentUser.sub
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to delete this task.');
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

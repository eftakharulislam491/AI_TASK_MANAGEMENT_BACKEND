import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListActivityQueryInput,
  ListTaskActivityQueryInput,
} from './activity.schemas';

type ActivityWriter = Prisma.TransactionClient | PrismaService;

type LogActivityInput = {
  organizationId: string;
  actorId: string;
  action: string;
  taskId?: string | null;
  projectId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

const activitySelect = {
  id: true,
  organizationId: true,
  taskId: true,
  projectId: true,
  actorId: true,
  action: true,
  metadata: true,
  createdAt: true,
  actor: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      role: true,
    },
  },
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
    },
  },
} satisfies Prisma.ActivityLogSelect;

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  static async logActivity(prisma: ActivityWriter, data: LogActivityInput) {
    return prisma.activityLog.create({
      data: {
        organizationId: data.organizationId,
        actorId: data.actorId,
        action: data.action,
        taskId: data.taskId,
        projectId: data.projectId,
        metadata: data.metadata,
      },
    });
  }

  async logActivity(data: LogActivityInput) {
    return ActivityService.logActivity(this.prisma, data);
  }

  async listOrganizationActivity(
    currentUser: JwtUser,
    query: ListActivityQueryInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertValidDateRange(query.from, query.to);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...this.buildDateFilter(query.from, query.to),
    } satisfies Prisma.ActivityLogWhereInput;

    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: activitySelect,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return serializeResponse({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  }

  async listTaskActivity(
    currentUser: JwtUser,
    taskId: string,
    query: ListTaskActivityQueryInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertValidDateRange(query.from, query.to);
    await this.assertTaskBelongsToOrganization(organizationId, taskId);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      taskId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...this.buildDateFilter(query.from, query.to),
    } satisfies Prisma.ActivityLogWhereInput;

    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: activitySelect,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return serializeResponse({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  }

  private getOrganizationId(currentUser: JwtUser) {
    if (!currentUser.currentOrganizationId) {
      throw new ForbiddenException('Organization context is required.');
    }

    return currentUser.currentOrganizationId;
  }

  private buildDateFilter(from?: Date, to?: Date) {
    if (!from && !to) {
      return {};
    }

    return {
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    } satisfies Prisma.ActivityLogWhereInput;
  }

  private assertValidDateRange(from?: Date, to?: Date) {
    if (from && to && to < from) {
      throw new BadRequestException('The to date must be after the from date.');
    }
  }

  private async assertTaskBelongsToOrganization(
    organizationId: string,
    taskId: string,
  ) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found.');
    }
  }
}

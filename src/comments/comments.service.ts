import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCommentInput,
  ListCommentsQueryInput,
  UpdateCommentInput,
} from './comments.schemas';

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

const commentSelect = {
  id: true,
  taskId: true,
  authorId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: userSummarySelect,
  },
} satisfies Prisma.CommentSelect;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createComment(
    currentUser: JwtUser,
    taskId: string,
    input: CreateCommentInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const task = await this.getTaskOrThrow(currentUser, organizationId, taskId);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          taskId,
          authorId: currentUser.sub,
          body: input.body,
        },
        select: commentSelect,
      });

      await ActivityService.logActivity(tx, {
        organizationId,
        actorId: currentUser.sub,
        taskId,
        projectId: task.projectId,
        action: 'COMMENT_ADDED',
        metadata: {
          commentId: created.id,
        },
      });

      return created;
    });

    const recipients = [...new Set([task.assigneeId, task.reporterId])]
      .filter(Boolean)
      .filter((userId) => userId !== currentUser.sub) as string[];

    await this.notificationsService.createBulkNotifications(recipients, {
      organizationId,
      type: 'TASK_COMMENT',
      title: 'New task comment',
      body: `${currentUser.email} commented on ${task.title}.`,
      metadata: {
        taskId,
        commentId: comment.id,
      },
    });

    return serializeResponse({
      message: 'Comment added successfully.',
      comment,
    });
  }

  async listComments(
    currentUser: JwtUser,
    taskId: string,
    query: ListCommentsQueryInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    await this.getTaskOrThrow(currentUser, organizationId, taskId);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      taskId,
    } satisfies Prisma.CommentWhereInput;

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: {
          createdAt: 'asc',
        },
        skip,
        take: limit,
        select: commentSelect,
      }),
      this.prisma.comment.count({ where }),
    ]);

    return serializeResponse({
      data: comments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async updateComment(
    currentUser: JwtUser,
    commentId: string,
    input: UpdateCommentInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    const existing = await this.getCommentOrThrow(
      currentUser,
      organizationId,
      commentId,
    );

    if (existing.authorId !== currentUser.sub) {
      throw new ForbiddenException('Only the author can update this comment.');
    }

    const comment = await this.prisma.comment.update({
      where: {
        id: commentId,
      },
      data: {
        body: input.body,
      },
      select: commentSelect,
    });

    return serializeResponse({
      message: 'Comment updated successfully.',
      comment,
    });
  }

  async deleteComment(currentUser: JwtUser, commentId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const comment = await this.getCommentOrThrow(
      currentUser,
      organizationId,
      commentId,
    );

    this.assertCanDeleteComment(currentUser, organizationId, comment.authorId);

    await this.prisma.comment.delete({
      where: {
        id: commentId,
      },
    });

    return serializeResponse({
      message: 'Comment deleted successfully.',
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

  private assertCanDeleteComment(
    currentUser: JwtUser,
    organizationId: string,
    authorId: string,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      authorId === currentUser.sub
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to delete this comment.');
  }

  private async getTaskOrThrow(
    currentUser: JwtUser,
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
        title: true,
        projectId: true,
        assigneeId: true,
        reporterId: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found.');
    }

    this.assertCanAccessTask(currentUser, organizationId, task.assigneeId);

    return task;
  }

  private async getCommentOrThrow(
    currentUser: JwtUser,
    organizationId: string,
    commentId: string,
  ) {
    const comment = await this.prisma.comment.findFirst({
      where: {
        id: commentId,
        task: {
          organizationId,
        },
      },
      select: {
        id: true,
        authorId: true,
        task: { select: { assigneeId: true } },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }

    this.assertCanAccessTask(
      currentUser,
      organizationId,
      comment.task.assigneeId,
    );

    return comment;
  }

  private assertCanAccessTask(
    currentUser: JwtUser,
    organizationId: string,
    assigneeId: string | null,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);
    if (role !== 'MEMBER' || assigneeId === currentUser.sub) return;

    throw new ForbiddenException('You can only access tasks assigned to you.');
  }
}

import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateNotificationInput,
  ListNotificationsQueryInput,
  MarkNotificationsReadInput,
} from './notifications.schemas';
import { NotificationsGateway } from './notifications.gateway';

const notificationSelect = {
  id: true,
  userId: true,
  organizationId: true,
  type: true,
  title: true,
  body: true,
  metadata: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async createNotification(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
      select: notificationSelect,
    });

    this.emitNotification(notification);
    return serializeResponse(notification);
  }

  async createBulkNotifications(
    recipientIds: string[],
    data: Omit<CreateNotificationInput, 'userId'>,
  ) {
    const uniqueRecipientIds = [...new Set(recipientIds)];

    if (uniqueRecipientIds.length === 0) {
      return serializeResponse([]);
    }

    const notifications = await this.prisma.$transaction(
      uniqueRecipientIds.map((userId) =>
        this.prisma.notification.create({
          data: {
            userId,
            organizationId: data.organizationId,
            type: data.type,
            title: data.title,
            body: data.body,
            metadata: data.metadata as Prisma.InputJsonValue | undefined,
          },
          select: notificationSelect,
        }),
      ),
    );

    notifications.forEach((notification) =>
      this.emitNotification(notification),
    );
    return serializeResponse(notifications);
  }

  async listMyNotifications(
    currentUser: JwtUser,
    query: ListNotificationsQueryInput,
  ) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      userId: currentUser.sub,
      ...(query.isRead === undefined ? {} : { isRead: query.isRead }),
      ...(query.type ? { type: query.type } : {}),
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
                body: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.NotificationWhereInput;

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: notificationSelect,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          userId: currentUser.sub,
          isRead: false,
        },
      }),
    ]);

    return serializeResponse({
      items,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  }

  async getUnreadCount(currentUser: JwtUser) {
    const unreadCount = await this.prisma.notification.count({
      where: {
        userId: currentUser.sub,
        isRead: false,
      },
    });

    return serializeResponse({ unreadCount });
  }

  async markAsRead(currentUser: JwtUser, input: MarkNotificationsReadInput) {
    await this.assertNotificationsBelongToUser(
      currentUser.sub,
      input.notificationIds,
    );

    await this.prisma.notification.updateMany({
      where: {
        userId: currentUser.sub,
        id: {
          in: input.notificationIds,
        },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    const notifications = await this.prisma.notification.findMany({
      where: {
        userId: currentUser.sub,
        id: {
          in: input.notificationIds,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: notificationSelect,
    });

    return serializeResponse({
      message: 'Notifications marked as read.',
      notifications,
    });
  }

  async markAllAsRead(currentUser: JwtUser) {
    await this.prisma.notification.updateMany({
      where: {
        userId: currentUser.sub,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return serializeResponse({
      message: 'All notifications marked as read.',
    });
  }

  private async assertNotificationsBelongToUser(
    userId: string,
    notificationIds: string[],
  ) {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        id: {
          in: notificationIds,
        },
      },
    });

    if (count !== new Set(notificationIds).size) {
      throw new ForbiddenException(
        'One or more notifications do not belong to the current user.',
      );
    }
  }

  private emitNotification(notification: NotificationRow) {
    this.gateway.emitToUser(
      notification.userId,
      'notification:new',
      notification,
    );
  }
}

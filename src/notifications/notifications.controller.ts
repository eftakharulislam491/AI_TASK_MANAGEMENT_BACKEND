import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  parseWithSchema,
} from './notifications.schemas';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  listMyNotifications(
    @CurrentUser() currentUser: JwtUser,
    @Query() query: unknown,
  ) {
    return this.notificationsService.listMyNotifications(
      currentUser,
      parseWithSchema(listNotificationsQuerySchema, query),
    );
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() currentUser: JwtUser) {
    return this.notificationsService.getUnreadCount(currentUser);
  }

  @Patch('read')
  markAsRead(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.notificationsService.markAsRead(
      currentUser,
      parseWithSchema(markNotificationsReadSchema, body),
    );
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() currentUser: JwtUser) {
    return this.notificationsService.markAllAsRead(currentUser);
  }
}

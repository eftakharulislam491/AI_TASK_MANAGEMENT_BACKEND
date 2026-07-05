import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  createCommentSchema,
  listCommentsQuerySchema,
  parseWithSchema,
  resourceIdValue,
  updateCommentSchema,
} from './comments.schemas';
import { CommentsService } from './comments.service';

@Controller()
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('tasks/:taskId/comments')
  createComment(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.commentsService.createComment(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      parseWithSchema(createCommentSchema, body),
    );
  }

  @Get('tasks/:taskId/comments')
  listComments(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
    @Query() query: unknown,
  ) {
    return this.commentsService.listComments(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      parseWithSchema(listCommentsQuerySchema, query),
    );
  }

  @Patch('comments/:commentId')
  updateComment(
    @CurrentUser() currentUser: JwtUser,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    return this.commentsService.updateComment(
      currentUser,
      parseWithSchema(resourceIdValue, commentId),
      parseWithSchema(updateCommentSchema, body),
    );
  }

  @Delete('comments/:commentId')
  deleteComment(
    @CurrentUser() currentUser: JwtUser,
    @Param('commentId') commentId: string,
  ) {
    return this.commentsService.deleteComment(
      currentUser,
      parseWithSchema(resourceIdValue, commentId),
    );
  }
}

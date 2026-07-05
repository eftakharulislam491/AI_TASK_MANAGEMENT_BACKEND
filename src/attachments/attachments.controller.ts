import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  createAttachmentSchema,
  parseWithSchema,
  resourceIdValue,
} from './attachments.schemas';
import { AttachmentsService } from './attachments.service';

@Controller()
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('attachments')
  createAttachment(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.attachmentsService.createAttachment(
      currentUser,
      parseWithSchema(createAttachmentSchema, body),
    );
  }

  @Get('tasks/:taskId/attachments')
  listTaskAttachments(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
  ) {
    return this.attachmentsService.listTaskAttachments(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
    );
  }

  @Delete('attachments/:attachmentId')
  deleteAttachment(
    @CurrentUser() currentUser: JwtUser,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachmentsService.deleteAttachment(
      currentUser,
      parseWithSchema(resourceIdValue, attachmentId),
    );
  }
}

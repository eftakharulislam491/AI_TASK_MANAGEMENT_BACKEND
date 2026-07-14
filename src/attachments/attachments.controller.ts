import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
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

  @Post('attachments/upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadTaskAttachment(
    @CurrentUser() currentUser: JwtUser,
    @Body('taskId') taskId: unknown,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
    @Req() request: Request,
  ) {
    const host = request.get('host');
    const publicBaseUrl = host ? `${request.protocol}://${host}` : '';

    return this.attachmentsService.uploadTaskAttachment(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      file,
      publicBaseUrl,
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

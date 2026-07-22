import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  createDiscussionSchema,
  createRequirementSchema,
  linkTaskSchema,
  parseWithSchema,
  rejectRequirementSchema,
  requirementQuerySchema,
  resourceIdValue,
  updateRequirementSchema,
} from './requirements.schemas';
import { RequirementsService } from './requirements.service';

@Controller('requirements')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.requirementsService.createRequirement(
      user,
      parseWithSchema(createRequirementSchema, body),
    );
  }

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return this.requirementsService.listRequirements(
      user,
      parseWithSchema(requirementQuerySchema, query),
    );
  }

  @Get(':requirementId')
  get(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.getRequirement(
      user,
      parseWithSchema(resourceIdValue, requirementId),
    );
  }

  @Patch(':requirementId')
  update(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
    @Body() body: unknown,
  ) {
    return this.requirementsService.updateRequirement(
      user,
      parseWithSchema(resourceIdValue, requirementId),
      parseWithSchema(updateRequirementSchema, body),
    );
  }

  @Delete(':requirementId')
  remove(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.deleteRequirement(
      user,
      parseWithSchema(resourceIdValue, requirementId),
    );
  }

  @Post(':requirementId/submit')
  submit(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.submitRequirement(user, requirementId);
  }

  @Post(':requirementId/review')
  startReview(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.startReview(user, requirementId);
  }

  @Post(':requirementId/approve')
  approve(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.approveRequirement(user, requirementId);
  }

  @Post(':requirementId/reject')
  reject(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
    @Body() body: unknown,
  ) {
    return this.requirementsService.rejectRequirement(
      user,
      requirementId,
      parseWithSchema(rejectRequirementSchema, body),
    );
  }

  @Post(':requirementId/implement')
  implement(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.implementRequirement(user, requirementId);
  }

  @Get(':requirementId/versions')
  versions(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.getVersions(user, requirementId);
  }

  @Get(':requirementId/versions/:version')
  version(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
    @Param('version') version: string,
  ) {
    return this.requirementsService.getVersion(user, requirementId, version);
  }

  @Post(':requirementId/discussions')
  createDiscussion(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
    @Body() body: unknown,
  ) {
    return this.requirementsService.createDiscussion(
      user,
      requirementId,
      parseWithSchema(createDiscussionSchema, body),
    );
  }

  @Get(':requirementId/discussions')
  discussions(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.getDiscussions(user, requirementId);
  }

  @Delete('discussions/:discussionId')
  deleteDiscussion(
    @CurrentUser() user: JwtUser,
    @Param('discussionId') discussionId: string,
  ) {
    return this.requirementsService.deleteDiscussion(user, discussionId);
  }

  @Post(':requirementId/attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadAttachment(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
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
    return this.requirementsService.uploadAttachment(
      user,
      requirementId,
      file,
      publicBaseUrl,
    );
  }

  @Get(':requirementId/attachments')
  attachments(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.getAttachments(user, requirementId);
  }

  @Delete('attachments/:attachmentId')
  deleteAttachment(
    @CurrentUser() user: JwtUser,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.requirementsService.deleteAttachment(user, attachmentId);
  }

  @Get(':requirementId/change-log')
  changeLog(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirementsService.getChangeLog(user, requirementId);
  }

  @Post(':requirementId/link-task')
  linkTask(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
    @Body() body: unknown,
  ) {
    return this.requirementsService.linkTask(
      user,
      requirementId,
      parseWithSchema(linkTaskSchema, body),
    );
  }

  @Delete(':requirementId/unlink-task/:taskId')
  unlinkTask(
    @CurrentUser() user: JwtUser,
    @Param('requirementId') requirementId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.requirementsService.unlinkTask(user, requirementId, taskId);
  }
}

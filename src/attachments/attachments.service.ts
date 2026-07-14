import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAttachmentInput } from './attachments.schemas';

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

const attachmentSelect = {
  id: true,
  entityType: true,
  taskId: true,
  commentId: true,
  projectId: true,
  uploadedById: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  mimeType: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: {
    select: userSummarySelect,
  },
} satisfies Prisma.AttachmentSelect;

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAttachment(currentUser: JwtUser, input: CreateAttachmentInput) {
    const organizationId = this.getOrganizationId(currentUser);
    await this.assertParentBelongsToOrganization(
      currentUser,
      organizationId,
      input,
    );

    const attachment = await this.prisma.attachment.create({
      data: {
        entityType: input.entityType,
        taskId: input.taskId,
        commentId: input.commentId,
        projectId: input.projectId,
        uploadedById: currentUser.sub,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
      },
      select: attachmentSelect,
    });

    return serializeResponse({
      message: 'Attachment created successfully.',
      attachment,
    });
  }

  async uploadTaskAttachment(
    currentUser: JwtUser,
    taskId: string,
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
    publicBaseUrl: string,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required.');
    }

    const organizationId = this.getOrganizationId(currentUser);
    await this.assertTaskBelongsToOrganization(
      currentUser,
      organizationId,
      taskId,
    );
    const uploadsDirectory = join(process.cwd(), 'uploads');
    await mkdir(uploadsDirectory, { recursive: true });
    const storedName = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
    const storedPath = join(uploadsDirectory, storedName);
    await writeFile(storedPath, file.buffer);

    try {
      return await this.createAttachment(currentUser, {
        entityType: 'TASK',
        taskId,
        fileName: file.originalname,
        fileUrl: `${publicBaseUrl}/uploads/${storedName}`,
        fileSize: file.size,
        mimeType: file.mimetype,
      });
    } catch (error) {
      await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  }

  async listTaskAttachments(currentUser: JwtUser, taskId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    await this.assertTaskBelongsToOrganization(
      currentUser,
      organizationId,
      taskId,
    );

    const attachments = await this.prisma.attachment.findMany({
      where: {
        OR: [
          {
            taskId,
          },
          {
            comment: {
              taskId,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: attachmentSelect,
    });

    return serializeResponse(attachments);
  }

  async deleteAttachment(currentUser: JwtUser, attachmentId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        OR: [
          {
            task: {
              organizationId,
            },
          },
          {
            comment: {
              task: {
                organizationId,
              },
            },
          },
          {
            project: {
              organizationId,
            },
          },
        ],
      },
      select: {
        id: true,
        uploadedById: true,
        fileUrl: true,
      },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found.');
    }

    this.assertCanDeleteAttachment(
      currentUser,
      organizationId,
      attachment.uploadedById,
    );

    await this.prisma.attachment.delete({
      where: {
        id: attachmentId,
      },
    });

    const localFileName = this.getLocalUploadName(attachment.fileUrl);
    if (localFileName) {
      await unlink(join(process.cwd(), 'uploads', localFileName)).catch(
        () => undefined,
      );
    }

    return serializeResponse({
      message: 'Attachment deleted successfully.',
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

  private assertCanDeleteAttachment(
    currentUser: JwtUser,
    organizationId: string,
    uploadedById: string,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (
      role === 'SUPER_ADMIN' ||
      role === 'MANAGER' ||
      uploadedById === currentUser.sub
    ) {
      return;
    }

    throw new ForbiddenException(
      'You are not allowed to delete this attachment.',
    );
  }

  private async assertParentBelongsToOrganization(
    currentUser: JwtUser,
    organizationId: string,
    input: CreateAttachmentInput,
  ) {
    if (input.entityType === 'TASK' && input.taskId) {
      await this.assertTaskBelongsToOrganization(
        currentUser,
        organizationId,
        input.taskId,
      );
      return;
    }

    if (input.entityType === 'COMMENT' && input.commentId) {
      const comment = await this.prisma.comment.findFirst({
        where: {
          id: input.commentId,
          task: {
            organizationId,
          },
        },
        select: {
          id: true,
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

      return;
    }

    if (input.entityType === 'PROJECT' && input.projectId) {
      const project = await this.prisma.project.findFirst({
        where: {
          id: input.projectId,
          organizationId,
        },
        select: {
          id: true,
        },
      });

      if (!project) {
        throw new NotFoundException('Project not found.');
      }
    }
  }

  private async assertTaskBelongsToOrganization(
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
        assigneeId: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found.');
    }

    this.assertCanAccessTask(currentUser, organizationId, task.assigneeId);
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

  private getLocalUploadName(fileUrl: string) {
    try {
      const url = new URL(fileUrl);
      if (!url.pathname.startsWith('/uploads/')) return null;
      return basename(url.pathname);
    } catch {
      return null;
    }
  }
}

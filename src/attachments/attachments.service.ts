import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
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
    await this.assertParentBelongsToOrganization(organizationId, input);

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

  async listTaskAttachments(currentUser: JwtUser, taskId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    await this.assertTaskBelongsToOrganization(organizationId, taskId);

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
    organizationId: string,
    input: CreateAttachmentInput,
  ) {
    if (input.entityType === 'TASK' && input.taskId) {
      await this.assertTaskBelongsToOrganization(organizationId, input.taskId);
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
        },
      });

      if (!comment) {
        throw new NotFoundException('Comment not found.');
      }

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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Requirement,
  RequirementStatus,
  Role,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ActivityService } from '../activity/activity.service';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { serializeResponse } from '../common/utils/response';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateDiscussionInput,
  CreateRequirementInput,
  LinkTaskInput,
  RejectRequirementInput,
  RequirementQueryInput,
  UpdateRequirementInput,
} from './requirements.schemas';
import { canTransitionRequirement } from './requirements.workflow';

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

const projectSummarySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
} satisfies Prisma.ProjectSelect;

const requirementListSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  source: true,
  clientName: true,
  clientEmail: true,
  expectedDelivery: true,
  actualDelivery: true,
  approvedById: true,
  approvedAt: true,
  metadata: true,
  version: true,
  isLatestVersion: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  project: { select: projectSummarySelect },
  createdBy: { select: userSummarySelect },
  approvedBy: { select: userSummarySelect },
  _count: {
    select: {
      tasks: true,
      discussions: true,
      attachments: true,
      versionHistory: true,
      changeLogs: true,
    },
  },
} satisfies Prisma.RequirementSelect;

const linkedTaskSelect = {
  id: true,
  relationType: true,
  createdAt: true,
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      projectId: true,
      deadline: true,
    },
  },
} satisfies Prisma.TaskRequirementSelect;

const discussionSelect = {
  id: true,
  requirementId: true,
  authorId: true,
  body: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: userSummarySelect },
} satisfies Prisma.RequirementDiscussionSelect;

const attachmentSelect = {
  id: true,
  requirementId: true,
  uploadedById: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  mimeType: true,
  createdAt: true,
  uploadedBy: { select: userSummarySelect },
} satisfies Prisma.RequirementAttachmentSelect;

const versionSelect = {
  id: true,
  requirementId: true,
  version: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  type: true,
  changeSummary: true,
  metadata: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: userSummarySelect },
} satisfies Prisma.RequirementVersionSelect;

const changeLogSelect = {
  id: true,
  requirementId: true,
  field: true,
  oldValue: true,
  newValue: true,
  changedById: true,
  changeNote: true,
  createdAt: true,
  changedBy: { select: userSummarySelect },
} satisfies Prisma.RequirementChangeLogSelect;

const trackedFields = [
  'projectId',
  'title',
  'description',
  'type',
  'status',
  'priority',
  'source',
  'clientName',
  'clientEmail',
  'expectedDelivery',
  'actualDelivery',
  'approvedById',
  'approvedAt',
  'metadata',
] as const;

type RequirementListRow = Prisma.RequirementGetPayload<{
  select: typeof requirementListSelect;
}>;

@Injectable()
export class RequirementsService {
  private readonly logger = new Logger(RequirementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createRequirement(user: JwtUser, input: CreateRequirementInput) {
    const organizationId = this.getOrganizationId(user);
    this.assertCanCreate(user, organizationId);
    if (input.projectId) {
      await this.assertProject(organizationId, input.projectId);
    }

    const requirement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          organizationId,
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          type: input.type,
          priority: input.priority,
          source: input.source,
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          expectedDelivery: input.expectedDelivery,
          actualDelivery: input.actualDelivery,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          createdById: user.sub,
        },
      });

      await tx.requirementVersion.create({
        data: this.versionData(created, user.sub, 'Initial version'),
      });

      return tx.requirement.findUniqueOrThrow({
        where: { id: created.id },
        select: requirementListSelect,
      });
    });

    await this.recordActivity(
      organizationId,
      user.sub,
      'REQUIREMENT_CREATED',
      requirement,
    );
    return serializeResponse({
      message: 'Requirement created successfully.',
      requirement,
    });
  }

  async listRequirements(user: JwtUser, query: RequirementQueryInput) {
    const organizationId = this.getOrganizationId(user);
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                clientName: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.RequirementWhereInput;
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.prisma.requirement.findMany({
        where,
        select: requirementListSelect,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.requirement.count({ where }),
    ]);

    return serializeResponse({
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    });
  }

  async getRequirement(user: JwtUser, requirementId: string) {
    const organizationId = this.getOrganizationId(user);
    const requirement = await this.prisma.requirement.findFirst({
      where: { id: requirementId, organizationId },
      select: {
        ...requirementListSelect,
        tasks: { select: linkedTaskSelect, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!requirement) throw new NotFoundException('Requirement not found.');
    return serializeResponse(requirement);
  }

  async updateRequirement(
    user: JwtUser,
    requirementId: string,
    input: UpdateRequirementInput,
  ) {
    const organizationId = this.getOrganizationId(user);
    const current = await this.findRequirement(organizationId, requirementId);
    this.assertCanEdit(user, organizationId, current);
    if (current.status === 'DEPRECATED') {
      throw new BadRequestException(
        'Deprecated requirements cannot be edited.',
      );
    }
    if (input.projectId)
      await this.assertProject(organizationId, input.projectId);

    const { changeSummary, changeNote, ...patch } = input;
    const changes = this.calculateChanges(current, patch);
    if (changes.length === 0) {
      throw new BadRequestException('No requirement fields changed.');
    }

    const requirement = await this.prisma.$transaction(async (tx) => {
      const nextVersion = current.version + 1;
      const updated = await tx.requirement.update({
        where: { id: requirementId },
        data: {
          ...patch,
          metadata: patch.metadata as Prisma.InputJsonValue | undefined,
          version: nextVersion,
        },
      });

      await tx.requirementVersion.create({
        data: this.versionData(
          updated,
          user.sub,
          changeSummary || this.summarizeChanges(changes),
        ),
      });
      await tx.requirementChangeLog.createMany({
        data: changes.map((change) => ({
          requirementId,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedById: user.sub,
          changeNote,
        })),
      });

      return tx.requirement.findUniqueOrThrow({
        where: { id: requirementId },
        select: requirementListSelect,
      });
    });

    await this.recordActivity(
      organizationId,
      user.sub,
      'REQUIREMENT_UPDATED',
      requirement,
      {
        fields: changes.map((item) => item.field),
      },
    );
    return serializeResponse({
      message: 'Requirement updated successfully.',
      requirement,
    });
  }

  async deleteRequirement(user: JwtUser, requirementId: string) {
    const organizationId = this.getOrganizationId(user);
    const current = await this.findRequirement(organizationId, requirementId);
    this.assertCanEdit(user, organizationId, current);
    if (current.status === 'DEPRECATED') {
      return serializeResponse({
        message: 'Requirement is already deprecated.',
      });
    }
    const requirement = await this.transition(
      user,
      current,
      'DEPRECATED',
      'Requirement deprecated',
      undefined,
      true,
    );
    return serializeResponse({
      message: 'Requirement deprecated successfully.',
      requirement,
    });
  }

  async submitRequirement(user: JwtUser, requirementId: string) {
    const current = await this.workflowRequirement(user, requirementId, false);
    this.assertCanEdit(user, current.organizationId, current);
    return this.transitionResponse(user, current, 'SUBMITTED');
  }

  async startReview(user: JwtUser, requirementId: string) {
    const current = await this.workflowRequirement(user, requirementId, true);
    return this.transitionResponse(user, current, 'UNDER_REVIEW');
  }

  async approveRequirement(user: JwtUser, requirementId: string) {
    const current = await this.workflowRequirement(user, requirementId, true);
    return this.transitionResponse(user, current, 'APPROVED', undefined, {
      approvedById: user.sub,
      approvedAt: new Date(),
    });
  }

  async rejectRequirement(
    user: JwtUser,
    requirementId: string,
    input: RejectRequirementInput,
  ) {
    const current = await this.workflowRequirement(user, requirementId, true);
    return this.transitionResponse(user, current, 'REJECTED', input.reason, {
      approvedById: null,
      approvedAt: null,
    });
  }

  async implementRequirement(user: JwtUser, requirementId: string) {
    const current = await this.workflowRequirement(user, requirementId, true);
    return this.transitionResponse(user, current, 'IMPLEMENTED', undefined, {
      actualDelivery: current.actualDelivery || new Date(),
    });
  }

  async getVersions(user: JwtUser, requirementId: string) {
    await this.assertRequirementAccess(user, requirementId);
    const versions = await this.prisma.requirementVersion.findMany({
      where: { requirementId },
      select: versionSelect,
      orderBy: { version: 'desc' },
    });
    return serializeResponse(versions);
  }

  async getVersion(user: JwtUser, requirementId: string, rawVersion: string) {
    await this.assertRequirementAccess(user, requirementId);
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException('Version must be a positive integer.');
    }
    const snapshot = await this.prisma.requirementVersion.findUnique({
      where: { requirementId_version: { requirementId, version } },
      select: versionSelect,
    });
    if (!snapshot)
      throw new NotFoundException('Requirement version not found.');
    return serializeResponse(snapshot);
  }

  async createDiscussion(
    user: JwtUser,
    requirementId: string,
    input: CreateDiscussionInput,
  ) {
    await this.assertRequirementAccess(user, requirementId);
    if (input.parentId) {
      const parent = await this.prisma.requirementDiscussion.findFirst({
        where: { id: input.parentId, requirementId },
        select: { id: true },
      });
      if (!parent)
        throw new BadRequestException('Parent discussion was not found.');
    }
    const discussion = await this.prisma.requirementDiscussion.create({
      data: {
        requirementId,
        authorId: user.sub,
        body: input.body,
        parentId: input.parentId,
      },
      select: discussionSelect,
    });
    return serializeResponse({ message: 'Discussion added.', discussion });
  }

  async getDiscussions(user: JwtUser, requirementId: string) {
    await this.assertRequirementAccess(user, requirementId);
    const rows = await this.prisma.requirementDiscussion.findMany({
      where: { requirementId },
      select: discussionSelect,
      orderBy: { createdAt: 'asc' },
    });
    const byId = new Map(
      rows.map((row) => [row.id, { ...row, replies: [] as unknown[] }]),
    );
    const roots: Array<(typeof rows)[number] & { replies: unknown[] }> = [];
    byId.forEach((row) => {
      const parent = row.parentId ? byId.get(row.parentId) : null;
      if (parent) parent.replies.push(row);
      else roots.push(row);
    });
    return serializeResponse(roots);
  }

  async deleteDiscussion(user: JwtUser, discussionId: string) {
    const organizationId = this.getOrganizationId(user);
    const discussion = await this.prisma.requirementDiscussion.findFirst({
      where: { id: discussionId, requirement: { organizationId } },
      select: { id: true, authorId: true },
    });
    if (!discussion) throw new NotFoundException('Discussion not found.');
    if (
      discussion.authorId !== user.sub &&
      !this.isManager(user, organizationId)
    ) {
      throw new ForbiddenException('You cannot delete this discussion.');
    }
    await this.prisma.requirementDiscussion.delete({
      where: { id: discussionId },
    });
    return serializeResponse({ message: 'Discussion deleted.' });
  }

  async uploadAttachment(
    user: JwtUser,
    requirementId: string,
    file:
      | { originalname: string; mimetype: string; size: number; buffer: Buffer }
      | undefined,
    publicBaseUrl: string,
  ) {
    if (!file) throw new BadRequestException('A file is required.');
    await this.assertRequirementAccess(user, requirementId);
    const uploadsDirectory = join(process.cwd(), 'uploads');
    await mkdir(uploadsDirectory, { recursive: true });
    const storedName = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
    const storedPath = join(uploadsDirectory, storedName);
    await writeFile(storedPath, file.buffer);
    try {
      const attachment = await this.prisma.requirementAttachment.create({
        data: {
          requirementId,
          uploadedById: user.sub,
          fileName: file.originalname,
          fileUrl: `${publicBaseUrl}/uploads/${storedName}`,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
        select: attachmentSelect,
      });
      return serializeResponse({ message: 'Attachment uploaded.', attachment });
    } catch (error) {
      await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  }

  async getAttachments(user: JwtUser, requirementId: string) {
    await this.assertRequirementAccess(user, requirementId);
    const attachments = await this.prisma.requirementAttachment.findMany({
      where: { requirementId },
      select: attachmentSelect,
      orderBy: { createdAt: 'desc' },
    });
    return serializeResponse(attachments);
  }

  async deleteAttachment(user: JwtUser, attachmentId: string) {
    const organizationId = this.getOrganizationId(user);
    const attachment = await this.prisma.requirementAttachment.findFirst({
      where: { id: attachmentId, requirement: { organizationId } },
      select: { id: true, uploadedById: true, fileUrl: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    if (
      attachment.uploadedById !== user.sub &&
      !this.isManager(user, organizationId)
    ) {
      throw new ForbiddenException('You cannot delete this attachment.');
    }
    await this.prisma.requirementAttachment.delete({
      where: { id: attachmentId },
    });
    await this.deleteLocalFile(attachment.fileUrl);
    return serializeResponse({ message: 'Attachment deleted.' });
  }

  async getChangeLog(user: JwtUser, requirementId: string) {
    await this.assertRequirementAccess(user, requirementId);
    const changeLog = await this.prisma.requirementChangeLog.findMany({
      where: { requirementId },
      select: changeLogSelect,
      orderBy: { createdAt: 'desc' },
    });
    return serializeResponse(changeLog);
  }

  async linkTask(user: JwtUser, requirementId: string, input: LinkTaskInput) {
    const organizationId = this.getOrganizationId(user);
    this.assertManager(user, organizationId);
    await this.assertRequirementAccess(user, requirementId);
    const task = await this.prisma.task.findFirst({
      where: { id: input.taskId, organizationId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    try {
      const link = await this.prisma.taskRequirement.create({
        data: {
          requirementId,
          taskId: input.taskId,
          relationType: input.relationType,
        },
        select: linkedTaskSelect,
      });
      return serializeResponse({ message: 'Task linked.', link });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('This task is already linked.');
      }
      throw error;
    }
  }

  async unlinkTask(user: JwtUser, requirementId: string, taskId: string) {
    const organizationId = this.getOrganizationId(user);
    this.assertManager(user, organizationId);
    await this.assertRequirementAccess(user, requirementId);
    const result = await this.prisma.taskRequirement.deleteMany({
      where: { requirementId, taskId },
    });
    if (!result.count) throw new NotFoundException('Linked task not found.');
    return serializeResponse({ message: 'Task unlinked.' });
  }

  private async transitionResponse(
    user: JwtUser,
    current: Requirement,
    next: RequirementStatus,
    note?: string,
    extra?: Prisma.RequirementUncheckedUpdateInput,
  ) {
    if (!canTransitionRequirement(current.status, next)) {
      throw new BadRequestException(
        `Cannot move a requirement from ${current.status} to ${next}.`,
      );
    }
    const requirement = await this.transition(user, current, next, note, extra);
    return serializeResponse({
      message: `Requirement moved to ${next.toLowerCase().replaceAll('_', ' ')}.`,
      requirement,
    });
  }

  private async transition(
    user: JwtUser,
    current: Requirement,
    next: RequirementStatus,
    note?: string,
    extra?: Prisma.RequirementUncheckedUpdateInput,
    skipWorkflowCheck = false,
  ) {
    if (!skipWorkflowCheck && current.status === next) return current;
    const nextVersion = current.version + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      const transitionChanges = this.calculateChanges(current, {
        status: next,
        ...extra,
      });
      const requirement = await tx.requirement.update({
        where: { id: current.id },
        data: { status: next, version: nextVersion, ...extra },
      });
      await tx.requirementVersion.create({
        data: this.versionData(
          requirement,
          user.sub,
          note || `Status changed from ${current.status} to ${next}`,
        ),
      });
      await tx.requirementChangeLog.createMany({
        data: transitionChanges.map((change) => ({
          requirementId: current.id,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedById: user.sub,
          changeNote: note,
        })),
      });
      return tx.requirement.findUniqueOrThrow({
        where: { id: current.id },
        select: requirementListSelect,
      });
    });

    await this.notifyStatusChange(updated, user.sub, next, note);
    await this.recordActivity(
      current.organizationId,
      user.sub,
      'REQUIREMENT_STATUS_CHANGED',
      updated,
      {
        from: current.status,
        to: next,
      },
    );
    return updated;
  }

  private versionData(
    requirement: Requirement,
    createdById: string,
    changeSummary: string,
  ): Prisma.RequirementVersionUncheckedCreateInput {
    return {
      requirementId: requirement.id,
      version: requirement.version,
      title: requirement.title,
      description: requirement.description,
      status: requirement.status,
      priority: requirement.priority,
      type: requirement.type,
      changeSummary,
      metadata: requirement.metadata ?? undefined,
      createdById,
    };
  }

  private calculateChanges(
    current: Requirement,
    patch: Record<string, unknown>,
  ) {
    return trackedFields.flatMap((field) => {
      if (!(field in patch)) return [];
      const oldValue = this.auditValue(current[field]);
      const newValue = this.auditValue(patch[field]);
      return oldValue === newValue ? [] : [{ field, oldValue, newValue }];
    });
  }

  private auditValue(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value.toString();
    }
    return JSON.stringify(value) ?? null;
  }

  private summarizeChanges(changes: Array<{ field: string }>) {
    return `Updated ${changes.map((item) => item.field).join(', ')}`;
  }

  private async workflowRequirement(
    user: JwtUser,
    requirementId: string,
    managerOnly: boolean,
  ) {
    const organizationId = this.getOrganizationId(user);
    if (managerOnly) this.assertManager(user, organizationId);
    return this.findRequirement(organizationId, requirementId);
  }

  private async findRequirement(organizationId: string, requirementId: string) {
    const requirement = await this.prisma.requirement.findFirst({
      where: { id: requirementId, organizationId },
    });
    if (!requirement) throw new NotFoundException('Requirement not found.');
    return requirement;
  }

  private async assertRequirementAccess(user: JwtUser, requirementId: string) {
    return this.findRequirement(this.getOrganizationId(user), requirementId);
  }

  private async assertProject(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
  }

  private getOrganizationId(user: JwtUser) {
    if (!user.currentOrganizationId) {
      throw new ForbiddenException('Organization context is required.');
    }
    return user.currentOrganizationId;
  }

  private roleFor(user: JwtUser, organizationId: string): Role | undefined {
    if (user.role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    return user.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    )?.role;
  }

  private isManager(user: JwtUser, organizationId: string) {
    return ['SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER'].includes(
      this.roleFor(user, organizationId) || '',
    );
  }

  private assertManager(user: JwtUser, organizationId: string) {
    if (!this.isManager(user, organizationId)) {
      throw new ForbiddenException(
        'Manager or team leader access is required.',
      );
    }
  }

  private assertCanCreate(user: JwtUser, organizationId: string) {
    this.assertManager(user, organizationId);
  }

  private assertCanEdit(
    user: JwtUser,
    organizationId: string,
    requirement: Requirement,
  ) {
    if (
      this.isManager(user, organizationId) ||
      requirement.createdById === user.sub
    )
      return;
    throw new ForbiddenException('You cannot update this requirement.');
  }

  private async notifyStatusChange(
    requirement: RequirementListRow,
    actorId: string,
    status: RequirementStatus,
    note?: string,
  ) {
    if (requirement.createdById === actorId) return;
    try {
      await this.notificationsService.createNotification({
        userId: requirement.createdById,
        organizationId: requirement.organizationId,
        type: 'REQUIREMENT_STATUS_CHANGED',
        title: 'Requirement status changed',
        body: `${requirement.title} is now ${status.toLowerCase().replaceAll('_', ' ')}.${
          note ? ` ${note}` : ''
        }`,
        metadata: { requirementId: requirement.id, status },
      });
    } catch (error) {
      this.logger.error(
        `Could not send requirement notification: ${String(error)}`,
      );
    }
  }

  private async recordActivity(
    organizationId: string,
    actorId: string,
    action: string,
    requirement: { id: string; projectId?: string | null; title: string },
    metadata: Record<string, unknown> = {},
  ) {
    try {
      await this.activityService.logActivity({
        organizationId,
        actorId,
        action,
        projectId: requirement.projectId,
        metadata: {
          requirementId: requirement.id,
          requirementTitle: requirement.title,
          ...metadata,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not write requirement activity: ${String(error)}`,
      );
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private async deleteLocalFile(fileUrl: string) {
    try {
      const url = new URL(fileUrl);
      if (!url.pathname.startsWith('/uploads/')) return;
      await unlink(
        join(process.cwd(), 'uploads', basename(url.pathname)),
      ).catch(() => undefined);
    } catch {
      return;
    }
  }
}

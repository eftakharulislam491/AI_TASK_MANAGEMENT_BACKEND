import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role, RoleChangeRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeResponse } from '../common/utils/response';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import type {
  CreateRoleChangeRequestInput,
  CreateUserAbilityInput,
  ListRoleChangeRequestsQueryInput,
  ListUsersQueryInput,
  ReviewRoleChangeRequestInput,
  UpdateOrganizationSettingsInput,
  UpdateMyProfileInput,
  UpdateUserAbilityInput,
} from './users.schemas';

const ROLE_RANK: Record<Role, number> = {
  MEMBER: 1,
  TEAM_LEADER: 2,
  MANAGER: 3,
  SUPER_ADMIN: 4,
};

const MANAGER_VISIBLE_ROLES: Role[] = ['MEMBER', 'TEAM_LEADER'];

const userAbilitySelect = {
  id: true,
  name: true,
  slug: true,
  category: true,
  proficiencyLevel: true,
  proficiencyScore: true,
  yearsOfExperience: true,
  projectsCount: true,
  isPrimary: true,
  notes: true,
  evidenceUrl: true,
  keywords: true,
  aiMetadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAbilitySelect;

const userDetailSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  type: true,
  role: true,
  isActive: true,
  currentOrganizationId: true,
  createdAt: true,
  updatedAt: true,
  currentOrganization: {
    select: {
      id: true,
      name: true,
      slug: true,
      settings: true,
    },
  },
  memberships: {
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      organizationId: true,
      role: true,
      status: true,
      joinedAt: true,
      createdAt: true,
      updatedAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
  abilities: {
    orderBy: [
      { isPrimary: 'desc' },
      { proficiencyScore: 'desc' },
      { name: 'asc' },
    ],
    select: userAbilitySelect,
  },
  profile: {
    select: {
      id: true,
      phone: true,
      headline: true,
      bio: true,
      dateOfBirth: true,
      gender: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      country: true,
      postalCode: true,
      timezone: true,
      currentJobTitle: true,
      yearsOfExperience: true,
      totalProjects: true,
      resumeUrl: true,
      portfolioUrl: true,
      websiteUrl: true,
      linkedinUrl: true,
      githubUrl: true,
      twitterUrl: true,
      socialLinks: true,
      otherInfo: true,
      aiMetadata: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

const userDirectorySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  type: true,
  role: true,
  isActive: true,
  currentOrganizationId: true,
  createdAt: true,
  updatedAt: true,
  currentOrganization: {
    select: {
      id: true,
      name: true,
      slug: true,
      settings: true,
    },
  },
  memberships: {
    where: {
      status: 'ACTIVE',
    },
    select: {
      organizationId: true,
      role: true,
      status: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
  abilities: {
    take: 8,
    orderBy: [
      { isPrimary: 'desc' },
      { proficiencyScore: 'desc' },
      { name: 'asc' },
    ],
    select: {
      id: true,
      name: true,
      category: true,
      proficiencyLevel: true,
      proficiencyScore: true,
      isPrimary: true,
      keywords: true,
    },
  },
  profile: {
    select: {
      headline: true,
      city: true,
      country: true,
      currentJobTitle: true,
      yearsOfExperience: true,
      portfolioUrl: true,
      websiteUrl: true,
      linkedinUrl: true,
      githubUrl: true,
    },
  },
} satisfies Prisma.UserSelect;

const roleChangeRequestSelect = {
  id: true,
  organizationId: true,
  currentRole: true,
  requestedRole: true,
  status: true,
  reason: true,
  reviewNote: true,
  metadata: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  requester: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      role: true,
    },
  },
  targetUser: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      role: true,
      currentOrganizationId: true,
    },
  },
  reviewer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      role: true,
    },
  },
} satisfies Prisma.RoleChangeRequestSelect;

type Actor = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    firstName: true;
    displayName: true;
    role: true;
    type: true;
    currentOrganizationId: true;
    isActive: true;
    memberships: {
      select: {
        organizationId: true;
        role: true;
        status: true;
      };
    };
  };
}>;

type UserDetail = Prisma.UserGetPayload<{ select: typeof userDetailSelect }>;
type UserDirectoryRow = Prisma.UserGetPayload<{
  select: typeof userDirectorySelect;
}>;
type RoleChangeRequestRow = Prisma.RoleChangeRequestGetPayload<{
  select: typeof roleChangeRequestSelect;
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getMe(currentUser: JwtUser) {
    await this.ensureProfileExists(currentUser.sub);

    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.sub },
      select: userDetailSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return serializeResponse(this.mapUserDetail(user));
  }

  async updateMyProfile(currentUser: JwtUser, input: UpdateMyProfileInput) {
    await this.ensureProfileExists(currentUser.sub);

    const { firstName, lastName, displayName, ...profileData } = input;
    const persistedProfileData = this.toProfilePersistenceInput(profileData);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (firstName || lastName || displayName !== undefined) {
        await tx.user.update({
          where: { id: currentUser.sub },
          data: {
            firstName,
            lastName,
            displayName,
          },
        });
      }

      await tx.userProfile.upsert({
        where: { userId: currentUser.sub },
        create: {
          userId: currentUser.sub,
          ...persistedProfileData,
        },
        update: persistedProfileData,
      });

      return tx.user.findUnique({
        where: { id: currentUser.sub },
        select: userDetailSelect,
      });
    });

    if (!updated) {
      throw new NotFoundException('User not found.');
    }

    return serializeResponse({
      success: true,
      message: 'Profile updated successfully.',
      user: this.mapUserDetail(updated),
    });
  }

  async getOrganizationSettings(currentUser: JwtUser) {
    const actor = await this.getActor(currentUser.sub);
    const organizationId = this.resolveAccessibleOrganizationId(
      actor,
      currentUser.currentOrganizationId ?? undefined,
    );

    if (!organizationId) {
      throw new BadRequestException(
        'Organization context is required for this action.',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        settings: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    return serializeResponse({
      organizationId: organization.id,
      organizationName: organization.name,
      settings: this.normalizeOrganizationSettings(organization.settings),
    });
  }

  async updateOrganizationSettings(
    currentUser: JwtUser,
    input: UpdateOrganizationSettingsInput,
  ) {
    const actor = await this.getActor(currentUser.sub);
    const organizationId = this.resolveAccessibleOrganizationId(
      actor,
      currentUser.currentOrganizationId ?? undefined,
    );

    if (!organizationId) {
      throw new BadRequestException(
        'Organization context is required for this action.',
      );
    }

    const actorRole = this.getActorRoleForOrganization(actor, organizationId);

    if (actor.role !== 'SUPER_ADMIN' && actorRole !== 'MANAGER') {
      throw new ForbiddenException(
        'Only managers can update organization settings.',
      );
    }

    const existing = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        settings: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Organization not found.');
    }

    const settings = {
      ...this.normalizeOrganizationSettings(existing.settings),
      ...(input.autoAssignOnTaskCreate !== undefined
        ? { autoAssignOnTaskCreate: input.autoAssignOnTaskCreate }
        : {}),
      ...(input.githubIntegrationEnabled !== undefined
        ? { githubIntegrationEnabled: input.githubIntegrationEnabled }
        : {}),
      ...(input.githubAutoReviewEnabled !== undefined
        ? { githubAutoReviewEnabled: input.githubAutoReviewEnabled }
        : {}),
    };

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        settings: settings,
      },
      select: {
        id: true,
        name: true,
        settings: true,
      },
    });

    return serializeResponse({
      message: 'Organization settings updated successfully.',
      organizationId: updated.id,
      organizationName: updated.name,
      settings: this.normalizeOrganizationSettings(updated.settings),
    });
  }

  async createMyAbility(currentUser: JwtUser, input: CreateUserAbilityInput) {
    await this.ensureProfileExists(currentUser.sub);

    const slug = this.toAbilitySlug(input.name);
    const existing = await this.prisma.userAbility.findUnique({
      where: {
        userId_slug: {
          userId: currentUser.sub,
          slug,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('This skill already exists for the user.');
    }

    const ability = await this.prisma.userAbility.create({
      data: {
        userId: currentUser.sub,
        slug,
        ...this.toCreateAbilityPersistenceInput(input),
      },
      select: userAbilitySelect,
    });

    return serializeResponse({
      success: true,
      message: 'Ability added successfully.',
      ability,
    });
  }

  async updateMyAbility(
    currentUser: JwtUser,
    abilityId: string,
    input: UpdateUserAbilityInput,
  ) {
    const existing = await this.prisma.userAbility.findFirst({
      where: {
        id: abilityId,
        userId: currentUser.sub,
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Ability not found.');
    }

    const nextSlug =
      input.name === undefined ? existing.slug : this.toAbilitySlug(input.name);

    if (nextSlug !== existing.slug) {
      const conflict = await this.prisma.userAbility.findUnique({
        where: {
          userId_slug: {
            userId: currentUser.sub,
            slug: nextSlug,
          },
        },
        select: { id: true },
      });

      if (conflict && conflict.id !== abilityId) {
        throw new ConflictException('Another ability already uses this name.');
      }
    }

    const ability = await this.prisma.userAbility.update({
      where: { id: abilityId },
      data: {
        ...this.toUpdateAbilityPersistenceInput(input),
        slug: nextSlug,
      },
      select: userAbilitySelect,
    });

    return serializeResponse({
      success: true,
      message: 'Ability updated successfully.',
      ability,
    });
  }

  async deleteMyAbility(currentUser: JwtUser, abilityId: string) {
    const existing = await this.prisma.userAbility.findFirst({
      where: {
        id: abilityId,
        userId: currentUser.sub,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Ability not found.');
    }

    await this.prisma.userAbility.delete({
      where: { id: abilityId },
    });

    return {
      success: true,
      message: 'Ability deleted successfully.',
    };
  }

  async listDirectory(currentUser: JwtUser, query: ListUsersQueryInput) {
    const actor = await this.getActor(currentUser.sub);
    const where = this.buildDirectoryWhere(actor, query);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ role: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        select: userDirectorySelect,
      }),
      this.prisma.user.count({ where }),
    ]);

    return serializeResponse({
      data: users.map((user) => this.mapUserDirectoryItem(user)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async getDirectoryUser(currentUser: JwtUser, userId: string) {
    const actor = await this.getActor(currentUser.sub);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userDetailSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    this.assertCanAccessUser(actor, user);

    return serializeResponse(this.mapUserDetail(user));
  }

  async createRoleChangeRequest(
    currentUser: JwtUser,
    input: CreateRoleChangeRequestInput,
  ) {
    const actor = await this.getActor(currentUser.sub);
    const target = await this.prisma.user.findUnique({
      where: { id: input.targetUserId },
      select: {
        id: true,
        email: true,
        firstName: true,
        displayName: true,
        role: true,
        currentOrganizationId: true,
        memberships: {
          select: {
            organizationId: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!target) {
      throw new NotFoundException('Target user not found.');
    }

    const organizationId =
      input.organizationId ??
      actor.currentOrganizationId ??
      target.currentOrganizationId ??
      undefined;
    const currentRole = this.resolveCurrentRoleForRequest(
      target,
      organizationId,
    );

    if (currentRole === input.requestedRole) {
      throw new BadRequestException(
        'Requested role must be different from the current role.',
      );
    }

    this.assertCanCreateRoleRequest(
      actor,
      target,
      currentRole,
      input.requestedRole,
      organizationId,
    );

    const duplicate = await this.prisma.roleChangeRequest.findFirst({
      where: {
        targetUserId: target.id,
        organizationId: organizationId ?? null,
        requestedRole: input.requestedRole,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        'A pending request already exists for this role change.',
      );
    }

    const request: RoleChangeRequestRow =
      await this.prisma.roleChangeRequest.create({
        data: {
          organizationId,
          requesterId: actor.id,
          targetUserId: target.id,
          currentRole,
          requestedRole: input.requestedRole,
          reason: input.reason,
          metadata: this.toJsonValue(input.metadata),
        },
        select: roleChangeRequestSelect,
      });

    // Notify Super Admins and Managers
    const superAdmins = await this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
      },
    });

    const managers = organizationId
      ? await this.prisma.organizationMembership.findMany({
          where: {
            organizationId,
            status: 'ACTIVE',
            role: 'MANAGER',
          },
          include: { user: true },
        })
      : [];

    const managerUsers = managers.map((m) => m.user);

    const recipientIds = Array.from(
      new Set([
        target.id,
        ...superAdmins.map((u) => u.id),
        ...managerUsers.map((u) => u.id),
      ]),
    ).filter((id) => id !== actor.id);

    const actorName = this.getUserDisplayName(actor);
    const targetName = this.getUserDisplayName(target);

    if (recipientIds.length > 0) {
      const title = 'Role change requested';
      const body =
        actor.id === target.id
          ? `${actorName} requested a role change to ${input.requestedRole}.`
          : `${actorName} requested to change ${targetName}'s role to ${input.requestedRole}.`;

      await this.notificationsService.createBulkNotifications(recipientIds, {
        organizationId,
        type: 'ROLE_CHANGE_REQUESTED',
        title,
        body,
        metadata: {
          requestId: request.id,
          requesterId: actor.id,
          targetUserId: target.id,
        },
      });
    }

    const emailRecipients = [target, ...superAdmins, ...managerUsers].filter(
      (recipient, index, recipients) =>
        recipient.email !== actor.email &&
        recipients.findIndex((item) => item.email === recipient.email) ===
          index,
    );

    await Promise.all(
      emailRecipients.map((recipient) =>
        this.mailService.sendRoleChangeRequestedEmail({
          to: recipient.email,
          recipientName: this.getUserDisplayName(recipient),
          requesterName: actorName,
          targetName,
          currentRole,
          requestedRole: input.requestedRole,
          reason: input.reason,
        }),
      ),
    );

    return serializeResponse({
      success: true,
      message: 'Role change request created successfully.',
      request: this.mapRoleChangeRequest(request),
    });
  }

  async listRoleChangeRequests(
    currentUser: JwtUser,
    query: ListRoleChangeRequestsQueryInput,
  ) {
    const actor = await this.getActor(currentUser.sub);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = this.buildRoleChangeRequestWhere(actor, query);

    const [requests, total] = await Promise.all([
      this.prisma.roleChangeRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
        select: roleChangeRequestSelect,
      }),
      this.prisma.roleChangeRequest.count({ where }),
    ]);

    return serializeResponse({
      data: requests.map((request) => this.mapRoleChangeRequest(request)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async reviewRoleChangeRequest(
    currentUser: JwtUser,
    requestId: string,
    input: ReviewRoleChangeRequestInput,
  ) {
    const actor = await this.getActor(currentUser.sub);
    const request = await this.prisma.roleChangeRequest.findUnique({
      where: { id: requestId },
      select: {
        ...roleChangeRequestSelect,
        requesterId: true,
        targetUserId: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Role change request not found.');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be reviewed.');
    }

    this.assertCanReviewRoleRequest(actor, request);

    const reviewed = await this.prisma.$transaction(async (tx) => {
      if (input.decision === 'APPROVED') {
        await this.applyApprovedRoleChange(tx, request);
      }

      return tx.roleChangeRequest.update({
        where: { id: request.id },
        data: {
          status: input.decision,
          reviewNote: input.reviewNote,
          reviewerId: actor.id,
          reviewedAt: new Date(),
        },
        select: roleChangeRequestSelect,
      });
    });

    const notificationRecipients = [
      ...new Set([reviewed.requester.id, reviewed.targetUser.id]),
    ].filter((userId) => userId !== actor.id);
    const targetName = this.getUserDisplayName(reviewed.targetUser);
    const requesterName = this.getUserDisplayName(reviewed.requester);
    const decisionLabel = input.decision.toLowerCase();

    await this.notificationsService.createBulkNotifications(
      notificationRecipients,
      {
        organizationId: reviewed.organizationId ?? undefined,
        type:
          input.decision === 'APPROVED'
            ? 'ROLE_CHANGED'
            : 'ROLE_CHANGE_REVIEWED',
        title: `Role change request ${decisionLabel}`,
        body: `${targetName}'s role change from ${reviewed.currentRole} to ${reviewed.requestedRole} was ${decisionLabel}.`,
        metadata: {
          requestId: reviewed.id,
          targetUserId: reviewed.targetUser.id,
          decision: input.decision,
        },
      },
    );

    const emailRecipients = [
      { email: reviewed.targetUser.email, name: targetName },
      {
        email: reviewed.requester.email,
        name: requesterName,
      },
    ].filter(
      (recipient, index, recipients) =>
        recipient.email !== actor.email &&
        recipients.findIndex((item) => item.email === recipient.email) ===
          index,
    );

    await Promise.all(
      emailRecipients.map((recipient) =>
        this.mailService.sendRoleChangeReviewedEmail({
          to: recipient.email,
          recipientName: recipient.name,
          requesterName,
          targetName,
          currentRole: reviewed.currentRole,
          requestedRole: reviewed.requestedRole,
          reason: reviewed.reason,
          decision: input.decision,
          reviewNote: input.reviewNote,
        }),
      ),
    );

    return serializeResponse({
      success: true,
      message:
        input.decision === 'APPROVED'
          ? 'Role change request approved successfully.'
          : 'Role change request rejected successfully.',
      request: this.mapRoleChangeRequest(reviewed),
    });
  }

  async cancelRoleChangeRequest(currentUser: JwtUser, requestId: string) {
    const actor = await this.getActor(currentUser.sub);
    const request = await this.prisma.roleChangeRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requesterId: true,
        status: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Role change request not found.');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be canceled.');
    }

    if (request.requesterId !== actor.id && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'You are not allowed to cancel this role change request.',
      );
    }

    const canceled = await this.prisma.roleChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELED',
      },
      select: roleChangeRequestSelect,
    });

    return serializeResponse({
      success: true,
      message: 'Role change request canceled successfully.',
      request: this.mapRoleChangeRequest(canceled),
    });
  }

  private async ensureProfileExists(userId: string) {
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private async getActor(userId: string): Promise<Actor> {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        displayName: true,
        role: true,
        type: true,
        currentOrganizationId: true,
        isActive: true,
        memberships: {
          select: {
            organizationId: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!actor) {
      throw new NotFoundException('Authenticated user was not found.');
    }

    if (!actor.isActive) {
      throw new ForbiddenException('Your account is inactive.');
    }

    return actor;
  }

  private buildDirectoryWhere(actor: Actor, query: ListUsersQueryInput) {
    const role = query.role;
    const type = query.type;
    const organizationId = this.resolveAccessibleOrganizationId(
      actor,
      query.organizationId,
    );

    return {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(role ? { role } : {}),
      ...(type ? { type } : {}),
      ...(query.search
        ? {
            OR: [
              {
                firstName: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                lastName: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                displayName: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                email: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                profile: {
                  is: {
                    OR: [
                      {
                        headline: {
                          contains: query.search,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        currentJobTitle: {
                          contains: query.search,
                          mode: 'insensitive' as const,
                        },
                      },
                    ],
                  },
                },
              },
              {
                abilities: {
                  some: {
                    OR: [
                      {
                        name: {
                          contains: query.search,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        keywords: {
                          has: query.search,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
      ...(organizationId
        ? {
            memberships: {
              some: {
                organizationId,
                status: 'ACTIVE',
              },
            },
          }
        : {}),
    } satisfies Prisma.UserWhereInput;
  }

  private resolveAccessibleOrganizationId(actor: Actor, requested?: string) {
    if (actor.role === 'SUPER_ADMIN') {
      return requested;
    }

    const organizationId = requested ?? actor.currentOrganizationId;

    if (!organizationId) {
      throw new BadRequestException(
        'Organization context is required for this action.',
      );
    }

    const hasAccess = actor.memberships.some(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        'You do not have access to this organization.',
      );
    }

    return organizationId;
  }

  private getActorRoleForOrganization(actor: Actor, organizationId: string) {
    if (actor.role === 'SUPER_ADMIN') {
      return 'SUPER_ADMIN';
    }

    return actor.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    )?.role;
  }

  private assertCanAccessUser(actor: Actor, target: UserDetail) {
    if (actor.role === 'SUPER_ADMIN') {
      return;
    }

    const accessibleOrganizationId = actor.currentOrganizationId;

    if (!accessibleOrganizationId) {
      throw new ForbiddenException(
        'Organization context is required to view another user.',
      );
    }

    const actorHasAccess = actor.memberships.some(
      (membership) =>
        membership.organizationId === accessibleOrganizationId &&
        membership.status === 'ACTIVE',
    );

    const targetHasAccess = target.memberships.some(
      (membership) =>
        membership.organizationId === accessibleOrganizationId &&
        membership.status === 'ACTIVE',
    );

    if (!actorHasAccess || !targetHasAccess) {
      throw new ForbiddenException('You are not allowed to access this user.');
    }
  }

  private resolveCurrentRoleForRequest(
    target: {
      role: Role;
      memberships: Array<{
        organizationId: string;
        role: Role;
        status: string;
      }>;
    },
    organizationId?: string,
  ): Role {
    if (!organizationId) {
      return target.role;
    }

    const membership = target.memberships.find(
      (item) =>
        item.organizationId === organizationId && item.status === 'ACTIVE',
    );

    if (!membership) {
      throw new BadRequestException(
        'Target user does not have an active membership in the selected organization.',
      );
    }

    return membership.role;
  }

  private assertCanCreateRoleRequest(
    actor: Actor,
    target: {
      id: string;
      role: Role;
      memberships: Array<{
        organizationId: string;
        role: Role;
        status: string;
      }>;
    },
    currentRole: Role,
    requestedRole: Role,
    organizationId?: string,
  ) {
    if (actor.role === 'SUPER_ADMIN') {
      return;
    }

    if (!organizationId) {
      throw new BadRequestException(
        'Organization context is required for role change requests.',
      );
    }

    const actorMembership = actor.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    );
    const targetMembership = target.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    );

    if (!actorMembership || !targetMembership) {
      throw new ForbiddenException(
        'Both requester and target user must belong to the same active organization.',
      );
    }

    if (requestedRole === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only a super admin can request the SUPER_ADMIN role.',
      );
    }

    if (actor.role === 'MANAGER') {
      if (
        target.id !== actor.id &&
        ROLE_RANK[currentRole] >= ROLE_RANK.MANAGER
      ) {
        throw new ForbiddenException(
          'Managers can only request changes for team leaders and members.',
        );
      }

      return;
    }

    if (actor.role === 'TEAM_LEADER') {
      if (target.id !== actor.id && currentRole !== 'MEMBER') {
        throw new ForbiddenException(
          'Team leaders can only request role changes for members.',
        );
      }

      if (
        target.id !== actor.id &&
        ROLE_RANK[requestedRole] > ROLE_RANK.TEAM_LEADER
      ) {
        throw new ForbiddenException(
          'Team leaders cannot request a higher role for another user.',
        );
      }

      return;
    }

    if (target.id !== actor.id) {
      throw new ForbiddenException(
        'Members can only create role change requests for themselves.',
      );
    }
  }

  private buildRoleChangeRequestWhere(
    actor: Actor,
    query: ListRoleChangeRequestsQueryInput,
  ) {
    const accessibleOrganizationId =
      actor.role === 'SUPER_ADMIN'
        ? query.organizationId
        : query.organizationId
          ? this.resolveAccessibleOrganizationId(actor, query.organizationId)
          : actor.currentOrganizationId;
    const baseWhere = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetUserId ? { targetUserId: query.targetUserId } : {}),
      ...(accessibleOrganizationId
        ? { organizationId: accessibleOrganizationId }
        : {}),
    } satisfies Prisma.RoleChangeRequestWhereInput;

    switch (query.scope) {
      case 'mine':
        return {
          ...baseWhere,
          requesterId: actor.id,
        } satisfies Prisma.RoleChangeRequestWhereInput;
      case 'target':
        return {
          ...baseWhere,
          targetUserId: actor.id,
        } satisfies Prisma.RoleChangeRequestWhereInput;
      case 'pending': {
        if (actor.role === 'SUPER_ADMIN') {
          return {
            ...baseWhere,
            status: query.status ?? 'PENDING',
          } satisfies Prisma.RoleChangeRequestWhereInput;
        }

        if (!actor.currentOrganizationId) {
          throw new BadRequestException(
            'Organization context is required to view pending role change requests.',
          );
        }

        const pendingConditions: Prisma.RoleChangeRequestWhereInput[] = [
          { targetUserId: actor.id, requesterId: { not: actor.id } },
        ];

        if (actor.role === 'MANAGER') {
          pendingConditions.push({
            organizationId: accessibleOrganizationId,
            requesterId: { not: actor.id },
            requestedRole: { in: MANAGER_VISIBLE_ROLES },
            currentRole: { in: MANAGER_VISIBLE_ROLES },
          });
        }

        return {
          ...baseWhere,
          status: query.status ?? 'PENDING',
          OR: pendingConditions,
        } satisfies Prisma.RoleChangeRequestWhereInput;
      }
      case 'all': {
        if (actor.role === 'SUPER_ADMIN') {
          return baseWhere;
        }

        if (!actor.currentOrganizationId) {
          return {
            ...baseWhere,
            OR: [{ requesterId: actor.id }, { targetUserId: actor.id }],
          } satisfies Prisma.RoleChangeRequestWhereInput;
        }

        const allConditions: Prisma.RoleChangeRequestWhereInput[] = [
          { requesterId: actor.id },
          { targetUserId: actor.id },
        ];

        if (actor.role === 'MANAGER') {
          allConditions.push({
            organizationId: accessibleOrganizationId,
            requestedRole: { in: MANAGER_VISIBLE_ROLES },
            currentRole: { in: MANAGER_VISIBLE_ROLES },
          });
        }

        return {
          ...baseWhere,
          OR: allConditions,
        } satisfies Prisma.RoleChangeRequestWhereInput;
      }
      default:
        return {
          ...baseWhere,
          requesterId: actor.id,
        } satisfies Prisma.RoleChangeRequestWhereInput;
    }
  }

  private assertCanReviewRoleRequest(
    actor: Actor,
    request: {
      id: string;
      organizationId: string | null;
      currentRole: Role;
      requestedRole: Role;
      requesterId: string;
      targetUserId: string;
      status: RoleChangeRequestStatus;
    },
  ) {
    if (actor.id === request.requesterId) {
      throw new ForbiddenException(
        'Requesters cannot review their own role change requests.',
      );
    }

    if (actor.role === 'SUPER_ADMIN') {
      return;
    }

    if (actor.id === request.targetUserId) {
      return;
    }

    if (actor.role !== 'MANAGER') {
      throw new ForbiddenException(
        'Only managers, super admins, or the target user can review role change requests.',
      );
    }

    if (
      !request.organizationId ||
      actor.currentOrganizationId !== request.organizationId
    ) {
      throw new ForbiddenException(
        'Managers can only review requests for their current organization.',
      );
    }

    if (
      !MANAGER_VISIBLE_ROLES.includes(request.currentRole) ||
      !MANAGER_VISIBLE_ROLES.includes(request.requestedRole)
    ) {
      throw new ForbiddenException(
        'Manager approval is limited to member and team leader role changes.',
      );
    }
  }

  private async applyApprovedRoleChange(
    tx: Prisma.TransactionClient,
    request: {
      targetUserId: string;
      organizationId: string | null;
      requestedRole: Role;
    },
  ) {
    if (request.organizationId) {
      const membership = await tx.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: request.targetUserId,
            organizationId: request.organizationId,
          },
        },
        select: {
          id: true,
        },
      });

      if (!membership) {
        throw new NotFoundException(
          'Target user no longer has membership in this organization.',
        );
      }

      await tx.organizationMembership.update({
        where: { id: membership.id },
        data: {
          role: request.requestedRole,
        },
      });

      const memberships = await tx.organizationMembership.findMany({
        where: {
          userId: request.targetUserId,
          status: 'ACTIVE',
        },
        select: {
          role: true,
        },
      });

      const highestMembershipRole = this.getHighestRole(
        memberships.map((membership) => membership.role),
      );

      await tx.user.update({
        where: { id: request.targetUserId },
        data: {
          role:
            request.requestedRole === 'SUPER_ADMIN'
              ? 'SUPER_ADMIN'
              : (highestMembershipRole ?? request.requestedRole),
          currentOrganizationId: request.organizationId,
        },
      });

      return;
    }

    await tx.user.update({
      where: { id: request.targetUserId },
      data: {
        role: request.requestedRole,
      },
    });
  }

  private getHighestRole(roles: Role[]) {
    return roles.sort((left, right) => ROLE_RANK[right] - ROLE_RANK[left])[0];
  }

  private getUserDisplayName(user: {
    email: string;
    firstName: string;
    lastName?: string;
    displayName: string | null;
  }) {
    return (
      user.displayName ||
      `${user.firstName} ${user.lastName ?? ''}`.trim() ||
      user.email
    );
  }

  private toAbilitySlug(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private toJsonValue(value?: Record<string, unknown>) {
    return value as Prisma.InputJsonValue | undefined;
  }

  private toProfilePersistenceInput(
    input: Omit<UpdateMyProfileInput, 'firstName' | 'lastName' | 'displayName'>,
  ) {
    return {
      ...input,
      socialLinks: this.toJsonValue(input.socialLinks),
      otherInfo: this.toJsonValue(input.otherInfo),
      aiMetadata: this.toJsonValue(input.aiMetadata),
    };
  }

  private toCreateAbilityPersistenceInput(input: CreateUserAbilityInput) {
    return {
      ...input,
      aiMetadata: this.toJsonValue(input.aiMetadata),
    };
  }

  private toUpdateAbilityPersistenceInput(input: UpdateUserAbilityInput) {
    return {
      ...input,
      aiMetadata: this.toJsonValue(input.aiMetadata),
    };
  }

  private mapUserDirectoryItem(user: UserDirectoryRow) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      type: user.type,
      role: user.role,
      isActive: user.isActive,
      currentOrganizationId: user.currentOrganizationId,
      currentOrganization: user.currentOrganization,
      profile: user.profile
        ? {
            headline: user.profile.headline,
            city: user.profile.city,
            country: user.profile.country,
            currentJobTitle: user.profile.currentJobTitle,
            yearsOfExperience: user.profile.yearsOfExperience,
            portfolioUrl: user.profile.portfolioUrl,
            websiteUrl: user.profile.websiteUrl,
            linkedinUrl: user.profile.linkedinUrl,
            githubUrl: user.profile.githubUrl,
            abilities: user.abilities,
          }
        : null,
      memberships: user.memberships,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private mapUserDetail(user: UserDetail) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      type: user.type,
      role: user.role,
      isActive: user.isActive,
      currentOrganizationId: user.currentOrganizationId,
      currentOrganization: user.currentOrganization,
      memberships: user.memberships,
      profile: user.profile
        ? {
            ...user.profile,
            abilities: user.abilities,
          }
        : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private mapRoleChangeRequest(request: RoleChangeRequestRow) {
    return {
      id: request.id,
      organizationId: request.organizationId,
      organization: request.organization,
      currentRole: request.currentRole,
      requestedRole: request.requestedRole,
      status: request.status,
      reason: request.reason,
      reviewNote: request.reviewNote,
      metadata: request.metadata,
      requesterId: request.requester.id,
      targetUserId: request.targetUser.id,
      reviewerId: request.reviewer?.id ?? null,
      requester: request.requester,
      targetUser: request.targetUser,
      reviewer: request.reviewer,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private normalizeOrganizationSettings(settings: unknown) {
    const value =
      settings && typeof settings === 'object' && !Array.isArray(settings)
        ? (settings as Record<string, unknown>)
        : {};

    return {
      autoAssignOnTaskCreate: value.autoAssignOnTaskCreate === true,
      githubIntegrationEnabled: value.githubIntegrationEnabled !== false,
      githubAutoReviewEnabled: value.githubAutoReviewEnabled === true,
    };
  }
}

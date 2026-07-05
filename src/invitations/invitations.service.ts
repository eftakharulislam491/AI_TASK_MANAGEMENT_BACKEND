import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PasswordService } from '../auth/password.service';
import { serializeResponse } from '../common/utils/response';
import type { AppEnv } from '../config/env';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AcceptInvitationInput,
  ListInvitationsQueryInput,
  SendInvitationInput,
} from './invitations.schemas';

const invitationSelect = {
  id: true,
  organizationId: true,
  requesterId: true,
  recipientId: true,
  type: true,
  status: true,
  message: true,
  invitationToken: true,
  invitationEmail: true,
  expiresAt: true,
  respondedAt: true,
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
    },
  },
  recipient: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
} satisfies Prisma.JoinRequestSelect;

type InvitationRow = Prisma.JoinRequestGetPayload<{
  select: typeof invitationSelect;
}>;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {}

  async sendInvitation(currentUser: JwtUser, input: SendInvitationInput) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanManageInvitations(currentUser, organizationId);
    const organization = await this.getOrganizationOrThrow(organizationId);
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: input.email,
      },
      select: {
        id: true,
      },
    });

    await this.assertNoActiveMembership(organizationId, existingUser?.id);
    await this.assertNoPendingInvitation(organizationId, input.email);

    const expiresAt = this.getInvitationExpiry();
    const invitation = await this.prisma.joinRequest.create({
      data: {
        organizationId,
        requesterId: currentUser.sub,
        recipientId: existingUser?.id,
        type: 'INVITATION',
        status: 'PENDING',
        message: input.message,
        invitationEmail: input.email,
        invitationToken: randomUUID(),
        expiresAt,
      },
      select: invitationSelect,
    });

    await this.deliverInvitationEmail(invitation);

    if (existingUser?.id) {
      await this.notificationsService.createNotification({
        userId: existingUser.id,
        organizationId,
        type: 'INVITATION_RECEIVED',
        title: 'Organization invitation',
        body: `You have been invited to join ${organization.name}.`,
        metadata: {
          invitationId: invitation.id,
        },
      });
    }

    return serializeResponse({
      message: 'Invitation sent successfully.',
      invitation,
    });
  }

  async listInvitations(
    currentUser: JwtUser,
    query: ListInvitationsQueryInput,
  ) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanManageInvitations(currentUser, organizationId);
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      type: 'INVITATION',
      ...(query.status ? { status: query.status } : {}),
    } satisfies Prisma.JoinRequestWhereInput;

    const [items, total] = await Promise.all([
      this.prisma.joinRequest.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: invitationSelect,
      }),
      this.prisma.joinRequest.count({ where }),
    ]);

    return serializeResponse({
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async resendInvitation(currentUser: JwtUser, invitationId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanManageInvitations(currentUser, organizationId);
    const invitation = await this.getInvitationOrThrow(
      organizationId,
      invitationId,
    );

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Only pending invitations can be resent.');
    }

    const updated = await this.prisma.joinRequest.update({
      where: {
        id: invitationId,
      },
      data: {
        invitationToken: randomUUID(),
        expiresAt: this.getInvitationExpiry(),
      },
      select: invitationSelect,
    });

    await this.deliverInvitationEmail(updated);

    return serializeResponse({
      message: 'Invitation resent successfully.',
      invitation: updated,
    });
  }

  async cancelInvitation(currentUser: JwtUser, invitationId: string) {
    const organizationId = this.getOrganizationId(currentUser);
    this.assertCanManageInvitations(currentUser, organizationId);
    const invitation = await this.getInvitationOrThrow(
      organizationId,
      invitationId,
    );

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending invitations can be canceled.',
      );
    }

    const canceled = await this.prisma.joinRequest.update({
      where: {
        id: invitationId,
      },
      data: {
        status: 'CANCELED',
        respondedAt: new Date(),
      },
      select: invitationSelect,
    });

    return serializeResponse({
      message: 'Invitation canceled successfully.',
      invitation: canceled,
    });
  }

  async acceptInvitation(input: AcceptInvitationInput) {
    const invitation = await this.prisma.joinRequest.findUnique({
      where: {
        invitationToken: input.token,
      },
      select: invitationSelect,
    });

    if (!invitation || invitation.type !== 'INVITATION') {
      throw new BadRequestException('Invalid invitation token.');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Invitation is no longer pending.');
    }

    if (!invitation.expiresAt || invitation.expiresAt < new Date()) {
      await this.prisma.joinRequest.update({
        where: {
          id: invitation.id,
        },
        data: {
          status: 'CANCELED',
          respondedAt: new Date(),
        },
      });
      throw new BadRequestException('Invitation has expired.');
    }

    if (!invitation.invitationEmail) {
      throw new BadRequestException('Invitation email is missing.');
    }

    const passwordHash = await this.passwordService.hash(input.password);

    const result = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: {
          email: invitation.invitationEmail as string,
        },
        select: {
          id: true,
          currentOrganizationId: true,
          credential: {
            select: {
              id: true,
            },
          },
        },
      });

      const user = existingUser
        ? await tx.user.update({
            where: {
              id: existingUser.id,
            },
            data: {
              firstName: input.firstName,
              lastName: input.lastName,
              displayName: input.displayName,
              currentOrganizationId:
                existingUser.currentOrganizationId ?? invitation.organizationId,
            },
            select: {
              id: true,
            },
          })
        : await tx.user.create({
            data: {
              email: invitation.invitationEmail as string,
              firstName: input.firstName,
              lastName: input.lastName,
              displayName: input.displayName,
              type: 'MEMBER',
              role: 'MEMBER',
              currentOrganizationId: invitation.organizationId,
              credential: {
                create: {
                  passwordHash,
                  passwordChangedAt: new Date(),
                },
              },
              profile: {
                create: {},
              },
            },
            select: {
              id: true,
            },
          });

      if (existingUser && !existingUser.credential) {
        await tx.credential.create({
          data: {
            userId: existingUser.id,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        });
      }

      await tx.organizationMembership.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: invitation.organizationId,
          },
        },
        create: {
          userId: user.id,
          organizationId: invitation.organizationId,
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
        update: {
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      const accepted = await tx.joinRequest.update({
        where: {
          id: invitation.id,
        },
        data: {
          recipientId: user.id,
          status: 'ACCEPTED',
          respondedAt: new Date(),
          invitationToken: null,
        },
        select: invitationSelect,
      });

      return { userId: user.id, invitation: accepted };
    });

    await this.notificationsService.createNotification({
      userId: invitation.requesterId,
      organizationId: invitation.organizationId,
      type: 'INVITATION_RECEIVED',
      title: 'Invitation accepted',
      body: `${input.firstName} ${input.lastName} joined ${invitation.organization.name}.`,
      metadata: {
        invitationId: invitation.id,
        userId: result.userId,
      },
    });

    return serializeResponse({
      message: 'You have successfully joined the organization.',
      invitation: result.invitation,
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

  private assertCanManageInvitations(
    currentUser: JwtUser,
    organizationId: string,
  ) {
    const role = this.getRoleForOrganization(currentUser, organizationId);

    if (role === 'SUPER_ADMIN' || role === 'MANAGER') {
      return;
    }

    throw new ForbiddenException('Only managers can manage invitations.');
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: {
        id: organizationId,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    return organization;
  }

  private async assertNoActiveMembership(
    organizationId: string,
    userId?: string,
  ) {
    if (!userId) {
      return;
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      select: {
        status: true,
      },
    });

    if (membership?.status === 'ACTIVE') {
      throw new ConflictException(
        'This user is already an active member of the organization.',
      );
    }
  }

  private async assertNoPendingInvitation(
    organizationId: string,
    email: string,
  ) {
    const duplicate = await this.prisma.joinRequest.findFirst({
      where: {
        organizationId,
        type: 'INVITATION',
        status: 'PENDING',
        invitationEmail: email,
        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: new Date(),
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        'A pending invitation already exists for this email.',
      );
    }
  }

  private async getInvitationOrThrow(
    organizationId: string,
    invitationId: string,
  ) {
    const invitation = await this.prisma.joinRequest.findFirst({
      where: {
        id: invitationId,
        organizationId,
        type: 'INVITATION',
      },
      select: invitationSelect,
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }

    return invitation;
  }

  private getInvitationExpiry() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    return expiresAt;
  }

  private buildInvitationUrl(token: string) {
    const appUrl = this.configService.get('APP_URL', { infer: true });
    return `${appUrl}/invitations/accept?token=${token}`;
  }

  private async deliverInvitationEmail(invitation: InvitationRow) {
    if (!invitation.invitationEmail || !invitation.invitationToken) {
      return;
    }

    await this.mailService.sendInvitationEmail({
      to: invitation.invitationEmail,
      organizationName: invitation.organization.name,
      inviterName:
        invitation.requester.displayName ?? invitation.requester.firstName,
      inviteUrl: this.buildInvitationUrl(invitation.invitationToken),
      message: invitation.message ?? undefined,
      expiresAt: invitation.expiresAt ?? undefined,
    });
  }
}

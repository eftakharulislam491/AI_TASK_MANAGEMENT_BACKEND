import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  Credential,
  OrganizationMembership,
  Role,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeResponse } from '../common/utils/response';
import type {
  LoginInput,
  RefreshInput,
  RegisterInput,
} from './auth.schemas';
import type { JwtMembership, JwtUser } from './interfaces/jwt-user.interface';
import { PasswordService } from './password.service';
import type { AppEnv } from '../config/env';

type UserWithRelations = User & {
  credential: Credential | null;
  memberships: OrganizationMembership[];
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    @Inject(ConfigService)
    private readonly configService: ConfigService<AppEnv, true>,
  ) {}

  async register(dto: RegisterInput) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    if (dto.type === 'ORGANIZATION') {
      if (!dto.organizationName || !dto.organizationSlug) {
        throw new BadRequestException(
          'Organization name and slug are required for organization registration',
        );
      }

      const organizationName = dto.organizationName;
      const organizationSlug = dto.organizationSlug;

      const slugExists = await this.prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true },
      });

      if (slugExists) {
        throw new ConflictException('Organization slug is already in use');
      }

        const result = await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: dto.email,
              firstName: dto.firstName,
              lastName: dto.lastName,
              displayName: dto.displayName,
              type: 'ORGANIZATION',
              role: 'MANAGER',
              profile: {
                create: {},
              },
            },
          });

        const organization = await tx.organization.create({
          data: {
            name: organizationName,
            slug: organizationSlug,
            ownerId: user.id,
          },
        });

        await tx.organizationMembership.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            role: 'MANAGER',
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });

        await tx.credential.create({
          data: {
            userId: user.id,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        });

        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            currentOrganizationId: organization.id,
          },
          include: {
            credential: true,
            memberships: true,
          },
        });

        return updatedUser;
      });

      return this.createAuthResponse(result);
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName,
        type: 'MEMBER',
        role: 'MEMBER',
        profile: {
          create: {},
        },
        credential: {
          create: {
            passwordHash,
            passwordChangedAt: new Date(),
          },
        },
      },
      include: {
        credential: true,
        memberships: true,
      },
    });

    return this.createAuthResponse(user);
  }

  async login(dto: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        credential: true,
        memberships: true,
      },
    });

    if (!user?.credential) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await this.passwordService.verify(
      dto.password,
      user.credential.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertLoginTypeCompatibility(user, dto.type);

    await this.prisma.credential.update({
      where: { userId: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return this.createAuthResponse(user);
  }

  async refresh(dto: RefreshInput) {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        credential: true,
        memberships: true,
      },
    });

    if (!user?.credential?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token is not available');
    }

    const validRefreshToken = await this.passwordService.verify(
      dto.refreshToken,
      user.credential.refreshTokenHash,
    );

    if (!validRefreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.createAuthResponse(user);
  }

  async getProfile(userId: string) {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        currentOrganization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        memberships: {
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    return serializeResponse(profile);
  }

  private assertLoginTypeCompatibility(
    user: UserWithRelations,
    loginType: 'ORGANIZATION' | 'MEMBER',
  ) {
    const hasManagerMembership = user.memberships.some(
      (membership) =>
        membership.status === 'ACTIVE' && membership.role === 'MANAGER',
    );

    if (loginType === 'ORGANIZATION' && !hasManagerMembership) {
      throw new UnauthorizedException(
        'This account is not allowed to log in as an organization manager',
      );
    }

    if (loginType === 'MEMBER' && user.role === 'SUPER_ADMIN' && user.type !== 'MEMBER') {
      throw new UnauthorizedException(
        'Super admin accounts must use the organization login flow',
      );
    }
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return { success: true };
    }

    const payload = await this.verifyRefreshToken(refreshToken);
    const credential = await this.prisma.credential.findUnique({
      where: { userId: payload.sub },
      select: {
        userId: true,
        refreshTokenHash: true,
      },
    });

    const isValid =
      !!credential?.refreshTokenHash &&
      (await this.passwordService.verify(
        refreshToken,
        credential.refreshTokenHash,
      ));

    if (isValid) {
      await this.prisma.credential.update({
        where: { userId: payload.sub },
        data: {
          refreshTokenHash: null,
        },
      });
    }

    return { success: true };
  }

  private async createAuthResponse(user: UserWithRelations) {
    const memberships = this.toJwtMemberships(user.memberships);
    const payload: JwtUser = {
      sub: user.id,
      email: user.email,
      type: user.type,
      role: user.role as Role,
      currentOrganizationId: user.currentOrganizationId,
      memberships,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow('JWT_SECRET', { infer: true }),
      expiresIn: this.configService.getOrThrow('JWT_EXPIRES_IN', {
        infer: true,
      }) as never,
    });

    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, tokenType: 'refresh' },
      {
        secret: this.configService.getOrThrow('JWT_REFRESH_SECRET', {
          infer: true,
        }),
        expiresIn: this.configService.getOrThrow('JWT_REFRESH_EXPIRES_IN', {
          infer: true,
        }) as never,
      },
    );

    await this.prisma.credential.update({
      where: { userId: user.id },
      data: {
        refreshTokenHash: await this.passwordService.hash(refreshToken),
      },
    });

    return serializeResponse({
      accessToken,
      refreshToken,
      accessTokenExpiresIn: this.configService.getOrThrow('JWT_EXPIRES_IN', {
        infer: true,
      }),
      refreshTokenExpiresIn: this.configService.getOrThrow(
        'JWT_REFRESH_EXPIRES_IN',
        {
          infer: true,
        },
      ),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        type: user.type,
        role: user.role,
        currentOrganizationId: user.currentOrganizationId,
        memberships,
      },
    });
  }

  private toJwtMemberships(
    memberships: OrganizationMembership[],
  ): JwtMembership[] {
    return memberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
      status: membership.status,
    }));
  }

  getCookieConfig(kind: 'access' | 'refresh') {
    const ttl = this.parseExpiresIn(
      kind === 'access'
        ? this.configService.getOrThrow('JWT_EXPIRES_IN', { infer: true })
        : this.configService.getOrThrow('JWT_REFRESH_EXPIRES_IN', {
            infer: true,
          }),
    );

    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure:
        this.configService.getOrThrow('NODE_ENV', { infer: true }) ===
        'production',
      path: '/',
      maxAge: ttl,
    };
  }

  private parseExpiresIn(value: string) {
    const normalizedValue = value.trim();
    const match = normalizedValue.match(/^(\d+)([smhd])$/i);

    if (!match) {
      throw new InternalServerErrorException(
        `Invalid expires format: ${normalizedValue}. Use values like 15m, 1d, 7d.`,
      );
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60 * 1000;
      case 'h':
        return amount * 60 * 60 * 1000;
      case 'd':
        return amount * 24 * 60 * 60 * 1000;
      default:
        throw new InternalServerErrorException(
          `Invalid expires unit: ${normalizedValue}.`,
        );
    }
  }

  private async verifyRefreshToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        tokenType?: string;
      }>(token, {
        secret: this.configService.getOrThrow('JWT_REFRESH_SECRET', {
          infer: true,
        }),
      });

      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token type');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import type { AppEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedSocket = Socket & {
  user?: JwtUser;
};

@WebSocketGateway({
  namespace: 'notifications',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(@ConnectedSocket() client: AuthenticatedSocket) {
    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const user = await this.jwtService.verifyAsync<JwtUser>(token, {
        secret: this.configService.getOrThrow('JWT_SECRET', { infer: true }),
      });
      const persisted = await this.prisma.user.findUnique({
        where: {
          id: user.sub,
        },
        select: {
          isActive: true,
        },
      });

      if (!persisted?.isActive) {
        client.disconnect(true);
        return;
      }

      client.user = user;
      await client.join(this.getUserRoom(user.sub));
      this.logger.log(`Socket connected for user ${user.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: AuthenticatedSocket) {
    if (client.user?.sub) {
      this.logger.log(`Socket disconnected for user ${client.user.sub}`);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(this.getUserRoom(userId)).emit(event, payload);
  }

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  private extractToken(client: Socket) {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const authToken = auth?.token;

    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const authorization = client.handshake.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    const [type, token] = authorization.split(' ');
    return type === 'Bearer' && token ? token : undefined;
  }
}

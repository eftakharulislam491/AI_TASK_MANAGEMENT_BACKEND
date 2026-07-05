import {
  InternalServerErrorException,
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import type { AppEnv } from '../config/env';

function createPool(connectionString: string) {
  if (!connectionString) {
    throw new InternalServerErrorException(
      'DATABASE_URL is not configured. Add it to backend/.env before starting the server.',
    );
  }

  return new Pool({
    connectionString,
  });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {
    const pool = createPool(
      configService.getOrThrow('DATABASE_URL', { infer: true }).trim(),
    );
    super({
      adapter: new PrismaPg(pool),
      log:
        configService.getOrThrow('NODE_ENV', { infer: true }) === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');

    if (
      this.configService.getOrThrow('NODE_ENV', { infer: true }) ===
      'development'
    ) {
      // @ts-expect-error Prisma query events are available when query logging emits events.
      this.$on('query', (event: { query: string; duration: number }) => {
        if (event.duration > 200) {
          this.logger.warn(
            `Slow query (${event.duration}ms): ${event.query.slice(0, 120)}`,
          );
        }
      });
    }
  }

  enableShutdownHooks(app: INestApplication) {
    app.enableShutdownHooks();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}

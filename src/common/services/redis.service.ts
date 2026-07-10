import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import type { AppEnv } from '../../config/env';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    try {
      const redisUrl = this.configService.get('REDIS_URL', { infer: true });

      this.client = redisUrl
        ? createClient({
            url: redisUrl,
            socket: {
              connectTimeout: 3000,
              reconnectStrategy: (retries) => this.getReconnectDelay(retries),
            },
          })
        : createClient({
            socket: {
              host: this.configService.get('REDIS_HOST', { infer: true }),
              port: this.configService.get('REDIS_PORT', { infer: true }),
              connectTimeout: 3000,
              reconnectStrategy: (retries) => this.getReconnectDelay(retries),
            },
            password:
              this.configService.get('REDIS_PASSWORD', { infer: true }) ||
              undefined,
          });

      this.client.on('error', (error) => {
        this.isConnected = false;
        this.logger.warn(`Redis client error: ${this.formatError(error)}`);
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Redis client connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        this.logger.log('Redis client ready');
      });

      this.client.on('end', () => {
        this.isConnected = false;
        this.logger.warn('Redis client disconnected');
      });

      this.client.on('reconnecting', () => {
        this.logger.warn('Redis client reconnecting');
      });

      await this.client.connect();
    } catch (error) {
      this.isConnected = false;
      this.logger.warn(
        `Failed to connect to Redis. Cache will be bypassed. ${this.formatError(
          error,
        )}`,
      );
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.ensureConnection().get(key);
    } catch (error) {
      this.logger.warn(
        `Redis GET failed for ${key}: ${this.formatError(error)}`,
      );
      return null;
    }
  }

  async set(key: string, value: unknown, ttlInSeconds: number): Promise<void> {
    try {
      const stringValue =
        typeof value === 'string' ? value : JSON.stringify(value);

      await this.ensureConnection().set(key, stringValue, {
        EX: ttlInSeconds,
      });
    } catch (error) {
      this.logger.warn(
        `Redis SET failed for ${key}: ${this.formatError(error)}`,
      );
    }
  }

  async update(key: string, value: unknown, ttlInSeconds: number) {
    await this.set(key, value, ttlInSeconds);
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnection().del(key);
    } catch (error) {
      this.logger.warn(
        `Redis DELETE failed for ${key}: ${this.formatError(error)}`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureConnection().ping();
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client?.isOpen) {
        await this.client.quit();
      }
    } catch (error) {
      this.logger.warn(`Redis disconnect failed: ${this.formatError(error)}`);
    } finally {
      this.isConnected = false;
      this.client = null;
    }
  }

  private ensureConnection(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client is not initialized.');
    }

    if (!this.isConnected || !this.client.isReady) {
      throw new Error('Redis client is not connected.');
    }

    return this.client;
  }

  private getReconnectDelay(retries: number) {
    if (retries > 3) {
      return false;
    }

    return Math.min(retries * 200, 1000);
  }

  private formatError(error: unknown): string {
    if (error instanceof AggregateError) {
      const childMessages = error.errors
        .map((childError) => this.formatError(childError))
        .filter(Boolean);

      return childMessages.join('; ') || error.message || error.name;
    }

    if (error instanceof Error) {
      return error.message || error.name;
    }

    return String(error);
  }
}

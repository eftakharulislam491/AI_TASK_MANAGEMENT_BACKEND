import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AppEnv } from '../../config/env';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class EncryptionService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  encrypt(value: string): string {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    return [
      VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string): string {
    const [version, iv, authTag, encrypted] = value.split('.');
    if (version !== VERSION || !iv || !authTag || encrypted === undefined) {
      throw new InternalServerErrorException(
        'Encrypted credential has an unsupported format.',
      );
    }

    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.getKey(),
        Buffer.from(iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new InternalServerErrorException(
        'Encrypted credential could not be decrypted.',
      );
    }
  }

  isConfigured() {
    return Boolean(this.config.get('ENCRYPTION_KEY', { infer: true }));
  }

  private getKey() {
    const encodedKey = this.config.get('ENCRYPTION_KEY', { infer: true });
    if (!encodedKey) {
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY is required before GitHub integration can be enabled.',
      );
    }
    return Buffer.from(encodedKey, 'base64');
  }
}

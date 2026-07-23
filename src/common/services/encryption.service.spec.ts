import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const config = {
    get: jest.fn((name: string) =>
      name === 'ENCRYPTION_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService<AppEnv, true>;
  const service = new EncryptionService(config);

  it('encrypts with authenticated randomness and decrypts the original value', () => {
    const first = service.encrypt('github-secret');
    const second = service.encrypt('github-secret');

    expect(first).not.toBe('github-secret');
    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe('github-secret');
    expect(service.decrypt(second)).toBe('github-secret');
  });

  it('rejects modified ciphertext', () => {
    const encrypted = service.encrypt('github-secret');
    const tampered = `${encrypted.slice(0, -1)}x`;
    expect(() => service.decrypt(tampered)).toThrow(
      'Encrypted credential could not be decrypted.',
    );
  });
});

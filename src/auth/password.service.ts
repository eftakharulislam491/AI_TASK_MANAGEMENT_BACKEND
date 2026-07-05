import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  async hash(value: string): Promise<string> {
    return hash(value, 10);
  }

  async verify(value: string, storedHash: string): Promise<boolean> {
    return compare(value, storedHash);
  }
}

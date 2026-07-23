import { createHmac } from 'node:crypto';
import { verifyGitHubWebhookSignature } from './github-webhook-signature';

describe('verifyGitHubWebhookSignature', () => {
  const body = Buffer.from('{"action":"opened"}');
  const secret = 'repository-secret';

  it('accepts a valid sha256 signature', () => {
    const signature = `sha256=${createHmac('sha256', secret)
      .update(body)
      .digest('hex')}`;
    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a tampered payload and malformed signatures', () => {
    const signature = `sha256=${createHmac('sha256', secret)
      .update(body)
      .digest('hex')}`;
    expect(
      verifyGitHubWebhookSignature(
        Buffer.from('{"action":"closed"}'),
        signature,
        secret,
      ),
    ).toBe(false);
    expect(verifyGitHubWebhookSignature(body, 'bad', secret)).toBe(false);
  });
});

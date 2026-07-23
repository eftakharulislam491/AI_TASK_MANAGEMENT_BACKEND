import { buildAllowedOrigins, isAllowedOrigin, normalizeOrigin } from './cors';

describe('cors config helpers', () => {
  it('normalizes origins to their canonical origin value', () => {
    expect(normalizeOrigin('http://15.134.85.143/api/v1')).toBe(
      'http://15.134.85.143',
    );
    expect(normalizeOrigin('http://15.134.85.143:3000/')).toBe(
      'http://15.134.85.143:3000',
    );
  });

  it('adds the frontend app origin to the allowlist', () => {
    const allowedOrigins = buildAllowedOrigins(
      'http://172-31-30-12,http://localhost:3000',
      'http://15.134.85.143/invite/accept',
    );

    expect(allowedOrigins.has('http://15.134.85.143')).toBe(true);
    expect(allowedOrigins.has('http://localhost:3000')).toBe(true);
  });

  it('allows requests from the configured allowlist', () => {
    const allowedOrigins = buildAllowedOrigins(
      'http://15.134.85.143:3000',
      'http://172-31-30-12',
    );

    expect(
      isAllowedOrigin(
        'http://15.134.85.143:3000',
        '15.134.85.143:5000',
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('allows requests from the same public hostname on another port', () => {
    const allowedOrigins = buildAllowedOrigins(
      'http://172-31-30-12',
      'http://172-31-30-12',
    );

    expect(
      isAllowedOrigin(
        'http://15.134.85.143:3000',
        '15.134.85.143:5000',
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('rejects different hostnames that are not explicitly allowed', () => {
    const allowedOrigins = buildAllowedOrigins(
      'http://172-31-30-12',
      'http://172-31-30-12',
    );

    expect(
      isAllowedOrigin(
        'http://evil.example.com',
        '15.134.85.143:5000',
        allowedOrigins,
      ),
    ).toBe(false);
  });
});

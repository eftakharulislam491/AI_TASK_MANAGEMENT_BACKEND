import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';

const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-organization-id',
  'x-refresh-token',
];

function normalizeHostname(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  return candidate.split(':')[0]?.trim().toLowerCase() || null;
}

export function normalizeOrigin(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate).origin.toLowerCase();
  } catch {
    return candidate.replace(/\/+$/, '').toLowerCase();
  }
}

export function buildAllowedOrigins(rawAllowedOrigins: string, appUrl: string) {
  const allowedOrigins = new Set<string>();

  for (const value of rawAllowedOrigins.split(',')) {
    const normalizedOrigin = normalizeOrigin(value);
    if (normalizedOrigin) {
      allowedOrigins.add(normalizedOrigin);
    }
  }

  const appOrigin = normalizeOrigin(appUrl);
  if (appOrigin) {
    allowedOrigins.add(appOrigin);
  }

  return allowedOrigins;
}

export function isAllowedOrigin(
  requestOrigin: string | null,
  requestHost: string | undefined,
  allowedOrigins: Set<string>,
) {
  if (!requestOrigin) {
    return true;
  }

  if (allowedOrigins.has(requestOrigin)) {
    return true;
  }

  const requestHostname = normalizeHostname(requestHost);

  if (!requestHostname) {
    return false;
  }

  try {
    return new URL(requestOrigin).hostname.toLowerCase() === requestHostname;
  } catch {
    return false;
  }
}

export function createCorsOptionsDelegate(
  rawAllowedOrigins: string,
  appUrl: string,
): CorsOptionsDelegate<Request> {
  const allowedOrigins = buildAllowedOrigins(rawAllowedOrigins, appUrl);

  return (req, callback) => {
    const requestOrigin = normalizeOrigin(req.header('origin'));
    const allowOrigin = isAllowedOrigin(
      requestOrigin,
      req.header('host'),
      allowedOrigins,
    );

    const options: CorsOptions = {
      origin: allowOrigin,
      credentials: true,
      methods: CORS_METHODS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
    };

    callback(null, options);
  };
}

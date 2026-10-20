import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function requireDashboardAuthentication(apiToken: string | undefined): RequestHandler {
  return (request, response, next) => {
    if (!apiToken) {
      response.status(503).json({
        error: {
          code: 'DASHBOARD_AUTH_NOT_CONFIGURED',
          message: 'Dashboard access is not configured.',
        },
      });
      return;
    }

    const providedToken = bearerToken(request.header('authorization'));
    if (!providedToken || !safeTokenMatch(providedToken, apiToken)) {
      response.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Dashboard authentication is required.' },
      });
      return;
    }

    next();
  };
}

function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function safeTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  // Intentionally do not log request bodies or leak details to API clients.
  void _next;
  if (isRequestTooLargeError(error)) {
    response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100kb.' } });
    return;
  }

  console.error('Unhandled API error', { name: error.name, message: error.message });
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
};

function isRequestTooLargeError(error: unknown): error is { type: string } {
  return typeof error === 'object'
    && error !== null
    && 'type' in error
    && error.type === 'entity.too.large';
}

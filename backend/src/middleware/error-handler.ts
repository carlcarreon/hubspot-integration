import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  // Intentionally do not leak implementation details to webhook or dashboard clients.
  void _next;
  console.error('Unhandled API error', error);
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
};

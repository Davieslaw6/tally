export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  unauthorized: (message = 'Sign in to continue.') => new ApiError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have access to that resource.') => new ApiError(403, 'FORBIDDEN', message),
  notFound: (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message),
  badRequest: (message: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', message, details),
  conflict: (message: string) => new ApiError(409, 'CONFLICT', message),
  tooMany: (message = 'Too many requests. Try again later.', details?: unknown) =>
    new ApiError(429, 'RATE_LIMITED', message, details),
  payloadTooLarge: (message = 'File is too large.') => new ApiError(413, 'PAYLOAD_TOO_LARGE', message),
  internal: (message = 'Something went wrong.') => new ApiError(500, 'INTERNAL_ERROR', message),
};

'use strict';

/**
 * Centralized API error handling.
 * -------------------------------
 * ApiError carries a safe, client-facing message plus an HTTP status.
 * Anything that is NOT an ApiError is treated as an unexpected server fault
 * and collapsed into a generic 500 so we never leak stack traces, database
 * internals, or secrets to clients.
 */
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.expose = true; // message is safe to send to the client
    this.code = code;
  }

  static badRequest(message, code) {
    return new ApiError(400, message, code);
  }
  static unauthorized(message = 'Your session has expired. Please sign in again.', code) {
    return new ApiError(401, message, code);
  }
  static forbidden(message = 'You do not have access to that.', code) {
    return new ApiError(403, message, code);
  }
  static notFound(message = 'Not found.', code) {
    return new ApiError(404, message, code);
  }
  static conflict(message, code) {
    return new ApiError(409, message, code);
  }
  static tooMany(message = 'Too many requests. Please wait a moment and try again.', code) {
    return new ApiError(429, message, code);
  }
}

/**
 * Wrap an async route handler so thrown/rejected errors flow to the
 * centralized error handler instead of crashing or hanging the request.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { ApiError, asyncHandler };

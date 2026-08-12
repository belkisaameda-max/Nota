'use strict';

const { MemoryRateLimitStore } = require('./rate-limit-store');
const { ApiError } = require('./errors');

/**
 * Rate limiter middleware built on a swappable store (see rate-limit-store.js).
 * Defaults to an in-memory store so existing single-process behavior is
 * preserved; pass a durable store (SQLite today, Redis/Upstash later) for
 * limits that survive restarts and can be shared across instances.
 */
function createRateLimiter({ windowMs = 60_000, max = 20, message, store } = {}) {
  const backing = store || new MemoryRateLimitStore();

  return function rateLimit(req, res, next) {
    const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.path}`;

    let result;
    try {
      result = backing.hit(key, windowMs);
    } catch (e) {
      // Never let a rate-limit backend fault take down the request.
      console.error('[nota] rate-limit store error:', e?.message || e);
      return next();
    }

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - result.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (result.count > max) {
      return next(
        ApiError.tooMany(message || 'Too many requests. Please wait a moment and try again.')
      );
    }
    next();
  };
}

module.exports = { createRateLimiter };

'use strict';

/**
 * Centralized configuration and secret handling.
 * -----------------------------------------------
 * - Separates development/test defaults from production requirements.
 * - Fails fast (throws at boot) when a required production secret is missing
 *   or left at an insecure default, so we never silently run prod with a
 *   development secret.
 *
 * This is still a fictional test-credit prototype. None of this makes the
 * app production-ready fintech infrastructure.
 */

const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

// Values that must never be used in production.
const INSECURE_SECRETS = new Set([
  'development-only-change-this-secret',
  'replace-this-with-a-long-random-secret',
  'test-secret',
  '',
  undefined,
  null,
]);

function parseDuration(value, fallbackSeconds) {
  // Accepts plain seconds ("900") or a jsonwebtoken-style string ("15m", "8h").
  if (value === undefined || value === null || value === '') return fallbackSeconds;
  if (/^\d+$/.test(String(value))) return Number(value);
  const m = String(value).match(/^(\d+)\s*([smhd])$/i);
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return n * mult;
}

function loadConfig(env = process.env) {
  const problems = [];

  const jwtSecret = env.JWT_SECRET;
  if (isProduction && INSECURE_SECRETS.has(jwtSecret)) {
    problems.push('JWT_SECRET must be set to a strong, non-default value in production.');
  }
  if (isProduction && typeof jwtSecret === 'string' && jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters in production.');
  }

  if (problems.length) {
    // Fail safely: refuse to boot with missing/weak production secrets.
    throw new Error(
      `Refusing to start in production due to configuration problems:\n - ${problems.join('\n - ')}`
    );
  }

  return {
    nodeEnv: NODE_ENV,
    isProduction,
    isTest,
    port: Number(env.PORT || 3000),
    // In dev/test we allow a clearly-labeled default so the demo runs out of the box.
    jwtSecret: jwtSecret || 'development-only-change-this-secret',
    dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'nota.db'),
    seedDemos: env.SEED_DEMOS !== 'false',
    // Short-lived access token, longer-lived refresh token.
    accessTokenTtlSeconds: parseDuration(env.ACCESS_TOKEN_TTL, 15 * 60),
    refreshTokenTtlSeconds: parseDuration(env.REFRESH_TOKEN_TTL, 30 * 24 * 3600),
    trustProxyHops: Number(env.TRUST_PROXY_HOPS || 1),
    // Rate-limit backend selection. "memory" keeps a local dev implementation;
    // "sqlite" is durable across restarts within this instance. Redis/Upstash
    // can be added later behind the same store interface.
    rateLimitBackend: env.RATE_LIMIT_BACKEND || (isTest ? 'memory' : 'sqlite'),
    rateLimitAuthMax: Number(env.RATE_LIMIT_AUTH_MAX || 30),
    rateLimitTransferMax: Number(env.RATE_LIMIT_TRANSFER_MAX || 20),
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET || 'nota-demo-webhook-secret',
  };
}

module.exports = { loadConfig, parseDuration };

'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ApiError } = require('./errors');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const value = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${value}`;
}

function verifyPassword(password, saved) {
  const [salt, value] = saved.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(value, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Create a short-lived access token bound to a session id ("sid").
 * Because the session id is embedded, revoking the session (logout or
 * refresh-token reuse detection) immediately invalidates the access token.
 */
function createAccessToken(user, secret, { sessionId, ttlSeconds = 900 } = {}) {
  return jwt.sign({ sub: Number(user.id), email: user.email, sid: sessionId }, secret, {
    expiresIn: ttlSeconds,
  });
}

/** Back-compat alias for the Phase 1–3 name. */
function createToken(user, secret, opts) {
  return createAccessToken(user, secret, opts);
}

/** Opaque, high-entropy refresh token. The raw value is returned to the
 *  client exactly once and is NEVER persisted — only its SHA-256 hash is. */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Auth middleware: verifies the JWT signature/expiry AND confirms the
 * referenced session is still active. This is what prevents replay of
 * revoked tokens.
 */
function authMiddleware(secret, deps = {}) {
  const { sessions } = deps;
  return function auth(req, _res, next) {
    let payload;
    try {
      const header = req.headers.authorization || '';
      const token = header.replace(/^Bearer\s+/i, '');
      payload = jwt.verify(token, secret);
    } catch {
      return next(ApiError.unauthorized());
    }

    // Session-backed revocation check (skipped only if no session store wired).
    if (sessions && payload.sid) {
      const session = sessions.getActive(payload.sid);
      if (!session || Number(session.user_id) !== Number(payload.sub)) {
        return next(ApiError.unauthorized('Your session is no longer valid. Please sign in again.'));
      }
      req.sessionId = payload.sid;
    } else if (sessions && !payload.sid) {
      // A session store exists but this token predates sessions → reject.
      return next(ApiError.unauthorized());
    }

    req.user = payload;
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  createAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  authMiddleware,
};

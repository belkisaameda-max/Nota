'use strict';

const { clean, emailOK, usernameOK } = require('../lib/validation');
const { verifyPassword, createAccessToken } = require('../lib/crypto-auth');
const { createUser, userView } = require('../lib/db');
const { ApiError, asyncHandler } = require('../lib/errors');
const { EVENTS } = require('../lib/audit');

function registerAuthRoutes(app, { db, jwtSecret, sessions, audit, accessTokenTtlSeconds = 900 }) {
  const clientMeta = (req) => ({ ip: req.ip || '', userAgent: req.get('user-agent') || '' });

  function issueTokens(req, res, user, status) {
    const meta = clientMeta(req);
    const { sessionId, refreshToken } = sessions.create({
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const token = createAccessToken(user, jwtSecret, {
      sessionId,
      ttlSeconds: accessTokenTtlSeconds,
    });
    res.status(status).json({
      token,
      refreshToken,
      expiresIn: accessTokenTtlSeconds,
      user: userView(user),
    });
    return sessionId;
  }

  app.post(
    '/api/auth/register',
    asyncHandler(async (req, res) => {
      const name = clean(req.body.name, 60);
      const username = clean(req.body.username, 24).toLowerCase();
      const email = clean(req.body.email, 120).toLowerCase();
      const password = typeof req.body.password === 'string' ? req.body.password : '';

      if (name.length < 2) throw ApiError.badRequest('Please enter your full name.');
      if (!usernameOK(username))
        throw ApiError.badRequest('Username must be 3–24 letters, numbers, or underscores.');
      if (!emailOK(email)) throw ApiError.badRequest('Please enter a valid email address.');
      if (password.length < 8 || password.length > 128)
        throw ApiError.badRequest('Password must be 8–128 characters.');

      let user;
      try {
        user = createUser(db, { name, username, email, password });
      } catch (e) {
        const field = String(e).includes('username') ? 'username' : 'email';
        throw ApiError.conflict(`That ${field} is already in use.`);
      }

      const sessionId = issueTokens(req, res, user, 201);
      audit.record(EVENTS.REGISTER, {
        userId: user.id,
        ip: req.ip,
        metadata: { username, sessionId },
      });
    })
  );

  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const login = clean(req.body.login || req.body.email, 120).toLowerCase();
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const user = db
        .prepare('SELECT * FROM users WHERE email = ? OR username = ?')
        .get(login, login);

      if (!user || !verifyPassword(password, user.password_hash)) {
        audit.record(EVENTS.LOGIN_FAILED, { ip: req.ip, metadata: { login } });
        throw ApiError.unauthorized('Incorrect email/username or password.');
      }

      const sessionId = issueTokens(req, res, user, 200);
      audit.record(EVENTS.LOGIN, { userId: user.id, ip: req.ip, metadata: { sessionId } });
    })
  );

  // Exchange a refresh token for a new access token (with rotation).
  app.post(
    '/api/auth/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = typeof req.body.refreshToken === 'string' ? req.body.refreshToken : '';
      const meta = clientMeta(req);

      let rotated;
      try {
        rotated = sessions.rotate(refreshToken, meta);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'REUSE') {
          audit.record(EVENTS.TOKEN_REVOKED, { ip: req.ip, metadata: { reason: 'refresh_reuse' } });
        }
        throw e;
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(rotated.userId);
      if (!user) throw ApiError.unauthorized();

      const token = createAccessToken(user, jwtSecret, {
        sessionId: rotated.sessionId,
        ttlSeconds: accessTokenTtlSeconds,
      });
      audit.record(EVENTS.TOKEN_REFRESH, {
        userId: user.id,
        ip: req.ip,
        metadata: { sessionId: rotated.sessionId },
      });

      res.json({ token, refreshToken: rotated.refreshToken, expiresIn: accessTokenTtlSeconds });
    })
  );
}

/**
 * Logout route needs the auth middleware, so it is registered separately once
 * the middleware is available.
 */
function registerLogoutRoute(app, { auth, sessions, audit }) {
  app.post(
    '/api/auth/logout',
    auth,
    asyncHandler(async (req, res) => {
      const sessionId = req.sessionId;
      const revoked = sessionId ? sessions.revoke(sessionId) : false;
      if (revoked) {
        audit.record(EVENTS.LOGOUT, { userId: req.user.sub, ip: req.ip, metadata: { sessionId } });
        audit.record(EVENTS.TOKEN_REVOKED, {
          userId: req.user.sub,
          ip: req.ip,
          metadata: { sessionId, reason: 'logout' },
        });
      }
      res.json({ message: 'Signed out.' });
    })
  );
}

module.exports = { registerAuthRoutes, registerLogoutRoute };

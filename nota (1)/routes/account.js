'use strict';

const { clean } = require('../lib/validation');
const { hashPassword, verifyPassword } = require('../lib/crypto-auth');
const { userView } = require('../lib/db');
const { ApiError, asyncHandler } = require('../lib/errors');
const { EVENTS } = require('../lib/audit');

function registerAccountRoutes(app, { db, auth, audit }) {
  app.get(
    '/api/me',
    auth,
    asyncHandler(async (req, res) => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
      const wallet = db
        .prepare('SELECT balance_cents FROM wallets WHERE user_id = ?')
        .get(req.user.sub);

      if (!user || !wallet) throw ApiError.unauthorized('Account unavailable.');

      res.json({ user: userView(user), balanceCents: Number(wallet.balance_cents) });
    })
  );

  app.patch(
    '/api/me',
    auth,
    asyncHandler(async (req, res) => {
      const name = clean(req.body.name, 60);
      const bio = clean(req.body.bio, 240);
      const currentPassword =
        typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

      if (name.length < 2) throw ApiError.badRequest('Name must have at least 2 characters.');

      if (newPassword) {
        if (newPassword.length < 8 || newPassword.length > 128)
          throw ApiError.badRequest('New password must be 8–128 characters.');
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.sub);
        if (!row || !verifyPassword(currentPassword, row.password_hash))
          throw ApiError.badRequest('Current password is incorrect.');
        db.prepare('UPDATE users SET name = ?, bio = ?, password_hash = ? WHERE id = ?').run(
          name,
          bio,
          hashPassword(newPassword),
          req.user.sub
        );
        audit.record(EVENTS.PASSWORD_CHANGE, { userId: req.user.sub, ip: req.ip });
      } else {
        db.prepare('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(name, bio, req.user.sub);
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
      res.json({ user: userView(user) });
    })
  );

  app.get(
    '/api/users/search',
    auth,
    asyncHandler(async (req, res) => {
      const q = clean(req.query.q, 80);
      if (q.length < 2) return res.json({ users: [] });

      const like = `%${q}%`;
      const users = db
        .prepare(
          `SELECT id, name, username FROM users
           WHERE id != ? AND (username LIKE ? OR email LIKE ?)
           ORDER BY username LIMIT 8`
        )
        .all(req.user.sub, like, like)
        .map((u) => ({ ...u, id: Number(u.id) }));

      res.json({ users });
    })
  );
}

module.exports = { registerAccountRoutes };

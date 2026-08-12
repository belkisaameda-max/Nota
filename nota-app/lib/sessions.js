'use strict';

const crypto = require('crypto');
const { generateRefreshToken, hashRefreshToken } = require('./crypto-auth');
const { ApiError } = require('./errors');

/**
 * Session + refresh-token store (SQLite-backed).
 * ----------------------------------------------
 * - Refresh tokens are opaque random strings. Only their SHA-256 hash is
 *   stored (`sessions.refresh_hash`); the raw value never touches the DB.
 * - Rotation: every successful refresh issues a NEW refresh token and records
 *   the old hash in `used_refresh_tokens`.
 * - Reuse/replay detection: presenting an already-rotated refresh token is a
 *   strong signal of theft, so the entire session is revoked.
 */
function createSessionStore(db, { refreshTtlSeconds = 30 * 24 * 3600 } = {}) {
  const getActiveStmt = db.prepare(
    `SELECT * FROM sessions
     WHERE id = ? AND revoked_at IS NULL AND expires_at > datetime('now')`
  );
  const findByHashStmt = db.prepare(
    `SELECT * FROM sessions
     WHERE refresh_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')`
  );
  const usedLookupStmt = db.prepare('SELECT session_id FROM used_refresh_tokens WHERE hash = ?');
  const revokeStmt = db.prepare(
    "UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"
  );

  function create({ userId, ip = '', userAgent = '' }) {
    const sessionId = crypto.randomUUID();
    const refreshToken = generateRefreshToken();
    db.prepare(
      `INSERT INTO sessions (id, user_id, refresh_hash, expires_at, ip, user_agent)
       VALUES (?, ?, ?, datetime('now', ?), ?, ?)`
    ).run(
      sessionId,
      Number(userId),
      hashRefreshToken(refreshToken),
      `+${Number(refreshTtlSeconds)} seconds`,
      String(ip).slice(0, 64),
      String(userAgent).slice(0, 200)
    );
    return { sessionId, refreshToken };
  }

  function getActive(sessionId) {
    return getActiveStmt.get(sessionId) || null;
  }

  function revoke(sessionId) {
    const info = revokeStmt.run(sessionId);
    return info.changes > 0;
  }

  /**
   * Rotate a refresh token. Returns { sessionId, userId, refreshToken }.
   * Throws ApiError(401) on an invalid token, and on reuse it also revokes
   * the compromised session before throwing.
   */
  function rotate(refreshToken, { ip = '', userAgent = '' } = {}) {
    if (typeof refreshToken !== 'string' || refreshToken.length < 20) {
      throw ApiError.unauthorized('Invalid refresh token.');
    }
    const hash = hashRefreshToken(refreshToken);

    // Replay detection: this token was already rotated away.
    const used = usedLookupStmt.get(hash);
    if (used) {
      revoke(used.session_id);
      throw ApiError.unauthorized('Refresh token reuse detected. Session revoked.', 'REUSE');
    }

    const session = findByHashStmt.get(hash);
    if (!session) throw ApiError.unauthorized('Invalid or expired refresh token.');

    const nextToken = generateRefreshToken();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO used_refresh_tokens (hash, session_id) VALUES (?, ?)').run(
        hash,
        session.id
      );
      db.prepare(
        `UPDATE sessions
         SET refresh_hash = ?, last_used_at = datetime('now'), ip = ?, user_agent = ?
         WHERE id = ?`
      ).run(hashRefreshToken(nextToken), String(ip).slice(0, 64), String(userAgent).slice(0, 200), session.id);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }

    return { sessionId: session.id, userId: Number(session.user_id), refreshToken: nextToken };
  }

  return { create, getActive, revoke, rotate };
}

module.exports = { createSessionStore };

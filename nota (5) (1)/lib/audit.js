'use strict';

/**
 * Security / audit event log.
 * ---------------------------
 * Records important actions for later review. Metadata is stored as JSON and
 * MUST NOT contain passwords, tokens, refresh tokens, password hashes, or any
 * other secret. A denylist strips obviously-sensitive keys defensively.
 */
const EVENTS = Object.freeze({
  REGISTER: 'user.register',
  LOGIN: 'user.login',
  LOGIN_FAILED: 'user.login_failed',
  LOGOUT: 'user.logout',
  PASSWORD_CHANGE: 'user.password_change',
  TOKEN_REFRESH: 'auth.token_refresh',
  TOKEN_REVOKED: 'auth.token_revoked',
  TRANSFER_CREATED: 'transfer.created',
  TRANSFER_REJECTED: 'transfer.rejected',
});

const SECRET_KEYS = /pass|secret|token|hash|authorization|cookie|pin|cvv/i;

function scrub(metadata) {
  const out = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (SECRET_KEYS.test(k)) continue; // never persist secret-looking fields
    if (v === undefined) continue;
    out[k] = typeof v === 'object' && v !== null ? scrub(v) : v;
  }
  return out;
}

function createAuditLog(db) {
  const stmt = db.prepare(
    'INSERT INTO audit_events (event_type, user_id, ip, metadata) VALUES (?, ?, ?, ?)'
  );

  function record(eventType, { userId = null, ip = '', metadata = {} } = {}) {
    try {
      stmt.run(
        String(eventType),
        userId == null ? null : Number(userId),
        String(ip).slice(0, 64),
        JSON.stringify(scrub(metadata))
      );
    } catch (e) {
      // Audit logging must never break the primary request path.
      console.error('[nota] audit write failed:', e?.message || e);
    }
  }

  function list({ limit = 50, userId } = {}) {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
    if (userId != null) {
      return db
        .prepare('SELECT * FROM audit_events WHERE user_id = ? ORDER BY id DESC LIMIT ?')
        .all(Number(userId), capped);
    }
    return db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?').all(capped);
  }

  return { record, list, EVENTS };
}

module.exports = { createAuditLog, EVENTS };

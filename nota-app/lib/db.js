'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./crypto-auth');

function openDatabase(dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      balance_cents INTEGER NOT NULL DEFAULT 100000 CHECK(balance_cents >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed',
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sender_id, idempotency_key)
    );
  `);

  function addColumn(sql) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!String(e.message).includes('duplicate column')) throw e;
    }
  }

  addColumn('ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE');
  addColumn("ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'");
  addColumn("ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'");
  addColumn('ALTER TABLE transactions ADD COLUMN idempotency_key TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
      ON users(username) WHERE username IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS transfer_idempotency_unique
      ON transactions(sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);

  // --- Phase 4 migrations -------------------------------------------------

  // Auth sessions. Refresh tokens are NEVER stored raw — only a SHA-256 hash.
  // The access-token JWT carries this session id ("sid"); revoking the session
  // immediately invalidates any access token that references it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      refresh_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  `);

  // Consumed/rotated refresh-token hashes, for replay (reuse) detection.
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_refresh_tokens (
      hash TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      rotated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Double-entry ledger. Each transfer writes two rows (debit + credit) with
  // the resulting balance, giving a reconciliation-friendly audit trail while
  // keeping the existing `transactions` table intact for compatibility.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      counterparty_id INTEGER NOT NULL REFERENCES users(id),
      direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      balance_after_cents INTEGER NOT NULL CHECK(balance_after_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger_entries(user_id, id);
    CREATE INDEX IF NOT EXISTS ledger_txn_idx ON ledger_entries(transaction_id);
  `);

  // Security/audit events. Metadata is a JSON string and must never contain
  // passwords, tokens, or other secrets.
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id INTEGER,
      ip TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_events(user_id, id);
    CREATE INDEX IF NOT EXISTS audit_type_idx ON audit_events(event_type, id);
  `);

  // Durable rate-limit counters (used by the SQLite rate-limit store).
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
  `);

  // Phase 5 payment infrastructure. These records contain provider references
  // and tokenized metadata only; Nota never stores card numbers or CVV.
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      provider_intent_id TEXT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      status TEXT NOT NULL CHECK(status IN ('created','pending','authorized','succeeded','failed','cancelled','refunded')),
      idempotency_key TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, idempotency_key),
      UNIQUE(provider, provider_intent_id)
    );
    CREATE INDEX IF NOT EXISTS payment_intents_user_idx ON payment_intents(user_id, created_at);
  `);
  try { db.exec('ALTER TABLE payment_intents ADD COLUMN credited_at TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  db.exec(`

    CREATE TABLE IF NOT EXISTS provider_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
      provider TEXT NOT NULL,
      provider_transaction_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('payment','payout')),
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      currency TEXT NOT NULL,
      raw_reference TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_transaction_id)
    );

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      signature_valid INTEGER NOT NULL CHECK(signature_valid IN (0,1)),
      payload TEXT NOT NULL,
      processed_at TEXT,
      processing_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_event_id)
    );

    CREATE TABLE IF NOT EXISTS payment_refunds (
      id TEXT PRIMARY KEY,
      payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
      provider TEXT NOT NULL,
      provider_refund_id TEXT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed','cancelled')),
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_refund_id)
    );

    CREATE TABLE IF NOT EXISTS payment_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      source TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS payment_status_history_idx ON payment_status_history(payment_intent_id, id);
  `);

  // Phase 6 identity, KYC, compliance, and account restriction records.
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), legal_name TEXT NOT NULL DEFAULT '', country_code TEXT NOT NULL DEFAULT '', date_of_birth TEXT, document_type TEXT, document_last4 TEXT, provider TEXT NOT NULL DEFAULT 'demo', provider_subject TEXT, status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','pending','verified','rejected','expired','needs_review')), verified_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kyc_checks (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), provider TEXT NOT NULL, provider_check_id TEXT, status TEXT NOT NULL CHECK(status IN ('created','pending','verified','rejected','expired','needs_review')), decision TEXT NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','allow','review','deny')), risk_score INTEGER CHECK(risk_score IS NULL OR (risk_score BETWEEN 0 AND 100)), sanctions_result TEXT NOT NULL DEFAULT 'not_checked', document_result TEXT NOT NULL DEFAULT 'not_checked', idempotency_key TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, idempotency_key), UNIQUE(provider, provider_check_id)
    );
    CREATE INDEX IF NOT EXISTS kyc_checks_user_idx ON kyc_checks(user_id, created_at);
    CREATE TABLE IF NOT EXISTS kyc_webhook_events (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL, signature_valid INTEGER NOT NULL, payload TEXT NOT NULL, processed_at TEXT, processing_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider, provider_event_id));
    CREATE TABLE IF NOT EXISTS risk_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), check_id TEXT REFERENCES kyc_checks(id), decision TEXT NOT NULL CHECK(decision IN ('allow','review','deny')), risk_score INTEGER NOT NULL CHECK(risk_score BETWEEN 0 AND 100), rules TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS account_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), from_status TEXT, to_status TEXT NOT NULL CHECK(to_status IN ('active','restricted','suspended','closed')), reason TEXT NOT NULL DEFAULT '', actor_user_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  try { db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }

  // Phase 7 fraud/risk prototype records. Store only decision metadata and
  // minimal operational signals; never persist passwords, tokens, cards, or fingerprints.
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_evaluations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      evaluation_type TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      payment_intent_id TEXT REFERENCES payment_intents(id),
      transaction_id INTEGER REFERENCES transactions(id),
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      band TEXT NOT NULL CHECK(band IN ('low','medium','high')),
      decision TEXT NOT NULL CHECK(decision IN ('allow','review','deny')),
      reason_codes TEXT NOT NULL DEFAULT '[]',
      idempotency_key TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS risk_evaluations_user_idx ON risk_evaluations(user_id, created_at);
    CREATE INDEX IF NOT EXISTS risk_evaluations_subject_idx ON risk_evaluations(subject_type, subject_id, created_at);

    CREATE TABLE IF NOT EXISTS risk_cases (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      evaluation_id TEXT NOT NULL REFERENCES risk_evaluations(id),
      payment_intent_id TEXT REFERENCES payment_intents(id),
      transaction_id INTEGER REFERENCES transactions(id),
      severity TEXT NOT NULL CHECK(severity IN ('medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','under_review','resolved','dismissed')),
      reason_codes TEXT NOT NULL DEFAULT '[]',
      reviewer_user_id INTEGER,
      resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(evaluation_id)
    );
    CREATE INDEX IF NOT EXISTS risk_cases_status_idx ON risk_cases(status, created_at);

    CREATE TABLE IF NOT EXISTS risk_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      evaluation_id TEXT REFERENCES risk_evaluations(id),
      case_id TEXT REFERENCES risk_cases(id),
      user_id INTEGER REFERENCES users(id),
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS risk_events_user_idx ON risk_events(user_id, created_at);
  `);
}

function userView(u) {
  return {
    id: Number(u.id),
    name: u.name,
    username: u.username,
    email: u.email,
    bio: u.bio,
    createdAt: u.created_at,
  };
}

function createUser(db, { name, username, email, password }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db
      .prepare('INSERT INTO users(name, username, email, password_hash) VALUES(?, ?, ?, ?)')
      .run(name, username, email, hashPassword(password));
    db.prepare('INSERT INTO wallets(user_id) VALUES(?)').run(result.lastInsertRowid);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    db.exec('COMMIT');
    return user;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function seedDemoUsers(db) {
  if (process.env.SEED_DEMOS === 'false') return;
  const demos = [
    { name: 'Amer Demo', username: 'amer', email: 'amer@test.local' },
    { name: 'Alex Demo', username: 'alex', email: 'alex@test.local' },
    { name: 'Sarah Demo', username: 'sarah', email: 'sarah@test.local' },
  ];
  for (const u of demos) {
    if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username)) {
      createUser(db, { ...u, password: 'NotaDemo1!' });
    }
  }
}

module.exports = { openDatabase, userView, createUser, seedDemoUsers };

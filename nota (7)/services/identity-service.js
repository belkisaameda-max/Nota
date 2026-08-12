'use strict';
const crypto = require('node:crypto');
const { transition, STATES } = require('../lib/payment-state');

function id() { return `kyc_${crypto.randomUUID()}`; }
function json(value) { return JSON.stringify(value || {}); }

function createIdentityService({ db, provider, audit }) {
  function profile(userId) {
    const row = db.prepare('SELECT * FROM identity_profiles WHERE user_id=?').get(Number(userId));
    if (!row) return { userId: Number(userId), status: 'not_started' };
    if (row.expires_at && new Date(row.expires_at) <= new Date() && row.status === 'verified') {
      db.prepare("UPDATE identity_profiles SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(Number(userId));
      return { ...row, status: 'expired' };
    }
    return row;
  }
  function start({ userId, input, idempotencyKey, ip }) {
    const prior = db.prepare('SELECT * FROM kyc_checks WHERE user_id=? AND idempotency_key=?').get(Number(userId), idempotencyKey);
    if (prior) return { check: prior, duplicate: true };
    const outcome = input.demoOutcome || 'verified';
    const remote = provider.createCheck({ userId, outcome });
    const checkId = id();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("INSERT INTO identity_profiles(user_id,legal_name,country_code,date_of_birth,document_type,document_last4,provider,provider_subject,status) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET legal_name=excluded.legal_name,country_code=excluded.country_code,date_of_birth=excluded.date_of_birth,document_type=excluded.document_type,document_last4=excluded.document_last4,provider=excluded.provider,provider_subject=excluded.provider_subject,status=excluded.status,updated_at=CURRENT_TIMESTAMP").run(Number(userId), input.legalName || '', input.countryCode || '', input.dateOfBirth || null, input.documentType || 'demo', String(input.documentLast4 || '').slice(-4), provider.name, remote.providerCheckId, remote.status === 'verified' ? 'verified' : remote.status === 'pending' ? 'pending' : remote.status);
      db.prepare('INSERT INTO kyc_checks(id,user_id,provider,provider_check_id,status,decision,risk_score,sanctions_result,document_result,idempotency_key,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(checkId, Number(userId), provider.name, remote.providerCheckId, remote.status, remote.status === 'verified' ? 'allow' : remote.status === 'rejected' ? 'deny' : 'review', remote.riskScore, remote.sanctionsResult, remote.documentResult, idempotencyKey, json({ demo: true }));
      db.prepare('INSERT INTO risk_decisions(user_id,check_id,decision,risk_score,rules) VALUES(?,?,?,?,?)').run(Number(userId), checkId, remote.status === 'verified' ? 'allow' : remote.status === 'rejected' ? 'deny' : 'review', remote.riskScore || 50, json({ demoOutcome: outcome }));
      audit.record('kyc.started', { userId: Number(userId), ip, metadata: { checkId, provider: provider.name } });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    return { check: db.prepare('SELECT * FROM kyc_checks WHERE id=?').get(checkId), duplicate: false };
  }
  function expire() {
    const result = db.prepare("UPDATE identity_profiles SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE status='verified' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP").run();
    return Number(result.changes || 0);
  }
  return { profile, start, expire };
}
module.exports = { createIdentityService };

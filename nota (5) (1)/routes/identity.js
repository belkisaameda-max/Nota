'use strict';
const { ApiError, asyncHandler } = require('../lib/errors');
const { limitFrom } = require('../lib/validation');

function registerIdentityRoutes(app, { db, auth, audit, identityService }) {
  app.get('/api/identity', auth, asyncHandler(async (req, res) => res.json({ identity: identityService.profile(req.user.sub) })));
  app.post('/api/identity/kyc', auth, asyncHandler(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (!key || key.length > 128) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
    const result = identityService.start({ userId: req.user.sub, input: req.body || {}, idempotencyKey: key, ip: req.ip });
    res.status(result.duplicate ? 200 : 201).json({ check: result.check, duplicate: result.duplicate, demoOnly: true });
  }));
  app.get('/api/identity/kyc', auth, asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT * FROM kyc_checks WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(Number(req.user.sub), limitFrom(req.query.limit, 20, 100));
    res.json({ checks: rows });
  }));
  app.get('/api/admin/identity/review', auth, asyncHandler(async (req, res) => {
    if (!req.user.isAdmin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Administrator access required.');
    const rows = db.prepare("SELECT k.*,u.username,u.email FROM kyc_checks k JOIN users u ON u.id=k.user_id WHERE k.decision='review' OR k.status='needs_review' ORDER BY k.created_at ASC LIMIT ?").all(limitFrom(req.query.limit, 50, 100));
    res.json({ checks: rows });
  }));
  app.post('/api/admin/identity/:checkId/decision', auth, asyncHandler(async (req, res) => {
    if (!req.user.isAdmin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Administrator access required.');
    const decision = String(req.body?.decision || '');
    if (!['allow','review','deny'].includes(decision)) throw new ApiError(400, 'INVALID_DECISION', 'Decision must be allow, review, or deny.');
    const check = db.prepare('SELECT * FROM kyc_checks WHERE id=?').get(req.params.checkId);
    if (!check) throw new ApiError(404, 'NOT_FOUND', 'Identity check not found.');
    const status = decision === 'allow' ? 'verified' : decision === 'deny' ? 'rejected' : 'needs_review';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE kyc_checks SET decision=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(decision, status, req.params.checkId);
      db.prepare("UPDATE identity_profiles SET status=?,verified_at=CASE WHEN ?='verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,expires_at=CASE WHEN ?='verified' THEN datetime('now','+1 year') ELSE expires_at END,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(status, status, status, Number(check.user_id));
      audit.record('kyc.admin_decision', { userId: Number(check.user_id), ip: req.ip, metadata: { checkId: req.params.checkId, decision, actorUserId: req.user.sub } });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    res.json({ check: db.prepare('SELECT * FROM kyc_checks WHERE id=?').get(req.params.checkId) });
  }));
}
function registerAccountStatusRoutes(app, { db, auth, audit }) {
  app.get('/api/account/status', auth, asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT account_status FROM users WHERE id=?').get(Number(req.user.sub));
    res.json({ status: row?.account_status || 'active' });
  }));
  app.post('/api/admin/accounts/:userId/status', auth, asyncHandler(async (req, res) => {
    if (!req.user.isAdmin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Administrator access required.');
    const status = String(req.body?.status || '');
    const reason = String(req.body?.reason || '').slice(0, 240);
    if (!['active','restricted','suspended','closed'].includes(status)) throw new ApiError(400, 'INVALID_STATUS', 'Invalid account status.');
    const userId = Number(req.params.userId);
    const current = db.prepare('SELECT account_status FROM users WHERE id=?').get(userId);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET account_status=? WHERE id=?').run(status, userId);
      db.prepare('INSERT INTO account_status_history(user_id,from_status,to_status,reason,actor_user_id) VALUES(?,?,?,?,?)').run(userId, current.account_status || 'active', status, reason, Number(req.user.sub));
      audit.record('account.status_changed', { userId, ip: req.ip, metadata: { from: current.account_status || 'active', to: status, reason, actorUserId: req.user.sub } });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    res.json({ userId, status });
  }));
}

function registerIdentityWebhookRoute(app, { db, provider, identityService, webhookSecret, audit }) {
  app.post('/api/webhooks/kyc', require('express').raw({ type: 'application/json', limit: '50kb' }), asyncHandler(async (req, res) => {
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})));
    const signature = req.get('x-kyc-signature') || '';
    const valid = provider.verifyWebhook(raw, signature, webhookSecret);
    let payload = {};
    try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new ApiError(400, 'INVALID_WEBHOOK', 'Invalid webhook payload.'); }
    if (!valid) throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature.');
    const eventId = String(payload.id || '');
    if (!eventId) throw new ApiError(400, 'INVALID_WEBHOOK', 'Webhook event id is required.');
    const existing = db.prepare('SELECT * FROM kyc_webhook_events WHERE provider=? AND provider_event_id=?').get(provider.name, eventId);
    if (existing?.processed_at) return res.json({ received: true, duplicate: true });
    if (!existing) {
      try { db.prepare('INSERT INTO kyc_webhook_events(provider,provider_event_id,event_type,signature_valid,payload) VALUES(?,?,?,?,?)').run(provider.name, eventId, String(payload.type || 'identity.updated'), 1, raw.toString('utf8')); }
      catch (error) { if (!String(error.message).includes('UNIQUE')) throw error; }
    }
    try {
      const check = db.prepare('SELECT * FROM kyc_checks WHERE provider=? AND provider_check_id=?').get(provider.name, String(payload.providerCheckId || ''));
      if (check && payload.status) {
        const status = ['verified','rejected','needs_review','pending'].includes(payload.status) ? payload.status : 'needs_review';
        const decision = status === 'verified' ? 'allow' : status === 'rejected' ? 'deny' : 'review';
        db.prepare('UPDATE kyc_checks SET status=?,decision=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, decision, check.id);
        db.prepare('UPDATE identity_profiles SET status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(status, Number(check.user_id));
        audit.record('kyc.webhook_processed', { userId: Number(check.user_id), metadata: { eventId, checkId: check.id, status } });
      }
      db.prepare('UPDATE kyc_webhook_events SET processed_at=CURRENT_TIMESTAMP,processing_error=NULL WHERE provider=? AND provider_event_id=?').run(provider.name, eventId);
    } catch (error) {
      db.prepare('UPDATE kyc_webhook_events SET processing_error=? WHERE provider=? AND provider_event_id=?').run(String(error.message).slice(0, 500), provider.name, eventId);
      throw error;
    }
    res.json({ received: true, duplicate: false });
  }));
}

module.exports = { registerIdentityRoutes, registerIdentityWebhookRoute, registerAccountStatusRoutes };

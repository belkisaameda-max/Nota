'use strict';

const { clean, centsFrom, limitFrom } = require('../lib/validation');
const { ApiError, asyncHandler } = require('../lib/errors');

function registerPaymentRoutes(app, { db, auth, audit, paymentService, reconcile }) {
  app.get('/api/payments/reconciliation', auth, asyncHandler(async (req, res) => {
    res.json({ reconciliation: reconcile(), demoOnly: true });
  }));
  app.post('/api/payments/intents', auth, asyncHandler(async (req, res) => {
    const amountCents = centsFrom(req.body.amount);
    const idempotencyKey = clean(req.get('Idempotency-Key') || req.body.idempotencyKey, 100);
    const outcome = clean(req.body.demoOutcome, 20);
    if (!amountCents || amountCents > 1000000) throw ApiError.badRequest('Enter a valid test-payment amount.');
    if (!idempotencyKey) throw ApiError.badRequest('Payment reference missing.');
    const result = paymentService.createIntent({ userId: req.user.sub, amountCents, currency: 'EUR', idempotencyKey, metadata: { environment: 'demo', requestedOutcome: outcome || 'pending' } });
    audit.record('payment.created', { userId: req.user.sub, ip: req.ip, metadata: { paymentIntentId: result.intent.id, duplicate: result.duplicate } });
    res.status(result.duplicate ? 200 : 201).json({ paymentIntent: result.intent, duplicate: result.duplicate, demoOnly: true });
  }));

  app.get('/api/payments/:id', auth, asyncHandler(async (req, res) => {
    const intent = paymentService.getIntent(clean(req.params.id, 100));
    if (!intent || Number(intent.user_id) !== Number(req.user.sub)) throw ApiError.notFound('Payment not found.');
    res.json({ paymentIntent: intent, demoOnly: true });
  }));

  app.post('/api/payments/:id/refunds', auth, asyncHandler(async (req, res) => {
    const amountCents = centsFrom(req.body.amount);
    const result = paymentService.refund({ userId: req.user.sub, intentId: clean(req.params.id, 100), amountCents, reason: clean(req.body.reason, 140) });
    res.status(201).json(result);
  }));

  app.get('/api/payments', auth, asyncHandler(async (req, res) => {
    const limit = limitFrom(req.query.limit, 20, 100);
    const rows = db.prepare('SELECT * FROM payment_intents WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?').all(req.user.sub, limit);
    res.json({ payments: rows, demoOnly: true });
  }));
}

function registerWebhookRoute(app, { db, provider, paymentService, webhookSecret, audit }) {
  app.post('/api/webhooks/payments', asyncHandler(async (req, res) => {
    const signature = req.get('X-Nota-Signature') || '';
    const payload = JSON.stringify(req.body || {});
    if (!provider.verifyWebhook({ payload, signature, secret: webhookSecret })) {
      audit.record('payment.webhook_rejected', { ip: req.ip, metadata: { provider: provider.name } });
      throw ApiError.unauthorized('Invalid webhook signature.');
    }
    const event = provider.parseWebhook(payload);
    if (!event.id || !event.paymentIntentId || !event.type) throw ApiError.badRequest('Invalid webhook event.');
    const existing = db.prepare('SELECT * FROM payment_webhook_events WHERE provider=? AND provider_event_id=?').get(provider.name, event.id);
    if (existing) return res.json({ received: true, duplicate: true });
    db.prepare('INSERT INTO payment_webhook_events(provider,provider_event_id,event_type,signature_valid,payload) VALUES(?,?,?,?,?)').run(provider.name, event.id, event.type, 1, payload);
    const intent = db.prepare('SELECT id FROM payment_intents WHERE provider_intent_id=?').get(event.paymentIntentId);
    if (intent) paymentService.applyProviderStatus(intent.id, event.status, 'webhook', event.id);
    db.prepare('UPDATE payment_webhook_events SET processed_at=CURRENT_TIMESTAMP WHERE provider=? AND provider_event_id=?').run(provider.name, event.id);
    audit.record('payment.webhook_processed', { ip: req.ip, metadata: { eventId: event.id, paymentIntentId: event.paymentIntentId } });
    res.json({ received: true, duplicate: false });
  }));
}

module.exports = { registerPaymentRoutes, registerWebhookRoute };

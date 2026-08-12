'use strict';

const { ApiError, asyncHandler } = require('../lib/errors');
const { clean, centsFrom, limitFrom } = require('../lib/validation');

function registerSandboxTransferRoutes(app, { db, auth, audit, service }) {
  app.get('/api/sandbox/transfers', auth, asyncHandler(async (req, res) => {
    res.json({ transfers: service.listForUser(req.user.sub, limitFrom(req.query.limit, 50, 100)), demoOnly: true });
  }));

  app.post('/api/sandbox/transfers', auth, asyncHandler(async (req, res) => {
    const amountCents = centsFrom(req.body.amount);
    const idempotencyKey = clean(req.get('Idempotency-Key') || req.body.idempotencyKey, 100);
    const recipientId = Number(req.body.recipientId);
    if (!Number.isInteger(recipientId) || recipientId <= 0) throw ApiError.badRequest('Recipient is required.');
    if (!amountCents || amountCents > 1000000) throw ApiError.badRequest('Enter a valid test-credit amount.');
    if (!idempotencyKey) throw ApiError.badRequest('Transfer reference missing.');
    const result = service.create({ userId: req.user.sub, recipientId, amountCents, idempotencyKey, metadata: { demoRiskScenario: clean(req.body.demoRiskScenario, 30) || 'LOW_RISK' } });
    audit.record('sandbox.transfer_requested', { userId: req.user.sub, ip: req.ip, metadata: { transferId: result.transfer.id, duplicate: result.duplicate } });
    res.status(result.duplicate ? 200 : 201).json({ transfer: result.transfer, duplicate: result.duplicate, demoOnly: true });
  }));
}

module.exports = { registerSandboxTransferRoutes };

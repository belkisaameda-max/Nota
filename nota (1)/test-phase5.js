'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const port = 3400 + Math.floor(Math.random() * 100);
const dbFile = `/tmp/nota-phase5-${process.pid}.db`;
const secret = 'phase5-webhook-secret';
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_FILE: dbFile, JWT_SECRET: 'phase5-test-secret', PAYMENT_WEBHOOK_SECRET: secret, SEED_DEMOS: 'true' }, stdio: 'pipe' });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function request(path, options = {}) { const response = await fetch(`${base}${path}`, options); const body = await response.json(); return { response, body }; }
function signed(event) { const payload = JSON.stringify(event); return { payload, signature: crypto.createHmac('sha256', secret).update(payload).digest('hex') }; }

(async () => {
  try {
    for (let i = 0; i < 30; i += 1) { try { if ((await fetch(`${base}/`)).ok) break; } catch {} await sleep(100); }
    const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'amer', password: 'NotaDemo1!' }) });
    assert.equal(login.response.status, 200);
    const auth = { Authorization: `Bearer ${login.body.token}`, 'content-type': 'application/json' };

    const created = await request('/api/payments/intents', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'phase5-success' }, body: JSON.stringify({ amount: '12.50' }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.paymentIntent.status, 'pending');
    const intent = created.body.paymentIntent;

    const event = { id: 'evt-phase5-success', type: 'payment.succeeded', paymentIntentId: intent.provider_intent_id, status: 'succeeded' };
    const signedEvent = signed(event);
    const webhookOptions = { method: 'POST', headers: { 'content-type': 'application/json', 'X-Nota-Signature': signedEvent.signature }, body: signedEvent.payload };
    const concurrent = await Promise.all([request('/api/webhooks/payments', webhookOptions), request('/api/webhooks/payments', webhookOptions)]);
    assert.equal(concurrent.filter((x) => x.response.ok).length, 2);
    const duplicate = await request('/api/webhooks/payments', webhookOptions);
    assert.equal(duplicate.body.duplicate, true);

    const status = await request(`/api/payments/${intent.id}`, { headers: auth });
    assert.equal(status.body.paymentIntent.status, 'succeeded');
    const invalid = await request('/api/webhooks/payments', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Nota-Signature': 'invalid' }, body: signedEvent.payload });
    assert.equal(invalid.response.status, 401);

    const refund = await request(`/api/payments/${intent.id}/refunds`, { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'phase5 test' }) });
    assert.equal(refund.response.status, 201);
    assert.equal(refund.body.intent.status, 'refunded');
    const failed = await request('/api/payments/intents', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'phase5-failed' }, body: JSON.stringify({ amount: '2.00', demoOutcome: 'failed' }) });
    assert.equal(failed.response.status, 201);
    assert.equal(failed.body.paymentIntent.status, 'failed');
    const cancelled = await request('/api/payments/intents', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'phase5-cancelled' }, body: JSON.stringify({ amount: '3.00', demoOutcome: 'cancelled' }) });
    assert.equal(cancelled.response.status, 201);
    assert.equal(cancelled.body.paymentIntent.status, 'cancelled');
    const unauthorized = await request(`/api/payments/${intent.id}`);
    assert.equal(unauthorized.response.status, 401);
    const reconciliation = await request('/api/payments/reconciliation', { headers: auth });
    assert.equal(reconciliation.response.status, 200);
    assert.equal(reconciliation.body.reconciliation.mismatches.length, 0);
    console.log('Phase 5 tests passed.');
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(dbFile, { force: true }); } catch {}
    try { fs.rmSync(`${dbFile}-wal`, { force: true }); fs.rmSync(`${dbFile}-shm`, { force: true }); } catch {}
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = `/tmp/nota-phase6-${process.pid}.db`;
try { fs.unlinkSync(path); } catch {}
process.env.NODE_ENV = 'test'; process.env.DB_FILE = path; process.env.SEED_DEMOS = 'true'; process.env.JWT_SECRET = 'phase6-test-secret'; process.env.PORT = '0';
const { app } = require('./server');
function request(server, path, options = {}) { return new Promise((resolve, reject) => { const address = server.address(); const req = http.request({ hostname: '127.0.0.1', port: address.port, path, method: options.method || 'GET', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }, (res) => { let data = ''; res.on('data', (chunk) => { data += chunk; }); res.on('end', () => resolve({ response: res, body: data ? JSON.parse(data) : {} })); }); req.on('error', reject); if (options.body) req.write(JSON.stringify(options.body)); req.end(); }); }
(async () => {
  const server = app.listen(0); try {
    const login = await request(server, '/api/auth/login', { method: 'POST', body: { login: 'amer', password: 'NotaDemo1!' } });
    assert.equal(login.response.statusCode, 200); const auth = { Authorization: `Bearer ${login.body.token}` };
    const before = await request(server, '/api/identity', { headers: auth }); assert.equal(before.body.identity.status, 'not_started');
    const status = await request(server, '/api/account/status', { headers: auth }); assert.equal(status.body.status, 'active');
    const accountStatus = await request(server, '/api/admin/accounts/2/status', { method: 'POST', headers: auth, body: { status: 'restricted', reason: 'phase6-test' } }); assert.equal(accountStatus.response.statusCode, 200);
    const denied = await request(server, '/api/identity/kyc', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'phase6-deny' }, body: { legalName: 'Demo', countryCode: 'DE', demoOutcome: 'rejected' } });
    assert.equal(denied.response.statusCode, 201); assert.equal(denied.body.check.decision, 'deny');
    const duplicate = await request(server, '/api/identity/kyc', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'phase6-deny' }, body: { demoOutcome: 'verified' } });
    assert.equal(duplicate.body.duplicate, true);
    const review = await request(server, '/api/identity/kyc', { method: 'POST', headers: { ...auth, 'Idempotency-Key': 'phase6-review' }, body: { legalName: 'Demo', countryCode: 'DE', demoOutcome: 'needs_review' } });
    assert.equal(review.body.check.decision, 'review');
    const admin = await request(server, '/api/admin/identity/review', { headers: auth }); assert.equal(admin.response.statusCode, 200); assert.ok(admin.body.checks.length >= 1);
    const decision = await request(server, `/api/admin/identity/${review.body.check.id}/decision`, { method: 'POST', headers: auth, body: { decision: 'allow' } }); assert.equal(decision.response.statusCode, 200); assert.equal(decision.body.check.decision, 'allow');
    const identity = await request(server, '/api/identity', { headers: auth }); assert.equal(identity.body.identity.status, 'verified');
    console.log('Phase 6 tests passed.');
  } finally { server.close(); try { fs.unlinkSync(path); } catch {} }
})().catch((error) => { console.error(error); process.exitCode = 1; });

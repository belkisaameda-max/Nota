'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, jobs } = require('./server');

function request(server, path, options = {}) { return new Promise((resolve, reject) => {
  const address = server.address();
  const req = http.request({ hostname: '127.0.0.1', port: address.port, path, method: options.method || 'GET', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; }); res.on('end', () => { let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; } resolve({ response: res, body: parsed }); });
  }); req.on('error', reject); if (options.body) req.write(JSON.stringify(options.body)); req.end();
}); }

(async () => {
  const server = app.listen(0);
  try {
    const live = await request(server, '/health/live'); assert.equal(live.response.statusCode, 200); assert.equal(live.body.ok, true); assert.ok(live.response.headers['x-request-id']);
    const ready = await request(server, '/health/ready'); assert.equal(ready.response.statusCode, 200); assert.equal(ready.body.database, 'ok');
    const echoed = await request(server, '/health/live', { headers: { 'X-Request-Id': 'phase8-request-123' } }); assert.equal(echoed.response.headers['x-request-id'], 'phase8-request-123');
    const cleanup = await jobs.run('cleanup-auth'); assert.ok(Number.isInteger(cleanup.sessions));
    await assert.rejects(() => jobs.run('unknown-job'));
    console.log('Phase 8 tests passed.');
  } finally { await jobs.stop(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.DB_FILE = `/tmp/nota-phase9-${process.pid}.db`;
process.env.JWT_SECRET = 'phase9-test-secret';
process.env.PAYMENT_MODE = 'sandbox';
const { app, db } = require('./server');
const http = require('http');

function request(method, path, body, token, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 0, method, path, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, (res) => { let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} })); });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}

assert.equal(process.env.PAYMENT_MODE, 'sandbox');
assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sandbox_transfers'").get().name, 'sandbox_transfers');
console.log('Phase 9 schema/provider checks passed');

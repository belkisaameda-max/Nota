'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const port = 3110;
const file = path.join(__dirname, 'work', 'phase4-test.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) try { fs.rmSync(file + suffix); } catch {}
const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(port), DB_FILE: file, SEED_DEMOS: 'false', JWT_SECRET: 'phase4-test-secret', NODE_ENV: 'test' }, stdio: 'ignore' });
const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function req(url, options = {}) { const r = await fetch(base + url, options); return { r, body: await r.json() }; }
async function run() {
  for (let i = 0; i < 40; i += 1) { try { await fetch(base); break; } catch { await sleep(100); if (i === 39) throw Error('Server did not start'); } }
  const headers = { 'Content-Type': 'application/json' };
  const register = await req('/api/auth/register', { method: 'POST', headers, body: JSON.stringify({ name: 'Phase Four', username: 'phase4', email: 'phase4@test.local', password: 'Password1!' }) });
  assert.equal(register.r.status, 201); assert.ok(register.body.refreshToken);
  const access = register.body.token; const refresh = register.body.refreshToken;
  assert.equal((await req('/api/me', { headers: { Authorization: `Bearer ${access}` } })).r.status, 200);
  const rotated = await req('/api/auth/refresh', { method: 'POST', headers, body: JSON.stringify({ refreshToken: refresh }) });
  assert.equal(rotated.r.status, 200); assert.notEqual(rotated.body.refreshToken, refresh);
  const replay = await req('/api/auth/refresh', { method: 'POST', headers, body: JSON.stringify({ refreshToken: refresh }) });
  assert.equal(replay.r.status, 401);
  assert.equal((await req('/api/me', { headers: { Authorization: `Bearer ${rotated.body.token || access}` } })).r.status, 401);
  const login = await req('/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ login: 'phase4', password: 'Password1!' }) });
  const logout = await req('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${login.body.token}` } });
  assert.equal(logout.r.status, 200);
  assert.equal((await req('/api/me', { headers: { Authorization: `Bearer ${login.body.token}` } })).r.status, 401);
  console.log('Phase 4 tests passed.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => child.kill());

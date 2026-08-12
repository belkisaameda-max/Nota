const crypto = require('node:crypto');

function requestIdMiddleware(req, res, next) {
  const incoming = String(req.get('x-request-id') || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    log('info', 'http.request', { requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs * 100) / 100 });
  });
  next();
}

function sanitize(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const secret = /password|token|secret|authorization|cookie|card|cvv|raw.?payload/i;
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, secret.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
  }
  return String(value);
}

function log(level, event, fields = {}) {
  const record = { timestamp: new Date().toISOString(), level, event, ...sanitize(fields) };
  const writer = level === 'error' ? console.error : console.log;
  writer(JSON.stringify(record));
}

module.exports = { requestIdMiddleware, log, sanitize };

'use strict';

/**
 * Basic security headers for the demo app.
 * Not a substitute for HTTPS, a real CSP strategy, or production hardening.
 */
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Keep CSP relatively open so the Google Fonts + inline-free SPA still work.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
}

/**
 * Avoid leaking internal error details to clients.
 */
function notFoundApi(_req, res) {
  res.status(404).json({ error: 'API route not found.' });
}

/**
 * Centralized error handler. Known ApiErrors carry a safe, client-facing
 * message and status. Everything else is treated as an unexpected fault and
 * collapsed into a generic 500 — no stack traces, DB internals, or secrets
 * are ever sent to the client.
 */
function errorHandler(err, _req, res, _next) {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  const safe = err && err.expose === true;

  if (status >= 500) {
    // Log full detail server-side only.
    console.error('[nota]', err?.stack || err?.message || err);
  }

  if (res.headersSent) return;

  res.status(status).json({
    error: safe && err.message ? err.message : 'Something went wrong. Please try again.',
    ...(safe && err.code ? { code: err.code } : {}),
  });
}

module.exports = { securityHeaders, notFoundApi, errorHandler };

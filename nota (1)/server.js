'use strict';

/** Nota — test-credit wallet server. Fictional credits only. */
const express = require('express');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { openDatabase, seedDemoUsers } = require('./lib/db');
const { authMiddleware } = require('./lib/crypto-auth');
const { createSessionStore } = require('./lib/sessions');
const { createAuditLog } = require('./lib/audit');
const { createIdempotencyStore } = require('./lib/idempotency');
const { createRateLimiter } = require('./lib/rate-limit');
const { SqliteRateLimitStore } = require('./lib/rate-limit-store');
const { securityHeaders, notFoundApi, errorHandler } = require('./lib/security');
const { registerAuthRoutes, registerLogoutRoute } = require('./routes/auth');
const { registerAccountRoutes } = require('./routes/account');
const { registerTransferRoutes } = require('./routes/transfers');
const { registerPaymentRoutes, registerWebhookRoute } = require('./routes/payments');
const { DemoPaymentProvider } = require('./services/demo-payment-provider');
const { createPaymentService } = require('./services/payment-service');
const { reconcilePayments } = require('./services/payment-reconciliation');

const config = loadConfig();
const db = openDatabase(config.dbFile);
seedDemoUsers(db);
const app = express();
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const audit = createAuditLog(db);
const sessions = createSessionStore(db, {
  accessTokenTtlSeconds: config.accessTokenTtlSeconds,
  refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
});
const auth = authMiddleware(config.jwtSecret, { sessions });
const rateLimitStore = new SqliteRateLimitStore(db);
const idempotency = createIdempotencyStore(db);
const paymentProvider = new DemoPaymentProvider();
const paymentService = createPaymentService({ db, provider: paymentProvider, audit });
const reconcile = () => reconcilePayments({ db, provider: paymentProvider });
const authLimiter = createRateLimiter({ store: rateLimitStore, windowMs: 15 * 60 * 1000, max: config.rateLimitAuthMax, message: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
const transferLimiter = createRateLimiter({ store: rateLimitStore, windowMs: 60 * 1000, max: config.rateLimitTransferMax, message: 'Too many transfers. Please wait a moment and try again.' });

app.use('/api/auth', authLimiter);
app.use('/api/transfers', transferLimiter);
registerAuthRoutes(app, { db, jwtSecret: config.jwtSecret, sessions, audit, accessTokenTtlSeconds: config.accessTokenTtlSeconds });
registerLogoutRoute(app, { auth, sessions, audit });
registerAccountRoutes(app, { db, auth, audit });
registerTransferRoutes(app, { db, auth, audit, idempotency });
registerPaymentRoutes(app, { db, auth, audit, paymentService, reconcile });
registerWebhookRoute(app, { db, provider: paymentProvider, paymentService, webhookSecret: config.webhookSecret, audit });
app.use('/api', notFoundApi);
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Nota is running at http://localhost:${config.port}`));
}

module.exports = { app, db, config, sessions, audit };

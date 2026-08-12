# Nota operations runbook

## Production provider seams

Nota currently runs with SQLite, inline jobs, and demo providers. `services/infrastructure-providers.js` defines the narrow PostgreSQL and Redis interfaces for a production adapter; do not enable an adapter until its connection, migration, timeout, and health checks are configured.

## Database backup and recovery

Before deployment, configure an automated SQLite snapshot or hosted PostgreSQL backup with encryption and retention. Test restore into an isolated environment regularly. A backup is not complete until the restored database passes `npm test`, `npm run test:phase4`, `npm run test:phase5`, `npm run test:phase6`, `npm run test:phase7`, and `npm run test:phase8`.

## Deployment checklist

- Set a long random `JWT_SECRET` and `PAYMENT_WEBHOOK_SECRET`.
- Set `NODE_ENV=production`; production configuration rejects placeholder secrets.
- Use a shared PostgreSQL adapter and Redis-backed rate limiting/idempotency before multiple instances.
- Run migrations before accepting traffic.
- Expose `/health/live` for process liveness and `/health/ready` for traffic readiness.
- Deliver `SIGTERM`, wait for graceful shutdown, and drain connections before terminating.
- Keep webhook endpoints behind provider signature verification and monitor processing errors.
- Do not log tokens, credentials, card data, raw webhook payloads, or full identity documents.

## Recovery and reconciliation

Payment and KYC webhooks are persisted with processing errors so retries can be replayed. Run the read-only payment reconciliation endpoint after provider incidents and investigate every mismatch before resuming settlement. Account and ledger mutations must remain transactional and idempotent.

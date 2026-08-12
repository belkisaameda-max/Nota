# Phase 9 sandbox payment flows

Nota is locked to fictional test credits. `PAYMENT_MODE` accepts only `sandbox` or `demo`; any other value fails boot. The sandbox provider never contacts a bank, card network, wallet provider, or external payment API.

## Sandbox transfers

Authenticated users can create idempotent transfers through `POST /api/sandbox/transfers` with `recipientId`, `amount`, and `Idempotency-Key`. Transfers are persisted in `sandbox_transfers`, use the existing wallet balances, and are subject to account status and risk controls. `GET /api/sandbox/transfers` returns the authenticated user’s sent and received sandbox transfers.

## Deployment guardrails

Set `PAYMENT_MODE=sandbox`, a strong `JWT_SECRET`, and a dedicated `PAYMENT_WEBHOOK_SECRET`. Do not provide real provider credentials. Use persistent storage for the SQLite database and run one application instance unless the database layer is migrated to a shared transactional store.

## Webhooks

Payment webhooks must use `X-Nota-Signature`, an HMAC-SHA256 signature over the exact raw request body. Events are persisted before processing and retried safely when processing fails. This sandbox does not send or receive real provider events.

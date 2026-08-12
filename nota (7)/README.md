# Nota v0.1

Nota is a fictional, **test-credits-only** wallet prototype. It has no banking, card, cryptocurrency, deposit, withdrawal, or real-money payment capability.

## Run locally

1. Install Node.js 24 or later (Nota uses Node's built-in SQLite module).
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a unique `JWT_SECRET`.
4. Run `npm run dev` or `npm start`.
5. Open `http://localhost:3000`.

Run the automated MVP suite with `npm test`.

## Development demo accounts

Demo accounts are seeded locally: `amer`, `alex`, and `sarah`; all use the password `NotaDemo1!`. They each start with EUR 1,000.00 test credits. Set `SEED_DEMOS=false` to disable seeding.

## Safety and architecture

- Passwords use `scrypt` with a unique salt; sessions are signed, expiring JWTs.
- Wallet amounts are integer cents and transfers run atomically in SQLite.
- The backend validates ownership, balance, recipient, amount, and idempotency.
- Auth and transfer endpoints are rate-limited (in-memory, single process).
- Basic security headers are set (CSP, X-Frame-Options, nosniff, etc.).
- The test wallet and its ledger are separate from future provider abstractions.
- `ARCHITECTURE.md` and `services/future-fintech.js` document disabled boundaries for any future regulated payment, banking, FX, identity, and fraud services.

This prototype is not production payment software. It needs HTTPS, a shared rate-limit store, CSRF strategy, secure secret management, audit controls, compliance review, and independent security assessment before any real financial product work.

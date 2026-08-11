# Nota future-fintech boundary

Nota v0.1 operates only a local **test-credit wallet** and ledger. Test credits are not money, cannot be redeemed, and must never share balances, transfer execution, or credentials with a future real-money system.

## Current domain split

| Domain | Current responsibility | Real-money status |
| --- | --- | --- |
| User account | Authentication and profile | Test-only application account |
| Test wallet | Integer-cent fictional credits | Active, test-only |
| Ledger | Completed test-credit transfers | Active, test-only |
| Provider boundary | Future integration contracts | Disabled |
| Compliance boundary | Future verification and fraud contracts | Disabled |

## Future regulated flow (conceptual only)

`Bank account -> licensed provider -> Nota regulated ledger -> licensed provider -> recipient bank account`

No implementation in this repository performs any part of that flow. Future work must select regulated providers and create separate real-money ledgers, authorization, reconciliation, compliance, and audit controls.

## Provider contracts

`PaymentProvider`, `BankAccountProvider`, `CurrencyExchangeProvider`, `IdentityVerificationProvider`, and `FraudDetectionProvider` are represented only by disabled interfaces in `services/future-fintech.js`. Their methods fail closed so they cannot accidentally be invoked by the test wallet.

Future FX records would require source/target currencies, source/target integer amounts, rate, fee, provider, and timestamp. Nota has no exchange service and no fake real-money rates.

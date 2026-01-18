# Billing invariants

- Trial provides full access.
- No retroactive charges.
- No usage-based billing or counting.
- Billing state is independent of RiskEvent processing.
- Risk evaluation continues even when access is read-only.

## Access control

- Billing access is computed via `getBillingAccess(shop)` (on-read).
- Trial expiration is set when `now > trialEndsAt` and there is no ACTIVE subscription.
- `needsUpgrade` only affects UI actions (read-only mode).

## Transitions & audit

- All billing status changes are recorded in `BillingTransition`.
- Support can verify status and dates in `/admin/billing`.


# Governance Invariants and Guardrails

## Invariants
- RiskEvent is immutable. We only append new events, never update past ones.
- No retroactive recalculation. Existing RiskEvents stay as computed at the time.
- Simulation never persists. What-if runs are read-only and not stored.
- Only ACTIVE rules are evaluated in the risk engine.

## Safe defaults
- Rule changes apply only to future events.
- DRAFT rules do not affect risk scoring until activated.

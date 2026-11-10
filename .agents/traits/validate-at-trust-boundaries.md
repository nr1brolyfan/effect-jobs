---
name: validate-at-trust-boundaries
subject: Runtime validation of values crossing or remaining inside software
  trust boundaries.
requirement: Validate untrusted input and externally supplied configuration at
  their actual trust boundaries. Do not repeatedly validate already-validated
  internal values solely to defend against hypothetical callers violating an
  enforced internal contract. Retain validation where values can change,
  persisted data can be incompatible, or a documented runtime invariant requires
  a check; static types alone do not establish trust in external data.
purpose: Keep validation focused on real failure and attack paths without
  unnecessary internal scaffolding.
---

# Changelog

## 0.1.0-alpha.0

Initial alpha extraction of the Effect-native durable jobs mechanism from
MIT-licensed effect-auth, with application-owned domains and infrastructure.

- Schema-defined catalogs, typed producer slots and library-generated job IDs.
- Transaction-bound production and immutable semantic duplicate comparison.
- PostgreSQL two-table storage, fixed leases, fencing, retry and bounded recovery.
- Explicit scoped workers, bounded cleanup and protected-payload projection.
- Focused ESM exports and optional effect-native Drizzle migration declarations.

This is an alpha, not a production qualification claim. Exact versions and
unsupported cases are listed in README and the release qualification document.
No registry publication or cryptographic build provenance is claimed by this file.

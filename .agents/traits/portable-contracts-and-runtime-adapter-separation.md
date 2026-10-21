---
name: portable-contracts-and-runtime-adapter-separation
subject: Public portable service and data contract modules and their concrete
  runtime adapters.
requirement: Keep portable public service and schema modules free of runtime
  imports of concrete platform/provider implementations. Expose concrete
  provider construction in implementation modules so consuming portable
  contracts does not load deployment, driver or native runtime dependencies.
  Type-only references and intentionally backend-specific implementation
  entrypoints are permitted.
purpose: Preserve portable contract imports and explicit adapter ownership
  without banning legitimate backend entrypoints.
---

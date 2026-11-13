---
name: minimal-purpose-owned-test-fixtures
subject: Maintained test fixtures and test-only prototype applications.
requirement: Keep fixtures minimal and tied to identifiable current test
  consumers. Colocate single-consumer fixtures with their owning tests; share
  fixtures only when there are actual shared consumers. Consolidate duplicate
  test applications and retire prototypes superseded by meaningful tests of the
  real public API, preserving distinct required type, runtime and failure
  oracles.
applicability: Applies when adding or refactoring fixtures. Does not authorize
  deleting supported migration histories, compiler-negative inputs or other
  distinct contract evidence merely to reduce file counts.
purpose: Reduce fixture duplication and maintenance without replacing useful
  behavioral or type evidence with redundant miniature implementations.
---

---
name: effect-native-orchestration-and-resource-ownership
subject: Asynchronous orchestration and owned resource lifetimes in Effect-based
  library and application source.
requirement: Compose Effect-based workflows and owned resource lifetimes with
  Effect and Scope primitives rather than ad-hoc Promise, async/await or
  try/finally orchestration. Keep acquisition, release and fiber ownership
  explicit. Promise-based foreign-function boundaries and pure synchronous code
  are permitted; adapt foreign asynchronous work through Effect at its boundary.
applicability: Applies to Effect-based library implementation and application
  source; not to standalone tooling, tests or fixtures.
purpose: Keep failure, interruption and resource ownership visible to the Effect
  runtime without banning necessary external integrations.
---

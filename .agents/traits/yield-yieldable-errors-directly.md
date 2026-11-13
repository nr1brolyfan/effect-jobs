---
name: yield-yieldable-errors-directly
subject: Failure branches in Effect generator bodies.
requirement: When an error value is itself yieldable with the same failure
  semantics, yield it directly instead of wrapping it in Effect.fail.
applicability: Applies to authored TypeScript Effect generator bodies, including
  Effect.gen and generator-based Effect.fn. Does not apply to non-yieldable
  errors or expression-returning callbacks outside a generator.
purpose: Keep failure branches concise without changing their typed error or
  runtime behavior.
---

```diff
-return yield* Effect.fail(new OrderConflict())
+return yield* new OrderConflict()
```

Check that the error is genuinely yieldable; ordinary error values still require Effect.fail.

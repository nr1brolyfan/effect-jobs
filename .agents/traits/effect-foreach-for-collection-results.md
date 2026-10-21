---
name: effect-foreach-for-collection-results
subject: Effectful collection traversals that collect results.
requirement: When traversing a collection to perform Effects and collect
  results, prefer Effect.forEach over a for loop that pushes into a mutable
  accumulator array. Preserve intended ordering, filtering, and concurrency
  semantics.
applicability: "File types or languages: text/typescript, text/tsx."
purpose: Express effectful traversal and result collection together with visible
  ordering and concurrency semantics.
---

```diff
-const results = []
-for (const item of items) results.push(yield* processItem(item))
+const results = yield* Effect.forEach(items, processItem)
```

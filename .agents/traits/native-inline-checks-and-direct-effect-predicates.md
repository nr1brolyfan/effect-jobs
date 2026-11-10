---
name: native-inline-checks-and-direct-effect-predicates
subject: Inline runtime checks and predicate stages in existing pipelines.
requirement: Prefer native syntax for inline comparisons and simple runtime
  checks, such as `bounds.top <= readingLine` and `value === 0`. Prefer suitable
  Effect predicate helpers when passed directly as callbacks or curried stages
  in an existing pipeline, such as `Effect.filterOrFail(Equal.equals(0),
  onError)` or `Array.filter(values, Predicate.isString)`. Do not introduce
  wrapper callbacks or extra pipelines solely to use a helper. Retain helpers
  when native syntax would change required equality semantics or type narrowing;
  use native expressions when no suitable helper exists or a helper would change
  required semantics.
applicability: |-
  Applies when writing inline comparisons, simple runtime checks, or predicate stages in existing pipelines.
  File types or languages: text/typescript, text/tsx.
purpose: Keep simple checks immediately readable while preserving concise
  predicate composition and required semantics.
---

```diff
-if (Number.lessThanOrEqualTo(bounds.top, readingLine)) show()
-const strings = Array.filter(values, (value) => Predicate.isString(value))
+if (bounds.top <= readingLine) show()
+const strings = Array.filter(values, Predicate.isString)
```

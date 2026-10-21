---
name: preserve-built-in-effect-errors
subject: Wrapping and mapping built-in Effect errors.
requirement: "Preserve Effect’s built-in error types and let errors propagate
  naturally: prefer `fs.readFileString(file)` over
  `fs.readFileString(file).pipe(Effect.mapError(wrapError))`. Avoid custom error
  types or error mapping unless needed for recovery or a meaningful external
  boundary."
applicability: |-
  Applies when deciding whether to wrap or remap built-in Effect errors.
  File types or languages: text/typescript, text/tsx.
  Exception: When every custom error or error mapping under assessment is needed for recovery or a meaningful external boundary rather than merely wrapping a built-in Effect error.
purpose: Preserve established error information and interoperability without
  unnecessary custom error layers.
---

```diff
-const read = fs.readFileString(file).pipe(Effect.mapError(wrapError))
+const read = fs.readFileString(file)
```

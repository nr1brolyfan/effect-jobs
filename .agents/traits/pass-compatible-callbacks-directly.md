---
name: pass-compatible-callbacks-directly
subject: Callbacks, forwarding functions, and service method definitions.
requirement: "Prefer passing a function directly as a callback when its
  signature and behavior are compatible with the caller:
  Effect.map(String.trim), not Effect.map((text) => String.trim(text)). Apply
  the same preference to forwarding function definitions and service methods:
  use a curried library overload that produces the required function instead of
  an arrow that only passes its parameter to the data-first overload, such as
  rm: Effect.forEach(remove, { discard: true }) instead of rm: (ids) =>
  Effect.forEach(ids, remove, { discard: true }). Use a wrapper when needed to
  control forwarded arguments or preserve the receiver; for example,
  Array.map(files, (file) => path.resolve(file)) prevents the array index from
  reaching variadic path.resolve."
applicability: |-
  Applies when passing callbacks or defining forwarding functions or service methods.
  File types or languages: text/typescript, text/tsx, text/javascript, text/jsx.
  Exception: When a wrapper is necessary to control forwarded arguments or preserve the receiver.
purpose: Expose the actual operation being forwarded without redundant wrappers
  or accidental argument changes.
---

```diff
-const trimmed = effect.pipe(Effect.map((text) => String.trim(text)))
+const trimmed = effect.pipe(Effect.map(String.trim))
```

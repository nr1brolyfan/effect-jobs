---
name: direct-property-access-in-parameters
subject: Function, callback, and generator parameters receiving objects.
requirement: "Use direct property access rather than object destructuring in
  function parameters, including arrow callbacks, ordinary functions, and
  generator/Effect handlers: `(v) => v.id`, not `({ id }) => id`; `function*
  (params) { yield* check(params.files) }`, not `function* ({ files }) { yield*
  check(files) }`. This applies regardless of the function body's complexity,
  not only to property selectors. Local destructuring inside a function body is
  unaffected."
applicability: |-
  Applies when declaring function, callback, or generator parameters that receive objects.
  File types or languages: text/typescript, text/tsx, text/javascript, text/jsx.
purpose: Keep parameter identity and property provenance visible throughout
  function bodies.
---

```diff
-const names = Array.map(items, ({ name }) => name)
+const names = Array.map(items, (item) => item.name)
```

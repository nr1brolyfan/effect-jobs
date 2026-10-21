---
name: static-imports-first
subject: Static module import declarations.
requirement: 'Place all static import declarations at the top of a module,
  before executable statements and other declarations: import { Layer } from
  "effect" before export default ..., never after it. Dynamic import()
  expressions may remain where needed.'
applicability: |-
  Applies when adding or reorganizing static module imports.
  File types or languages: text/typescript, text/tsx, text/javascript, text/jsx.
purpose: Make module dependencies easy to discover before reading declarations
  and executable behavior.
---

```diff
-export const value = 1
 import { Layer } from "effect"
+export const value = 1
```

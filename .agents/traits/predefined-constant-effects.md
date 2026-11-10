---
name: predefined-constant-effects
subject: Successful constant Effects with predefined equivalents.
requirement: "Use Effect’s predefined constant effects rather than constructing
  equivalent successful effects: Effect.undefined, not
  Effect.succeed(undefined); Effect.void, not Effect.succeed(void 0). Apply this
  when a dedicated constant with the same semantics exists."
applicability: "File types or languages: text/typescript, text/tsx."
purpose: Express common constant outcomes with recognizable Effect values rather
  than redundant constructions.
---

```diff
-const empty = Effect.succeed(undefined)
+const empty = Effect.undefined
```

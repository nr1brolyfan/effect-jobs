---
name: avoid-omitting-overwritten-spread-fields
subject: Object construction using record spreads and authoritative field assignments.
requirement: When building an object by spreading an existing record and
  explicitly assigning authoritative fields afterward, do not first omit fields
  that those later assignments already overwrite. Keep omission or filtering
  when it actually prevents unwanted properties from surviving, and preserve
  intentional merge precedence and conditional inheritance.
purpose: Make object merge precedence clear without redundant filtering or
  intermediate allocations.
---

```diff
-const updated = { ...Struct.omit(record, ["body"]), body }
+const updated = { ...record, body }
```

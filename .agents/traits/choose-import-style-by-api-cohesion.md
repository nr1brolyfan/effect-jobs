---
name: choose-import-style-by-api-cohesion
subject: Import style for related module exports.
requirement: Prefer namespace imports when multiple members form a cohesive
  module API and qualification clarifies their origin or replaces module-name
  aliases—for example, Yaml.parse, Yaml.stringify, and Yaml.YAMLParseError.
  Otherwise preserve named imports from external dependencies, including
  independent exports from umbrella packages such as effect. Do not introduce
  namespaces solely because of member counts or alias prefixes; choose based on
  API cohesion and call-site clarity, not whether the module is external.
applicability: |-
  Applies when choosing between named and namespace imports
  File types or languages: text/typescript, text/tsx, text/javascript, text/jsx.
purpose: Clarify API ownership without adding namespace noise to unrelated exports.
---

```diff
-import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
+import * as Yaml from "yaml"
```

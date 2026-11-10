import { test } from "vitest"
import { checkSnippets } from "../docs-reference/Snippets.js"

test(
  "all reference snippets resolve canonical sources; malformed regions fail closed",
  checkSnippets
)

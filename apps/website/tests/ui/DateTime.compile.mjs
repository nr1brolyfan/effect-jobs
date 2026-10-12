// Build-tool FFI: compile the actual DateTime modules with production StyleX
// settings. This does not claim to render the sibling-owned Popover.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { transformAsync } from "@babel/core"
import transformTypescript from "@babel/plugin-transform-typescript"
import transformReactJsx from "@babel/plugin-transform-react-jsx"
import stylexPlugin from "@stylexjs/babel-plugin"

const scratch = await mkdtemp(resolve(import.meta.dirname, ".datetime-compile-"))
const modules = [
  "Theme.stylex.ts",
  "DateTime.stylex.ts",
  "DateTimeFormat.ts",
  "DateTime.tsx"
]
const inputs = []
try {
  for (const name of modules) {
    const source = await readFile(
      resolve(import.meta.dirname, "../../src/ui", name),
      "utf8"
    )
    inputs.push({ name, sha256: createHash("sha256").update(source).digest("hex") })
    const result = await transformAsync(source, {
      filename: name,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          transformTypescript,
          {
            isTSX: name.endsWith(".tsx"),
            allExtensions: true,
            onlyRemoveTypeImports: true
          }
        ],
        [transformReactJsx, { runtime: "automatic" }]
      ]
    })
    assert.ok(result?.code)
    await writeFile(resolve(scratch, name.replace(/\.tsx?$/, ".js")), result.code)
  }
  const rules = []
  for (const name of modules) {
    const filename = resolve(scratch, name.replace(/\.tsx?$/, ".js"))
    const result = await transformAsync(await readFile(filename, "utf8"), {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [
        [
          stylexPlugin,
          {
            dev: false,
            runtimeInjection: false,
            treeshakeCompensation: true,
            unstable_moduleResolution: { type: "commonJS", rootDir: scratch }
          }
        ]
      ]
    })
    assert.ok(result?.code)
    assert.doesNotMatch(result.code, /stylex\.(?:create|defineVars)\s*\(/)
    rules.push(...(result.metadata.stylex ?? []))
  }
  const css = stylexPlugin.processStylexRules(rules)
  assert(css.length > 0)
  assert.match(css, /:focus-visible/)
  assert.match(css, /@media \(pointer:\s*coarse\).*min-height:44px/)
  console.log(
    JSON.stringify(
      {
        result:
          "PASS: DateTime production StyleX extraction (not a Popover runtime test)",
        inputs,
        rules: rules.length,
        cssSha256: createHash("sha256").update(css).digest("hex"),
        runtimeInjection: false
      },
      null,
      2
    )
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

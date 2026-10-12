// Build/test FFI: compile the real StyleX modules before rendering with React.
// Run with: bun apps/website/tests/ui/Field.test.mjs
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { transformAsync } from "@babel/core"
import stylexPlugin from "@stylexjs/babel-plugin"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const scratch = await mkdtemp(resolve(import.meta.dirname, ".field-test-"))
try {
  const modules = ["Theme.stylex", "Primitives.stylex", "Primitives"]
  await mkdir(resolve(scratch, "ui"))
  for (const name of modules) {
    const extension = name === "Primitives" ? "tsx" : "ts"
    const source = await readFile(
      resolve(import.meta.dirname, `../../src/ui/${name}.${extension}`),
      "utf8"
    )
    const transpiler = new Bun.Transpiler({
      loader: extension,
      tsconfig: JSON.stringify({
        compilerOptions: { jsx: "react", jsxFactory: "React.createElement" }
      })
    })
    await writeFile(
      resolve(scratch, `ui/${name}.js`),
      `import * as React from "react";\n${transpiler.transformSync(source)}`
    )
  }
  for (const name of modules) {
    const filename = resolve(scratch, `ui/${name}.js`)
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
    await writeFile(filename, result.code)
  }
  const { Field } = await import(pathToFileURL(resolve(scratch, "ui/Primitives.js")))
  const field = (label, control) => createElement(Field, { label, key: label }, control)
  const render = (...fields) => renderToStaticMarkup(createElement("form", null, fields))
  const associations = (html) => {
    const labels = [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map(
      (match) => match[1]
    )
    const controls = [
      ...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)
    ].map((match) => match[1])
    assert.deepEqual(labels, controls)
    assert.equal(new Set(controls).size, controls.length)
    return controls
  }

  const generated = render(
    field("Search", createElement("input", { defaultValue: "kept" })),
    field("State", createElement("select", null, createElement("option", null, "All"))),
    field("Notes", createElement("textarea", { id: "", defaultValue: "notes" }))
  )
  assert.equal(associations(generated).length, 3)
  assert.match(generated, /value="kept"/)
  assert.match(generated, />notes<\/textarea>/)

  const explicit = render(
    field(
      "Only due",
      createElement("input", {
        id: "due-jobs",
        type: "checkbox",
        defaultChecked: true,
        disabled: true,
        className: "caller-control",
        style: { color: "red" }
      })
    )
  )
  assert.deepEqual(associations(explicit), ["due-jobs"])
  assert.match(explicit, /type="checkbox"/)
  assert.match(explicit, /checked=""/)
  assert.match(explicit, /disabled=""/)
  assert.match(explicit, /caller-control/)
  assert.match(explicit, /color:red/)

  const CustomControl = ({ id }) => createElement("input", { id })
  assert.equal(
    associations(render(field("Custom", createElement(CustomControl)))).length,
    1
  )
  console.log(
    "PASS: Field labels match unique generated/native/custom ids; explicit id and native props preserved"
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

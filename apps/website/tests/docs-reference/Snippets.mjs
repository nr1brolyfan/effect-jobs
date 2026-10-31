import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../../..")
const sources = join(root, "apps/website/examples/docs")
const content = join(root, "apps/website/src/content/docs")
const hash = (value) => createHash("sha256").update(value).digest("hex")
const regions = (text) => {
  const found = new Map()
  let active
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s*\/\/ #(region|endregion) ([a-z][a-z0-9-]*)\s*$/.exec(lines[i])
    if (!marker) {
      continue
    }
    if (marker[1] === "region") {
      assert(!active && !found.has(marker[2]), "duplicate/nested region")
      active = { name: marker[2], start: i + 1 }
    } else {
      assert(active && active.name === marker[2], "unmatched region closure")
      found.set(active.name, lines.slice(active.start, i).join("\n"))
      active = undefined
    }
  }
  assert(!active, "unclosed region")
  return found
}
for (const text of [
  "// #region a",
  "// #endregion a",
  "// #region a\n// #region a\n",
  "// #region a\n// #endregion b"
]) {
  assert.throws(() => regions(text))
}
const inventory = []
const files = new Map(
  readdirSync(sources, { recursive: true })
    .filter((f) => f.endsWith(".ts"))
    .map((file) => {
      const bytes = readFileSync(join(sources, file), "utf8")
      const extracted = regions(bytes)
      inventory.push({
        file,
        sha256: hash(bytes),
        regions: Object.fromEntries(
          [...extracted].map(([name, text]) => [
            name,
            { sha256: hash(text), lines: text.split("\n").length }
          ])
        )
      })
      return [file, extracted]
    })
)
let checked = 0
for (const file of readdirSync(content, { recursive: true, encoding: "utf8" }).filter(
  (f) => f.endsWith(".mdx")
)) {
  const text = readFileSync(join(content, file), "utf8")
  for (const match of text.matchAll(/<CodeExample\b([^>]*?)\/>/g)) {
    const attributes = [...match[1].matchAll(/(sourcePath|region)="([^"]+)"/g)]
    const props = Object.fromEntries(attributes.map((m) => [m[1], m[2]]))
    assert.equal(attributes.length, Object.keys(props).length, "duplicate snippet props")
    assert(files.has(props.sourcePath), `${file}: unknown canonical file`)
    if (props.region) {
      assert(
        files.get(props.sourcePath).has(props.region),
        `${file}: unknown canonical region`
      )
    }
    checked++
  }
  assert.equal(
    (text.match(/<CodeExample\b/g) ?? []).length,
    [...text.matchAll(/<CodeExample\b([^>]*?)\/>/g)].length,
    `${file}: unrecognized snippet syntax`
  )
  assert(
    !file.startsWith("reference/") || !/```(?:ts|typescript)\b/.test(text),
    `${file}: executable-looking TypeScript must come from checked sources`
  )
}
assert(checked > 0, "No reference snippet embeds checked")
mkdirSync(join(root, ".toolchain/docs-reference"), { recursive: true })
writeFileSync(
  join(root, ".toolchain/docs-reference/snippets.json"),
  JSON.stringify({ inventory, checked }, null, 2) + "\n"
)
console.log(
  `${checked} canonical reference snippet embeds and ${inventory.length} source inventories checked; malformed region negative controls PASS`
)

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const theme = await readFile(
  new URL("../../src/ui/Theme.stylex.ts", import.meta.url),
  "utf8"
)
const primitives = await readFile(
  new URL("../../src/ui/Primitives.tsx", import.meta.url),
  "utf8"
)
const design = await readFile(
  new URL("../../src/features/jobs/Design.ts", import.meta.url),
  "utf8"
)

// Source literals let the contrast and path checks run before foundation has
// installed React/StyleX. These checks do not qualify compilation or DOM behavior.
const literals = (source) =>
  Object.fromEntries(
    [...source.matchAll(/(\w+):\s*"(#[0-9a-f]{6})"/g)].map(([, key, value]) => [
      key,
      value
    ])
  )
const palette = literals(theme)
const luminance = (hex) => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
const contrast = (foreground, background) => {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test("small semantic and state text has at least 4.5:1 contrast on supported surfaces", () => {
  for (const surface of ["canvas", "sidebar", "surface", "raised"]) {
    for (const text of [
      "text",
      "muted",
      "Completed",
      "Active",
      "Pending",
      "RetryScheduled",
      "Dead",
      "Isolated"
    ]) {
      const ratio = contrast(palette[text], palette[surface])
      assert.ok(ratio >= 4.5, `${text} on ${surface}: ${ratio.toFixed(2)}:1`)
    }
  }
  assert.ok(contrast(palette.accentText, palette.accent) >= 4.5)
  assert.ok(contrast(palette.accentText, palette.Completed) >= 4.5)
  console.log(
    `Minimum state contrast on badge surface: ${Math.min(...["Completed", "Active", "Pending", "RetryScheduled", "Dead", "Isolated"].map((state) => contrast(palette[state], palette.surface))).toFixed(2)}:1`
  )
})

test("focus indication has at least 3:1 contrast against each supported dark surface", () => {
  for (const surface of ["canvas", "sidebar", "surface", "raised"]) {
    assert.ok(contrast(palette.focus, palette[surface]) >= 3)
  }
})

test("React icon names and SVG paths preserve the complete existing Design registry", () => {
  const paths = (source, name) => {
    const block = source.match(
      new RegExp(String.raw`const ${name} = \{([\s\S]*?)\} as const`)
    )?.[1]
    assert.ok(block, `${name} registry is present`)
    return Object.fromEntries(
      [...block.matchAll(/(\w+):\s*"([^"\n]+)"/g)].map(([, key, path]) => [key, path])
    )
  }
  assert.deepEqual(paths(primitives, "iconPaths"), paths(design, "paths"))
})

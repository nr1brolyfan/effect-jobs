// Finite compiler/render qualification. Bun/Babel/filesystem are test-only FFI.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

const website = resolve(import.meta.dirname, "../..")
const require = createRequire(join(website, "package.json"))
const { transformSync } = require("@babel/core")
const stylexPlugin = require("@stylexjs/babel-plugin")
const syntaxTypescript = require("@babel/plugin-syntax-typescript")
const themePath = process.env.STATS_CHART_THEME_PATH
const evidence = resolve(website, "../../.multica/stats-chart")
mkdirSync(evidence, { recursive: true })
// Copy exact author inputs into one disposable source layout so the compiler can
// resolve theme variables without editing either author's working tree.
const fixture = mkdtempSync(join(evidence, "run-"))
const inputs = new Map()
inputs.set(
  import.meta.filename,
  createHash("sha256")
    .update(readFileSync(import.meta.filename))
    .digest("hex")
)
for (const [relative, sourcePath] of [
  ["src/features/jobs/StatsChart.tsx", join(website, "src/features/jobs/StatsChart.tsx")],
  [
    "src/features/jobs/StatsChart.stylex.ts",
    join(website, "src/features/jobs/StatsChart.stylex.ts")
  ],
  [
    "src/ui/Theme.stylex.ts",
    themePath ? resolve(themePath) : join(website, "src/ui/Theme.stylex.ts")
  ],
  ["tests/ui/StatsChart.render.tsx", join(import.meta.dirname, "StatsChart.render.tsx")]
]) {
  const source = readFileSync(sourcePath, "utf8")
  inputs.set(sourcePath, createHash("sha256").update(source).digest("hex"))
  const destination = join(fixture, relative)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, source)
}
symlinkSync(join(website, "node_modules"), join(fixture, "node_modules"), "dir")
writeFileSync(
  join(fixture, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      verbatimModuleSyntax: true,
      // This checks source, not third-party declaration compatibility.
      skipLibCheck: true,
      noEmit: true,
      jsx: "react-jsx",
      types: ["node"],
      paths: {
        "@effect-jobs/playground-contracts/Jobs": [
          resolve(website, "../../packages/playground-contracts/src/Jobs.ts")
        ],
        "effect-jobs/*": [resolve(website, "../../src/*.ts")]
      }
    },
    include: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.tsx"]
  })
)
execFileSync(
  process.execPath,
  [
    join(dirname(require.resolve("typescript/package.json")), "bin/tsc"),
    "-p",
    join(fixture, "tsconfig.json")
  ],
  {
    timeout: 60_000,
    stdio: "inherit"
  }
)
const rules = []
const result = await Bun.build({
  entrypoints: [join(fixture, "tests/ui/StatsChart.render.tsx")],
  target: "bun",
  outdir: evidence,
  plugins: [
    {
      name: "stats-chart-stylex",
      setup(build) {
        build.onLoad({ filter: /\.(ts|tsx)$/ }, ({ path }) => {
          if (path.includes("node_modules")) {
            return
          }
          const source = readFileSync(path, "utf8")
          const transformed = transformSync(source, {
            filename: path,
            babelrc: false,
            configFile: false,
            plugins: [
              [syntaxTypescript, { isTSX: path.endsWith(".tsx") }],
              [
                stylexPlugin,
                {
                  dev: false,
                  runtimeInjection: false,
                  unstable_moduleResolution: {
                    type: "commonJS",
                    rootDir: join(fixture, "src")
                  }
                }
              ]
            ]
          })
          rules.push(...(transformed.metadata.stylex ?? []))
          return {
            contents: transformed.code,
            loader: path.endsWith(".tsx") ? "tsx" : "ts",
            resolveDir: dirname(path)
          }
        })
      }
    }
  ]
})
if (!result.success) {
  throw new AggregateError(result.logs, "Chart compilation failed")
}
const css = stylexPlugin.processStylexRules(rules, true)
assert(css.includes("@media (max-width: 600px)"), "mobile CSS must be extracted")
writeFileSync(join(evidence, "StatsChart.css"), css)
await import(join(evidence, "StatsChart.render.js"))
writeFileSync(
  join(evidence, "receipt.json"),
  JSON.stringify(
    {
      result: "PASS",
      inputs: Object.fromEntries(inputs),
      bun: Bun.version,
      packages: Object.fromEntries(
        [
          "react",
          "react-dom",
          "recharts",
          "@stylexjs/stylex",
          "@stylexjs/babel-plugin",
          "@babel/core",
          "typescript"
        ].map((name) => [name, require(`${name}/package.json`).version])
      ),
      cssSha256: createHash("sha256").update(css).digest("hex"),
      sourceTypeCheck: "PASS (skipLibCheck: true; real local JobStats source)",
      notTested: [
        "browser SVG/tooltip/resize",
        "integrated dashboard",
        "PG/workerd",
        "production"
      ]
    },
    null,
    2
  ) + "\n"
)
console.log(
  "PASS: real StyleX compilation and mobile CSS extraction; receipt in .multica/stats-chart"
)

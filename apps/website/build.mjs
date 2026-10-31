// Build-tool FFI: transpile TS/JSX, extract StyleX once, then bundle real sources.
// The intermediate JS mirror makes NodeNext .js theme imports resolvable by Babel.
import { transformAsync } from "@babel/core"
import stylexPlugin from "@stylexjs/babel-plugin"
import transformTypescript from "@babel/plugin-transform-typescript"
import transformReactJsx from "@babel/plugin-transform-react-jsx"
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises"
import { resolve, relative, dirname } from "node:path"
import { createHash } from "node:crypto"

const root = import.meta.dirname
const repository = resolve(root, "../..")
const source = resolve(root, "src")
const scratch = resolve(root, ".stylex-build")
// Astro owns these trees; dashboard receipts and StyleX inputs stay independent.
const siteDirectories = new Set(
  ["components", "content", "pages"].map((name) => resolve(source, name))
)
const walk = async (directory) => {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!siteDirectories.has(path)) {
        paths.push(...(await walk(path)))
      }
    } else if (/\.tsx?$/.test(entry.name) && entry.name !== "content.config.ts") {
      paths.push(path)
    }
  }
  return paths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export const build = async ({
  fixtures = false,
  outdir = resolve(root, "dist")
} = {}) => {
  const sources = await walk(source)
  if (fixtures) {
    sources.push(resolve(root, "tests/ui/BrowserEntry.ts"))
  }
  const rules = []
  const inputs = []
  await mkdir(scratch, { recursive: true })
  try {
    for (const path of sources) {
      const text = await readFile(path, "utf8")
      const target = resolve(scratch, relative(root, path).replace(/\.tsx?$/, ".js"))
      const transpiled = await transformAsync(text, {
        filename: path,
        babelrc: false,
        configFile: false,
        plugins: [
          [
            transformTypescript,
            {
              isTSX: path.endsWith(".tsx"),
              allExtensions: true,
              onlyRemoveTypeImports: true
            }
          ],
          [transformReactJsx, { runtime: "automatic" }]
        ]
      })
      if (!transpiled?.code) {
        throw new Error(`Empty transpiler result: ${path}`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, transpiled.code)
      inputs.push({
        path: relative(repository, path),
        sha256: createHash("sha256").update(text).digest("hex")
      })
    }
    for (const path of await walkJavaScript(scratch)) {
      const result = await transformAsync(await readFile(path, "utf8"), {
        filename: path,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ["jsx"] },
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
      if (!result?.code) {
        throw new Error(`Empty compiler result: ${path}`)
      }
      if (/\bstylex\.(?:create|defineVars)\s*\(/.test(result.code)) {
        throw new Error(`Uncompiled StyleX: ${path}`)
      }
      rules.push(...(result.metadata.stylex ?? []))
      await writeFile(path, result.code)
    }
    const entries = fixtures
      ? ["src/Client.js", "src/features/jobs/FixtureEntry.js", "tests/ui/BrowserEntry.js"]
      : ["src/Client.js"]
    const bundled = await Bun.build({
      entrypoints: entries.map((path) => resolve(scratch, path)),
      root: scratch,
      outdir,
      plugins: [
        {
          name: "scenario-wire-schema",
          setup(build) {
            build.onResolve(
              { filter: /playground-worker\/src\/scenarios\/Definitions\.js$/ },
              () => ({
                path: resolve(
                  repository,
                  "apps/playground-worker/src/scenarios/Definitions.ts"
                )
              })
            )
          }
        }
      ],
      target: "browser",
      naming: "[name].js",
      minify: true,
      define: {
        "process.env.NODE_ENV": JSON.stringify(fixtures ? "development" : "production")
      }
    })
    if (!bundled.success) {
      throw new AggregateError(bundled.logs, "Website bundle failed")
    }
    for (const artifact of bundled.outputs) {
      if (/\bstylex\.(?:create|defineVars)\s*\(/.test(await artifact.text())) {
        throw new Error("Uncompiled StyleX in production bundle")
      }
    }
    const css = stylexPlugin.processStylexRules(rules)
    if (!css || !rules.length) {
      throw new Error("No extracted StyleX CSS")
    }
    await mkdir(outdir, { recursive: true })
    await writeFile(
      resolve(outdir, "Jobs.css"),
      (await readFile(resolve(source, "styles/Jobs.css"), "utf8")) + "\n" + css
    )
    await writeFile(
      resolve(outdir, "build-receipt.json"),
      JSON.stringify(
        {
          inputs,
          rules: rules.length,
          cssSha256: createHash("sha256").update(css).digest("hex"),
          runtimeInjection: false,
          compiled: true
        },
        null,
        2
      ) + "\n"
    )
    console.log(
      `Compiled ${sources.length} sources; extracted ${rules.length} StyleX rules; ${relative(repository, outdir)}`
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
const walkJavaScript = async (directory) => {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await walkJavaScript(path)))
    } else if (entry.name.endsWith(".js")) {
      paths.push(path)
    }
  }
  return paths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}
if (import.meta.main) {
  await build({
    fixtures: process.argv.includes("--fixtures"),
    ...(process.env.UI_BUILD_DIRECTORY
      ? { outdir: resolve(process.env.UI_BUILD_DIRECTORY) }
      : {})
  })
}

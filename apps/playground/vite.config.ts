import { defineConfig } from "vite"
import { unplugin as stylex } from "@stylexjs/unplugin"
import { relative, resolve } from "node:path"

// Standard Vite compilation directly from TypeScript; no generated source mirror.
export default defineConfig((environment) => {
  const fixture = environment.mode === "fixtures"
  const browser = environment.mode === "browser-test"
  const entry = browser
    ? "../website/tests/ui/BrowserEntry.ts"
    : fixture
      ? "tests/fixtures/FixtureEntry.ts"
      : "src/Client.ts"
  const name = browser ? "BrowserEntry" : fixture ? "FixtureEntry" : "Client"
  return {
    plugins: [
      stylex.vite({
        dev: false,
        runtimeInjection: false,
        treeshakeCompensation: true,
        unstable_moduleResolution: { type: "commonJS", rootDir: import.meta.dirname }
      }),
      {
        name: "playground-browser-boundary",
        generateBundle() {
          const repository = resolve(import.meta.dirname, "../..")
          const modules = Array.from(this.getModuleIds())
            .filter(
              (path) =>
                path.startsWith(repository + "/apps/") ||
                path.startsWith(repository + "/packages/")
            )
            .map((path) => relative(repository, path))
            .sort()
          for (const path of modules) {
            if (
              path.startsWith("apps/playground-worker/") ||
              (!fixture && !browser && path.includes("/tests/"))
            ) {
              this.error(`Forbidden browser dependency: ${path}`)
            }
          }
          this.emitFile({
            type: "asset",
            fileName: `${name}.modules.json`,
            source: JSON.stringify(modules, null, 2) + "\n"
          })
        }
      }
    ],
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        fixture || browser ? "development" : "production"
      )
    },
    build: {
      outDir: process.env.UI_BUILD_DIRECTORY ?? "dist",
      emptyOutDir: !fixture && !browser,
      minify: true,
      lib: {
        entry: resolve(import.meta.dirname, entry),
        formats: ["es"],
        fileName: name
      },
      cssCodeSplit: false,
      rolldownOptions: {
        output: {
          entryFileNames: `${name}.js`,
          assetFileNames: "Jobs.[ext]",
          codeSplitting: false
        }
      }
    }
  }
})

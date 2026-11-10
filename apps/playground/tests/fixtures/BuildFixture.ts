import { build } from "vite"
import { createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { resolve, basename } from "node:path"

const playground = resolve(import.meta.dirname, "../..")

// These are tool boundaries, resolved through their declared owning workspaces.
// No Babel mirror, Bun transpiler, nested node_modules path, or source copy.
export const buildFixture = async (entry: string, directory: string) => {
  await build({
    root: playground,
    configFile: resolve(playground, "vite.config.ts"),
    mode: "fixtures",
    plugins: [
      {
        name: "fixture-workspace-dependencies",
        resolveId(id) {
          if (
            [
              "@effect/atom-react",
              "@base-ui/react",
              "@effect-jobs/playground-contracts",
              "effect-jobs"
            ].some((name) => id === name || id.startsWith(name + "/"))
          ) {
            return this.resolve(id, resolve(playground, "src/Client.ts"), {
              skipSelf: true
            })
          }
        }
      }
    ],
    build: {
      outDir: directory,
      lib: { entry: resolve(entry), formats: ["es"], fileName: "Fixture" },
      rolldownOptions: { output: { entryFileNames: "Fixture.js" } }
    }
  })
  const script = await readFile(resolve(directory, "Fixture.js"))
  const css = await readFile(resolve(directory, "Jobs.css"))
  const evidence = resolve(process.cwd(), ".multica/test-modernization/artifacts")
  await mkdir(evidence, { recursive: true })
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  await writeFile(
    resolve(evidence, basename(entry) + ".json"),
    JSON.stringify(
      {
        entry,
        entrySha256: sha256(await readFile(resolve(entry))),
        configSha256: sha256(await readFile(resolve(playground, "vite.config.ts"))),
        lockSha256: sha256(await readFile(resolve(playground, "../../bun.lock"))),
        scriptSha256: sha256(script),
        cssSha256: sha256(css)
      },
      null,
      2
    ) + "\n"
  )
  return { script, css }
}

if (process.argv[1] === import.meta.filename) {
  const entry = process.argv[2]
  const directory = process.argv[3]
  if (entry === undefined || directory === undefined) {
    throw new Error("Expected fixture entry and owned output directory")
  }
  await buildFixture(entry, directory)
}

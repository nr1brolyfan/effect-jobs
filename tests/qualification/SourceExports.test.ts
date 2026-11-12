import { describe, expect, it } from "vitest"
import { publicModules } from "../../scripts/SourceExports.mjs"

const manifest = (target: unknown, subpath = "./PostgreSqlJobs") => ({
  exports: { [subpath]: target }
})
const target = {
  types: "./dist/postgresql/PostgreSqlJobs.d.ts",
  import: "./dist/postgresql/PostgreSqlJobs.js"
}

describe("public export source mapping", () => {
  it("maps actual nested targets and keeps public names", () => {
    expect(publicModules(manifest(target))).toEqual([
      {
        subpath: "./PostgreSqlJobs",
        name: "PostgreSqlJobs",
        source: "src/postgresql/PostgreSqlJobs.ts",
        import: "dist/postgresql/PostgreSqlJobs.js",
        types: "dist/postgresql/PostgreSqlJobs.d.ts"
      }
    ])
    expect(
      publicModules(
        manifest({ types: "./dist/index.d.ts", import: "./dist/index.js" }, ".")
      )[0]?.source
    ).toBe("src/index.ts")
  })

  it.each([
    "../outside.js",
    "/dist/Jobs.js",
    "./dist/../Jobs.js",
    "./dist/./Jobs.js",
    "./dist//Jobs.js",
    "./dist/%2e%2e/Jobs.js",
    "./dist/Jobs.js?query",
    "./dist/Jobs.js#fragment",
    "./dist\\Jobs.js",
    "./src/Jobs.js"
  ])("rejects noncanonical or escaping import target %s", (value) => {
    expect(() => publicModules(manifest({ ...target, import: value }))).toThrow()
  })

  it("rejects private/wildcard subpaths and divergent declaration targets", () => {
    for (const subpath of ["./postgresql/PostgreSqlJobs", "./*", "./../Job"]) {
      expect(() => publicModules(manifest(target, subpath))).toThrow()
    }
    expect(() =>
      publicModules(manifest({ ...target, types: "./dist/Job.d.ts" }))
    ).toThrow()
    expect(() => publicModules(manifest({ ...target, default: target.import }))).toThrow()
    expect(() => publicModules({ exports: null })).toThrow()
  })
})

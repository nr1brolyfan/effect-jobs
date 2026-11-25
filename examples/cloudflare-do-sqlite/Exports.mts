import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { join } from "node:path"
import { Effect } from "effect"
import type {
  SqlStorage,
  Storage,
  TransactionStorage
} from "effect-jobs/DurableObjectSqlite"
import type { JobStoreService } from "effect-jobs/JobStore"

const sdk = join(import.meta.dirname, "node_modules/effect-jobs")
const manifest = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"))
assert.deepEqual(manifest.exports["./DurableObjectSqlite"], {
  types: "./dist/cloudflare/DurableObjectSqlite.d.ts",
  import: "./dist/cloudflare/DurableObjectSqlite.js"
})
assert.deepEqual(manifest.dependencies ?? {}, {})
assert.equal(existsSync(join(import.meta.dirname, "node_modules/drizzle-orm")), false)

const sdkUrl = new URL("./node_modules/effect-jobs/", import.meta.url).href
const loaded: string[] = []
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sdkUrl) && !specifier.startsWith(".")) {
      assert.match(specifier, /^effect(?:\/|$)/, "unexpected SDK runtime import")
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sdkUrl)) {
      loaded.push(url.slice(sdkUrl.length))
    }
    return nextLoad(url, context)
  }
})

try {
  assert.deepEqual(Object.keys(await import("effect-jobs")), [])
  assert.deepEqual(loaded, ["dist/index.js"], "root must not load the adapter")
  const sqlite = await import("effect-jobs/DurableObjectSqlite")
  assert.deepEqual(Object.keys(sqlite).sort(), [
    "SqliteStoreUnavailable",
    "SqliteTransactionClosed",
    "SqliteTransactionUnavailable",
    "SqliteWriteFailed",
    "ddl",
    "makeStore",
    "withTransaction"
  ])
  assert(loaded.includes("dist/internal/do-sqlite/Transaction.js"))
  assert(loaded.includes("dist/internal/do-sqlite/Store.js"))
  assert(loaded.every((path) => !path.startsWith("dist/postgresql/")))
  for (const path of [
    "effect-jobs/internal/do-sqlite/Transaction",
    "effect-jobs/dist/internal/do-sqlite/Store.js"
  ]) {
    await assert.rejects(import(path), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" })
  }

  const unexpected = () => assert.fail("storage called before executing an Effect")
  const sql: SqlStorage = { exec: unexpected }
  const storage: Storage & TransactionStorage = {
    sql,
    transaction: unexpected,
    transactionSync: unexpected,
    sync: unexpected
  }
  const store: JobStoreService<InstanceType<typeof sqlite.SqliteStoreUnavailable>> =
    sqlite.makeStore(storage, 250)
  assert.equal(typeof store.claim, "function")
  assert(Effect.isEffect(sqlite.withTransaction(storage, 250, unexpected)))
} finally {
  hooks.deregister()
}
console.log("Packed exports, root isolation, SDK import graph and lazy construction PASS")

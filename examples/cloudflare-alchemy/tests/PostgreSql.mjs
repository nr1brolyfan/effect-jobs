// Requires the surrounding qualification runner's one disposable, owned database.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { Client } from "pg"
import { migration } from "./Migrate.mjs"
assert(process.env.EXAMPLE_TEST_DATABASE_URL)
const admin = new Client({
  connectionString: process.env.EXAMPLE_TEST_DATABASE_URL,
  connectionTimeoutMillis: 2000
})
await admin.connect()
try {
  await admin.query("CREATE SCHEMA alchemy_example")
  await admin.query(migration)
  for (const script of [".toolchain/Cleanup.mjs", "tests/Run.mjs", "tests/FullApp.mjs"]) {
    const result = spawnSync("node", [script], {
      timeout: 120000,
      encoding: "utf8",
      env: process.env
    })
    assert.equal(
      result.status,
      0,
      `${script} failed: ${(result.stdout ?? "") + (result.stderr ?? "")}`
    )
    console.log(result.stdout)
  }
  assert.equal(
    (
      await admin.query(
        "SELECT issued FROM alchemy_example.invoices WHERE invoice_id='invoice-reject'"
      )
    ).rows[0].issued,
    false
  )
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM alchemy_example.receipts WHERE operation_id='tenant-a/rollback-request'"
      )
    ).rows[0].n,
    0
  )
  const rows = (
    await admin.query(
      "SELECT i.issued, r.job_id, j.state FROM alchemy_example.invoices i JOIN alchemy_example.receipts r USING(tenant_id,invoice_id) JOIN alchemy_example.jobs j ON j.id=r.job_id"
    )
  ).rows
  assert.equal(rows.length, 2)
  assert(rows.every((row) => row.issued === true))
  assert(rows.every((row) => row.state === "Completed"))
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='effect-jobs-alchemy-example'"
      )
    ).rows[0].n,
    0
  )
  console.log(
    "real PG domain/receipt/job atomic result and zero surviving invocation SQL sessions PASS"
  )
} finally {
  await admin.query("DROP SCHEMA alchemy_example CASCADE")
  await admin.end()
}

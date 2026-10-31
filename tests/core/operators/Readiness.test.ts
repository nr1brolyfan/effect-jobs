import { Effect, Exit } from "effect"
import { expect, test } from "vitest"
import { ready } from "../../../src/internal/postgresql/Readiness.js"
import type {
  ApplicationAdapter,
  TransactionQuery
} from "../../../src/PostgreSqlTransaction.js"

const constraints = (): Array<Record<string, unknown>> => [
  ...[
    "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated','Cancelled']",
    "state=ANYARRAY['Completed','Dead','Cancelled']=completed_atISNOTNULL",
    "original_source_job_idISNULLANDsource_job_idISNULLANDredrive_kindISNULLORoriginal_source_job_idISNOTNULLANDredrive_kindISNOTNULL",
    "redrive_kind=ANYARRAY['Redrive','CorrectedRedrive']",
    "original_source_job_id<>id",
    "source_job_id=original_source_job_id"
  ].map((expression) => ({ jobs: true, kind: "c", expression })),
  { jobs: true, kind: "p", columns: ["id"] },
  { jobs: true, kind: "u", columns: ["operation", "operation_id", "slot"] },
  { jobs: true, kind: "u", columns: ["lease_token"] },
  { payloads: true, kind: "p", columns: ["job_id"] },
  {
    payloads: true,
    kind: "f",
    columns: ["job_id"],
    target_jobs: true,
    target_columns: ["id"],
    deletion: "c"
  },
  {
    jobs: true,
    kind: "f",
    columns: ["source_job_id"],
    target_jobs: true,
    target_columns: ["id"],
    deletion: "n"
  }
]
const fixture = (change: string) => {
  const calls: string[] = []
  const query: TransactionQuery = {
    query: (sql) =>
      Effect.sync(() => {
        calls.push(sql)
        if (sql.includes("attname='created_at'")) {
          return change === "missing-created-at"
            ? []
            : [
                {
                  required: change === "required-created-at",
                  bigint: change !== "wrong-created-at-type",
                  has_default: change === "default-created-at"
                }
              ]
        }
        if (sql.includes("FROM pg_catalog.pg_attribute WHERE")) {
          return ["original_source_job_id", "source_job_id", "redrive_kind"]
            .filter((name) => change !== "missing-column" || name !== "source_job_id")
            .map((name) => ({
              name,
              required: change === "not-null" && name === "source_job_id",
              text: change !== "non-text"
            }))
        }
        if (sql.includes("FROM pg_catalog.pg_constraint")) {
          return constraints()
            .filter(
              (c) =>
                change !== "missing-check" ||
                c.expression !== "source_job_id=original_source_job_id"
            )
            .map((c) =>
              c.jobs && c.kind === "f"
                ? {
                    ...c,
                    deletion: change === "cascade" ? "c" : c.deletion,
                    target_jobs: change !== "foreign-target"
                  }
                : c
            )
        }
        if (sql.includes("FROM pg_catalog.pg_index")) {
          return [
            {
              columns: ["queue", "kind", "version", "available_at", "id"],
              predicate: "state=ANYARRAY['Pending','RetryScheduled']"
            },
            { columns: ["lease_expires_at", "id"], predicate: "state='Active'" },
            {
              columns: ["cleanup_at", "id"],
              predicate: "state=ANYARRAY['Completed','Dead']"
            },
            ...(change === "missing-index"
              ? []
              : [{ columns: ["source_job_id"], predicate: "source_job_idISNOTNULL" }])
          ]
        }
        return []
      })
  }
  const adapter: ApplicationAdapter = {
    validate: () => Effect.die("unexpected validate"),
    withTransaction: () => Effect.die("unexpected transaction"),
    ownedTransaction: (body) => body(query)
  }
  return { calls, program: ready(adapter, '"scope"."jobs"', '"scope"."payloads"') }
}
test("mapped readiness is bounded introspection without DDL", async () => {
  const { calls, program } = fixture("valid")
  await Effect.runPromise(program)
  expect(calls).toHaveLength(6)
  expect(calls.every((sql) => sql.startsWith("SELECT"))).toBe(true)
})
test.each([
  "missing-created-at",
  "required-created-at",
  "wrong-created-at-type",
  "default-created-at",
  "missing-column",
  "not-null",
  "non-text",
  "cascade",
  "foreign-target",
  "missing-check",
  "missing-index"
])("readiness rejects %s lineage storage", async (change) => {
  const { program } = fixture(change)
  expect(Exit.isFailure(await Effect.runPromiseExit(program))).toBe(true)
})

import { SqlClient } from "effect/sql/SqlClient"
import { relations } from "../persistence/authority/Schema.js"
import { Effect } from "effect"
import { Application } from "../../../website/src/server/Services.js"
import * as Http from "../../../website/src/server/HttpApplication.js"
import * as Upgrade from "../../../website/src/server/live/Upgrade.js"
import * as Read from "../../../website/src/server/read/HttpRead.js"
import { JobsRead, PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Manager from "./Manager.js"
import type { Env } from "../Worker.js"
import * as OriginPolicy from "../../../website/src/OriginPolicy.js"

// Public data admission waits for actual encrypted-worker completion and audited
// known-failure repair resolution. Internal demo control can progress before this gate.
export const readyCurrent = (schema: string) =>
  Effect.gen(function* () {
    const sandbox = yield* Manager.current(schema)
    const sql = yield* SqlClient
    const t = relations(schema)
    const rows = yield* sql.unsafe(
      `SELECT s.sandbox_id FROM ${t.sandboxes} s WHERE s.sandbox_id=$1 AND s.generation=$2 AND s.demo_owned
    AND EXISTS(SELECT 1 FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id WHERE a.sandbox_id=s.sandbox_id AND a.generation=s.generation AND j.kind='playground.synthetic-document-export' AND j.queue='playground-private' AND j.version=1 AND j.state='Completed')
    AND EXISTS(SELECT 1 FROM "${schema}"."repair_receipts" r JOIN "${schema}"."job_problems" p ON p.sandbox_id=r.sandbox_id AND p.generation=r.generation AND p.root_job_id=r.receipt->'result'->'problem'->>'rootJobId'
      JOIN ${t.jobs} original ON original.id=r.receipt->'result'->>'sourceJobId'
      WHERE r.sandbox_id=s.sandbox_id AND r.generation=s.generation AND r.operation='Repair' AND r.request_id='synthetic-corrected-showcase-v1' AND r.receipt->'result'->>'_tag'='Committed' AND original.state='Dead' AND p.problem->>'state'='Resolved' AND p.problem->'resolution'->>'kind'='SuccessorCompleted'
      AND EXISTS(SELECT 1 FROM "${schema}"."repair_audit" audit WHERE audit.sandbox_id=p.sandbox_id AND audit.generation=p.generation AND audit.root_job_id=p.root_job_id AND audit.fact->>'kind'='SuccessorCompleted'))`,
      [sandbox.ref.sandboxId, sandbox.ref.generation]
    )
    if (rows.length !== 1) {
      return yield* new PlaygroundError({ code: "unavailable" })
    }
    return sandbox
  })
export const handle = (
  request: Request,
  env: Env & { readonly LOCAL_PREVIEW?: string }
) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const policy = OriginPolicy.make({
      configuredOrigin: env.ORIGIN,
      localPreview: env.LOCAL_PREVIEW === "true"
    })
    if (
      request.url.length > 4096 ||
      policy.resolve(url.origin) === undefined ||
      request.method !== "GET"
    ) {
      return Http.response({ code: "invalid-request" }, 400)
    }
    const sandbox = yield* readyCurrent(env.SCHEMA).pipe(
      Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
    )
    const access = { sandbox }
    if (url.pathname === "/api/demo") {
      return Http.response(sandbox)
    }
    if (url.pathname === "/api/demo/changes") {
      return yield* Upgrade.upgrade(request, policy, env.LIVE, () =>
        Effect.succeed(sandbox)
      )
    }
    const operations: Record<string, Parameters<typeof Read.handle>[2]> = {
      "/api/demo/jobs": "list",
      "/api/demo/jobs/detail": "detail",
      "/api/demo/jobs/problems": "problems",
      "/api/demo/jobs/history": "history",
      "/api/demo/jobs/related": "related"
    }
    const operation = operations[url.pathname]
    if (!operation) {
      return Http.response({ code: "not-found" }, 404)
    }
    const app = yield* Application
    return yield* Read.handle(access, request, operation).pipe(
      Effect.provideService(JobsRead, app)
    )
  })

import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { JobId } from "effect-jobs/JobId"
import { CatalogIdentity } from "effect-jobs/JobIdentity"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { ApplicationRelations } from "@effect-jobs/playground-contracts/Jobs"
import * as Definitions from "../scenarios/Definitions.js"
import * as Source from "./commands/RepairSource.js"
import { relations } from "./authority/Schema.js"

// Explicit application migration hook, same native migration transaction/client.
// Canonical codec and exact allowlisted catalog validate the old artifact; replacement
// caller data never supplies retained tenant authority. Invalid artifacts stay unavailable.
export const run = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = relations(schema)
    let after = ""
    for (;;) {
      const rows = yield* sql.unsafe<Record<string, unknown> & { job_id: string }>(
        `SELECT a.*,j.queue,j.kind,j.version,p.format_version,p.payload,p.projection FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id LEFT JOIN "${schema}"."job_payloads" p ON p.job_id=j.id WHERE a.job_id COLLATE "C">$1 COLLATE "C" AND NOT a.relations ? 'syntheticTenant' ORDER BY a.job_id COLLATE "C" LIMIT 50 FOR UPDATE OF a,j`,
        [after]
      )
      if (!rows.length) {
        break
      }
      for (const row of rows) {
        after = row.job_id
        const value = yield* Effect.gen(function* () {
          const ref = yield* Schema.decodeUnknownEffect(SandboxRef)({
            sandboxId: row.sandbox_id,
            generation: Number(row.generation)
          })
          const catalog = yield* Schema.decodeUnknownEffect(CatalogIdentity)({
            queue: row.queue,
            kind: row.kind,
            version: Number(row.version)
          })
          const definition = Definitions.definitions.find(
            (d) =>
              d.catalog.queue === catalog.queue &&
              d.catalog.kind === catalog.kind &&
              d.catalog.version === catalog.version
          )
          if (!definition) {
            return null
          }
          const wire = yield* Codec.decodeJobPayload(
            Schema.toEncoded(definition.payload),
            yield* Source.artifact(row)
          )
          const related = yield* Schema.decodeUnknownEffect(ApplicationRelations)(
            row.relations,
            { onExcessProperty: "error" }
          )
          if (
            wire.sandbox.sandboxId !== ref.sandboxId ||
            wire.sandbox.generation !== ref.generation ||
            wire.actor !== related.syntheticActor ||
            wire.order !== related.syntheticOrderId
          ) {
            return null
          }
          yield* Schema.decodeUnknownEffect(JobId)(row.job_id)
          return wire.tenant
        }).pipe(Effect.catch(() => Effect.succeed(null)))
        if (value !== null) {
          yield* sql.unsafe(
            `UPDATE ${t.associations} SET relations=relations||jsonb_build_object('syntheticTenant',$4::text) WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3`,
            [row.sandbox_id, row.generation, row.job_id, value]
          )
        }
      }
    }
  })

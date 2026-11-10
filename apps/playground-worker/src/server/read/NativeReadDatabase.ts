// Effect SQL is an explicit application dependency; no pool or migration starts.
// @effect-diagnostics unstableApiUsage:off
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { ReadDatabase } from "./PostgreSqlRead.js"

export const layerNoDeps = Layer.effect(
  ReadDatabase,
  Effect.gen(function* () {
    const client = yield* SqlClient
    return ReadDatabase.of({
      execute: (query) =>
        client
          .unsafe(query.text, query.values)
          .pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
    })
  })
)

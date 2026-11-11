import { Config, Effect } from "effect"
import * as Event from "../execution/Event.js"

// Alchemy captures these Config reads as native bindings during init. No pool
// or request resource is acquired here; each handler still owns Event.run.
export const configuration = Effect.gen(function* () {
  const connectionString = yield* Config.String("PG_connectionString")
  const SCHEMA = yield* Config.String("SCHEMA")
  const ORIGIN = yield* Config.String("ORIGIN")
  const LOCAL_PREVIEW = yield* Config.String("LOCAL_PREVIEW").pipe(
    Config.withDefault("false")
  )
  const LOCAL_PRIVATE = yield* Config.String("LOCAL_PRIVATE").pipe(
    Config.withDefault("false")
  )
  const ENCRYPTION_KEY = yield* Config.String("ENCRYPTION_KEY")
  const FINGERPRINT_KEY = yield* Config.String("FINGERPRINT_KEY")
  const CURSOR_KEY = yield* Config.String("CURSOR_KEY")
  const DEMO_ROTATION_MS = yield* Config.String("DEMO_ROTATION_MS").pipe(
    Config.withDefault("86400000")
  )
  return {
    PG: { connectionString },
    SCHEMA,
    ORIGIN,
    LOCAL_PREVIEW,
    LOCAL_PRIVATE,
    ENCRYPTION_KEY,
    FINGERPRINT_KEY,
    CURSOR_KEY,
    DEMO_ROTATION_MS
  }
}).pipe(Effect.orDie)

export type Configuration = Effect.Success<typeof configuration>
export const database = (env: Configuration): Event.Config => ({
  localPrivate: env.LOCAL_PRIVATE === "true",
  connectionString: env.PG.connectionString,
  schema: env.SCHEMA,
  encryptionKey: env.ENCRYPTION_KEY,
  fingerprintKey: env.FINGERPRINT_KEY,
  cursorKey: env.CURSOR_KEY
})

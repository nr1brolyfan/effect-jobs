import { Config, Effect } from "effect"
import { connection } from "./Database.js"

export const SharedConfig = Effect.gen(function* () {
  const database = yield* connection
  const providerUrl = yield* Config.String("EXAMPLE_PROVIDER_URL")
  // Keep the accessor lazy: openInvocation reads the URL in its own runtime scope.
  return { databaseUrl: database.connectionString, providerUrl }
})

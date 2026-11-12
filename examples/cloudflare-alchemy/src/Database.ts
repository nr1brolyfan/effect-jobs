import * as Cloudflare from "@alchemy.run/cloudflare"
import { Config, Data, Effect, Redacted } from "effect"

class DatabaseConfigurationError extends Data.TaggedError(
  "DatabaseConfigurationError"
)<{}> {}

// The resource is evaluated by Alchemy's local provider in dev. Qualification only
// builds/types this declaration; it never runs a plan or provisions an account.
const JobsPostgres = Cloudflare.Hyperdrive.Connection(
  "JobsPostgres",
  Effect.gen(function* () {
    const configured = yield* Config.Redacted("EXAMPLE_DATABASE_URL")
    const origin = yield* Effect.try({
      try: () => {
        const url = new URL(Redacted.value(configured))
        if (
          (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
          url.hostname === "" ||
          url.pathname.length <= 1 ||
          url.username === ""
        ) {
          throw new Error("Invalid PostgreSQL configuration")
        }
        return {
          scheme: "postgres" as const,
          host: url.hostname,
          port: url.port === "" ? 5432 : Number(url.port),
          database: decodeURIComponent(url.pathname.slice(1)),
          user: decodeURIComponent(url.username),
          password: Redacted.make(decodeURIComponent(url.password))
        }
      },
      catch: () => new DatabaseConfigurationError()
    })
    return {
      origin,
      dev: { ...origin, sslmode: "disable" as const },
      caching: { disabled: true }
    }
  }).pipe(Effect.orDie)
)

// Resolve the stable binding in construction. The returned accessor reads fresh
// invocation-bound Hyperdrive credentials only when openInvocation executes it.
export const connection = Effect.gen(function* () {
  const resource = yield* JobsPostgres
  return yield* Cloudflare.Hyperdrive.Connect(resource)
}).pipe(Effect.provide(Cloudflare.Hyperdrive.ConnectBinding))

import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { CloudflareEnvironment } from "@alchemy.run/cloudflare/CloudflareEnvironment"
import { Effect } from "effect"
import { Stage } from "alchemy/Stage"

export default Alchemy.Stack(
  "EffectJobsDocs",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const stage = yield* Stage
    if (stage !== "production") {
      return yield* Effect.die(new Error("Docs hosting requires --stage production"))
    }
    const environment = yield* CloudflareEnvironment.current
    if (environment.accountId !== "86b3069c45014c13f4729d416b292bcb") {
      return yield* Effect.die(new Error("Unexpected Cloudflare account for docs"))
    }
    const site = yield* Cloudflare.Website.Astro("Docs", {
      name: "effect-jobs-docs-production",
      rootDir: ".",
      astro: { output: "static", outDir: "./dist/hosting" },
      prerenderEnvironment: "node",
      sessionKVBindingName: false,
      compatibility: { date: "2026-10-13" },
      domain: "effect-jobs.dev",
      workersDev: { enabled: false, previewsEnabled: false },
      assets: { htmlHandling: "drop-trailing-slash", notFoundHandling: "404-page" }
    })
    return { url: site.url }
  })
)

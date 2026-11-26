import { CloudflareClient, CloudflareDecisionModel } from "@effect/ai-cloudflare"
import { Config, Effect, Layer, Schema } from "effect"
import type { TraitsConfig } from "traits"
import { layer as layerLanguageModel } from "./.opencode/traits/OpenCodeLanguageModel.ts"

const decisionModel = Config.schema(
  Schema.Literals(["clef-flash", "clef"]),
  "TRAITS_CLEF_MODEL"
).pipe(Config.withDefault("clef-flash"))

const cloudflareClient = Layer.unwrap(
  Effect.gen(function* () {
    const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
    const apiKey = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- Workers AI client is pinned to 4.1.3.
    return CloudflareClient.layer({ accountId, apiKey })
  })
)

export default {
  excludes: [
    "**/*.md",
    "**/*.html",
    "**/*.key",
    "**/*.pem",
    "**/*.tsbuildinfo",
    "**/*credentials*",
    "**/*lock*",
    "**/.alchemy/**",
    "**/.dev.vars*",
    "**/.env",
    "**/.env.*",
    "**/.output/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
    ".multica/**",
    ".task-cache/**",
    ".toolchain/**",
    "artifacts/**",
    "evidence/**",
    "effect/**",
    "references/**",
    "repos/**",
    "repositories/**",
    "vendor/**"
  ],
  layerDecisionModel: Layer.unwrap(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- Workers AI decision adapter is pinned to 4.1.3.
    Effect.map(decisionModel, (model) => CloudflareDecisionModel.layer({ model }))
  ).pipe(Layer.provide(cloudflareClient)),
  layerLanguageModel
} satisfies TraitsConfig

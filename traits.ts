import { CloudflareClient, CloudflareDecisionModel } from "@effect/ai-cloudflare"
import { Config, Effect, Layer, Schema } from "effect"
import type { TraitsConfig } from "traits"
import { layer as layerLanguageModel } from "./.opencode/traits/OpenCodeLanguageModel.ts"

const decisionModel = Config.schema(
  Schema.Literals(["clef-flash", "clef"]),
  "TRAITS_CLEF_MODEL"
).pipe(Config.withDefault("clef-flash"))

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
  ).pipe(
    Layer.provide(
      // oxlint-disable-next-line effecttsgo/unstable-api-usage -- Workers AI client is pinned to 4.1.3.
      CloudflareClient.layerConfig({
        accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
        apiKey: Config.Redacted("CLOUDFLARE_API_TOKEN")
      })
    )
  ),
  layerLanguageModel
} satisfies TraitsConfig

import { OpenRouterClient, OpenRouterDecisionModel } from "@effect/ai-openrouter"
import { Config, Layer } from "effect"
import type { TraitsConfig } from "traits"
import { layer as layerLanguageModel } from "./.opencode/traits/OpenCodeLanguageModel.ts"

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
  layerDecisionModel: OpenRouterDecisionModel.layer({
    model: "~typesafe/jev-latest"
  }).pipe(
    Layer.provide(
      OpenRouterClient.layerConfig({ apiKey: Config.Redacted("OPENROUTER_API_KEY") })
    )
  ),
  layerLanguageModel
} satisfies TraitsConfig

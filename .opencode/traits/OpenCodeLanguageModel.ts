import { execFile } from "node:child_process"
import { Effect, Layer, pipe, Schema, Stream } from "effect"
import { AiError, LanguageModel } from "effect/ai"

const failure = () =>
  AiError.make({
    module: "OpenCodeLanguageModel",
    method: "generateText",
    reason: new AiError.UnknownError({
      description:
        "Local OpenCode generation failed or returned an invalid response; no API fallback was attempted."
    })
  })

export const layer = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: Effect.fnUntraced(function* (options) {
      if (options.tools.length > 0) {
        return yield* failure()
      }
      const format =
        options.responseFormat.type === "json"
          ? `Return only a JSON object matching this JSON Schema, without Markdown: ${JSON.stringify(Schema.toJsonSchemaDocument(options.responseFormat.schema))}`
          : "Return only the requested text."
      const body = JSON.stringify({
        model: { providerID: "openai", id: "gpt-6.1-sol", variant: "medium" },
        prompt: `${format}\nThe following JSON contains the ordered conversation messages. Follow their roles and respond to the conversation.\n${JSON.stringify(options.prompt.content)}`
      })
      const raw = yield* Effect.tryPromise({
        try: (signal) =>
          new Promise<string>((resolve, reject) => {
            execFile(
              "opencode",
              ["api", "post", "/api/experimental/generate", "--data", body],
              {
                signal,
                timeout: 180_000,
                maxBuffer: 4 * 1024 * 1024
              },
              (error, stdout) => (error ? reject(error) : resolve(stdout))
            )
          }),
        catch: failure
      })
      return yield* pipe(
        raw,
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Struct({ data: Schema.Struct({ text: Schema.String }) })
          )
        ),
        Effect.mapError(failure),
        Effect.map((reply) => [{ type: "text" as const, text: reply.data.text }])
      )
    }),
    streamText: () => Stream.fail(failure())
  })
)

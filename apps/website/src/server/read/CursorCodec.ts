import { Context, Effect, Layer, Schema } from "effect"
import { JobFilters, Cursor } from "@effect-jobs/playground-contracts/Jobs"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"

const After = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))
)
export type Position = typeof Position.Type
const Position = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    sandbox: SandboxRef,
    filters: JobFilters,
    after: After
  }).pipe(
    Schema.check(
      Schema.makeFilter(
        (p) =>
          p.filters.resolution === undefined && p.filters.needsAttention === undefined
      )
    )
  ),
  Schema.Struct({
    version: Schema.Literal(2),
    view: Schema.Literals(["jobs", "problems"]),
    sandbox: SandboxRef,
    filters: JobFilters,
    after: After
  }),
  Schema.Struct({
    version: Schema.Literal(2),
    view: Schema.Literals(["history", "related"]),
    sandbox: SandboxRef,
    jobId: After,
    after: Schema.String.pipe(
      Schema.check(Schema.isMinLength(1), Schema.isMaxLength(512))
    )
  })
])
export class CursorCodec extends Context.Service<
  CursorCodec,
  {
    readonly encode: (position: Position) => Effect.Effect<Cursor, PlaygroundError>
    readonly decode: (cursor: Cursor) => Effect.Effect<Position, PlaygroundError>
  }
>()("playground/read/CursorCodec") {}
const utf8 = new TextEncoder()
const text = new TextDecoder("utf-8", { fatal: true })
const encodeBytes = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
const decodeBytes = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid cursor encoding")
  }
  const bytes = Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0)
  )
  if (encodeBytes(bytes) !== value) {
    throw new Error("Noncanonical cursor encoding")
  }
  return bytes
}
// WebCrypto is the portable FFI. The application supplies an HMAC SHA-256 key;
// no key/env access or lifetime starts here. Rotation invalidates old cursors.
export const make = (key: CryptoKey): typeof CursorCodec.Service => {
  const algorithm = key.algorithm as HmacKeyAlgorithm
  if (
    key.type !== "secret" ||
    algorithm.name !== "HMAC" ||
    algorithm.hash.name !== "SHA-256" ||
    algorithm.length < 256 ||
    !key.usages.includes("sign") ||
    !key.usages.includes("verify")
  ) {
    throw new Error("Cursor key requires HMAC SHA-256 and sign/verify usages")
  }
  return {
    encode: (position) =>
      Schema.decodeUnknownEffect(Position)(position, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => new PlaygroundError({ code: "unavailable" })),
        Effect.flatMap((decoded) =>
          Effect.tryPromise({
            try: async () => {
              const body = utf8.encode(JSON.stringify(decoded))
              const signature = await crypto.subtle.sign("HMAC", key, body)
              return `${encodeBytes(body)}.${encodeBytes(new Uint8Array(signature))}`
            },
            catch: () => new PlaygroundError({ code: "unavailable" })
          })
        ),
        Effect.flatMap((value) =>
          Schema.decodeUnknownEffect(Cursor)(value).pipe(
            Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
          )
        )
      ),
    decode: (cursor) =>
      Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
        Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })),
        Effect.flatMap((cursor) =>
          Effect.tryPromise({
            try: async () => {
              const parts = cursor.split(".")
              if (parts.length !== 2) {
                throw new Error("Invalid cursor")
              }
              const body = decodeBytes(parts[0]!)
              const signature = decodeBytes(parts[1]!)
              if (
                signature.byteLength !== 32 ||
                !(await crypto.subtle.verify("HMAC", key, signature, body))
              ) {
                throw new Error("Invalid cursor signature")
              }
              return JSON.parse(text.decode(body)) as unknown
            },
            catch: () => new PlaygroundError({ code: "invalid-request" })
          }).pipe(
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(Position)(value, {
                onExcessProperty: "error"
              }).pipe(
                Effect.mapError(() => new PlaygroundError({ code: "invalid-request" }))
              )
            )
          )
        )
      )
  }
}
export const layer = (key: CryptoKey) => Layer.succeed(CursorCodec, make(key))

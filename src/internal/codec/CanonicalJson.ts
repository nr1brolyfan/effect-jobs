import { Effect, Match, Result } from "effect"
import { JobPayloadCodecError, maximumJobPayloadDepth } from "../../JobContract.js"

const encoder = new TextEncoder()
const validScalars = (value: string): boolean => {
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

// The recursive algorithm returns typed results synchronously. Only native
// reflection/encoding is adapted here; domain validation never throws.
export const canonicalText = (
  value: unknown,
  maximum: number,
  reason: "payload-too-large" | "projection-too-large",
  rootDepth = 0
): Result.Result<string, JobPayloadCodecError> => {
  const seen = new Set<object>()
  let length = 0
  const emit = (text: string): Result.Result<string, JobPayloadCodecError> => {
    const bytes = Result.try({
      try: () => encoder.encode(text),
      catch: (error) =>
        error instanceof JobPayloadCodecError
          ? error
          : new JobPayloadCodecError({ reason: "invalid-json-value" })
    })
    if (Result.isFailure(bytes)) {
      return Result.fail(bytes.failure)
    }
    length += bytes.success.byteLength
    if (length > maximum) {
      return Result.fail(new JobPayloadCodecError({ reason }))
    }
    return Result.succeed(text)
  }
  const quote = (text: string): Result.Result<string, JobPayloadCodecError> => {
    if (text.length > maximum) {
      return Result.fail(new JobPayloadCodecError({ reason }))
    }
    if (!validScalars(text)) {
      return Result.fail(new JobPayloadCodecError({ reason: "invalid-json-value" }))
    }
    return emit(JSON.stringify(text))
  }
  const visit = (
    item: unknown,
    depth: number
  ): Result.Result<string, JobPayloadCodecError> =>
    Result.gen(function* () {
      if (depth > maximumJobPayloadDepth) {
        return yield* Result.fail(
          new JobPayloadCodecError({ reason: "payload-too-deep" })
        )
      }
      if (item === null) {
        return yield* emit("null")
      }
      return yield* Match.value(item).pipe(
        Match.when(Match.boolean, (item) => emit(JSON.stringify(item))),
        Match.when(Match.string, quote),
        Match.when(Match.number, (item) =>
          Number.isFinite(item)
            ? emit(JSON.stringify(item))
            : Result.fail(new JobPayloadCodecError({ reason: "invalid-json-value" }))
        ),
        Match.when(
          (item): item is object => typeof item === "object" && item !== null,
          (item) =>
            Result.gen(function* () {
              if (seen.has(item)) {
                return yield* Result.fail(
                  new JobPayloadCodecError({ reason: "invalid-json-value" })
                )
              }
              const array = yield* Result.try({
                try: () => Array.isArray(item),
                catch: (error) =>
                  error instanceof JobPayloadCodecError
                    ? error
                    : new JobPayloadCodecError({ reason: "invalid-json-value" })
              })
              const plain =
                array ||
                (yield* Result.try({
                  try: () =>
                    Object.getPrototypeOf(item) === Object.prototype ||
                    Object.getPrototypeOf(item) === null,
                  catch: (error) =>
                    error instanceof JobPayloadCodecError
                      ? error
                      : new JobPayloadCodecError({ reason: "invalid-json-value" })
                }))
              if (!plain) {
                return yield* Result.fail(
                  new JobPayloadCodecError({ reason: "invalid-json-value" })
                )
              }
              seen.add(item)
              const descriptors = yield* Result.try({
                try: () => Object.getOwnPropertyDescriptors(item),
                catch: (error) =>
                  error instanceof JobPayloadCodecError
                    ? error
                    : new JobPayloadCodecError({ reason: "invalid-json-value" })
              })
              const keys = Reflect.ownKeys(descriptors)
              for (const key of keys) {
                if (array && key === "length") {
                  continue
                }
                const descriptor = descriptors[key as string]!
                if (
                  typeof key !== "string" ||
                  !validScalars(key) ||
                  !descriptor.enumerable ||
                  !("value" in descriptor)
                ) {
                  return yield* Result.fail(
                    new JobPayloadCodecError({ reason: "invalid-json-value" })
                  )
                }
              }
              let text: string
              if (array) {
                yield* emit("[]")
                const size = yield* Result.try({
                  try: () => (Array.isArray(item) ? item.length : 0),
                  catch: (error) =>
                    error instanceof JobPayloadCodecError
                      ? error
                      : new JobPayloadCodecError({ reason: "invalid-json-value" })
                })
                if (keys.length !== size + 1) {
                  return yield* Result.fail(
                    new JobPayloadCodecError({ reason: "invalid-json-value" })
                  )
                }
                const entries: Array<string> = []
                for (let index = 0; index < size; index++) {
                  if (index > 0) {
                    yield* emit(",")
                  }
                  const descriptor = descriptors[String(index)]
                  if (descriptor === undefined) {
                    return yield* Result.fail(
                      new JobPayloadCodecError({ reason: "invalid-json-value" })
                    )
                  }
                  entries.push(yield* visit(descriptor.value, depth + 1))
                }
                text = `[${entries.join(",")}]`
              } else {
                yield* emit("{}")
                const entries: Array<string> = []
                // Symbols have already failed above; filter preserves the string order.
                for (const key of keys.filter((key) => typeof key === "string").sort()) {
                  if (entries.length > 0) {
                    yield* emit(",")
                  }
                  const name = yield* quote(key)
                  yield* emit(":")
                  const entry = yield* visit(descriptors[key]!.value, depth + 1)
                  entries.push(`${name}:${entry}`)
                }
                text = `{${entries.join(",")}}`
              }
              seen.delete(item)
              return text
            })
        ),
        Match.orElse(() =>
          Result.fail(new JobPayloadCodecError({ reason: "invalid-json-value" }))
        )
      )
    })
  return visit(value, rootDepth)
}

export const canonicalBytes = (
  value: unknown,
  maximum: number,
  reason: "payload-too-large" | "projection-too-large",
  rootDepth = 0
) =>
  Effect.gen(function* () {
    const text = yield* Effect.fromResult(
      canonicalText(value, maximum, reason, rootDepth)
    )
    const bytes = yield* Effect.try({
      try: () => encoder.encode(text),
      catch: (error) =>
        error instanceof JobPayloadCodecError
          ? error
          : new JobPayloadCodecError({ reason: "invalid-json-value" })
    })
    if (bytes.byteLength > maximum) {
      return yield* new JobPayloadCodecError({ reason })
    }
    return bytes
  })

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

/** Detect cycles/depth before Schema traverses plain decoded containers, without
 * coercing domain objects (dates, etc.) whose encoded side is validated later. */
export const checkDecodedContainers = (value: unknown) =>
  Effect.suspend(() => {
    const seen = new Set<object>()
    const visit = (
      item: unknown,
      depth: number
    ): Result.Result<void, JobPayloadCodecError> =>
      Result.gen(function* () {
        if (depth > maximumJobPayloadDepth) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "payload-too-deep" })
          )
        }
        if (typeof item === "number" && !Number.isFinite(item)) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "invalid-json-value" })
          )
        }
        if (item === null || typeof item !== "object") {
          return
        }
        const array = yield* Result.try({
          try: () => Array.isArray(item),
          catch: (error) =>
            error instanceof JobPayloadCodecError
              ? error
              : new JobPayloadCodecError({ reason: "invalid-json-value" })
        })
        const plain =
          array ||
          (yield* Result.try({
            try: () =>
              Object.getPrototypeOf(item) === Object.prototype ||
              Object.getPrototypeOf(item) === null,
            catch: (error) =>
              error instanceof JobPayloadCodecError
                ? error
                : new JobPayloadCodecError({ reason: "invalid-json-value" })
          }))
        if (!plain) {
          return
        }
        if (seen.has(item)) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "invalid-json-value" })
          )
        }
        seen.add(item)
        const descriptors = yield* Result.try({
          try: () => Object.getOwnPropertyDescriptors(item),
          catch: (error) =>
            error instanceof JobPayloadCodecError
              ? error
              : new JobPayloadCodecError({ reason: "invalid-json-value" })
        })
        if (array) {
          const size = yield* Result.try({
            try: () => (Array.isArray(item) ? item.length : 0),
            catch: (error) =>
              error instanceof JobPayloadCodecError
                ? error
                : new JobPayloadCodecError({ reason: "invalid-json-value" })
          })
          if (Reflect.ownKeys(descriptors).length !== size + 1) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-json-value" })
            )
          }
          for (let index = 0; index < size; index++) {
            if (!Object.hasOwn(descriptors, String(index))) {
              return yield* Result.fail(
                new JobPayloadCodecError({ reason: "invalid-json-value" })
              )
            }
          }
        }
        for (const key of Reflect.ownKeys(descriptors)) {
          if (array && key === "length") {
            continue
          }
          const descriptor = descriptors[key as string]!
          if (
            typeof key !== "string" ||
            !validScalars(key) ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-json-value" })
            )
          }
          yield* visit(descriptor.value, depth + 1)
        }
        seen.delete(item)
      })
    return Effect.fromResult(visit(value, 0))
  })

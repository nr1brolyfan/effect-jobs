import { Effect } from "effect"
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

// Serialization is a synchronous JS boundary. Only bounded operation-owned
// errors escape it; accessors/toJSON and arbitrary object coercion are forbidden.
export const canonicalText = (
  value: unknown,
  maximum: number,
  reason: "payload-too-large" | "projection-too-large"
): string => {
  const seen = new Set<object>()
  let length = 0
  const emit = (text: string): string => {
    length += encoder.encode(text).byteLength
    if (length > maximum) {
      throw new JobPayloadCodecError({ reason })
    }
    return text
  }
  const quote = (text: string): string => {
    if (text.length > maximum) {
      throw new JobPayloadCodecError({ reason })
    }
    if (!validScalars(text)) {
      throw new JobPayloadCodecError({ reason: "invalid-json-value" })
    }
    return emit(JSON.stringify(text))
  }
  const visit = (item: unknown, depth: number): string => {
    if (depth > maximumJobPayloadDepth) {
      throw new JobPayloadCodecError({ reason: "payload-too-deep" })
    }
    if (item === null) {
      return emit("null")
    }
    switch (typeof item) {
      case "boolean":
        return emit(JSON.stringify(item))
      case "string":
        return quote(item)
      case "number":
        if (Number.isFinite(item)) {
          return emit(JSON.stringify(item))
        }
        break
      case "object": {
        if (seen.has(item)) {
          break
        }
        const array = Array.isArray(item)
        if (
          !array &&
          Object.getPrototypeOf(item) !== Object.prototype &&
          Object.getPrototypeOf(item) !== null
        ) {
          break
        }
        seen.add(item)
        const descriptors = Object.getOwnPropertyDescriptors(item)
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
            throw new JobPayloadCodecError({ reason: "invalid-json-value" })
          }
        }
        let text: string
        if (array) {
          emit("[]")
          if (keys.length !== item.length + 1) {
            throw new JobPayloadCodecError({ reason: "invalid-json-value" })
          }
          const entries: Array<string> = []
          for (let index = 0; index < item.length; index++) {
            if (index > 0) {
              emit(",")
            }
            const descriptor = descriptors[String(index)]
            if (descriptor === undefined) {
              throw new JobPayloadCodecError({ reason: "invalid-json-value" })
            }
            entries.push(visit(descriptor.value, depth + 1))
          }
          text = `[${entries.join(",")}]`
        } else {
          emit("{}")
          text = `{${(keys as Array<string>)
            .sort()
            .map((key, index) => {
              if (index > 0) {
                emit(",")
              }
              return `${quote(key)}${emit(":")}${visit(descriptors[key]!.value, depth + 1)}`
            })
            .join(",")}}`
        }
        seen.delete(item)
        return text
      }
    }
    throw new JobPayloadCodecError({ reason: "invalid-json-value" })
  }
  return visit(value, 0)
}

export const canonicalBytes = (
  value: unknown,
  maximum: number,
  reason: "payload-too-large" | "projection-too-large"
) =>
  Effect.try({
    try: () => {
      const bytes = encoder.encode(canonicalText(value, maximum, reason))
      if (bytes.byteLength > maximum) {
        throw new JobPayloadCodecError({ reason })
      }
      return bytes
    },
    catch: (error) =>
      error instanceof JobPayloadCodecError
        ? error
        : new JobPayloadCodecError({ reason: "invalid-json-value" })
  })

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

/** Detect cycles/depth before Schema traverses plain decoded containers, without
 * coercing domain objects (dates, etc.) whose encoded side is validated later. */
export const checkDecodedContainers = (value: unknown) =>
  Effect.try({
    try: () => {
      const seen = new Set<object>()
      const visit = (item: unknown, depth: number): void => {
        if (depth > maximumJobPayloadDepth) {
          throw new JobPayloadCodecError({ reason: "payload-too-deep" })
        }
        if (typeof item === "number" && !Number.isFinite(item)) {
          throw new JobPayloadCodecError({ reason: "invalid-json-value" })
        }
        if (item === null || typeof item !== "object") {
          return
        }
        if (
          !Array.isArray(item) &&
          Object.getPrototypeOf(item) !== Object.prototype &&
          Object.getPrototypeOf(item) !== null
        ) {
          return
        }
        if (seen.has(item)) {
          throw new JobPayloadCodecError({ reason: "invalid-json-value" })
        }
        seen.add(item)
        const descriptors = Object.getOwnPropertyDescriptors(item)
        if (Array.isArray(item)) {
          if (Reflect.ownKeys(descriptors).length !== item.length + 1) {
            throw new JobPayloadCodecError({ reason: "invalid-json-value" })
          }
          for (let index = 0; index < item.length; index++) {
            if (!Object.hasOwn(descriptors, String(index))) {
              throw new JobPayloadCodecError({ reason: "invalid-json-value" })
            }
          }
        }
        for (const key of Reflect.ownKeys(descriptors)) {
          if (Array.isArray(item) && key === "length") {
            continue
          }
          const descriptor = descriptors[key as string]!
          if (
            typeof key !== "string" ||
            !validScalars(key) ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            throw new JobPayloadCodecError({ reason: "invalid-json-value" })
          }
          visit(descriptor.value, depth + 1)
        }
        seen.delete(item)
      }
      visit(value, 0)
    },
    catch: (error) =>
      error instanceof JobPayloadCodecError
        ? error
        : new JobPayloadCodecError({ reason: "invalid-json-value" })
  })

import { Schema } from "effect"
import type { Document } from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import * as BrowserDocumentCrypto from "../payload/BrowserDocumentCrypto.js"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as Definitions from "../../../../../playground-worker/src/scenarios/Definitions.js"

export interface Change {
  readonly kind: "Added" | "Removed" | "Changed"
  readonly path: string
}
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1")
// Paths only: UI/audit never retain a second source/replacement value copy.
export const diff = (before: unknown, after: unknown): ReadonlyArray<Change> => {
  const changes: Change[] = []
  const visit = (left: unknown, right: unknown, path: string) => {
    if (Object.is(left, right)) {
      return
    }
    if (
      left &&
      right &&
      typeof left === "object" &&
      typeof right === "object" &&
      Array.isArray(left) === Array.isArray(right)
    ) {
      const a = left as Record<string, unknown>,
        b = right as Record<string, unknown>
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const next = `${path}/${pointer(key)}`
        if (!Object.hasOwn(a, key)) {
          changes.push({ kind: "Added", path: next })
        } else if (!Object.hasOwn(b, key)) {
          changes.push({ kind: "Removed", path: next })
        } else {
          visit(a[key], b[key], next)
        }
      }
    } else {
      changes.push({ kind: "Changed", path: path || "/" })
    }
  }
  visit(before, after, "")
  return changes
}
export const validReason = (value: string) =>
  value.trim().length > 0 &&
  value.length <= 512 &&
  Array.from(value).every(
    (scalar) => scalar.codePointAt(0)! < 0xd800 || scalar.codePointAt(0)! > 0xdfff
  ) &&
  !value.includes("\0") &&
  new TextEncoder().encode(value).length <= 1024
export const parseReplacement = (
  detail: JobDetail,
  text: string,
  document: Document | null = null
) => {
  const synthetic =
    detail.payload._tag === "Available" &&
    detail.payload.encryption === "SyntheticDocumentV1" &&
    BrowserDocumentCrypto.isSyntheticCatalog(detail.job.catalog)
  if (synthetic && document === null) {
    return { valid: false as const, rule: "unlock-required: use demo code 123" }
  }
  if (new TextEncoder().encode(text).length > 65536) {
    return { valid: false as const, rule: "payload-too-large" }
  }
  const definition = Definitions.definitions.find(
    (entry) =>
      entry.catalog.kind === detail.job.catalog.kind &&
      entry.catalog.queue === detail.job.catalog.queue &&
      entry.catalog.version === detail.job.catalog.version
  )
  if (
    !definition ||
    (definition === Definitions.SyntheticDocumentExport && !synthetic) ||
    definition.catalog.kind === Definitions.PrivateDataExport.catalog.kind ||
    (detail.payload._tag === "Available" &&
      detail.payload.encryption !== "None" &&
      !synthetic)
  ) {
    return { valid: false as const, rule: "encrypted-or-unsupported-catalog" }
  }
  // JSON/Schema FFI can throw. Do not expose the exception or parse inputs.
  try {
    const parsed: unknown = JSON.parse(text)
    const check = (value: unknown, level: number) => {
      if (level > 32) {
        throw new Error("Depth")
      }
      if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
          check(item, level + 1)
        }
      }
    }
    check(parsed, 0)
    const syntheticPayload = synthetic
      ? Schema.decodeUnknownSync(Definitions.SyntheticReadablePayload)(parsed, {
          onExcessProperty: "error"
        })
      : null
    const payload =
      syntheticPayload ??
      Schema.decodeUnknownSync(Definitions.Payload)(parsed, {
        onExcessProperty: "error"
      })
    if (
      payload.sandbox.sandboxId !== detail.sandbox.sandboxId ||
      payload.sandbox.generation !== detail.sandbox.generation ||
      detail.relations.syntheticActor !== payload.actor ||
      detail.relations.syntheticOrderId !== payload.order
    ) {
      return { valid: false as const, rule: "identity-mismatch" }
    }
    if (
      syntheticPayload &&
      (syntheticPayload.document.subject !== payload.actor ||
        syntheticPayload.document.tenant !== payload.tenant)
    ) {
      return {
        valid: false as const,
        rule: "document-identity-mismatch: subject and tenant must match payload"
      }
    }
    if (detail.payload._tag === "Available") {
      const old = Schema.decodeUnknownSync(Definitions.Payload)(detail.payload.encoded, {
        onExcessProperty: synthetic ? "ignore" : "error"
      })
      if (
        old.tenant !== payload.tenant ||
        old.actor !== payload.actor ||
        old.order !== payload.order
      ) {
        return { valid: false as const, rule: "identity-mismatch" }
      }
    }
    return {
      valid: true as const,
      payload,
      document: syntheticPayload?.document ?? null,
      changes:
        detail.payload._tag === "Available"
          ? diff(
              synthetic
                ? { ...(detail.payload.encoded as object), document }
                : detail.payload.encoded,
              payload
            )
          : null
    }
  } catch {
    return {
      valid: false as const,
      rule: "schema-invalid: check required payload fields; document subject demo-customer, tenant demo-tenant-a/b, note up to 256 characters"
    }
  }
}

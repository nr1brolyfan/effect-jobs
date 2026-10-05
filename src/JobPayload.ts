import type { Schema } from "effect"

/**
 * Marks an application-owned, already-protected JSON representation. Requires an
 * own fingerprint in the encoded value. This neither proves protection nor seals
 * or opens data. Encryption and stable fingerprint keys remain application-owned.
 * The schema may describe any JSON fingerprint; no envelope shape or crypto key
 * manager is imposed. Unsupported protected mappings fail when the codec runs.
 */
const protectedPayload = <S extends Schema.Top>(schema: S): S["Rebuild"] =>
  schema.annotate({ effectJobsProtectedPayload: true })

export { protectedPayload as protected }

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly effectJobsProtectedPayload?: true | undefined
    }
  }
}

// Isolated compile fixture ONLY. Real JobDetail registration belongs to UPVE-2151.
import type { JobDetail as CurrentDetail } from "../../../../../packages/playground-contracts/src/Jobs.js"
export type { JobSummary } from "../../../../../packages/playground-contracts/src/Jobs.js"
type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json }
export type JobDetail = CurrentDetail & {
  readonly payload:
    | {
        readonly _tag: "Available"
        readonly formatVersion: 1
        readonly catalog: CurrentDetail["job"]["catalog"]
        readonly encoded: Json
        readonly validation: "Valid"
        readonly encryption: "None" | "PrivateDocumentV1" | "SyntheticDocumentV1"
      }
    | {
        readonly _tag: "Unavailable"
        readonly reason: "not-stored" | "invalid-artifact" | "unsupported-catalog"
      }
  readonly result: { readonly _tag: "Unavailable"; readonly reason: "not-stored" }
}

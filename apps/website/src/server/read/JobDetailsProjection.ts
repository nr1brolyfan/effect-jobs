import { Effect, Schema } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import type { JobDetail, JobPayloadView } from "@effect-jobs/playground-contracts/Jobs"
import type {
  JobProblem,
  JobRepairReason
} from "@effect-jobs/playground-contracts/Repairs"
import * as Definitions from "../../../../playground-worker/src/scenarios/Definitions.js"
import * as Source from "../../../../playground-worker/src/persistence/commands/RepairSource.js"

const unavailable = (
  reason: Extract<JobPayloadView, { _tag: "Unavailable" }>["reason"]
): JobPayloadView => ({ _tag: "Unavailable", reason })
// Read only the encoded-side schema. In particular, never provide DocumentKeys
// or invoke an application decryptor during a detail SELECT.
export const payload = (
  detail: Pick<JobDetail, "job" | "sandbox">,
  row: Readonly<Record<string, unknown>>
): Effect.Effect<JobPayloadView> =>
  Effect.gen(function* () {
    const catalog = detail.job.catalog
    const definition = Definitions.definitions.find(
      (entry) =>
        entry.catalog.name === catalog.name &&
        entry.catalog.queue === catalog.queue &&
        entry.catalog.version === catalog.version
    )
    if (!definition) {
      return unavailable("unsupported-catalog")
    }
    if (row.payload === null || row.payload === undefined) {
      return unavailable("not-stored")
    }
    const bytes = yield* Source.artifact(row)
    const wire = yield* Codec.decodeJobPayload(
      Schema.toEncoded(definition.payload),
      bytes
    )
    if (
      wire.sandbox.sandboxId !== detail.sandbox.sandboxId ||
      wire.sandbox.generation !== detail.sandbox.generation
    ) {
      return unavailable("invalid-artifact")
    }
    let encryption: Extract<JobPayloadView, { _tag: "Available" }>["encryption"] = "None"
    if ("document" in wire) {
      const document = wire.document as {
        ciphertext: readonly number[]
        fingerprint: string
      }
      if (
        document.ciphertext.length < 16 ||
        !/^[a-f0-9]{64}$/u.test(document.fingerprint)
      ) {
        return unavailable("invalid-artifact")
      }
      encryption =
        String(definition.catalog.name) === "playground.synthetic-document-export"
          ? "SyntheticDocumentV1"
          : "PrivateDocumentV1"
    }
    return {
      _tag: "Available" as const,
      formatVersion: 1 as const,
      catalog,
      encoded: wire,
      validation: "Valid" as const,
      encryption
    }
  }).pipe(
    Effect.catchTags({
      RepairSourceRejected: () => Effect.succeed(unavailable("invalid-artifact"))
    }),
    Effect.catchTags({
      JobPayloadCodecError: () => Effect.succeed(unavailable("invalid-artifact"))
    })
  )

export const eligibility = (
  detail: Pick<JobDetail, "job">,
  problem: JobProblem | null,
  payloadView: JobPayloadView
) => {
  const selected = Definitions.definitions.find(
    (entry) =>
      entry.catalog.name === detail.job.catalog.name &&
      entry.catalog.queue === detail.job.catalog.queue &&
      entry.catalog.version === detail.job.catalog.version
  )
  const entry = (reason: JobRepairReason | null) => ({ enabled: reason === null, reason })
  const state = detail.job.state
  const common: JobRepairReason | null =
    state === "Active"
      ? "active-execution"
      : state !== "Dead" && state !== "Isolated"
        ? "not-eligible"
        : problem?.state === "InProgress"
          ? "repair-in-progress"
          : problem?.state === "Resolved"
            ? "already-resolved"
            : problem &&
                (problem.activeSuccessorJobId ?? problem.rootJobId) !== detail.job.jobId
              ? "resolution-conflict"
              : null
  const plain =
    common ??
    (payloadView._tag === "Unavailable"
      ? payloadView.reason === "unsupported-catalog"
        ? "unsupported-catalog"
        : "invalid-artifact"
      : null)
  const correction =
    common ??
    (selected === Definitions.SyntheticDocumentExport &&
    payloadView._tag === "Unavailable"
      ? "invalid-artifact"
      : null) ??
    ((selected &&
      "document" in selected.payload.fields &&
      selected !== Definitions.SyntheticDocumentExport) ||
    (payloadView._tag === "Available" &&
      payloadView.encryption !== "None" &&
      !(
        selected === Definitions.SyntheticDocumentExport &&
        payloadView.encryption === "SyntheticDocumentV1"
      ))
      ? "encrypted-correction-unavailable"
      : payloadView._tag === "Unavailable" && payloadView.reason === "unsupported-catalog"
        ? "unsupported-catalog"
        : null)
  return { redrive: entry(plain), correctedRedrive: entry(correction) }
}

export const retainedFields = {
  createdAt: null,
  result: { _tag: "Unavailable" as const, reason: "not-stored" as const }
}

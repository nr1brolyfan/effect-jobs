import { Result, Schema } from "effect"
import * as Contract from "../../JobContract.js"
import { CatalogIdentity, ProducerIdentity } from "../../JobIdentity.js"
import { EpochMillis, PersistedJobPolicy } from "../../JobPolicy.js"
import * as Lifecycle from "../../JobLifecycle.js"
import { JobStoreProtocolError, type ClaimedJob } from "../../JobStore.js"

const bytes = (maximum: number) =>
  Schema.instanceOf(Uint8Array).pipe(
    Schema.check(
      Schema.makeFilter((value) => value.byteLength > 0 && value.byteLength <= maximum)
    )
  )
const PreparedArtifact = Schema.Struct({
  catalog: CatalogIdentity,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  availableAt: Schema.optional(EpochMillis),
  encoded: Schema.Struct({
    formatVersion: Schema.Literal(Contract.jobPayloadFormatVersion),
    payloadBytes: bytes(Contract.maximumJobPayloadBytes),
    semanticProjectionBytes: bytes(Contract.maximumJobSemanticProjectionBytes)
  })
})
/** Validates portable structure only. Codec must still validate canonical bytes/schema/projection before execution. */
export const validateClaimArtifact = (
  claim: ClaimedJob
): Result.Result<Contract.PreparedJob, JobStoreProtocolError> =>
  Result.gen(function* () {
    const fail = () => new JobStoreProtocolError({ reason: "invalid-artifact" })
    const row = yield* Result.mapError(Lifecycle.validateSnapshot(claim.snapshot), fail)
    const ownership = yield* Result.mapError(Lifecycle.ownershipOf(row), fail)
    const suppliedOwnership = yield* Result.mapError(
      Schema.decodeResult(Lifecycle.JobOwnership, { onExcessProperty: "error" })(
        claim.ownership
      ),
      fail
    )
    const prepared = yield* Result.mapError(
      Schema.decodeUnknownResult(PreparedArtifact, { onExcessProperty: "error" })(
        claim.prepared
      ),
      fail
    )
    if (
      !Schema.toEquivalence(Lifecycle.JobOwnership)(ownership, suppliedOwnership) ||
      !Schema.toEquivalence(PersistedJobPolicy)(row.policy, prepared.policy)
    ) {
      return yield* Result.fail(fail())
    }
    return Object.freeze({
      catalog: Object.freeze(prepared.catalog),
      producer: Object.freeze(prepared.producer),
      policy: Object.freeze({
        ...prepared.policy,
        retrySchedule: Object.freeze(prepared.policy.retrySchedule),
        completedRetention: Object.freeze(prepared.policy.completedRetention),
        deadRetention: Object.freeze(prepared.policy.deadRetention)
      }),
      ...(prepared.availableAt === undefined
        ? {}
        : { availableAt: prepared.availableAt }),
      encoded: Object.freeze({
        ...prepared.encoded,
        payloadBytes: new Uint8Array(prepared.encoded.payloadBytes),
        semanticProjectionBytes: new Uint8Array(prepared.encoded.semanticProjectionBytes)
      })
    })
  })

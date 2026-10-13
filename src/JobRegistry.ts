import { Context, Data, Effect, Layer } from "effect"
import type {
  EncodedJobPayload,
  HandlerContext,
  JobPayloadCodecError
} from "./JobContract.js"
import type { JobFailure } from "./JobFailure.js"
import type { CatalogIdentity } from "./JobIdentity.js"

export interface JobHandler {
  readonly catalog: CatalogIdentity
  /** Decodes first; services were captured by the definition's handler Layer. */
  readonly execute: (
    encoded: EncodedJobPayload,
    context: HandlerContext
  ) => Effect.Effect<void, JobFailure | JobPayloadCodecError>
}

export class DuplicateJobHandler extends Data.TaggedError(
  "DuplicateJobHandler"
)<CatalogIdentity> {
  override get message(): string {
    return `Handler already installed for ${this.queue}/${this.kind}@${this.version}; install one handler per catalog entry`
  }
}

export class DuplicateJobCatalogEntry extends Data.TaggedError(
  "DuplicateJobCatalogEntry"
)<CatalogIdentity> {
  override get message(): string {
    return `Duplicate catalog entry ${this.queue}/${this.kind}@${this.version}; use a unique queue/kind/version`
  }
}

export interface JobRegistryService {
  readonly install: (handler: JobHandler) => Effect.Effect<void, DuplicateJobHandler>
  readonly find: (catalog: CatalogIdentity) => JobHandler | undefined
}

export class JobRegistry extends Context.Service<JobRegistry, JobRegistryService>()(
  "effect-jobs/JobRegistry"
) {}

const key = (catalog: CatalogIdentity) =>
  `${catalog.queue}\u0000${catalog.kind}\u0000${catalog.version}`

/** Each Layer build owns its registry; imports and construction start no fibers. */
export const layer = Layer.sync(JobRegistry, () => {
  const handlers = new Map<string, JobHandler>()
  return JobRegistry.of({
    install: (handler) =>
      Effect.suspend(() => {
        const catalogKey = key(handler.catalog)
        if (handlers.has(catalogKey)) {
          return Effect.fail(new DuplicateJobHandler(handler.catalog))
        }
        const catalog = Object.freeze({
          queue: handler.catalog.queue,
          kind: handler.catalog.kind,
          version: handler.catalog.version
        })
        handlers.set(catalogKey, Object.freeze({ catalog, execute: handler.execute }))
        return Effect.void
      }),
    find: (catalog) => handlers.get(key(catalog))
  })
})

export interface CatalogEntry {
  readonly catalog: CatalogIdentity
}

/** Preserve definition types; validate duplicate identities without a global catalog. */
export const catalog = <const Entries extends ReadonlyArray<CatalogEntry>>(
  ...entries: Entries
): Effect.Effect<Readonly<Entries>, DuplicateJobCatalogEntry> =>
  Effect.suspend(() => {
    const seen = new Set<string>()
    for (const entry of entries) {
      const catalogKey = key(entry.catalog)
      if (seen.has(catalogKey)) {
        return Effect.fail(new DuplicateJobCatalogEntry(entry.catalog))
      }
      seen.add(catalogKey)
    }
    return Effect.succeed(Object.freeze([...entries]) as unknown as Readonly<Entries>)
  })

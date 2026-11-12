/** Test-only mutable handler installation for direct protocol fault controls.
 * Public workers require complete JobGroup handlers, not this fixture service. */
import { Context, Data, Effect, Layer } from "effect"
import type { CatalogIdentity } from "../../../src/JobIdentity.js"
import type { JobHandler } from "../../../src/internal/worker/Handler.js"

/**
 * Typed installation failure for an already registered queue/name/version.
 *
 * @category errors
 */
export class DuplicateJobHandler extends Data.TaggedError(
  "DuplicateJobHandler"
)<CatalogIdentity> {
  override get message(): string {
    return `Handler already installed for ${this.queue}/${this.name}@${this.version}; install one handler per catalog entry`
  }
}

/**
 * Typed catalog validation failure for a repeated queue/name/version.
 *
 * @category errors
 */
export class DuplicateJobCatalogEntry extends Data.TaggedError(
  "DuplicateJobCatalogEntry"
)<CatalogIdentity> {
  override get message(): string {
    return `Duplicate catalog entry ${this.queue}/${this.name}@${this.version}; use a unique queue/name/version`
  }
}

/**
 * Application-local handler installation and exact catalog lookup.
 *
 * @category models
 */
export interface JobRegistryService {
  /** Rejects a second handler for the same queue/name/version. */
  readonly install: (handler: JobHandler) => Effect.Effect<void, DuplicateJobHandler>
  /** Exact catalog lookup; undefined means no handler is installed. */
  readonly find: (catalog: CatalogIdentity) => JobHandler | undefined
}

/**
 * Context service required by definition handler Layers and worker construction.
 *
 * @category models
 */
export class JobRegistry extends Context.Service<JobRegistry, JobRegistryService>()(
  "tests/protocol/JobRegistry"
) {}

const key = (catalog: CatalogIdentity) =>
  `${catalog.queue}\u0000${catalog.name}\u0000${catalog.version}`

/**
 * Builds a fresh registry per Layer acquisition. Reuse the same Layer reference for
 * workers and handler installation so they share one registry; starts no fibers.
 *
 * @category layers
 */
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
          name: handler.catalog.name,
          version: handler.catalog.version
        })
        handlers.set(catalogKey, Object.freeze({ catalog, execute: handler.execute }))
        return Effect.void
      }),
    find: (catalog) => handlers.get(key(catalog))
  })
})

/**
 * Catalog identity accepted by worker configuration; job definitions satisfy this port.
 *
 * @category models
 */
export interface CatalogEntry {
  readonly catalog: CatalogIdentity
}

/**
 * Validates unique queue/name/version tuples and freezes a copy, retaining entry types.
 * Fails with DuplicateJobCatalogEntry; creates no global catalog or workers.
 *
 * @category operations
 */
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

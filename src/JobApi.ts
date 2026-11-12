/** Pure immutable catalogs of job contracts. Imports and assembly start no work. */
import { Context, Data, Pipeable, Schema } from "effect"
import type { Definitions, InstalledHandlers } from "./JobGroup.js"
import { OperationName, JobName, JobVersion } from "./JobIdentity.js"

/** Existential group view; concrete catalogs preserve each original group type. */
export interface Group {
  readonly name: string
  readonly definitions: Definitions
  readonly handlers: Context.Key<unknown, InstalledHandlers<Definitions>>
}

/** Groups keyed by their declaration names, independent of durable job identity. */
export type Groups = Readonly<Record<string, Group>>

/** Invalid catalog assembly; diagnostics never include payloads. */
export class InvalidJobApi extends Data.TaggedError("InvalidJobApi")<{
  readonly reason:
    | "invalid-name"
    | "duplicate-group"
    | "duplicate-contract"
    | "invalid-group"
}> {}

/** A pipeable declaration; there is no acquisition, registry or finalize step. */
export interface JobApi<Name extends string, G extends Groups> extends Pipeable.Pipeable {
  readonly name: Name
  readonly groups: G
}

const assemble = <Name extends string, G extends Groups>(
  name: Name,
  groups: G
): JobApi<Name, G> =>
  Object.freeze({
    name,
    groups,
    pipe() {
      return Pipeable.pipeArguments(this, arguments)
    }
  })

/** Starts an empty catalog. Workers require at least one runnable definition. */
export const make = <const Name extends string>(name: Name): JobApi<Name, {}> => {
  if (!Schema.is(OperationName)(name)) {
    throw new InvalidJobApi({ reason: "invalid-name" })
  }
  return assemble(name, Object.freeze({}))
}

/** Adds a group without mutating earlier or sibling catalogs. */
export const addGroup =
  <const G extends Group>(group: G) =>
  <Name extends string, Existing extends Groups>(
    self: JobApi<Name, Existing> &
      ([Extract<G["name"], keyof NoInfer<Existing>>] extends [never] ? unknown : never)
  ): JobApi<Name, Existing & { readonly [K in G["name"]]: G }> => {
    if (
      typeof group !== "object" ||
      group === null ||
      typeof group.definitions !== "object" ||
      group.definitions === null ||
      !Context.isKey(group.handlers)
    ) {
      throw new InvalidJobApi({ reason: "invalid-group" })
    }
    if (!Schema.is(OperationName)(group.name)) {
      throw new InvalidJobApi({ reason: "invalid-name" })
    }
    if (Object.hasOwn(self.groups, group.name)) {
      throw new InvalidJobApi({ reason: "duplicate-group" })
    }
    const definitions = Object.entries(group.definitions)
    if (definitions.length === 0 || !group.handlers) {
      throw new InvalidJobApi({ reason: "invalid-group" })
    }
    const prior = Object.values(self.groups).flatMap((entry) =>
      Object.values(entry.definitions)
    )
    for (const entry of definitions) {
      if (
        typeof entry[1] !== "object" ||
        entry[1] === null ||
        !Schema.is(JobName)(entry[1].name) ||
        !Schema.is(JobVersion)(entry[1].version) ||
        !Schema.isSchema(entry[1].payload)
      ) {
        throw new InvalidJobApi({ reason: "invalid-group" })
      }
      if (
        prior.some(
          (job) => job.name === entry[1].name && job.version === entry[1].version
        )
      ) {
        throw new InvalidJobApi({ reason: "duplicate-contract" })
      }
      prior.push(entry[1])
    }
    // Group.make owns its immutable declarations and distinct Context key. Copy
    // only declaration structure here, retaining Schema and installation identity.
    const snapshot = Object.freeze({
      ...group,
      definitions: Object.freeze(
        Object.fromEntries(
          definitions.map((entry) => [entry[0], Object.freeze({ ...entry[1] })])
        )
      )
    })
    return assemble(
      self.name,
      Object.freeze({ ...self.groups, [group.name]: snapshot })
    ) as JobApi<Name, Existing & { readonly [K in G["name"]]: G }>
  }

/** Every declared group's exact installation requirement. Structural TS types
 * cannot distinguish separate same-shaped declarations; runtime keys do. */
export type HandlerServices<G extends Groups> = G extends Groups
  ? {
      [K in keyof G]: G[K]["handlers"] extends Context.Key<infer R, unknown> ? R : never
    }[keyof G]
  : never

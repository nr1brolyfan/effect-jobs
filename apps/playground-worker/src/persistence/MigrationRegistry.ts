// App-owned descriptor registry only. No SQL or automatic migration execution.
export interface MigrationDescriptor {
  readonly id: string
  readonly checksum: string
  readonly sql: string
}
export const migrations: ReadonlyArray<MigrationDescriptor> = Object.freeze([])

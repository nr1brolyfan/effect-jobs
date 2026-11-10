import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { Effect, Layer } from "effect"
import { ReportStorage, ReportStorageUnavailable } from "./ReportWorkflow.js"

// #region storage
// Local example: the application owns this private output directory.
// Atomic replacement prevents readers seeing partial CSV; this is not a cloud
// delivery adapter or a promise of fsync durability on power loss.
export const layer = (directory: string) =>
  Layer.succeed(
    ReportStorage,
    ReportStorage.of({
      put: Effect.fn("Reports.writeFile")(function* (reportId, csv) {
        if (!/^[a-z0-9-]{1,64}$/.test(reportId)) {
          return yield* new ReportStorageUnavailable()
        }
        const target = resolve(directory, `${reportId}.csv`)
        yield* Effect.tryPromise({
          try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
          catch: () => new ReportStorageUnavailable()
        })
        // The acquired unique directory is exclusively owned by this execution.
        yield* Effect.acquireUseRelease(
          Effect.tryPromise({
            try: () => mkdtemp(resolve(directory, ".report-")),
            catch: () => new ReportStorageUnavailable()
          }),
          (temporary) =>
            Effect.gen(function* () {
              const file = join(temporary, "report.csv")
              yield* Effect.tryPromise({
                try: () => writeFile(file, csv, { flag: "wx", mode: 0o600 }),
                catch: () => new ReportStorageUnavailable()
              })
              yield* Effect.tryPromise({
                try: () => rename(file, target),
                catch: () => new ReportStorageUnavailable()
              })
            }),
          (temporary) =>
            Effect.tryPromise({
              try: () => rm(temporary, { recursive: true, force: true }),
              catch: () => new ReportStorageUnavailable()
            }).pipe(Effect.orDie)
        )
      })
    })
  )
// #endregion storage

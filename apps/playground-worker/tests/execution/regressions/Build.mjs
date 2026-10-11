import { build } from "esbuild"
import { resolve } from "node:path"
const root = resolve(process.env.EXECUTOR_SOURCE_ROOT)
await build({
  stdin: {
    contents: `export * as Executor from '${root}/apps/playground-worker/src/execution/Executor.ts';
export * as Authority from '${root}/apps/playground-worker/src/persistence/authority/PostgreSqlAuthority.ts';
export { FakeProvider } from '${root}/apps/playground-worker/src/providers/FakeProvider.ts';
export * as Handlers from '${root}/apps/playground-worker/src/scenarios/Handlers.ts';
export * as Provider from '${root}/apps/playground-worker/src/execution/PostgreSqlProvider.ts';
export { WakeAlarm } from '${root}/apps/playground-worker/src/cloudflare/WakeCycle.ts';
export { JobWorker, JobWorkerUnavailable } from '${root}/src/JobWorker.ts';
export { WorkerCapability } from '${root}/src/internal/worker/Capability.ts';`,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "Actual.mjs",
  external: ["effect", "effect/*"],
  plugins: [
    {
      name: "frozen-source",
      setup(b) {
        b.onResolve({ filter: /^effect-jobs\// }, (a) => ({
          path: resolve(root, "src", a.path.slice("effect-jobs/".length) + ".ts")
        }))
        b.onResolve({ filter: /^@effect-jobs\/playground-contracts\// }, (a) => ({
          path: resolve(
            root,
            "packages/playground-contracts/src",
            a.path.slice("@effect-jobs/playground-contracts/".length) + ".ts"
          )
        }))
      }
    }
  ]
})

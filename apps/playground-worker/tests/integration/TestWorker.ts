// @effect-diagnostics anyUnknownInErrorContext:off
// Standalone test-host FFI: Core's upstream error channel is any.
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Core from "alchemy/Test/Core"
import { Effect, Exit, Scope } from "effect"
import { createInterface } from "node:readline"
import ProductionStack from "../../alchemy.run.js"
import ObservationStack from "../native/ObservationStack.js"

const Stack =
  process.env.NATIVE_HOST_OBSERVE === "true" ? ObservationStack : ProductionStack

const scope = Scope.makeUnsafe("sequential")
const options = {
  providers: Cloudflare.providers(),
  dev: true,
  stage: process.env.NATIVE_HOST_STAGE!,
  sidecar: { omitEnv: ["CLOUDFLARE_"] }
}
const sidecar = Core.makeSidecarHandle(options)
const controller = new AbortController()
let stop!: () => void
const stopped = new Promise<void>((done) => {
  stop = done
})
const requestStop = () => {
  controller.abort()
  stop()
}
const input = createInterface({ input: process.stdin })
input.on("line", requestStop)
input.on("close", requestStop)
process.on("SIGTERM", requestStop)
process.on("SIGINT", requestStop)
try {
  const output = await Effect.runPromise(
    Core.toEffect(Core.makeDeploy(options, scope)(Stack), options, scope, sidecar),
    { signal: controller.signal }
  )
  const origin = process.env.ORIGIN!
  if (!output.url || new URL(output.url).port !== new URL(origin).port) {
    throw new Error("Native output does not match the reserved loopback port")
  }
  let ready = false
  for (let attempt = 0; attempt < 50 && !controller.signal.aborted; attempt++) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) })
      if (response.status === 200) {
        ready = true
        break
      }
    } catch {
      /* Workerd is not listening yet. */
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  if (!ready) {
    throw new Error("Native HTTP readiness failed")
  }
  console.log("NATIVE_HOST_READY " + origin)
  await stopped
} finally {
  try {
    await Core.run(Core.destroy(options, Stack, { scope }), options, scope, sidecar)
  } finally {
    try {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    } finally {
      try {
        if (sidecar) {
          await Effect.runPromise(sidecar.close)
        }
      } finally {
        input.close()
        process.stdin.pause()
        process.off("SIGTERM", requestStop)
        process.off("SIGINT", requestStop)
      }
    }
  }
}

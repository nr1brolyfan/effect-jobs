import { DurableObject } from "cloudflare:workers"
import { Effect } from "effect"
import { probe } from "./Probe.mjs"
import { WakeUnavailable } from "../../src/cloudflare/WakeCycle.js"
export class Probe extends DurableObject {
  async fetch() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const checks = []
      try {
        const result = await Effect.runPromise(
          probe(
            this.env.PG.connectionString,
            "executor_workerd",
            {
              set: (at) =>
                Effect.tryPromise({
                  try: () => this.ctx.storage.setAlarm(at),
                  catch: () => new WakeUnavailable()
                }),
              clear: Effect.tryPromise({
                try: () => this.ctx.storage.deleteAlarm(),
                catch: () => new WakeUnavailable()
              })
            },
            checks
          )
        )
        result.nativeAlarmSet = (await this.ctx.storage.getAlarm()) !== null
        await this.ctx.storage.deleteAlarm()
        return Response.json(result)
      } catch {
        await this.ctx.storage.deleteAlarm()
        return Response.json(
          { status: "FAIL", checks, failure: "bounded executor probe failure" },
          { status: 500 }
        )
      }
    })
  }
  async alarm() {
    await this.ctx.storage.deleteAlarm()
  }
}
export default {
  fetch(request, env) {
    return env.PROBE.get(env.PROBE.idFromName("executor")).fetch(request)
  }
}

import { DurableObject } from "cloudflare:workers"
import { Effect } from "effect"
import * as Wake from "../../src/cloudflare/WakeCycle.js"
import { probe } from "./RealPgProbe.mjs"
export class RealProbe extends DurableObject {
  async fetch() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const checks = []
      try {
        const result = await Effect.runPromise(
          probe(
            this.env.PG.connectionString,
            "cf_workerd",
            {
              set: (at) =>
                Effect.tryPromise({
                  try: () => this.ctx.storage.setAlarm(at),
                  catch: () => new Wake.WakeUnavailable()
                }),
              clear: Effect.tryPromise({
                try: () => this.ctx.storage.deleteAlarm(),
                catch: () => new Wake.WakeUnavailable()
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
          {
            postgres: "FAIL",
            checks,
            reason: "sanitized probe failure; inspect bounded check receipt"
          },
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
    return env.PROBE.get(env.PROBE.idFromName("real-pg")).fetch(request)
  }
}

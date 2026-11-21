import { DurableObject } from "cloudflare:workers"
import { qualify, drain } from "./Transaction.mjs"

export class Probe extends DurableObject {
  async produce() {
    await qualify(this.env.DB.connectionString)
    await this.ctx.storage.setAlarm(Date.now())
  }
  async alarm() {
    await drain(this.env.DB.connectionString)
    await this.ctx.storage.put("drained", true)
  }
  status() {
    return this.ctx.storage.get("drained")
  }
}

export default {
  async fetch(request, env) {
    const stub = env.COORDINATOR.getByName("reports")
    if (new URL(request.url).pathname === "/produce") {
      await stub.produce()
      return new Response("produced")
    }
    return new Response((await stub.status()) ? "drained" : "pending")
  }
}

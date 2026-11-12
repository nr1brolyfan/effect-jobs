import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect } from "effect"
import ApplicationLayer, { InvoiceApplication } from "./src/Application.js"

export default Alchemy.Stack(
  "JobsExample",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState()
  },
  Effect.gen(function* () {
    const application = yield* InvoiceApplication.pipe(Effect.provide(ApplicationLayer))
    return { url: application.url }
  })
)

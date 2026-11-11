import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Output from "alchemy/Output"
import { Effect } from "effect"
import Worker from "./ObservedWorker.js"

export default Alchemy.Stack(
  "effect-jobs-queue-observation",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const worker = yield* Worker
    return {
      url: worker.url,
      namespaces: worker.durableObjectNamespaces.pipe(
        Output.map((namespaces) => Object.keys(namespaces).sort())
      )
    }
  })
)

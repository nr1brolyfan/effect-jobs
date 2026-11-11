import * as Output from "alchemy/Output"
import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect } from "effect"
import LifecycleHost from "./LifecycleHost.js"
import Worker from "../../src/Worker.js"

export default Alchemy.Stack(
  "effect-jobs-native-application",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState()
  },
  Effect.gen(function* () {
    const worker = yield* Worker
    const lifecycle = yield* LifecycleHost
    return {
      url: worker.url,
      lifecycleUrl: lifecycle.url,
      namespaces: worker.durableObjectNamespaces.pipe(
        Output.map((namespaces) => Object.keys(namespaces ?? {}).sort())
      )
    }
  })
)

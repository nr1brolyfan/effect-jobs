import { Effect } from "effect"
import { JobsClient } from "./features/jobs/Adapter.js"
import * as Http from "./integration/HttpClient.js"
import * as View from "./features/jobs/View.js"
import * as Live from "./live/BrowserLive.js"
const root = document.getElementById("jobs")
if (root) {
  const controller = new AbortController()
  void Effect.runPromise(
    document.cookie.includes("__Host-playground-csrf=")
      ? Http.client.describe()
      : Http.issue(),
    { signal: controller.signal }
  ).then(
    (sandbox) => {
      let generation = sandbox.ref.generation
      let live: ReturnType<typeof Live.start> | undefined
      const view = View.mount(root, Http.client, sandbox, {
        poll: false,
        changed: (state) => {
          if (live && state.sandbox.ref.generation !== generation) {
            generation = state.sandbox.ref.generation
            live.dispose()
            live = connect(state.sandbox)
            live?.setVisible(document.visibilityState !== "hidden")
          }
        }
      })
      const connect = (current: typeof sandbox) =>
        Live.start({
          sandbox: current,
          url: `${location.origin.replace("https:", "wss:").replace("http:", "ws:")}/api/changes`,
          snapshot: () =>
            view.controller.refresh.pipe(
              Effect.provideService(JobsClient, Http.client),
              Effect.map(() => view.controller.snapshot())
            ),
          render: () => undefined,
          unavailable: () => view.controller.connection("stale")
        })
      live = connect(sandbox)
      const visible = () => live?.setVisible(document.visibilityState !== "hidden")
      document.addEventListener("visibilitychange", visible)
      visible()
      window.addEventListener(
        "pagehide",
        () => {
          document.removeEventListener("visibilitychange", visible)
          live?.dispose()
          view.dispose()
          controller.abort()
        },
        { once: true }
      )
    },
    () => {
      root.textContent = "Sandbox unavailable. Reload to reconcile authority."
    }
  )
}

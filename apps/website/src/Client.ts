import { Effect, Schedule } from "effect"
import { JobsClient } from "./features/jobs/Adapter.js"
import * as Http from "./integration/HttpClient.js"
import * as View from "./features/jobs/View.js"
import * as Live from "./live/BrowserLive.js"
const root = document.getElementById("jobs")
if (root) {
  const demo = location.pathname === "/demo"
  const client = demo ? Http.demoClient : Http.client
  if (demo) {
    root.textContent = "Preparing public demo…"
  }
  const controller = new AbortController()
  void Effect.runPromise(
    demo
      ? client
          .describe()
          .pipe(
            Effect.retry({ times: 30, schedule: Schedule.spaced("1 second") }),
            Effect.timeout("45 seconds")
          )
      : document.cookie.includes(`${Http.csrfCookieName}=`)
        ? Http.client
            .describe()
            .pipe(
              Effect.catch((error) =>
                error.code === "not-found" || error.code === "sandbox-expired"
                  ? Http.issue()
                  : Effect.fail(error)
              )
            )
        : Http.issue(),
    { signal: controller.signal }
  ).then(
    (sandbox) => {
      let identity = `${sandbox.ref.sandboxId}:${sandbox.ref.generation}`
      let live: ReturnType<typeof Live.start> | undefined
      const view = View.mount(root, client, sandbox, {
        poll: false,
        demo,
        changed: (state) => {
          const next = `${state.sandbox.ref.sandboxId}:${state.sandbox.ref.generation}`
          if (live && next !== identity) {
            identity = next
            live.dispose()
            live = connect(state.sandbox)
            live?.setVisible(document.visibilityState !== "hidden")
          }
        }
      })
      const connect = (current: typeof sandbox) =>
        Live.start({
          sandbox: current,
          url: `${location.origin.replace("https:", "wss:").replace("http:", "ws:")}/api/${demo ? "demo/" : ""}changes`,
          snapshot: () =>
            view.controller.refresh.pipe(
              Effect.provideService(JobsClient, client),
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
      root.textContent = demo
        ? "Public demo unavailable. Please reload to retry."
        : "Sandbox unavailable. Reload to reconcile authority."
    }
  )
}

import { Effect, Schedule } from "effect"
import * as Http from "./integration/HttpClient.js"
import * as Mount from "./features/jobs/Mount.js"
const root = document.getElementById("jobs")
if (root) {
  const demo = location.pathname === "/demo"
  const client = demo ? Http.demoClient : Http.client
  if (demo) {
    root.textContent = "Preparing public demo…"
  }
  const controller = new AbortController()
  window.addEventListener("pagehide", () => controller.abort(), { once: true })
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
      if (controller.signal.aborted) {
        return
      }
      const view = Mount.mount(root, client, sandbox, {
        demo,
        liveUrl: `${location.origin.replace("https:", "wss:").replace("http:", "ws:")}/api/${demo ? "demo/" : ""}changes`
      })
      window.addEventListener(
        "pagehide",
        () => {
          controller.abort()
          void view.dispose()
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

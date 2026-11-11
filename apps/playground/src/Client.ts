import "./styles/Jobs.css"
import { Effect, Schedule } from "effect"
import * as Http from "./integration/HttpClient.js"
import * as Mount from "./features/jobs/Mount.js"

const root = document.getElementById("jobs")
if (root) {
  const demo =
    location.pathname === "/demo" || location.pathname.startsWith("/demo/jobs/")
  const client = demo ? Http.demoClient : Http.client
  if (demo) {
    root.textContent = "Preparing public demo…"
  }
  const pagehide = Effect.callback<never>((resume) => {
    const interrupt = () => resume(Effect.interrupt)
    window.addEventListener("pagehide", interrupt, { once: true })
    return Effect.sync(() => window.removeEventListener("pagehide", interrupt))
  })
  const bootstrap = Effect.gen(function* () {
    const authority = demo
      ? client
          .describe()
          .pipe(
            Effect.retry({ times: 30, schedule: Schedule.spaced("1 second") }),
            Effect.timeout("45 seconds")
          )
      : document.cookie.includes(`${Http.csrfCookieName}=`)
        ? client
            .describe()
            .pipe(
              Effect.catch((error) =>
                error.code === "not-found" || error.code === "sandbox-expired"
                  ? Http.issue()
                  : Effect.fail(error)
              )
            )
        : Http.issue()
    // The bootstrap listener ends on mount. Mount owns the dashboard pagehide
    // listener and StrictMode lifetimes after this synchronous handoff.
    yield* authority.pipe(
      Effect.tap((sandbox) =>
        Effect.sync(() => {
          Mount.mount(root, client, sandbox, {
            demo,
            liveUrl: `${location.origin.replace("https:", "wss:").replace("http:", "ws:")}/api/${demo ? "demo/" : ""}changes`
          })
        })
      ),
      Effect.catch(() =>
        Effect.sync(() => {
          root.textContent = demo
            ? "Public demo unavailable. Please reload to retry."
            : "Sandbox unavailable. Reload to reconcile authority."
        })
      )
    )
  }).pipe(Effect.raceFirst(pagehide))
  Effect.runFork(bootstrap)
}

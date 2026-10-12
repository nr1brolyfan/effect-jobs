import { RegistryContext } from "@effect/atom-react"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { Client } from "./Adapter.js"
import { Dashboard } from "./Dashboard.js"
import * as Runtime from "./Runtime.js"

export const mount = (
  root: HTMLElement,
  client: Client,
  sandbox: SandboxView,
  options: Runtime.Options = {}
) => {
  let current: Runtime.Runtime | undefined
  const cleanups = new Set<Promise<void>>()
  const Session = () => {
    const [runtime, setRuntime] = useState<Runtime.Runtime>()
    useEffect(() => {
      const next = Runtime.make(client, sandbox, options)
      current = next
      setRuntime(next)
      return () => {
        if (current === next) {
          current = undefined
        }
        const closing = next.dispose()
        cleanups.add(closing)
        void closing.finally(() => cleanups.delete(closing))
      }
    }, [])
    return runtime ? (
      <RegistryContext.Provider value={runtime.registry}>
        <Dashboard runtime={runtime} demo={options.demo === true} />
      </RegistryContext.Provider>
    ) : (
      <p role="status">Preparing dashboard…</p>
    )
  }
  const reactRoot = createRoot(root)
  reactRoot.render(
    <StrictMode>
      <Session />
    </StrictMode>
  )
  const dispose = async () => {
    window.removeEventListener("pagehide", pagehide)
    reactRoot.unmount()
    await Promise.all(cleanups)
  }
  const pagehide = () => {
    void dispose()
  }
  window.addEventListener("pagehide", pagehide, { once: true })
  return {
    get runtime() {
      if (!current) {
        throw new Error("Dashboard is not mounted")
      }
      return current
    },
    dispose
  }
}

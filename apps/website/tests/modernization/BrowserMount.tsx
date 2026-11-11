import { createRoot, type Root } from "react-dom/client"
import { act, type ReactNode } from "react"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// The provider owns the browser; this helper owns only this test's React root.
export const mount = async (content: ReactNode) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root: Root = createRoot(container)
  await act(async () => root.render(content))
  return {
    container,
    dispose: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

import { Effect, Exit } from "effect"
import { client } from "../src/integration/HttpClient.js"

declare global {
  interface Window {
    httpProof: {
      start: () => void
      cancel: () => Promise<boolean>
      bodyStarted: () => boolean
      aborted: () => boolean
      renders: () => number
    }
  }
}

// Observe actual browser fetch/json without replacing the native network/body.
const nativeFetch = globalThis.fetch.bind(globalThis)
let bodyStarted = false
let signal: AbortSignal | null | undefined
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, options?: RequestInit) => {
    signal = options?.signal
    const response = await nativeFetch(input, options)
    const json = response.json.bind(response)
    response.json = () => {
      bodyStarted = true
      return json()
    }
    return response
  },
  globalThis.fetch
)
let controller = new AbortController()
let result = Promise.resolve(false)
let renders = 0
window.httpProof = {
  start: () => {
    controller = new AbortController()
    result = Effect.runPromiseExit(
      client.describe().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            renders++
            document.getElementById("result")!.textContent = "late success"
          })
        )
      ),
      { signal: controller.signal }
    ).then(Exit.isFailure)
  },
  cancel: () => {
    controller.abort()
    return result
  },
  bodyStarted: () => bodyStarted,
  aborted: () => signal?.aborted === true,
  renders: () => renders
}

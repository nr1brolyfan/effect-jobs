import { createRequire } from "node:module"
import { resolve } from "node:path"
import type { Server } from "node:http"

export interface FixtureSocket {
  send: (data: string) => void
  close: () => void
  terminate: () => void
  on: (event: "message" | "close", listener: (data: Buffer) => void) => void
}
interface FixtureServer {
  clients: Set<FixtureSocket>
  on: (event: "connection", listener: (socket: FixtureSocket) => void) => void
  close: (callback: (error?: Error) => void) => void
}
// Test transport FFI resolves the already installed Miniflare dependency graph.
// This is the subset of ws used by these HTTP/browser fixtures, not an app host.
const require = createRequire(resolve("apps/playground-worker/package.json"))
export const { WebSocketServer } = createRequire(require.resolve("miniflare"))("ws") as {
  WebSocketServer: new (options: { server: Server }) => FixtureServer
}

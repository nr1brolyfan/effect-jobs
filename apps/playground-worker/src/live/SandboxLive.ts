import { Effect, Schema } from "effect"
import {
  SandboxRef,
  SandboxView,
  limits
} from "@effect-jobs/playground-contracts/Sandbox"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { Ack, liveLimits, sameSandbox } from "../../../website/src/live/Protocol.js"
import * as OriginPolicy from "../../../website/src/OriginPolicy.js"

// Narrow Cloudflare FFI ports. No SDK, pool, timer or service starts on import.
export interface HibernatingSocket {
  readonly readyState: number
  send(message: string): void
  close(code: number, reason: string): void
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
export interface LiveState {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put(key: string, value: unknown): Promise<void>
    getAlarm(): Promise<number | null>
    setAlarm(at: number): Promise<void>
    deleteAlarm(): Promise<void>
  }
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  acceptWebSocket(socket: HibernatingSocket): void
  getWebSockets(): Array<HibernatingSocket>
}
declare const WebSocketPair: new () => { 0: HibernatingSocket; 1: HibernatingSocket }

const Attachment = Schema.Struct({
  sandbox: SandboxRef,
  expiresAt: SandboxView.fields.expiresAt,
  sequence: Ack.fields.sequence,
  sentAt: Schema.Number,
  pending: Schema.Boolean
})
const decodeAttachment = Schema.decodeUnknownSync(Attachment, {
  onExcessProperty: "error"
})

export interface LiveOptions<Env> {
  readonly origin: (env: Env) => string
  readonly localPreview?: (env: Env) => boolean
  // HTTP composition authenticates the cookie and returns ONLY trusted authority.
  readonly authorize: (
    request: Request,
    env: Env
  ) => Effect.Effect<SandboxView, PlaygroundError>
  // Current authority/generation check. Fail closed on errors, not a jobs query.
  readonly isCurrent: (
    sandbox: SandboxRef,
    env: Env
  ) => Effect.Effect<boolean, PlaygroundError>
}

export const makeDurableObject = <Env, State extends LiveState>(
  options: LiveOptions<Env>,
  Base: new (ctx: State, env: Env) => object
) =>
  class SandboxLive extends Base {
    private scope: SandboxRef | undefined
    constructor(
      private readonly ctx: State,
      private readonly env: Env
    ) {
      super(ctx, env)
      void ctx.blockConcurrencyWhile(async () => {
        this.scope = await ctx.storage.get<SandboxRef>("scope")
      })
    }

    // Cloudflare callbacks are Promise/throwing FFI; Effect authority is run here.
    async fetch(request: Request): Promise<Response> {
      const policy = OriginPolicy.make({
        configuredOrigin: options.origin(this.env),
        localPreview: options.localPreview?.(this.env) === true
      })
      if (
        request.url.length > 4096 ||
        request.method !== "GET" ||
        request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
        !policy.matches(new URL(request.url).origin, request.headers.get("Origin"))
      ) {
        return Response.json({ code: "invalid-request" }, { status: 400 })
      }
      const authorized = await Effect.runPromise(
        options.authorize(request, this.env).pipe(
          Effect.timeout("2 seconds"),
          Effect.flatMap((view) =>
            Schema.decodeUnknownEffect(SandboxView)(view, { onExcessProperty: "error" })
          ),
          Effect.match({ onFailure: () => undefined, onSuccess: (view) => view })
        )
      ).catch(() => undefined)
      if (!authorized || authorized.expiresAt <= Date.now()) {
        return Response.json({ code: "sandbox-expired" }, { status: 403 })
      }
      // Admission and scope initialization stay serial across authorization awaits.
      return this.ctx.blockConcurrencyWhile(async () => {
        if (this.scope && !sameSandbox(this.scope, authorized.ref)) {
          return Response.json({ code: "stale-generation" }, { status: 403 })
        }
        if (this.viewers().length >= liveLimits.viewers) {
          return Response.json({ code: "limit-reached" }, { status: 429 })
        }
        if (!this.scope) {
          await this.ctx.storage.put("scope", authorized.ref)
          this.scope = authorized.ref
        }
        const pair = new WebSocketPair()
        pair[1].serializeAttachment({
          sandbox: authorized.ref,
          expiresAt: authorized.expiresAt,
          sequence: 1,
          sentAt: Date.now(),
          pending: true
        })
        this.ctx.acceptWebSocket(pair[1])
        pair[1].send(
          JSON.stringify({
            kind: "ready",
            sandbox: authorized.ref,
            reason: "reconcile",
            sequence: 1
          })
        )
        await this.schedule(
          Math.min(Date.now() + limits.reconciliationMillis, authorized.expiresAt)
        )
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit)
      })
    }

    // Trusted DO RPC only; not routed from public HTTP or WebSocket messages.
    async notifyCommitted(sandbox: SandboxRef): Promise<void> {
      if (
        !this.scope ||
        !sameSandbox(this.scope, sandbox) ||
        this.viewers().length === 0
      ) {
        return
      }
      await this.ctx.storage.put("dirty", true)
      await this.schedule(Date.now() + liveLimits.coalesceMillis)
    }

    async alarm(): Promise<void> {
      const now = Date.now()
      const current =
        this.scope &&
        (await Effect.runPromise(
          options
            .isCurrent(this.scope, this.env)
            .pipe(
              Effect.timeout("2 seconds"),
              Effect.match({ onFailure: () => false, onSuccess: (value) => value })
            )
        ).catch(() => false))
      const dirty = await this.ctx.storage.get<boolean>("dirty")
      // Clear before sends: interleaved post-commit notifications schedule another alarm.
      await this.ctx.storage.put("dirty", false)
      let next = now + limits.reconciliationMillis
      let viewers = 0
      for (const socket of this.viewers()) {
        try {
          const attachment = decodeAttachment(socket.deserializeAttachment())
          if (
            !current ||
            !this.scope ||
            !sameSandbox(attachment.sandbox, this.scope) ||
            attachment.expiresAt <= now
          ) {
            socket.close(4003, "sandbox unavailable")
            continue
          }
          if (attachment.pending && now - attachment.sentAt >= liveLimits.ackMillis) {
            socket.close(4008, "slow viewer")
            continue
          }
          if (!attachment.pending) {
            const sequence = attachment.sequence + 1
            if (!Number.isSafeInteger(sequence)) {
              socket.close(4008, "reconnect required")
              continue
            }
            socket.send(
              JSON.stringify({
                kind: "invalidate",
                sandbox: attachment.sandbox,
                reason: dirty ? "jobs-changed" : "reconcile",
                sequence
              })
            )
            socket.serializeAttachment({
              ...attachment,
              sequence,
              sentAt: now,
              pending: true
            })
          }
          next = Math.min(next, attachment.expiresAt)
          viewers++
        } catch {
          socket.close(4008, "connection unavailable")
        }
      }
      if (viewers > 0) {
        await this.schedule(next)
      } else {
        await this.ctx.storage.deleteAlarm()
      }
    }

    async webSocketMessage(
      socket: HibernatingSocket,
      message: string | ArrayBuffer
    ): Promise<void> {
      try {
        if (typeof message !== "string" || message.length > liveLimits.messageBytes) {
          throw new Error("invalid message")
        }
        const ack = Schema.decodeUnknownSync(Ack, { onExcessProperty: "error" })(
          JSON.parse(message)
        )
        const attachment = decodeAttachment(socket.deserializeAttachment())
        if (
          attachment.expiresAt <= Date.now() ||
          !this.scope ||
          !sameSandbox(attachment.sandbox, this.scope)
        ) {
          socket.close(4003, "sandbox unavailable")
          return
        }
        if (ack.sequence !== attachment.sequence) {
          throw new Error("invalid acknowledgement")
        }
        socket.serializeAttachment({ ...attachment, pending: false })
      } catch {
        socket.close(4008, "invalid message")
      }
    }

    async webSocketClose(socket: HibernatingSocket, code: number): Promise<void> {
      socket.close(code, "closed")
      if (this.viewers().length === 0) {
        await this.ctx.storage.deleteAlarm()
      }
    }
    async webSocketError(socket: HibernatingSocket): Promise<void> {
      await this.webSocketClose(socket, 1011)
    }

    private viewers(): Array<HibernatingSocket> {
      return this.ctx.getWebSockets().filter((socket) => socket.readyState === 1)
    }

    private async schedule(at: number): Promise<void> {
      const existing = await this.ctx.storage.getAlarm()
      if (existing === null || existing > at) {
        await this.ctx.storage.setAlarm(at)
      }
    }
  }

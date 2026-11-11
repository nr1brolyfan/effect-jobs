import * as Cloudflare from "@alchemy.run/cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Clock, Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as HttpRequest from "effect/http/HttpServerRequest"
import * as HttpResponse from "effect/http/HttpServerResponse"
import {
  SandboxRef,
  SandboxView,
  limits
} from "@effect-jobs/playground-contracts/Sandbox"
import {
  Ack,
  liveLimits,
  sameSandbox
} from "@effect-jobs/playground-contracts/LiveProtocol"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
// @effect-diagnostics unstableApiUsage:off
import { SqlClient } from "effect/sql/SqlClient"
import * as OriginPolicy from "../OriginPolicy.js"
import * as Configuration from "../cloudflare/Configuration.js"
import * as DurableWake from "../cloudflare/DurableWake.js"
import * as Event from "../execution/Event.js"
import * as Http from "../server/HttpApplication.js"
import * as DemoHttp from "../demo/Http.js"

const Attachment = Schema.Struct({
  sandbox: SandboxRef,
  expiresAt: SandboxView.fields.expiresAt,
  sequence: Ack.fields.sequence,
  sentAt: Schema.Number,
  pending: Schema.Boolean
})

export const implementation = Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState
  const env = yield* Configuration.configuration
  return Effect.gen(function* () {
    const runtime = yield* RuntimeContext
    const local = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>) =>
      effect.pipe(Effect.provideService(RuntimeContext, runtime))
    const scope = yield* state.storage.get<SandboxRef>("scope")
    let authority = scope
    const viewers = state
      .getWebSockets()
      .pipe(
        Effect.map((sockets) => sockets.filter((socket) => socket.ws.readyState === 1))
      )
    const isCurrent = (ref: SandboxRef) =>
      Event.run(
        Configuration.database(env),
        Effect.void,
        Effect.gen(function* () {
          const sql = yield* SqlClient
          const rows = yield* sql.unsafe(
            `SELECT sandbox_id FROM "${env.SCHEMA}"."sandboxes" WHERE sandbox_id=$1 AND generation=$2 AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint`,
            [ref.sandboxId, ref.generation]
          )
          return rows.length === 1
        })
      ).pipe(
        Effect.timeout("2 seconds"),
        Effect.catchCause(() => Effect.succeed(false))
      )
    const wake = yield* DurableWake.make("live", (alarm) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = authority !== undefined && (yield* isCurrent(authority))
        const dirty = yield* state.storage.get<boolean>("dirty")
        // Clear before sends: a later postcommit hint persists its own wake.
        yield* state.storage.put("dirty", false)
        let next = now + limits.reconciliationMillis
        let count = 0
        for (const socket of yield* viewers) {
          const retained = yield* Effect.gen(function* () {
            const attachment = yield* socket.getAttachment(Attachment)
            if (
              !current ||
              !authority ||
              !sameSandbox(attachment.sandbox, authority) ||
              attachment.expiresAt <= now
            ) {
              yield* socket.close(4003, "sandbox unavailable")
              return false
            }
            if (attachment.pending && now - attachment.sentAt >= liveLimits.ackMillis) {
              yield* socket.close(4008, "slow viewer")
              return false
            }
            if (!attachment.pending) {
              const sequence = attachment.sequence + 1
              if (!Number.isSafeInteger(sequence)) {
                yield* socket.close(4008, "reconnect required")
                return false
              }
              yield* socket.send(
                JSON.stringify({
                  kind: "invalidate",
                  sandbox: attachment.sandbox,
                  reason: dirty ? "jobs-changed" : "reconcile",
                  sequence
                })
              )
              yield* socket.setAttachment(Attachment, {
                ...attachment,
                sequence,
                sentAt: now,
                pending: true
              })
            }
            next = Math.min(next, attachment.expiresAt)
            return true
          }).pipe(
            Effect.catchCause(() =>
              socket.close(4008, "connection unavailable").pipe(Effect.as(false))
            )
          )
          if (retained) {
            count++
          }
        }
        if (count > 0) {
          yield* alarm.set(next)
        } else {
          yield* alarm.clear
        }
      })
    )
    const close = (socket: Cloudflare.WebSocket, code: number) =>
      local(
        Effect.gen(function* () {
          yield* socket.close(code, "closed")
          if ((yield* viewers).length === 0) {
            yield* wake.clear.pipe(Effect.orDie)
          }
        })
      )
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpRequest.toWeb(yield* HttpServerRequest).pipe(
          Effect.orDie
        )
        const policy = OriginPolicy.make({
          configuredOrigin: env.ORIGIN,
          localPreview: env.LOCAL_PREVIEW === "true"
        })
        if (
          request.url.length > 4096 ||
          request.method !== "GET" ||
          request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
          !policy.matches(new URL(request.url).origin, request.headers.get("Origin"))
        ) {
          return HttpResponse.fromWeb(
            Response.json({ code: "invalid-request" }, { status: 400 })
          )
        }
        const authorized = yield* Event.run(
          Configuration.database(env),
          Effect.void,
          new URL(request.url).pathname === "/api/demo/changes"
            ? DemoHttp.readyCurrent(env.SCHEMA).pipe(
                Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
              )
            : Http.authenticate(request, {
                configuredOrigin: env.ORIGIN,
                localPreview: env.LOCAL_PREVIEW === "true"
              }).pipe(Effect.map((access) => access.sandbox))
        ).pipe(
          Effect.timeout("2 seconds"),
          Effect.flatMap(
            Schema.decodeUnknownEffect(SandboxView, { onExcessProperty: "error" })
          ),
          Effect.catchCause(() => Effect.undefined)
        )
        if (!authorized || authorized.expiresAt <= (yield* Clock.currentTimeMillis)) {
          return HttpResponse.fromWeb(
            Response.json({ code: "sandbox-expired" }, { status: 403 })
          )
        }
        return yield* state.blockConcurrencyWhile(() =>
          Effect.gen(function* () {
            if (authority && !sameSandbox(authority, authorized.ref)) {
              return HttpResponse.fromWeb(
                Response.json({ code: "stale-generation" }, { status: 403 })
              )
            }
            if ((yield* viewers).length >= liveLimits.viewers) {
              return HttpResponse.fromWeb(
                Response.json({ code: "limit-reached" }, { status: 429 })
              )
            }
            if (!authority) {
              yield* state.storage.put("scope", authorized.ref)
              authority = authorized.ref
            }
            const [response, socket] = yield* Cloudflare.upgrade()
            const now = yield* Clock.currentTimeMillis
            yield* socket
              .setAttachment(Attachment, {
                sandbox: authorized.ref,
                expiresAt: authorized.expiresAt,
                sequence: 1,
                sentAt: now,
                pending: true
              })
              .pipe(Effect.orDie)
            yield* socket.send(
              JSON.stringify({
                kind: "ready",
                sandbox: authorized.ref,
                reason: "reconcile",
                sequence: 1
              })
            )
            yield* wake
              .earlier(Math.min(now + limits.reconciliationMillis, authorized.expiresAt))
              .pipe(Effect.orDie)
            return response
          })
        )
      }),
      notifyCommitted: (sandbox: SandboxRef) =>
        local(
          state.blockConcurrencyWhile(() =>
            Effect.gen(function* () {
              if (
                !authority ||
                !sameSandbox(authority, sandbox) ||
                (yield* viewers).length === 0
              ) {
                return
              }
              yield* state.storage.put("dirty", true)
              yield* wake
                .earlier((yield* Clock.currentTimeMillis) + liveLimits.coalesceMillis)
                .pipe(Effect.orDie)
            })
          )
        ),
      webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
        Effect.gen(function* () {
          if (typeof message !== "string" || message.length > liveLimits.messageBytes) {
            return yield* Effect.fail("invalid message")
          }
          const ack = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Ack), {
            onExcessProperty: "error"
          })(message)
          const attachment = yield* socket.getAttachment(Attachment)
          if (
            attachment.expiresAt <= (yield* Clock.currentTimeMillis) ||
            !authority ||
            !sameSandbox(attachment.sandbox, authority)
          ) {
            return yield* socket.close(4003, "sandbox unavailable")
          }
          if (ack.sequence !== attachment.sequence) {
            return yield* Effect.fail("invalid acknowledgement")
          }
          yield* socket.setAttachment(Attachment, { ...attachment, pending: false })
        }).pipe(Effect.catchCause(() => socket.close(4008, "invalid message"))),
      webSocketClose: close,
      webSocketError: (socket: Cloudflare.WebSocket) => close(socket, 1011)
    }
  })
})

export class SandboxLive extends Cloudflare.DurableObject<SandboxLive>()(
  "SandboxLive",
  implementation
) {}

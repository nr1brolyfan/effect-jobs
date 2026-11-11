// @effect-diagnostics unstableApiUsage:off
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Test from "alchemy/Test/Bun"
import { Pool } from "pg"
import { migrations } from "../../src/persistence/MigrationRegistry.js"
import WebSocket from "ws"
import { Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { JobPage } from "@effect-jobs/playground-contracts/Jobs"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"
import { Signal } from "@effect-jobs/playground-contracts/LiveProtocol"
import { ScenarioResult } from "@effect-jobs/playground-contracts/Scenarios"
import { afterAll, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import Stack from "./ApplicationStack.js"

const api = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  sidecar: { omitEnv: ["CLOUDFLARE_"] }
})
const pool = new Pool({
  connectionString: process.env.PG_connectionString,
  max: 2,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
})
const databaseReady = api.beforeAll(
  Effect.promise(async () => {
    await pool.query("SELECT 1")
    await pool.query('CREATE SCHEMA "native_application"')
    for (const migration of migrations("native_application")) {
      await pool.query(migration.sql)
    }
  })
)
const stack = api.beforeAll(Effect.andThen(databaseReady, api.deploy(Stack)))
const url = stack.pipe(
  Effect.flatMap((value) => {
    if (value.url === undefined) {
      return Effect.die("Native Worker URL missing")
    }
    const address = new URL(value.url)
    if (address.port !== new URL(process.env.ORIGIN!).port) {
      return Effect.die("Native Worker URL did not match configured loopback port")
    }
    address.hostname = "127.0.0.1"
    return Effect.succeed(address.origin)
  })
)

api.test(
  "serves the actual application through native bindings",
  Effect.gen(function* () {
    const response = yield* HttpClient.get(`${yield* url}/native-ready`).pipe(
      Effect.filterOrFail(
        (response) => response.status === 200,
        () => "native HTTP pending"
      ),
      Effect.retry({ times: 30, schedule: Schedule.spaced("100 millis") })
    )
    expect(yield* response.text).toBe("native application ready")
    const layout = yield* stack
    expect(layout.namespaces).toEqual([
      "Commerce",
      "Communications",
      "DemoGenerator",
      "Gateway",
      "Media",
      "Private",
      "SandboxLive"
    ])
    yield* Effect.promise(() =>
      Bun.write(
        process.env.NATIVE_EVIDENCE_DIRECTORY! + "/native-layout.json",
        JSON.stringify(
          {
            nativeUrl: layout.url,
            testedUrl: process.env.ORIGIN,
            namespaces: layout.namespaces
          },
          null,
          2
        )
      )
    )
  }),
  { timeout: 20000 }
)
const origin = () => process.env.ORIGIN!
const post = (path: string, actor?: Actor, body?: unknown, token?: string) =>
  fetch(origin() + path, {
    method: "POST",
    headers: {
      Origin: origin(),
      "Content-Type": "application/json",
      ...(actor
        ? { Cookie: actor.cookie, "X-Playground-CSRF": token ?? actor.token }
        : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
interface Actor {
  sandbox: SandboxView
  cookie: string
  token: string
}
const issue = async (): Promise<Actor> => {
  const response = await post("/api/sandbox/issue")
  expect(response.status).toBe(200)
  const cookies = response.headers.getSetCookie()
  expect(
    cookies.some(
      (value) => value.includes("HttpOnly") && value.includes("SameSite=Strict")
    )
  ).toBe(true)
  return {
    sandbox: Schema.decodeUnknownSync(SandboxView)(await response.json()),
    cookie: cookies.map((value) => value.split(";")[0]).join("; "),
    token: cookies
      .find((value) => value.startsWith(Cookies.names(origin(), true).csrf + "="))!
      .split(";")[0]!
      .split("=")[1]!
  }
}
const waitUntil = async (
  predicate: () => Promise<boolean>,
  label: string,
  timeout = 15000
) => {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(label)
    }
    await Bun.sleep(100)
  }
}
const query = (actor: Actor) =>
  `/api/jobs?sandboxId=${actor.sandbox.ref.sandboxId}&generation=${actor.sandbox.ref.generation}&limit=50`
const connect = async (
  actor: Actor,
  address = origin().replace("http:", "ws:") + "/api/changes"
) => {
  const socket = new WebSocket(address, {
    headers: { Cookie: actor.cookie, Origin: origin() }
  })
  const frames: Array<Signal> = []
  let closed: number | undefined
  let failure: Error | undefined
  socket.on("message", (data) => {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : data
    const signal = Schema.decodeUnknownSync(Signal, { onExcessProperty: "error" })(
      JSON.parse(bytes.toString("utf8"))
    )
    frames.push(signal)
    socket.send(JSON.stringify({ kind: "ack", sequence: signal.sequence }))
  })
  socket.on("close", (code) => {
    closed = code
  })
  socket.on("error", (error) => {
    failure = error
  })
  await waitUntil(async () => {
    if (failure) {
      throw failure
    }
    return frames.length > 0
  }, "native socket admission")
  return { socket, frames, closed: () => closed }
}
api.test(
  "preserves actual PG authority, postcommit hints, queues and generation fencing",
  Effect.promise(async () => {
    const owner = await issue()
    const foreign = await issue()
    expect((await post("/api/scenarios", owner, {}, "wrong")).status).toBe(400)
    expect(
      (await fetch(origin() + query(owner), { headers: { Cookie: foreign.cookie } }))
        .status
    ).toBe(404)
    expect(
      (
        await fetch(origin() + "/api/demo/control", {
          method: "POST",
          headers: { Origin: origin() }
        })
      ).status
    ).toBe(404)
    const peer = await connect(owner)
    try {
      expect(peer.frames[0]).toMatchObject({
        kind: "ready",
        sandbox: owner.sandbox.ref,
        sequence: 1
      })
      const command = {
        sandbox: owner.sandbox.ref,
        requestId: "native-atomic",
        scenario: "success",
        count: 6
      }
      const response = await post("/api/scenarios", owner, command)
      expect(response.status).toBe(200)
      const result = Schema.decodeUnknownSync(ScenarioResult)(await response.json())
      expect(result._tag).toBe("Committed")
      if (result._tag !== "Committed") {
        throw new Error("native commit not acknowledged")
      }
      const receipt = await post("/api/scenarios/receipt", owner, {
        sandbox: owner.sandbox.ref,
        requestId: command.requestId
      })
      expect(await receipt.json()).toEqual(result)
      const counts = await pool.query(
        `SELECT (SELECT count(*) FROM native_application.associations WHERE sandbox_id=$1 AND job_id=ANY($2))::int AS jobs, (SELECT count(*) FROM native_application.command_receipts WHERE sandbox_id=$1 AND request_id=$3)::int AS receipts`,
        [owner.sandbox.ref.sandboxId, result.jobIds, command.requestId]
      )
      expect(counts.rows[0]).toEqual({ jobs: 6, receipts: 1 })
      await waitUntil(
        async () => peer.frames.some((frame) => frame.reason === "jobs-changed"),
        "postcommit dirty hint"
      )
      await waitUntil(
        async () =>
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM native_application.jobs WHERE id=ANY($1) AND state='Completed'",
              [result.jobIds]
            )
          ).rows[0].n === 6,
        "four native queue callbacks did not complete"
      )
      const projection = Schema.decodeUnknownSync(JobPage)(
        await (
          await fetch(origin() + query(owner), { headers: { Cookie: owner.cookie } })
        ).json()
      )
      expect(JSON.stringify(projection)).not.toMatch(
        /ciphertext|fingerprint|payload|leaseToken|synthetic private export/
      )
      expect(
        result.jobIds.every((id) => projection.items.some((job) => job.jobId === id))
      ).toBe(true)
      expect(new Set(peer.frames.map((frame) => frame.sequence)).size).toBe(
        peer.frames.length
      )
      const reset = await post("/api/sandbox/reset", owner, {
        sandbox: owner.sandbox.ref,
        requestId: "native-reset"
      })
      expect(reset.status).toBe(200)
      await waitUntil(
        async () => peer.closed() === 4003,
        "old generation socket was not revoked"
      )
      expect(
        (await fetch(origin() + query(owner), { headers: { Cookie: owner.cookie } }))
          .status
      ).toBe(409)
    } finally {
      if (peer.socket.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          peer.socket.once("close", () => resolve())
          peer.socket.close()
        })
      }
    }
    const viewers: Array<Awaited<ReturnType<typeof connect>>> = []
    try {
      for (let i = 0; i < 16; i++) {
        viewers.push(await connect(foreign))
      }
      const denied = await connect(foreign).then(
        () => false,
        () => true
      )
      expect(denied).toBe(true)
      viewers[0]!.socket.send(JSON.stringify({ kind: "ack", sequence: 0 }))
      viewers[1]!.socket.send("x".repeat(1025))
      await waitUntil(
        async () => viewers[0]!.closed() === 4008 && viewers[1]!.closed() === 4008,
        "invalid ACK/message bounds"
      )
      await pool.query(
        "UPDATE native_application.sandboxes SET expires_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1 WHERE sandbox_id=$1",
        [foreign.sandbox.ref.sandboxId]
      )
      await waitUntil(
        async () => viewers.slice(2).every((viewer) => viewer.closed() === 4003),
        "native viewer expiry"
      )
    } finally {
      await Promise.all(
        viewers
          .filter((viewer) => viewer.socket.readyState === WebSocket.OPEN)
          .map(
            (viewer) =>
              new Promise<void>((resolve) => {
                viewer.socket.once("close", () => resolve())
                viewer.socket.close()
              })
          )
      )
    }
  }),
  { timeout: 45000 }
)

api.test(
  "hibernates the production live implementation with retained socket attachments",
  Effect.gen(function* () {
    const base = (yield* stack).lifecycleUrl
    if (!base) {
      return yield* Effect.die("Native lifecycle URL missing")
    }
    const address = base.replace("localhost", "127.0.0.1")
    yield* Effect.promise(async () => {
      const actor = await issue()
      const peer = await connect(actor, address.replace("http:", "ws:") + "/probe/socket")
      try {
        const before = await (await fetch(address + "/probe/activation")).text()
        await Bun.sleep(12000)
        const afterIdle = await (await fetch(address + "/probe/activation")).text()
        expect(afterIdle).not.toBe(before)
        expect(peer.closed()).toBeUndefined()
        const previousFrames = peer.frames.length
        await waitUntil(
          async () => peer.frames.length > previousFrames,
          "native attachment sequence did not survive reconstruction"
        )
        expect(peer.frames.at(-1)!.sandbox).toEqual(actor.sandbox.ref)
      } finally {
        if (peer.socket.readyState === WebSocket.OPEN) {
          await new Promise<void>((resolve) => {
            peer.socket.once("close", () => resolve())
            peer.socket.close()
          })
        }
      }
    })
  }),
  { timeout: 30000 }
)

api.test(
  "closes actual per-call PG resources on success, defect and interrupted SQL",
  Effect.gen(function* () {
    const base = (yield* stack).lifecycleUrl
    if (!base) {
      return yield* Effect.die("Native lifecycle URL missing")
    }
    for (const path of ["/success", "/defect", "/interruption"]) {
      const result = yield* HttpClient.get(
        base.replace("localhost", "127.0.0.1") + path
      ).pipe(Effect.flatMap((response) => response.text))
      expect(result).toBe(path === "/success" ? "closed-success" : "closed-failure")
      const remaining = yield* Effect.promise(() =>
        pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='native-lifecycle-probe'"
        )
      )
      expect(remaining.rows[0].n).toBe(0)
    }
  }),
  { timeout: 15000 }
)
api.test(
  "keeps successful durable wake passes running beyond the retry budget",
  Effect.gen(function* () {
    const base = (yield* stack).lifecycleUrl
    if (!base) {
      return yield* Effect.die("Native lifecycle URL missing")
    }
    const address = base.replace("localhost", "127.0.0.1")
    yield* HttpClient.get(address + "/wake/start")
    const final = yield* HttpClient.get(address + "/wake/passes").pipe(
      Effect.flatMap((response) => response.text),
      Effect.filterOrFail(
        (text) => text === "12",
        () => "bounded wake passes pending"
      ),
      Effect.retry({ times: 40, schedule: Schedule.spaced("100 millis") })
    )
    expect(final).toBe("12")
  }),
  { timeout: 15000 }
)
api.afterAll(
  api.destroy(Stack).pipe(
    Effect.andThen(
      Effect.promise(async () => {
        const active = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"
        )
        expect(active.rows[0].n).toBe(0)
      })
    )
  )
)
queueMicrotask(() => afterAll(() => pool.end()))

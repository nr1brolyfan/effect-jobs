import { randomBytes, randomUUID } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import pg from "pg"
import { migration } from "./Scenario.mjs"

const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim()

export const createFixture = async () => {
  mkdirSync("/tmp/opencode", { recursive: true })
  const directory = mkdtempSync("/tmp/opencode/effect-jobs-worker-crash-")
  const token = randomUUID()
  const name = `effect-jobs-worker-crash-${token}`
  const environment = join(directory, "postgres.env")
  const privateFile = join(directory, "private.json")
  const password = randomBytes(24).toString("hex")
  const children = new Set()
  let container
  let pool
  const removeContainer = () => {
    let inspection
    try {
      inspection = JSON.parse(docker("inspect", container ?? name))[0]
    } catch (error) {
      if (
        !(error.status === 1 && /No such (object|container)/.test(String(error.stderr)))
      ) {
        throw new Error("Cannot establish owned container state")
      }
    }
    if (inspection) {
      if (inspection.Config?.Labels?.["effect-jobs.crash.owner"] !== token) {
        throw new Error("Refusing foreign container removal")
      }
      docker("rm", "--force", "--volumes", inspection.Id)
    }
  }
  const signal = () => {
    for (const child of children) {
      child.process.kill("SIGKILL")
    }
    try {
      removeContainer()
    } finally {
      process.exitCode = 1
    }
  }
  const close = async () => {
    for (const child of children) {
      await child.kill()
    }
    await pool?.end()
    let removed = false
    try {
      removeContainer()
      removed = true
    } finally {
      for (const path of [environment, privateFile]) {
        try {
          unlinkSync(path)
        } catch (error) {
          if (error.code !== "ENOENT") {
            process.exitCode = 1
          }
        }
      }
      process.removeListener("SIGINT", signal)
      process.removeListener("SIGTERM", signal)
      writeFileSync(
        join(directory, "resource.json"),
        JSON.stringify({ name, ownedContainerRemoved: removed })
      )
    }
  }
  process.once("SIGINT", signal)
  process.once("SIGTERM", signal)
  try {
    const image = JSON.parse(docker("image", "inspect", "postgres:16.15-alpine"))[0]
    writeFileSync(
      environment,
      `POSTGRES_USER=crash_admin\nPOSTGRES_DB=effect_jobs_crash\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 }
    )
    container = docker(
      "create",
      "--pull=never",
      "--name",
      name,
      "--label",
      `effect-jobs.crash.owner=${token}`,
      "--publish",
      "127.0.0.1::5432",
      "--cpus",
      "2",
      "--memory",
      "1g",
      "--shm-size",
      "256m",
      "--env-file",
      environment,
      "postgres:16.15-alpine"
    )
    docker("start", container)
    const inspection = JSON.parse(docker("inspect", container))[0]
    const binding = inspection.NetworkSettings.Ports["5432/tcp"][0]
    if (
      inspection.Config?.Labels?.["effect-jobs.crash.owner"] !== token ||
      binding.HostIp !== "127.0.0.1"
    ) {
      throw new Error("Invalid container ownership/binding")
    }
    const connection = {
      host: "127.0.0.1",
      port: Number(binding.HostPort),
      database: "effect_jobs_crash",
      user: "crash_admin",
      password,
      connectionTimeoutMillis: 1000,
      statement_timeout: 2000,
      query_timeout: 3000,
      idle_in_transaction_session_timeout: 5000
    }
    pool = new pg.Pool({ ...connection, max: 2 })
    const deadline = Date.now() + 30000
    for (;;) {
      try {
        await pool.query("SELECT 1")
        break
      } catch {
        if (Date.now() >= deadline) {
          throw new Error("PostgreSQL startup deadline")
        }
        await delay(100)
      }
    }
    await pool.query("CREATE SCHEMA crash_fixture; CREATE SCHEMA crash_provider")
    await pool.query(migration)
    await pool.query(`CREATE TABLE crash_provider.effects (idempotency_key text PRIMARY KEY, requests integer NOT NULL);
      CREATE ROLE crash_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      GRANT USAGE ON SCHEMA crash_fixture,crash_provider TO crash_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA crash_fixture,crash_provider TO crash_runtime`)
    writeFileSync(privateFile, JSON.stringify({ connection }), { mode: 0o600 })
    writeFileSync(
      join(directory, "metadata.json"),
      JSON.stringify({
        imageId: image.Id,
        node: process.version,
        server: (await pool.query("SHOW server_version")).rows[0].server_version
      })
    )
    const startWorker = (hold = false) => {
      const messages = []
      const process = spawn(
        globalThis.process.execPath,
        [
          fileURLToPath(new URL("Worker.mjs", import.meta.url)),
          privateFile,
          hold ? "hold" : "complete"
        ],
        {
          stdio: ["ignore", "ignore", "ignore", "ipc"]
        }
      )
      process.on("message", (message) => messages.push(message))
      process.on("error", () => messages.push({ type: "failed" }))
      const closed = new Promise((resolve) => {
        process.once("close", (code, signal) => resolve({ code, signal }))
      })
      const child = {
        process,
        messages,
        closed,
        kill: async () => {
          if (process.exitCode === null && process.signalCode === null) {
            process.kill("SIGKILL")
          }
          await closed
          children.delete(child)
        }
      }
      children.add(child)
      return child
    }
    return { pool, connection, directory, close, startWorker }
  } catch (error) {
    await close()
    throw error
  }
}

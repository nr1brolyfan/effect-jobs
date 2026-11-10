import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import pg from "pg"
import { readQualificationResource } from "../qualification/Resource.mjs"
import { assertComplete } from "./MatrixReport.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const runtime = process.argv[2]
assert(
  ["node", "bun", "all"].includes(runtime) && process.argv.length === 3,
  "Usage: node tests/postgresql/Matrix.mjs node|bun|all"
)
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim()
const image = "postgres:16.15-alpine"
const removePrivateFile = (path) => {
  try {
    unlinkSync(path)
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error
    }
  }
}
mkdirSync("/tmp/opencode", { recursive: true })

for (const selected of runtime === "all" ? ["node", "bun"] : [runtime]) {
  const directory = mkdtempSync("/tmp/opencode/effect-jobs-pg-matrix-")
  const evidence = process.env.PG_MATRIX_EVIDENCE_DIRECTORY
    ? join(process.env.PG_MATRIX_EVIDENCE_DIRECTORY, selected)
    : join(directory, "reports")
  mkdirSync(evidence, { recursive: true })
  const owner = randomUUID()
  const name = `effect-jobs-pg-matrix-${owner}`
  const labels = {
    project: "52ccc13e-4995-4a3f-be37-6f4cf6bebe3e",
    owner,
    issue: "postgresql-runtime-matrix",
    deadline: new Date(Date.now() + 10 * 60000).toISOString()
  }
  const environment = join(directory, "postgres.env")
  const operators = join(directory, "operators.json")
  const password = randomBytes(24).toString("hex")
  let child
  let interrupted = false
  const signal = () => {
    interrupted = true
    child?.kill("SIGKILL")
  }
  process.once("SIGINT", signal)
  process.once("SIGTERM", signal)
  let removed = false
  const removeContainer = () => {
    let actual
    try {
      actual = JSON.parse(docker("inspect", name))[0]
    } catch (error) {
      if (
        !(error.status === 1 && /No such (object|container)/.test(String(error.stderr)))
      ) {
        throw error
      }
    }
    if (actual) {
      assert.equal(
        actual.Config.Labels.owner,
        owner,
        "Refusing foreign container removal"
      )
      assert.equal(actual.Config.Labels.project, labels.project)
      docker("rm", "--force", "--volumes", actual.Id)
    }
  }
  try {
    writeFileSync(
      environment,
      `POSTGRES_USER=matrix_admin\nPOSTGRES_DB=effect_jobs_d6\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 }
    )
    const container = docker(
      "create",
      "--pull=never",
      "--name",
      name,
      ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
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
      image
    )
    docker("start", container)
    const actual = JSON.parse(docker("inspect", container))[0]
    writeFileSync(
      join(directory, "ownership.json"),
      JSON.stringify({
        container_id: container,
        labels,
        deadline: labels.deadline,
        image: actual.Image,
        ports: actual.NetworkSettings.Ports
      })
    )
    const ownership = readQualificationResource(directory)
    const connection = {
      host: "127.0.0.1",
      port: Number(ownership.ports["5432/tcp"][0].HostPort),
      user: "matrix_admin",
      database: "effect_jobs_d6",
      password
    }
    writeFileSync(operators, JSON.stringify(connection), { mode: 0o600 })
    const deadline = Date.now() + 30000
    for (;;) {
      assert(!interrupted, "Matrix interrupted")
      // The suites connect through the host mapping, not the container's socket.
      const client = new pg.Client({
        ...connection,
        connectionTimeoutMillis: 1000,
        query_timeout: 1000
      })
      try {
        await client.connect()
        await client.query("SELECT 1")
        break
      } catch {
        assert(Date.now() < deadline, "PostgreSQL startup deadline")
        await delay(100)
      } finally {
        await client.end()
      }
    }
    const report = join(evidence, "results.json")
    const args = [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "tests/postgresql/matrix.config.mjs",
      "--reporter=default",
      "--reporter=json",
      "--reporter=junit",
      `--outputFile.json=${report}`,
      `--outputFile.junit=${join(evidence, "results.junit.xml")}`
    ]
    const code = await new Promise((resolve, reject) => {
      child = spawn(
        selected === "node" ? process.execPath : "bun",
        selected === "bun" ? ["--bun", ...args] : args,
        {
          cwd: root,
          stdio: "inherit",
          timeout: 7 * 60000,
          killSignal: "SIGKILL",
          env: {
            ...process.env,
            D6_RESOURCE_DIRECTORY: directory,
            OPERATORS_PG_CONFIG_FILE: operators,
            PG_EXPECT_RUNTIME: selected,
            D6_EXPECT_RUNTIME: selected
          }
        }
      )
      child.once("error", reject)
      child.once("close", resolve)
    })
    assert(!interrupted && code === 0, `${selected} PostgreSQL tests failed`)
    const result = JSON.parse(readFileSync(report, "utf8"))
    assertComplete(result, root)
    console.log(
      `PASS: ${selected}, ${result.numPassedTests} tests, no skips; reports: ${evidence}`
    )
  } finally {
    try {
      removeContainer()
      removed = true
    } finally {
      for (const path of [environment, operators]) {
        removePrivateFile(path)
      }
      process.removeListener("SIGINT", signal)
      process.removeListener("SIGTERM", signal)
      writeFileSync(
        join(evidence, "resource.json"),
        JSON.stringify({ runtime: selected, ownedContainerRemoved: removed })
      )
    }
  }
}

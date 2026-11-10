import { createHash, randomBytes, randomUUID } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ownedContainer, parseOptions } from "./Support.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const options = parseOptions(process.argv.slice(2))
if (!options.run) {
  console.log(
    JSON.stringify(
      {
        mode: "plan only; --run creates a new disposable database",
        options,
        retention:
          "90% library default (90 days on this baseline), 10% explicit churn cohort",
        database:
          "new owned Docker container, random loopback port; no database URL option",
        artifacts: "/tmp/opencode/effect-jobs-soak-<unique>/"
      },
      null,
      2
    )
  )
} else {
  const docker = (...args) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim()
  mkdirSync("/tmp/opencode", { recursive: true })
  const directory = mkdtempSync("/tmp/opencode/effect-jobs-soak-")
  const token = randomUUID()
  const name = `effect-jobs-soak-${token}`
  const environment = join(directory, "postgres.env")
  const privateFile = join(directory, "private.json")
  const password = randomBytes(24).toString("hex")
  let container
  let child
  let interrupted = false
  let completed = false
  const stop = () => {
    interrupted = true
    child?.kill("SIGTERM")
  }
  const removeOwned = () => {
    let inspection
    try {
      inspection = JSON.parse(docker("inspect", container ?? name))[0]
    } catch (error) {
      if (
        !(error.status === 1 && /No such (object|container)/.test(String(error.stderr)))
      ) {
        throw new Error("Cannot establish cleanup ownership")
      }
    }
    if (inspection) {
      if (inspection.Config?.Labels?.["effect-jobs.soak.owner"] !== token) {
        throw new Error("Foreign container")
      }
      docker("rm", "--force", "--volumes", inspection.Id)
    }
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    execFileSync("bun", ["run", "build"], { cwd: root, timeout: 120000, stdio: "pipe" })
    if (interrupted) {
      throw new Error("Interrupted")
    }
    const image = JSON.parse(docker("image", "inspect", options.image))[0]
    const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
    writeFileSync(
      join(directory, "metadata.json"),
      JSON.stringify(
        {
          options,
          node: process.version,
          head: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8"
          }).trim(),
          diffSha256: createHash("sha256")
            .update(execFileSync("git", ["diff", "HEAD"], { cwd: root }))
            .digest("hex"),
          harnessHashes: Object.fromEntries(
            ["Run", "Support", "Workload"].map((name) => [
              name,
              hash(fileURLToPath(new URL(`${name}.mjs`, import.meta.url)))
            ])
          ),
          runtimeHashes: Object.fromEntries(
            ["JobPolicy", "PostgreSqlNative", "internal/postgresql/Store"].map((name) => [
              name,
              hash(join(root, `dist/${name}.js`))
            ])
          ),
          dependencyLockSha256: hash(
            fileURLToPath(new URL("package-lock.json", import.meta.url))
          ),
          imageId: image.Id,
          imageDigests: image.RepoDigests,
          limits: { cpus: 2, memoryBytes: 1073741824, sharedMemoryBytes: 268435456 }
        },
        null,
        2
      )
    )
    writeFileSync(
      environment,
      `POSTGRES_USER=soak\nPOSTGRES_DB=effect_jobs_soak\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 }
    )
    container = docker(
      "create",
      "--pull=never",
      "--name",
      name,
      "--label",
      `effect-jobs.soak.owner=${token}`,
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
      options.image
    )
    docker("start", container)
    const inspection = JSON.parse(docker("inspect", container))[0]
    if (!ownedContainer(inspection, token) || interrupted) {
      throw new Error("Ownership or interruption")
    }
    writeFileSync(
      privateFile,
      JSON.stringify({
        options,
        directory,
        connection: {
          host: "127.0.0.1",
          port: Number(inspection.NetworkSettings.Ports["5432/tcp"][0].HostPort),
          user: "soak",
          database: "effect_jobs_soak",
          password
        }
      }),
      { mode: 0o600 }
    )
    console.log(`Owned soak started; artifacts: ${directory}`)
    await new Promise((resolve, reject) => {
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL("Workload.mjs", import.meta.url)), privateFile],
        {
          cwd: root,
          stdio: ["ignore", "inherit", "inherit"]
        }
      )
      const deadline = (options.durationSeconds + options.drainSeconds + 180) * 1000
      const soft = setTimeout(() => child.kill("SIGTERM"), deadline)
      const hard = setTimeout(() => child.kill("SIGKILL"), deadline + 5000)
      const finish = (error) => {
        clearTimeout(soft)
        clearTimeout(hard)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      child.once("error", finish)
      child.once("close", (code) =>
        finish(code === 0 ? undefined : new Error("Incomplete workload"))
      )
      if (interrupted) {
        child.kill("SIGTERM")
      }
    })
    completed = !interrupted
  } catch {
    console.error(`Soak incomplete; no capacity claim. Artifacts: ${directory}`)
    process.exitCode = 1
  } finally {
    let removed = false
    try {
      removeOwned()
      removed = true
    } catch {
      console.error(`Cleanup incomplete for owned container ${name}`)
      process.exitCode = 1
    }
    writeFileSync(
      join(directory, "resource.json"),
      JSON.stringify({
        container: container ?? name,
        ownedContainerRemoved: removed,
        workloadCompleted: completed
      })
    )
    for (const path of [environment, privateFile]) {
      try {
        unlinkSync(path)
      } catch (error) {
        if (error.code !== "ENOENT") {
          process.exitCode = 1
        }
      }
    }
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}

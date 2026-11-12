import { createHash, randomBytes, randomUUID } from "node:crypto"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ownedContainer, parseOptions } from "./Support.mjs"

// Stream the complete tracked working-tree/index diff, including changes larger
// than execFileSync's output buffer. Await child close on success, error or abort.
const trackedDiffDigest = (cwd, signal) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    let bytes = 0
    let failure
    const diffProcess = spawn("git", ["diff", "HEAD"], {
      cwd,
      signal,
      timeout: 15000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"]
    })
    diffProcess.stdout.on("data", (chunk) => {
      bytes += chunk.length
      hash.update(chunk)
    })
    diffProcess.stderr.resume()
    diffProcess.once("error", (error) => {
      failure = error
    })
    diffProcess.once("close", (code, signal) => {
      if (failure) {
        reject(failure)
      } else if (code !== 0) {
        reject(
          Object.assign(new Error("Tracked diff metadata failed"), {
            status: code,
            signal
          })
        )
      } else {
        resolve({ sha256: hash.digest("hex"), bytes })
      }
    })
  })

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
  let stage = "build"
  const metadataAbort = new AbortController()
  const preparation = (label, command, args, cwd) => {
    stage = label
    const result = spawnSync(command, args, {
      cwd,
      timeout: 120000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
    const output = String(result.stdout ?? "") + String(result.stderr ?? "")
    writeFileSync(
      join(directory, `${label}.log`),
      output.replaceAll(password, "[REDACTED]")
    )
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw Object.assign(new Error("Preparation failed"), { status: result.status })
    }
  }
  const stop = () => {
    interrupted = true
    metadataAbort.abort()
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
    preparation("build", "bun", ["run", "build"], root)
    // Copy the freshly built library into the isolated application graph. File
    // links would resolve its Schema peer from the source checkout instead.
    preparation(
      "install",
      "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      fileURLToPath(new URL("./", import.meta.url))
    )
    stage = "installed-byte-check"
    const installed = fileURLToPath(new URL("node_modules/effect-jobs/", import.meta.url))
    const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    for (const target of Object.values(current.exports)) {
      const path = target.import.slice(2)
      if (!readFileSync(join(installed, path)).equals(readFileSync(join(root, path)))) {
        throw new Error("Installed benchmark library differs from current build")
      }
    }
    if (interrupted) {
      throw new Error("Interrupted")
    }
    stage = "image-inspect"
    const image = JSON.parse(
      docker(
        "image",
        "inspect",
        "--format",
        '{"Id":{{json .Id}},"RepoDigests":{{json .RepoDigests}}}',
        options.image
      )
    )
    const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
    stage = "metadata-head"
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000
    }).trim()
    stage = "metadata-tracked-diff"
    const trackedDiff = await trackedDiffDigest(root, metadataAbort.signal)
    stage = "metadata-harness-hashes"
    const harnessHashes = Object.fromEntries(
      ["Run", "Support", "Definitions", "Workload"].map((name) => [
        name,
        hash(fileURLToPath(new URL(`${name}.mjs`, import.meta.url)))
      ])
    )
    stage = "metadata-runtime-hashes"
    const runtimeHashes = Object.fromEntries(
      [
        "Job",
        "JobProducer",
        "JobGroup",
        "JobApi",
        "JobApiBuilder",
        "JobWorker",
        "JobStorage",
        "JobPolicy",
        "postgresql/PostgreSqlNative",
        "postgresql/internal/Store"
      ].map((name) => [name, hash(join(root, `dist/${name}.js`))])
    )
    stage = "metadata-dependency-lock"
    const dependencyLockSha256 = hash(
      fileURLToPath(new URL("package-lock.json", import.meta.url))
    )
    stage = "metadata-write"
    writeFileSync(
      join(directory, "metadata.json"),
      JSON.stringify(
        {
          options,
          node: process.version,
          head,
          diffSha256: trackedDiff.sha256,
          trackedDiffBytes: trackedDiff.bytes,
          harnessHashes,
          runtimeHashes,
          dependencyLockSha256,
          imageId: image.Id,
          imageDigests: image.RepoDigests,
          limits: { cpus: 2, memoryBytes: 1073741824, sharedMemoryBytes: 268435456 }
        },
        null,
        2
      )
    )
    stage = "container-create"
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
    stage = "workload"
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
  } catch (error) {
    writeFileSync(
      join(directory, "runner-failure.json"),
      JSON.stringify({
        status: "incomplete",
        stage,
        failureClass: error instanceof Error ? error.name : "Unknown",
        exit: typeof error.status === "number" ? error.status : null,
        code: typeof error.code === "string" ? error.code : null
      })
    )
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

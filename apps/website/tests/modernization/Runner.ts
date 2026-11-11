import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { resolve } from "node:path"

export const runQualification = async (
  name: string,
  entry: string,
  env = process.env
) => {
  const directory = resolve(".multica/test-continuation")
  await mkdir(directory, { recursive: true })
  try {
    const result = await promisify(execFile)(process.execPath, [entry], {
      env,
      timeout: 85_000,
      maxBuffer: 32 * 1024 * 1024
    })
    await writeFile(resolve(directory, `${name}.log`), result.stdout + result.stderr)
    return { exitCode: 0, ...result }
  } catch (error) {
    const failure = error as Error & {
      readonly stdout?: string
      readonly stderr?: string
      readonly code?: number
    }
    await writeFile(
      resolve(directory, `${name}.log`),
      (failure.stdout ?? "") + (failure.stderr ?? "")
    )
    return {
      exitCode: failure.code ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    }
  }
}

// Build-time source-file FFI: snippets are never separately maintained copies.
import { readFile, realpath } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"

export const extractRegion = (source, region) => {
  if (region === undefined) {
    return source
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(region)) {
    throw new Error("Invalid example region")
  }
  const lines = source.replaceAll("\r\n", "\n").split("\n")
  const start = "// #region " + region
  const end = "// #endregion " + region
  const starts = lines.flatMap((line, index) => (line.trim() === start ? [index] : []))
  const ends = lines.flatMap((line, index) => (line.trim() === end ? [index] : []))
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) {
    throw new Error(
      "Example region must have one ordered matching marker pair: " + region
    )
  }
  return lines.slice(starts[0] + 1, ends[0]).join("\n")
}
export const extractExample = async (sourcePath, region, examplesDirectory) => {
  if (
    typeof sourcePath !== "string" ||
    !sourcePath.endsWith(".ts") ||
    isAbsolute(sourcePath)
  ) {
    throw new Error("Example sourcePath must be a relative TypeScript path")
  }
  const root = await realpath(fileURLToPath(examplesDirectory))
  const file = await realpath(resolve(root, sourcePath))
  const local = relative(root, file)
  if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
    throw new Error("Example sourcePath escapes examples/docs")
  }
  return extractRegion(await readFile(file, "utf8"), region)
}

// Longest common subsequence keeps unchanged lines unmarked, including repeats.
// Both stages come from checked canonical regions; no display-only source copy.
export const addedLines = (before, after) => {
  const previous = before.split("\n")
  const current = after.split("\n")
  const lengths = Array.from(
    { length: previous.length + 1 },
    () => new Uint32Array(current.length + 1)
  )
  for (let i = previous.length - 1; i >= 0; i--) {
    for (let j = current.length - 1; j >= 0; j--) {
      lengths[i][j] =
        previous[i] === current[j]
          ? 1 + lengths[i + 1][j + 1]
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const unchanged = new Set()
  let i = 0
  let j = 0
  while (i < previous.length && j < current.length) {
    if (previous[i] === current[j]) {
      unchanged.add(j++)
      i++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++
    else j++
  }
  return current.flatMap((line, index) =>
    unchanged.has(index) || !line.trim() ? [] : [index + 1]
  )
}

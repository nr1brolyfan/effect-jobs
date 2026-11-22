import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const cwd = process.argv[2]
const compile = (file) => {
  writeFileSync(
    join(cwd, "tsconfig.probe.json"),
    JSON.stringify({ extends: "./tsconfig.json", include: [file] })
  )
  return spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.probe.json", "--pretty", "false"],
    { cwd, encoding: "utf8", timeout: 60000 }
  )
}
const positive = compile("Contract.mts")
assert.equal(positive.status, 0, positive.stdout + positive.stderr)
const lines = readFileSync(join(cwd, "Contract.mts"), "utf8")
  .split("\n")
  .filter((line) => !line.includes("@ts-expect-error"))
writeFileSync(join(cwd, "Negative.mts"), lines.join("\n"))
const negative = compile("Negative.mts")
assert.equal(negative.status, 1, negative.stdout + negative.stderr)
const expected = [
  ["decodedAttempts", "TS2339"],
  ["badQueryError", "TS2322"],
  ["badTransactionError", "TS2322"],
  ["badJoinedError", "TS2322"],
  ["badOutput", "TS2322"],
  ["missingCaller", "TS2375"],
  ['values({ id: "wrong"', "TS2769"],
  ["badQueueObject", "TS2322"],
  ["missingQueueChoice", "TS2345"]
]
const diagnostics = negative.stdout
  .split("\n")
  .filter((line) => /error TS\d+:/.test(line))
assert.equal(diagnostics.length, expected.length, negative.stdout)
for (const [i, [marker, code]] of expected.entries()) {
  const location = /^Negative\.mts\((\d+),\d+\): error (TS\d+):/.exec(diagnostics[i])
  assert(
    location && lines[Number(location[1]) - 1].includes(marker) && location[2] === code,
    diagnostics[i]
  )
}
console.log("Bundled driver strict contracts + nine unsuppressed negative controls PASS")

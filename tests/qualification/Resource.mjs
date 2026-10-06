import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Test tooling only. Validate the exact disposable resource before reading secrets.
export const readQualificationResource = (directory) => {
  const record = JSON.parse(readFileSync(join(directory, "ownership.json"), "utf8"))
  assert.match(record.container_id, /^[a-f0-9]{64}$/)
  assert.equal(record.labels.project, "52ccc13e-4995-4a3f-be37-6f4cf6bebe3e")
  assert.equal(record.labels.deadline, record.deadline)
  assert(record.labels.issue && record.labels.owner)
  assert(Date.now() < Date.parse(record.deadline) - 60000, "PG resource deadline")
  const actual = JSON.parse(
    execFileSync("docker", ["inspect", "--format", "{{json .}}", record.container_id], {
      encoding: "utf8",
      timeout: 10000
    })
  )
  assert.equal(actual.Id, record.container_id)
  assert.equal(actual.Image, record.image)
  assert.equal(actual.State.Running, true)
  for (const [key, value] of Object.entries(record.labels)) {
    assert.equal(actual.Config.Labels[key], value)
  }
  assert.deepEqual(actual.NetworkSettings.Ports, record.ports)
  assert.equal(record.ports["5432/tcp"].length, 1)
  assert.equal(record.ports["5432/tcp"][0].HostIp, "127.0.0.1")
  return record
}

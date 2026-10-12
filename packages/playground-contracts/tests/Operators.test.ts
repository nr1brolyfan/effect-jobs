import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { JobOperatorCommand, commandIdentity } from "../src/Operators.js"

const command = {
  sandbox: { sandboxId: "private-a", generation: 1 },
  requestId: "request-a",
  jobId: "job-a",
  expectedState: "Dead",
  expectedLifecycleVersion: 5,
  action: "redrive",
  confirmDuplicateEffects: true
}
const decode = (value: unknown) =>
  Schema.decodeUnknownSync(JobOperatorCommand)(value, { onExcessProperty: "error" })
describe("private immutable operator command", () => {
  it("requires explicit duplicate-effects confirmation and forbids injected authority", () => {
    expect(decode(command).action).toBe("redrive")
    expect(() => decode({ ...command, confirmDuplicateEffects: false })).toThrow()
    const { confirmDuplicateEffects: _, ...unconfirmed } = command
    expect(() => decode(unconfirmed)).toThrow()
    for (const injected of ["producer", "policy", "payload", "credential"]) {
      expect(() => decode({ ...command, [injected]: "injected" })).toThrow()
    }
    expect(() => decode({ ...command, action: "cancel" })).toThrow()
  })
  it("binds every normalized command field regardless of object property order", () => {
    const identity = commandIdentity(decode(command))
    expect(
      commandIdentity(decode(Object.fromEntries(Object.entries(command).reverse())))
    ).toBe(identity)
    for (const changed of [
      { jobId: "job-b" },
      { expectedState: "Isolated" },
      { expectedLifecycleVersion: 6 },
      { requestId: "request-b" },
      { sandbox: { sandboxId: "private-a", generation: 2 } },
      { sandbox: { sandboxId: "private-b", generation: 1 } }
    ]) {
      expect(commandIdentity(decode({ ...command, ...changed }))).not.toBe(identity)
    }
    const { confirmDuplicateEffects: _, ...cancel } = command
    expect(commandIdentity(decode({ ...cancel, action: "cancel" }))).not.toBe(identity)
  })
})

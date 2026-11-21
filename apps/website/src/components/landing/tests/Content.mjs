import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { parse } from "@babel/parser"
import * as content from "../Content.ts"
import { codeOperations } from "../PlaybackClock.ts"

const fixturePath = "apps/website/src/components/landing/LandingExample.ts"
const sharedPath = "apps/website/src/components/landing/shared/jobs/orders.ts"
const fixture = await readFile(fixturePath, "utf8")
const sharedFixture = await readFile(sharedPath, "utf8")
const tokens = (text) =>
  parse(text, { sourceType: "module", plugins: ["typescript"], tokens: true })
    .tokens.filter((token) => token.type.label !== "eof")
    .map((token) => text.slice(token.start, token.end))

const region = (source, name) => {
  const excerpt = source
    .split(`// #region ${name}\n`)[1]
    ?.split(`// #endregion ${name}`)[0]
  assert(excerpt, `Missing fixture region: ${name}`)
  return excerpt
}
assert.deepEqual(
  tokens(content.shared),
  tokens(region(sharedFixture, "shared")),
  "shared"
)
for (const name of ["transaction", "rollback", "handler", "execution"]) {
  assert.deepEqual(tokens(content[name]), tokens(region(fixture, name)), name)
}
// Setup excerpts pair a module import with a line from inside an Effect generator.
const setupTokens = (text) => {
  const [importLine, ...body] = text.split("\n")
  return tokens(`${importLine}\nfunction* setup() {\n${body.join("\n")}\n}`)
}
for (const name of ["apiSetup", "workerSetup"]) {
  const excerpt = region(fixture, "setupImport") + region(fixture, name)
  assert.deepEqual(setupTokens(content[name]), setupTokens(excerpt), name)
}
assert(
  content.shared.includes(
    "return { OrdersQueue, ConfirmationJobGroup, OrdersJobApi, PlaceOrder }"
  )
)
assert(content.shared.includes("queue: OrdersQueue"))
assert(content.transaction.includes("PlaceOrder.enqueue"))
assert(content.rollback.includes("return yield* new OrderRejected()"))
assert(content.handler.includes('handlers.handle("confirmation", (input) =>'))
assert(content.execution.includes("JobWorker.layer(OrdersJobApi"))
assert(content.execution.includes("Layer.provide(HandlerLayer)"))
assert(content.execution.includes("JobWorker.drain(OrdersQueue"))

const page = await readFile("apps/website/src/pages/index.astro", "utf8")
assert(page.indexOf('id="transaction"') < page.indexOf('id="rows"'))
assert(page.indexOf('id="rows"') < page.indexOf('id="handler"'))
assert(!/durab/i.test(page), "No banned landing jargon")
assert(!page.includes("<dl>"), "SQL evidence must use genuine table geometry")
assert.equal((page.match(/<table>/g) ?? []).length, 2)
assert.equal((page.match(/<ScenePlayback /g) ?? []).length, 1)
assert(!page.includes("After COMMIT · orders queue"))
assert(!page.includes('class="worker-runtime"'))
assert(!page.includes('class="installed-handler"'))
assert(page.includes('class="job-row received-job"'))
assert(page.indexOf('id="handler"') < page.indexOf('id="shared"'))
assert(page.includes("shared/jobs/orders.ts"))
assert(!/\bconst (api|group|definitions)\b/.test(content.shared))
for (const operation of codeOperations) {
  const code = {
    ".commit-code": content.transaction,
    ".rollback-code": content.rollback,
    ".worker-code": content.execution,
    ".registration-code": content.handler
  }[operation.selector]
  const lines = code.split("\n")
  assert(operation.first >= 1 && operation.last <= lines.length)
  assert(operation.last >= operation.first)
  const first = lines[operation.first - 1]
  const expected =
    operation.kind === "transaction"
      ? [/withTransaction/, /db\.insert/, /PlaceOrder\.enqueue/, /\}\)|OrderRejected/][
          operation.phase
        ]
      : { 0: /JobWorker\.drain/, 3: /handlers\.handle/, 4: /emails\.send/ }[
          operation.phase
        ]
  assert.match(first, expected, operation.label)
}
console.log(
  JSON.stringify(
    {
      status: "PASS",
      verification:
        "Displayed TypeScript matches the typechecked landing sources token-for-token; chronological page and table structure",
      fixturePath,
      fixtureSha256: createHash("sha256").update(fixture).digest("hex"),
      sharedPath,
      sharedSha256: createHash("sha256").update(sharedFixture).digest("hex")
    },
    null,
    2
  )
)

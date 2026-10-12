import { describe, expect, it } from "vitest"
import { Effect, Layer, Redacted } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"
import { Application } from "../../../website/src/server/Services.js"
import * as Http from "../../../website/src/server/HttpApplication.js"

describe("explicit preview cookie authority", () => {
  const aliases = ["http://localhost:9911", "http://127.0.0.1:9911"]
  const setup = () => {
    let issues = 0
    const layer = Layer.mock(Application, {
      issue: () =>
        Effect.sync(() => {
          issues++
          return { sandbox: Fixtures.sandbox, credential: Redacted.make("a".repeat(64)) }
        }),
      authenticate: () => Effect.succeed({ sandbox: Fixtures.sandbox }),
      describe: () => Effect.succeed(Fixtures.sandbox)
    })
    const run = (
      origin: string,
      configuredOrigin: string,
      localPreview = false,
      suppliedOrigin = origin
    ) =>
      Effect.runPromise(
        Http.handle(
          new Request(origin + "/api/sandbox/issue", {
            method: "POST",
            headers: { Origin: suppliedOrigin, "Content-Type": "application/json" }
          }),
          configuredOrigin,
          () => true,
          localPreview
        ).pipe(Effect.provide(layer))
      )
    return { run, issues: () => issues }
  }
  it("issues host-only per-port credentials independently for the exact selected aliases", async () => {
    const { run, issues } = setup()
    for (const origin of aliases) {
      const out = await run(origin, aliases[1]!, true)
      expect(out.status).toBe(200)
      const cookies = out.headers.getSetCookie()
      expect(cookies).toHaveLength(2)
      expect(cookies[0]).toMatch(/^playground-local-9911=/)
      expect(cookies[0]).toContain("HttpOnly")
      for (const value of cookies) {
        expect(value).toContain("Path=/")
        expect(value).toContain("SameSite=Strict")
        expect(value).not.toContain("Domain=")
        expect(value).not.toContain("Secure")
      }
    }
    expect(issues()).toBe(2)
  })
  it("denies implicit HTTP, IPv6, foreign ports and cross-alias Origin before issuing", async () => {
    const { run, issues } = setup()
    for (const [actual, configured, enabled, supplied] of [
      [aliases[0]!, aliases[1]!, false, aliases[0]!],
      ["http://[::1]:9911", aliases[1]!, true, "http://[::1]:9911"],
      ["http://localhost:9912", aliases[1]!, true, "http://localhost:9912"],
      [aliases[0]!, aliases[1]!, true, aliases[1]!]
    ] as const) {
      expect((await run(actual, configured, enabled, supplied)).status).toBe(400)
    }
    expect(issues()).toBe(0)
  })
  it("retains Secure __Host cookies in hosted mode", async () => {
    const { run } = setup()
    const out = await run("https://playground.example", "https://playground.example")
    expect(out.status).toBe(200)
    expect(out.headers.getSetCookie()[0]).toMatch(/^__Host-playground=/)
    expect(out.headers.getSetCookie()[1]).toMatch(/^__Host-playground-csrf=/)
    expect(
      out.headers
        .getSetCookie()
        .every((value) => value.includes("; Secure") && !value.includes("Domain="))
    ).toBe(true)
    expect(Cookies.names("https://playground.example", true)).toEqual(Cookies.hosted)
  })
  it("selects the matching double-submit cookie and rejects alias crossing", () => {
    const config = { configuredOrigin: aliases[1]!, localPreview: true }
    const token = "c".repeat(64)
    for (const actual of aliases) {
      const request = new Request(actual + "/api/jobs/operator", {
        method: "POST",
        headers: {
          Origin: actual,
          "Content-Type": "application/json",
          Cookie: `playground-local-csrf-9911=${token}`,
          "X-Playground-CSRF": token
        }
      })
      expect(Http.csrf(request, config)).toBe(true)
      expect(Http.csrf(request, { ...config, localPreview: false })).toBe(false)
      request.headers.set(
        "Origin",
        aliases.find((value) => value !== actual)!
      )
      expect(Http.csrf(request, config)).toBe(false)
    }
  })
})

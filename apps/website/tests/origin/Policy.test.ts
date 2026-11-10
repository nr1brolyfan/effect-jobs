import { describe, expect, it } from "vitest"
import * as OriginPolicy from "../../src/OriginPolicy.js"

const aliases = ["http://localhost:8787", "http://127.0.0.1:8787"]
const forbidden = [
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost",
  "http://[::1]:8787",
  "http://localhost.evil.test:8787",
  "http://127.0.0.2:8787",
  "http://evil.test:8787",
  "https://localhost:8787",
  "null",
  "*",
  "http://LOCALHOST:8787",
  "http://127.1:8787",
  "http://localhost:8787/",
  "http://user@localhost:8787",
  "http://localhost:8787?query",
  " http://localhost:8787"
]

describe("explicit origin policy", () => {
  it.each(aliases)(
    "resolves both aliases from trusted %s without cross-origin POST/WS",
    (configuredOrigin) => {
      const policy = OriginPolicy.make({ configuredOrigin, localPreview: true })
      for (const origin of aliases) {
        expect(policy.resolve(origin)).toBe(origin)
        expect(policy.matches(origin, origin)).toBe(true)
        expect(policy.matches(origin, null)).toBe(false)
        for (const other of aliases.filter((alias) => alias !== origin)) {
          expect(policy.matches(origin, other)).toBe(false)
        }
        for (const other of forbidden) {
          expect(policy.matches(origin, other)).toBe(false)
          expect(policy.matches(other, origin)).toBe(false)
        }
      }
      for (const origin of forbidden) {
        expect(policy.resolve(origin)).toBeUndefined()
        expect(policy.matches(origin, origin)).toBe(false)
      }
    }
  )

  it.each([
    "",
    "not a URL",
    ...forbidden.slice(2),
    "http://localhost:0",
    "http://localhost:65536",
    "http://localhost:80",
    "http://localhost:08787",
    "http://localhost:8787#fragment",
    "http://*.test:8787",
    "https://example.test",
    "x".repeat(4097)
  ])("fails closed for invalid preview configuration %s", (configuredOrigin) => {
    const policy = OriginPolicy.make({ configuredOrigin, localPreview: true })
    for (const origin of [...aliases, configuredOrigin, "https://example.test"]) {
      expect(policy.resolve(origin)).toBeUndefined()
      expect(policy.matches(origin, origin)).toBe(false)
    }
  })

  it.each(["https://example.test", "https://example.test:8443"])(
    "hosts only exact HTTPS %s",
    (configuredOrigin) => {
      const policy = OriginPolicy.make({ configuredOrigin, localPreview: false })
      expect(policy.resolve(configuredOrigin)).toBe(configuredOrigin)
      expect(policy.matches(configuredOrigin, configuredOrigin)).toBe(true)
      for (const origin of [
        ...aliases,
        ...forbidden,
        "https://sub.example.test",
        "https://example.test:9443"
      ]) {
        expect(policy.resolve(origin)).toBeUndefined()
        expect(policy.matches(configuredOrigin, origin)).toBe(false)
      }
    }
  )

  it.each([
    ...aliases,
    "",
    "invalid",
    "https://*.test",
    "https://user@example.test",
    "https://example.test/path"
  ])("disables malformed or HTTP hosted config %s", (configuredOrigin) => {
    const policy = OriginPolicy.make({ configuredOrigin, localPreview: false })
    expect(policy.resolve(configuredOrigin)).toBeUndefined()
    for (const origin of aliases) {
      expect(policy.resolve(origin)).toBeUndefined()
    }
  })

  it.each([1, 65535])("accepts explicit valid port boundary %s", (port) => {
    const origin = `http://localhost:${port}`
    expect(
      OriginPolicy.make({ configuredOrigin: origin, localPreview: true }).resolve(origin)
    ).toBe(origin)
  })
})

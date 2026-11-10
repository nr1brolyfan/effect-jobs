import { describe, expect, it } from "vitest"
import { formatDateTime } from "../../src/ui/DateTimeFormat.js"

describe("timestamp presentation", () => {
  const options = { locale: "en-GB", timeZone: "Europe/Warsaw" }

  it("treats absent values separately from the valid zero epoch", () => {
    expect(formatDateTime(null, options)).toBeUndefined()
    expect(formatDateTime(undefined, options)).toBeUndefined()
    expect(formatDateTime(0, options)?.iso).toBe("1970-01-01T00:00:00.000Z")
    expect(formatDateTime(0, options)?.compact).toContain("01:00:00")
  })

  it("does not crash a render on nonfinite or out-of-range timestamps", () => {
    for (const value of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
      expect(formatDateTime(value, options)).toBeUndefined()
    }
  })

  it("shows local date/time and optional seconds while keeping exact millis and UTC", () => {
    const millis = Date.parse("2026-10-12T09:42:15.123Z")
    const formatted = formatDateTime(millis, options)!
    expect(formatted.compact).toContain("12 Oct 2026")
    expect(formatted.compact).toContain("11:42:15")
    expect(formatted.timeZone).toBe("Europe/Warsaw")
    expect(formatted.local).toContain("11:42:15.123 GMT+02:00")
    expect(formatted.utc).toContain("09:42:15.123 GMT")
    expect(formatted.iso).toBe("2026-10-12T09:42:15.123Z")
    const minutes = formatDateTime(millis, { ...options, seconds: false })!
    expect(minutes.compact).toContain("11:42")
    expect(minutes.compact).not.toContain("11:42:15")
    expect(minutes.local).toBe(formatted.local)
    expect(minutes.iso).toBe(formatted.iso)
  })

  it("formats the spring DST gap from instants without inventing a local time", () => {
    const before = formatDateTime(Date.parse("2026-03-29T00:59:59Z"), options)!
    const after = formatDateTime(Date.parse("2026-03-29T01:00:00Z"), options)!
    expect(before.local).toContain("01:59:59.000 GMT+01:00")
    expect(after.local).toContain("03:00:00.000 GMT+02:00")
  })

  it("distinguishes repeated fall DST hours using offset and exact UTC", () => {
    const first = formatDateTime(Date.parse("2026-10-25T00:30:00Z"), options)!
    const second = formatDateTime(Date.parse("2026-10-25T01:30:00Z"), options)!
    expect(first.compact).toBe(second.compact)
    expect(first.local).toContain("02:30:00.000 GMT+02:00")
    expect(second.local).toContain("02:30:00.000 GMT+01:00")
    expect(first.utc).not.toBe(second.utc)
    expect(first.iso).not.toBe(second.iso)
  })

  it("honors injected locale and timezone, including a local date rollover", () => {
    const millis = Date.parse("2026-10-12T23:42:15Z")
    const warsaw = formatDateTime(millis, options)!
    const english = formatDateTime(millis, { locale: "en-US", timeZone: "UTC" })!
    const polish = formatDateTime(millis, { locale: "pl-PL", timeZone: "UTC" })!
    expect(warsaw.compact).toContain("13 Oct 2026")
    expect(english.compact).toContain("Oct 12, 2026")
    expect(polish.compact).not.toBe(english.compact)
    expect(warsaw.iso).toBe(english.iso)
    expect(polish.iso).toBe(english.iso)
  })
})

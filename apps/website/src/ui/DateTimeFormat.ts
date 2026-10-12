export interface DateTimeFormatOptions {
  readonly locale?: string
  readonly timeZone?: string
  readonly seconds?: boolean
}

export interface FormattedDateTime {
  readonly compact: string
  readonly local: string
  readonly utc: string
  readonly iso: string
  readonly timeZone: string
}

// Intl/Date are presentation FFI only. Never round or reinterpret the source
// millis for scheduling, eligibility, lease ownership, or countdown arithmetic.
export function formatDateTime(
  value: number | null | undefined,
  { locale, timeZone, seconds = true }: DateTimeFormatOptions = {}
): FormattedDateTime | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return undefined
  }

  const compact = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {})
  })
  const zone = compact.resolvedOptions().timeZone
  const exact: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZoneName: "longOffset",
    hourCycle: "h23"
  }
  return {
    compact: compact.format(date),
    local: new Intl.DateTimeFormat(locale, { ...exact, timeZone: zone }).format(date),
    utc: new Intl.DateTimeFormat(locale, { ...exact, timeZone: "UTC" }).format(date),
    iso: date.toISOString(),
    timeZone: zone
  }
}

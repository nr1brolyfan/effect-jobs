export interface Config {
  readonly configuredOrigin: string
  readonly localPreview: boolean
}

export interface Policy {
  readonly resolve: (requestOrigin: string) => string | undefined
  readonly matches: (requestOrigin: string, suppliedOrigin: string | null) => boolean
}

// URL is a throwing platform parser. Bound its input and retain only canonical
// origins: credentials, paths, whitespace and normalized host spellings fail closed.
const parse = (origin: string): URL | undefined => {
  if (origin.length === 0 || origin.length > 4096) {
    return undefined
  }
  try {
    const url = new URL(origin)
    return url.origin === origin && !url.hostname.includes("*") && url.port !== "0"
      ? url
      : undefined
  } catch {
    return undefined
  }
}

export const make = ({ configuredOrigin, localPreview }: Config): Policy => {
  const configured = parse(configuredOrigin)
  const allowed = new Set<string>()
  if (configured) {
    if (localPreview) {
      if (
        configured.protocol === "http:" &&
        configured.port !== "" &&
        (configured.hostname === "localhost" || configured.hostname === "127.0.0.1")
      ) {
        allowed.add(`http://localhost:${configured.port}`)
        allowed.add(`http://127.0.0.1:${configured.port}`)
      }
    } else if (configured.protocol === "https:") {
      allowed.add(configuredOrigin)
    }
  }
  const resolve = (requestOrigin: string) =>
    allowed.has(requestOrigin) ? requestOrigin : undefined
  return {
    resolve,
    matches: (requestOrigin, suppliedOrigin) =>
      resolve(requestOrigin) !== undefined && suppliedOrigin === requestOrigin
  }
}

# Explicit preview origin policy

`apps/website/src/OriginPolicy.ts` is a pure finite admission policy. Its frozen
API is `make({ configuredOrigin: string, localPreview: boolean })`, returning
`resolve(requestOrigin): string | undefined` and
`matches(requestOrigin, suppliedOrigin: string | null): boolean`.
Invalid configuration produces a deny-all policy without throwing. Configuration
must be a canonical origin, without credentials, whitespace, path, query,
fragment or wildcard. Preview requires HTTP `localhost` or `127.0.0.1` with a
nonempty valid port (1–65535); an explicit default port is not a canonical origin
and fails closed. Hosted mode requires the exact configured HTTPS origin.

Preview permits exactly the two hostnames at that configured port. Resolution
returns the actual origin supplied by the request URL. `matches` additionally
requires the supplied Origin header to equal that actual origin. It never
accepts a cross-alias POST/WebSocket, foreign port, suffix host, IPv6 alias,
Host override or forwarded-header override. No credential/cookie sharing between
aliases is introduced.

## Required serial integration by stream C

1. Add `readonly LOCAL_PREVIEW?: string` to Worker `Env`. Enable it only with
   `env.LOCAL_PREVIEW === "true"`. Pass it explicitly in the owned launcher;
   absent configuration remains hosted-only.
2. Construct `OriginPolicy.make({ configuredOrigin: env.ORIGIN,
localPreview: env.LOCAL_PREVIEW === "true" })` at Worker/Gateway admission.
   Resolve `new URL(request.url).origin` before authentication, DB work or
   activating demo resources; reject undefined resolution. Use request URL,
   never Host/X-Forwarded-Host. Carry the selected actual origin through HTTP,
   CSRF and command handling without rewriting the original Request URL.
3. `Upgrade.upgrade(request, policy, namespace, authorize)` now accepts that
   `OriginPolicy.Policy`. A legacy string argument is supported only as a strict
   hosted HTTPS policy; it does not implicitly enable HTTP preview. The upgrade
   independently checks actual URL origin against its supplied Origin header,
   and forwards the same Request to the DO. Interruptions, including mixed
   Causes, remain Effect failures; other failures return sanitized 503.
4. `Live.makeDurableObject` retains `origin: (env) => env.ORIGIN` and adds
   `localPreview?: (env) => boolean`. Wire
   `localPreview: (env) => env.LOCAL_PREVIEW === "true"` in Worker SandboxLive.
   The DO reconstructs the same policy and repeats admission independently.
   Omitting the callback is hosted-only. Authority, generation, expiry and
   viewer limits remain in force.
5. `DemoHttp.handle(request, env)` reads `LOCAL_PREVIEW` through an optional
   structural Env extension; once C adds Env the existing call requires no
   signature change. All demo methods except GET are denied before services.
   Demo upgrades receive the policy, preserving selected actual origin.
6. HttpApplication/HttpCommands must use the selected actual origin for exact
   URL/Origin/CSRF checks. Cookie/auth helpers must receive explicit policy
   context: allow non-Secure host-only per-port names only when a valid preview
   policy resolves the actual origin. Remove the URL-only IPv6/HTTP exception.
   Hosted cookies retain Secure, __Host-, Path=/ and no Domain. Internal DO
   authentication must receive the same explicit policy context. HttpClient
   must select corresponding CSRF names and keep relative HTTP and
   location-derived WebSocket URLs.

No shared Worker, HTTP, cookie, client, launcher, manifest, registrar or contract
files are edited by stream A. C must qualify both aliases in actual Chromium
HTTP/WebSocket, demo and private sessions, issuance/recovery/CSRF/actions/receipts,
unauthorized origins and compiled production assets on an isolated fresh runtime.
This slice's mocked admission tests do not constitute that integrated runtime
qualification. Existing preview8787 must remain untouched.

## Slice qualification

Build root and playground-contracts before running
`bunx vitest run apps/website/tests/origin`. In a fresh Bun file-dependency install,
materialize the just-built root `dist` into the worktree's own installed
`effect-jobs` file dependency before building contracts. Do not borrow another
preview's dependency/config/runtime artifacts.

Tests cover the finite policy matrix, independent Upgrade/DO guards, unchanged
request forwarding, denial before authority/services, sanitized failure,
in-flight interruption and mixed Cause preservation, expiry and demo mutation
denial. Full browser/real-PG qualification belongs to serial integration.

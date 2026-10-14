import { Effect, Exit } from "effect"
import { useLayoutEffect, useRef, useState } from "react"
import * as stylex from "@stylexjs/stylex"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { Document } from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import { Button, Field } from "../../../ui/Primitives.js"
import { useSyntheticDocumentSession } from "./SyntheticDocumentSession.js"
import * as BrowserDocumentCrypto from "./BrowserDocumentCrypto.js"
import { styles } from "./JobPayloadPanel.stylex.js"

const HighlightedJson = ({ value }: { readonly value: unknown }) => {
  const text = JSON.stringify(value, null, 2)
  // Static JSON token grammar; React escapes every token, including markup strings.
  const tokens = text.split(
    /("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g
  )
  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={index}
          {...stylex.props(
            token.startsWith('"')
              ? tokens[index + 1]?.trimStart().startsWith(":")
                ? styles.key
                : styles.string
              : /^(?:-?\d|true$|false$|null$)/.test(token) && styles.literal
          )}
        >
          {token}
        </span>
      ))}
    </>
  )
}

const PayloadContent = ({
  detail,
  canCopyEncoded
}: {
  readonly detail: JobDetail
  readonly canCopyEncoded: boolean
}) => {
  const session = useSyntheticDocumentSession()
  const lockedStatus =
    detail.payload._tag === "Unavailable"
      ? "Payload unavailable."
      : detail.payload.encryption === "None"
        ? "Encoded payload."
        : "Locked."
  const [plaintext, setPlaintext] = useState<Document | null>(null)
  const [status, setStatus] = useState(lockedStatus)
  const [busy, setBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const code = useRef<HTMLInputElement>(null)
  const encryption = useRef<HTMLInputElement>(null)
  const fingerprint = useRef<HTMLInputElement>(null)
  const lifetime = useRef({
    revision: 0,
    mounted: true,
    controller: null as AbortController | null
  })
  const clearInputs = () => {
    for (const input of [code.current, encryption.current, fingerprint.current]) {
      if (input) {
        input.value = ""
      }
    }
  }
  const revoke = () => {
    session?.revoke()
    lifetime.current.revision++
    lifetime.current.controller?.abort()
    lifetime.current.controller = null
    setCopyBusy(false)
    clearInputs()
  }
  const relock = () => {
    revoke()
    setPlaintext(null)
    setBusy(false)
    setStatus(lockedStatus)
  }
  useLayoutEffect(() => {
    lifetime.current.mounted = true
    window.addEventListener("pagehide", relock)
    window.addEventListener("popstate", relock)
    return () => {
      lifetime.current.mounted = false
      revoke()
      window.removeEventListener("pagehide", relock)
      window.removeEventListener("popstate", relock)
    }
  }, [])
  const payload = detail.payload
  const synthetic =
    payload._tag === "Available" &&
    payload.encryption === "SyntheticDocumentV1" &&
    BrowserDocumentCrypto.isSyntheticCatalog(payload.catalog)
  const compatible =
    payload._tag === "Available" &&
    payload.encryption === "PrivateDocumentV1" &&
    payload.catalog.queue === "playground-private" &&
    payload.catalog.kind === "playground.private-data-export" &&
    payload.catalog.version === 1
  useLayoutEffect(() => {
    if (synthetic && session && session.document === null) {
      setPlaintext(null)
      setStatus(lockedStatus)
    }
  }, [synthetic, session?.document])
  const unlock = () => {
    if (payload._tag !== "Available" || busy || (!synthetic && !compatible)) {
      return
    }
    // Read local input only for this operation. No client/Atom receives these values.
    const work = synthetic
      ? BrowserDocumentCrypto.unlockSyntheticDocument(
          payload.encoded,
          code.current?.value ?? ""
        )
      : BrowserDocumentCrypto.unlockPrivateDocument(
          payload.encoded,
          encryption.current?.value ?? "",
          fingerprint.current?.value ?? ""
        )
    revoke()
    setPlaintext(null)
    const revision = lifetime.current.revision
    const controller = new AbortController()
    lifetime.current.controller = controller
    setBusy(true)
    setStatus("Verifying…")
    // React event/Web Crypto boundary; cancellation plus revision blocks stale completions.
    void Effect.runPromiseExit(work, { signal: controller.signal }).then((exit) => {
      if (
        !lifetime.current.mounted ||
        revision !== lifetime.current.revision ||
        controller.signal.aborted
      ) {
        return
      }
      lifetime.current.controller = null
      setBusy(false)
      if (Exit.isSuccess(exit)) {
        if (synthetic) {
          session?.unlock(exit.value)
        }
        setPlaintext(exit.value)
        setStatus("Unlocked · verified locally.")
      } else {
        setPlaintext(null)
        setStatus(
          synthetic
            ? "Locked · authentication failed. Demo code: 123."
            : "Locked · authentication failed."
        )
      }
    })
  }
  // Only the allowlisted synthetic fixture may export a locally decrypted document.
  // Real private envelopes keep their existing encoded-only copy policy.
  const displayed =
    payload._tag === "Available" &&
    plaintext !== null &&
    typeof payload.encoded === "object" &&
    payload.encoded !== null &&
    !Array.isArray(payload.encoded)
      ? Object.fromEntries([...Object.entries(payload.encoded), ["document", plaintext]])
      : payload._tag === "Available"
        ? payload.encoded
        : null
  const canCopy = synthetic || canCopyEncoded
  const copyPayload = () => {
    if (payload._tag !== "Available" || !canCopy || copyBusy || busy) {
      return
    }
    const revision = lifetime.current.revision
    setCopyBusy(true)
    setStatus("Copying payload…")
    // Explicit browser gesture/Clipboard FFI; no Atom, server or storage receives JSON.
    void Effect.runPromiseExit(
      Effect.tryPromise({
        try: () =>
          navigator.clipboard.writeText(
            JSON.stringify(synthetic ? displayed : payload.encoded, null, 2)
          ),
        catch: () =>
          new BrowserDocumentCrypto.PayloadUnlockError({ reason: "unavailable" })
      })
    ).then((exit) => {
      if (!lifetime.current.mounted || revision !== lifetime.current.revision) {
        return
      }
      setCopyBusy(false)
      setStatus(Exit.isSuccess(exit) ? "Payload copied." : "Clipboard unavailable.")
    })
  }
  return (
    <section {...stylex.props(styles.panel)} aria-label="Job payload">
      <h3 {...stylex.props(styles.heading)}>Payload</h3>
      {payload._tag === "Unavailable" ? (
        <span
          {...stylex.props(styles.note)}
          aria-label={`Payload unavailable: ${payload.reason.replaceAll("-", " ")}.`}
          title={`Payload unavailable: ${payload.reason.replaceAll("-", " ")}.`}
        >
          —
        </span>
      ) : (
        <>
          <div {...stylex.props(styles.viewerHeader)}>
            <span {...stylex.props(styles.note)}>
              {plaintext === null ? "Encoded JSON" : "Readable JSON · decrypted locally"}
            </span>
            <span {...stylex.props(styles.note)}>
              Schema {payload.catalog.version} · {payload.validation}
            </span>
            {canCopy ? (
              <Button onClick={copyPayload} disabled={copyBusy || busy}>
                Copy payload
              </Button>
            ) : null}
          </div>
          <pre
            {...stylex.props(styles.code, plaintext !== null && styles.plaintext)}
            tabIndex={0}
            aria-label={plaintext === null ? "Encoded payload" : "Readable payload"}
            onCopy={
              plaintext !== null && !synthetic
                ? (event) => event.preventDefault()
                : undefined
            }
            onCut={
              plaintext !== null && !synthetic
                ? (event) => event.preventDefault()
                : undefined
            }
            draggable={false}
          >
            <HighlightedJson value={displayed} />
          </pre>
          {synthetic || compatible ? (
            <>
              <p {...stylex.props(styles.note)}>
                {synthetic
                  ? "Synthetic demo data only · demo code: 123."
                  : "PrivateDocumentV1 · local keys required."}
              </p>
              <form
                {...stylex.props(styles.form)}
                autoComplete="off"
                onSubmit={(event) => {
                  event.preventDefault()
                  unlock()
                }}
              >
                {synthetic ? (
                  <Field label="Demo unlock code">
                    <input
                      ref={code}
                      type="password"
                      autoComplete="off"
                      maxLength={128}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Local encryption key (hex)">
                      <input
                        ref={encryption}
                        type="password"
                        autoComplete="off"
                        maxLength={64}
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Local fingerprint key (hex)">
                      <input
                        ref={fingerprint}
                        type="password"
                        autoComplete="off"
                        maxLength={64}
                        spellCheck={false}
                      />
                    </Field>
                  </>
                )}
                <div {...stylex.props(styles.actions)}>
                  <Button type="submit" disabled={busy}>
                    Unlock locally
                  </Button>
                  <Button onClick={relock}>Relock</Button>
                </div>
              </form>
            </>
          ) : payload.encryption !== "None" ? (
            <p {...stylex.props(styles.note)}>
              Unlock unavailable: unsupported catalog or encryption format.
            </p>
          ) : null}
        </>
      )}
      {payload._tag === "Available" ? (
        <p role="status" {...stylex.props(styles.note)}>
          {status}
        </p>
      ) : null}
      <dl {...stylex.props(styles.result)}>
        <dt>Result</dt>
        <dd {...stylex.props(styles.resultValue)}>
          {detail.result._tag === "Unavailable" ? (
            <span
              aria-label={`Result unavailable: ${detail.result.reason.replaceAll("-", " ")}.`}
              title={`Result unavailable: ${detail.result.reason.replaceAll("-", " ")}.`}
            >
              —
            </span>
          ) : null}
        </dd>
      </dl>
    </section>
  )
}

// Integration must unmount this panel on close/expiry. identityKey includes mode,
// selected detail identity and generation; no plaintext belongs in return context.
export const JobPayloadPanel = ({
  detail,
  identityKey,
  allowCopyEncoded = false
}: {
  readonly detail: JobDetail
  readonly identityKey: string
  readonly allowCopyEncoded?: boolean
}) => (
  <PayloadContent
    key={JSON.stringify([identityKey, detail.sandbox, detail.job.jobId, detail.payload])}
    detail={detail}
    canCopyEncoded={allowCopyEncoded}
  />
)

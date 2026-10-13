import { Effect, Exit } from "effect"
import { useLayoutEffect, useRef, useState } from "react"
import * as stylex from "@stylexjs/stylex"
import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { Document } from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import { Button, Field } from "../../../ui/Primitives.js"
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

const PayloadContent = ({ detail }: { readonly detail: JobDetail }) => {
  const lockedStatus =
    detail.payload._tag === "Unavailable"
      ? "Payload unavailable."
      : detail.payload.encryption === "None"
        ? "Encoded payload available."
        : "Locked; plaintext and authentication are unverified."
  const [plaintext, setPlaintext] = useState<Document | null>(null)
  const [status, setStatus] = useState(lockedStatus)
  const [busy, setBusy] = useState(false)
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
    lifetime.current.revision++
    lifetime.current.controller?.abort()
    lifetime.current.controller = null
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
    setStatus("Verifying encrypted document…")
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
        setPlaintext(exit.value)
        setStatus(
          "Unlocked; AES-GCM authentication, document Schema and HMAC verified locally."
        )
      } else {
        setPlaintext(null)
        setStatus("Locked; key, envelope or document authentication failed.")
      }
    })
  }
  const copyEncoded = () => {
    if (payload._tag !== "Available") {
      return
    }
    const revision = lifetime.current.revision
    void Effect.runPromiseExit(
      Effect.tryPromise({
        try: () =>
          navigator.clipboard.writeText(JSON.stringify(payload.encoded, null, 2)),
        catch: () =>
          new BrowserDocumentCrypto.PayloadUnlockError({ reason: "unavailable" })
      })
    ).then((exit) => {
      if (!lifetime.current.mounted || revision !== lifetime.current.revision) {
        return
      }
      setStatus(
        Exit.isSuccess(exit) ? "Encoded payload copied." : "Clipboard unavailable."
      )
    })
  }
  return (
    <section {...stylex.props(styles.panel)} aria-label="Job payload">
      <h3 {...stylex.props(styles.heading)}>Payload</h3>
      {payload._tag === "Unavailable" ? (
        <p {...stylex.props(styles.note)}>Unavailable: {payload.reason}.</p>
      ) : (
        <>
          <p {...stylex.props(styles.note)}>
            Catalog {payload.catalog.queue} / {payload.catalog.kind} · schema version{" "}
            {payload.catalog.version} · format {payload.formatVersion}
          </p>
          <p {...stylex.props(styles.note)}>
            Stored encoded shape: {payload.validation}.{" "}
            {payload.encryption === "None"
              ? "Unencrypted JSON."
              : "Shape validation does not verify decrypted plaintext or authentication."}
          </p>
          <pre {...stylex.props(styles.code)} tabIndex={0} aria-label="Encoded payload">
            <HighlightedJson value={payload.encoded} />
          </pre>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={copyEncoded}>Copy encoded payload</Button>
          </div>
          {synthetic || compatible ? (
            <>
              <p {...stylex.props(styles.note)}>
                {synthetic
                  ? "Synthetic demo; key material is public; unlock code 123. This is a demonstration gate, not password security."
                  : "Compatible PrivateDocumentV1 only. Supply two distinct 32-byte keys locally as 64 hex characters each. Keys are never sent to the server."}
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
                  <Field label="Synthetic unlock code">
                    <input ref={code} type="password" autoComplete="off" maxLength={3} />
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
              {plaintext !== null ? (
                <pre
                  {...stylex.props(styles.code, styles.plaintext)}
                  aria-label="Locally decrypted document"
                  onCopy={(event) => event.preventDefault()}
                  onCut={(event) => event.preventDefault()}
                  draggable={false}
                >
                  <HighlightedJson value={plaintext} />
                </pre>
              ) : null}
              <p {...stylex.props(styles.note)}>
                Decrypted copying and browser correction are unavailable. Closing or
                navigating relocks the document.
              </p>
            </>
          ) : payload.encryption !== "None" ? (
            <p {...stylex.props(styles.note)}>
              Unlock unavailable: unsupported catalog or encryption format.
            </p>
          ) : null}
        </>
      )}
      <p role="status" {...stylex.props(styles.note)}>
        {status}
      </p>
      <h3 {...stylex.props(styles.heading)}>Result</h3>
      {detail.result._tag === "Unavailable" ? (
        <p {...stylex.props(styles.note)}>Unavailable: {detail.result.reason}.</p>
      ) : null}
    </section>
  )
}

// Integration must unmount this panel on close/expiry. identityKey includes mode,
// selected detail identity and generation; no plaintext belongs in return context.
export const JobPayloadPanel = ({
  detail,
  identityKey
}: {
  readonly detail: JobDetail
  readonly identityKey: string
}) => (
  <PayloadContent
    key={JSON.stringify([identityKey, detail.sandbox, detail.job.jobId, detail.payload])}
    detail={detail}
  />
)

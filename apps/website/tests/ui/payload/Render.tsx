import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { Effect } from "effect"
import { JobPayloadPanel } from "../../../src/features/jobs/payload/JobPayloadPanel.js"
import * as Crypto from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import type { JobDetail } from "./Jobs.compile.js"

const encrypted = await Effect.runPromise(
  Crypto.sealSyntheticDocument({
    subject: "demo-customer",
    tenant: "demo-tenant-a",
    note: "payload-browser-secret-synthetic"
  })
)
const original = {
  sandbox: { sandboxId: "fixture-sandbox", generation: 1 },
  job: { jobId: "fixture-job" },
  payload: {
    _tag: "Available",
    formatVersion: 1,
    catalog: Crypto.syntheticDocumentCatalog,
    encoded: { sandboxId: "fixture-sandbox", behavior: "success", document: encrypted },
    validation: "Valid",
    encryption: "SyntheticDocumentV1"
  },
  result: { _tag: "Unavailable", reason: "not-stored" }
} as unknown as JobDetail

const Harness = () => {
  const [detail, setDetail] = useState(original)
  const [identity, setIdentity] = useState("demo:1:fixture-job")
  const [shown, setShown] = useState(true)
  return (
    <>
      <h1>Isolated payload qualification</h1>
      <button onClick={() => setShown(false)}>Close fixture</button>
      <button
        onClick={() => {
          setDetail(original)
          setShown(true)
        }}
      >
        Open fixture
      </button>
      <button onClick={() => setShown(false)}>Expire fixture</button>
      <button
        onClick={() =>
          setIdentity((value) =>
            value === "demo:1:fixture-job"
              ? "private:1:fixture-job"
              : "demo:1:fixture-job"
          )
        }
      >
        Change mode
      </button>
      <button
        onClick={() =>
          setDetail((value) => ({
            ...value,
            sandbox: { ...value.sandbox, generation: value.sandbox.generation + 1 }
          }))
        }
      >
        Change generation
      </button>
      <button
        onClick={() =>
          setDetail((value) => ({
            ...value,
            job: {
              ...value.job,
              jobId: `${value.job.jobId}-other` as typeof value.job.jobId
            }
          }))
        }
      >
        Change job
      </button>
      <button
        onClick={() =>
          setDetail({
            ...original,
            payload: {
              ...original.payload,
              _tag: "Available",
              formatVersion: 1,
              catalog: Crypto.syntheticDocumentCatalog,
              encoded: { document: { ...encrypted, fingerprint: "0".repeat(64) } },
              validation: "Valid",
              encryption: "SyntheticDocumentV1"
            }
          })
        }
      >
        Tamper fixture
      </button>
      <button
        onClick={() =>
          setDetail({
            ...original,
            payload: {
              _tag: "Available",
              formatVersion: 1,
              catalog: { ...Crypto.syntheticDocumentCatalog, kind: "unsupported" },
              encoded: { document: encrypted },
              validation: "Valid",
              encryption: "SyntheticDocumentV1"
            }
          })
        }
      >
        Unsupported fixture
      </button>
      <button
        onClick={() =>
          setDetail({
            ...original,
            payload: { _tag: "Unavailable", reason: "not-stored" }
          })
        }
      >
        Missing fixture
      </button>
      <button
        onClick={() =>
          setDetail({
            ...original,
            payload: {
              _tag: "Available",
              formatVersion: 1,
              catalog: {
                queue: "playground-private",
                kind: "playground.private-data-export",
                version: 1
              },
              encoded: { document: encrypted },
              validation: "Valid",
              encryption: "PrivateDocumentV1"
            }
          })
        }
      >
        Compatible private fixture
      </button>
      <button
        onClick={() =>
          setDetail({
            ...original,
            payload: {
              _tag: "Available",
              formatVersion: 1,
              catalog: Crypto.syntheticDocumentCatalog,
              encoded: { note: "<script>never-execute</script>", value: 42, truth: true },
              validation: "Valid",
              encryption: "None"
            }
          })
        }
      >
        Plain fixture
      </button>
      {shown ? (
        <JobPayloadPanel
          detail={detail}
          identityKey={identity}
          allowCopyEncoded={identity.startsWith("private:")}
        />
      ) : null}
    </>
  )
}
createRoot(document.getElementById("fixture")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)

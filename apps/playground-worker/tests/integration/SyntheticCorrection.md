# Synthetic document correction qualification

Private `/jobs` supports corrected redrive for the exact version 1
`playground-private/playground.synthetic-document-export` catalog. Unlock with
public demo code `123`, edit the readable JSON, inspect changed paths, provide
reason and investigation, confirm duplicate effects, and explicitly submit.
The browser seals the corrected document with a fresh AES-GCM nonce and keyed
HMAC fingerprint and verifies it locally before sending only the encrypted
representation. Plain payload fields retain their existing contract. Subject and
tenant must match actor and tenant; retained actor, tenant, order and sandbox
identity cannot change. Document note is bounded to 256 characters.

The server authenticates and validates the submitted envelope using the selected
synthetic schema. The existing same-client atomic corrected-redrive operation
owns successor creation, fresh budget and lineage. Source bytes and execution
state remain immutable. Application repair state starts InProgress; executor
outcomes reconcile separately, preserving unknown external outcome knowledge.
Lost responses use the existing exact request receipt; conflicting reuse fails.

Plaintext stays in ephemeral detail-lifetime React state. Relock, navigation,
reset, detail/version change and close cancel the form and pending crypto work;
stale crypto completions cannot issue commands. JavaScript strings/native crypto
copies have no guaranteed zeroization. This is public synthetic demo cryptography,
not support for production encrypted document correction. PrivateDocumentV1
remains unavailable for correction; public `/demo` remains read-only server-side.
The unchanged same-data redrive and displayed-payload copy behavior remain distinct.

`SyntheticCorrection.test.ts` exercises real crypto and the server/client
validation boundaries. `SyntheticCorrection.ts` and `SyntheticCorrection.mjs`
qualify actual PostgreSQL 16.15, workerd, production drawer/fullpage and executor
flows. `SyntheticCorrectionRun.py` provisions only a fresh owned resource with
bounded logs and exact-ID cleanup; no owner preview configuration is read.

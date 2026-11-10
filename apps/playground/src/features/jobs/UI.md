# Playground UI ownership and state

Dashboard only coordinates navigation, selection focus and layout. JobsList and
JobsTable subscribe to query/list/status and selection; JobsOverview reads summary
atoms. SessionStatus reads transport/session data. ScenarioLauncher and
JobDetailView own their independent clock subscriptions. No Dashboard stateAtom or
per-second clock subscription remains, and receipt notices cannot render the list.
The qualified Recharts visualization and compiled StyleX theme are retained.

FormAtoms adapts Effect 4 Atom registries to React's external-store boundary.
Every field acquires a private registry when subscribed. Layout cleanup immediately
revokes writes and resets its nodes; unsubscribe disposes the registry. StrictMode
resubscription acquires a fresh registry. No form atom uses keepAlive, a global
registry, a family, persistence, a URL or history. Initial values are nonsecret
empty/default values; forms must be keyed or revoked when identity changes.

SyntheticDocumentSession, payload plaintext and correction editors share the
selected detail lifetime, never the runtime registry. Existing abort/revision and
session-revision checks fence decrypt/seal completions. Relock, pagehide, popstate,
payload identity, mode/generation changes and unmount clear sensitive state. Local
key inputs remain uncontrolled and are cleared after reading. JavaScript strings
are dereferenced; this does not promise zeroization of browser/provider copies.
Commands receive only authenticated encoded replacements, retaining exact pending
request/receipt identity and unknown-outcome behavior.

Run the focused semantic browser qualification from the repository root:

```sh
node apps/playground/tests/ui/FormAtoms.browser.ts
```

It builds with the canonical Vite/StyleX configuration and synthetic local data.
It checks field isolation, StrictMode, actual authenticated unlock/relock,
generation/pagehide/popstate revocation, stale completion fencing and zero list
commits for clock/receipt-only updates. It does not qualify native Alchemy or PG.
Shared dependency/config pins and test registration remain the foundation owner's
responsibility; a disposable local Lucide install is evidence, not a canonical
locked-install qualification.

/* oxlint-disable effecttsgo/unstable-api-usage -- Effect 4.0.5 Atom is the owner-selected UI state API. */
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react"

// Each mounted form field owns a private registry. It cannot enter the runtime
// registry, a family/cache, persistence or navigation. Unsubscribe synchronously
// drops all values, including plaintext, and StrictMode can acquire a fresh one.
export const useFormAtom = <A>(initial: A): readonly [A, (value: A) => void] => {
  const store = useMemo(() => {
    const atom = Atom.make(initial)
    let registry: AtomRegistry.AtomRegistry | undefined
    let active = true
    return {
      get: () => (registry ? registry.get(atom) : initial),
      subscribe: (notify: () => void) => {
        const current = AtomRegistry.make()
        registry = current
        const unmount = current.mount(atom)
        const unsubscribe = current.subscribe(atom, notify)
        return () => {
          if (registry === current) {
            registry = undefined
          }
          unsubscribe()
          unmount()
          current.dispose()
        }
      },
      set: (value: A) => {
        if (active) {
          registry?.set(atom, value)
        }
      },
      acquire: () => {
        active = true
      },
      release: () => {
        active = false
        registry?.reset()
      }
    }
    // Initial values belong to the keyed component lifetime, like uncontrolled
    // input defaults. Prop identity/version changes must key or revoke the form.
  }, [])
  useLayoutEffect(() => {
    store.acquire()
    return store.release
  }, [store])
  return [useSyncExternalStore(store.subscribe, store.get, store.get), store.set]
}

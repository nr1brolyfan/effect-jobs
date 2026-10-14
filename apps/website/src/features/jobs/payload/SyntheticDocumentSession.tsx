import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react"
import type { Document } from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"

// Detail-lifetime React state only: never an Atom, command, storage or return context.
interface Session {
  readonly document: Document | null
  readonly revision: number
  readonly unlock: (document: Document) => void
  readonly revoke: () => void
  readonly current: (revision: number) => boolean
}
const Context = createContext<Session | null>(null)
export const useSyntheticDocumentSession = () => useContext(Context)
export const SyntheticDocumentSession = ({
  children
}: {
  readonly children: ReactNode
}) => {
  const [document, setDocument] = useState<Document | null>(null)
  const [revision, setRevision] = useState(0)
  const lifetime = useRef({ revision: 0, mounted: true })
  const revoke = () => {
    lifetime.current.revision++
    setDocument(null)
    setRevision(lifetime.current.revision)
  }
  useLayoutEffect(() => {
    lifetime.current.mounted = true
    window.addEventListener("pagehide", revoke)
    window.addEventListener("popstate", revoke)
    return () => {
      lifetime.current.mounted = false
      lifetime.current.revision++
      window.removeEventListener("pagehide", revoke)
      window.removeEventListener("popstate", revoke)
    }
  }, [])
  return (
    <Context.Provider
      value={{
        document,
        revision,
        revoke,
        unlock: (value) => {
          revoke()
          setDocument(value)
        },
        current: (value) =>
          lifetime.current.mounted && lifetime.current.revision === value
      }}
    >
      {children}
    </Context.Provider>
  )
}

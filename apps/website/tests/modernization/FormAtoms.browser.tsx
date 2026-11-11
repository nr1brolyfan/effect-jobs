import { afterEach, expect, test } from "vitest"
import { StrictMode, act, useEffect } from "react"
import { useFormAtom } from "../../../playground/src/features/jobs/FormAtoms.js"
import { mount } from "./BrowserMount.js"

let mounted: Awaited<ReturnType<typeof mount>> | undefined
const setters = new Map<string, (value: string) => void>()
afterEach(async () => {
  await mounted?.dispose()
  mounted = undefined
  setters.clear()
})

function Field(props: { readonly name: string }) {
  const [value, set] = useFormAtom("")
  useEffect(() => {
    setters.set(props.name, set)
  }, [props.name, set])
  return <output aria-label={props.name}>{value}</output>
}

test("simultaneous form lifetimes isolate state; revoked setters cannot mutate a remounted field", async () => {
  const view = (
    <StrictMode>
      <Field name="left" />
      <Field name="right" />
    </StrictMode>
  )
  mounted = await mount(view)
  const left = setters.get("left")!
  const right = setters.get("right")!
  await act(async () => {
    left("detail-session-only")
    right("independent")
  })
  const values = () =>
    Array.from(mounted!.container.querySelectorAll("output"), (node) => node.textContent)
  expect(values()).toEqual(["detail-session-only", "independent"])
  await mounted.dispose()
  mounted = undefined
  await act(async () => {
    left("late-result")
    right("late-result")
  })
  mounted = await mount(view)
  expect(values()).toEqual(["", ""])
  await act(async () => {
    left("stale-result")
    setters.get("right")!("new-lifetime")
  })
  expect(values()).toEqual(["", "new-lifetime"])
  expect(document.body.textContent).not.toContain("detail-session-only")
})

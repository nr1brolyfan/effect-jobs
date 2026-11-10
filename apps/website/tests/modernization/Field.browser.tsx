import { afterEach, expect, test } from "vitest"
import { createElement, type ReactElement } from "react"
import { page, userEvent } from "vitest/browser"
import {
  Button,
  Icon,
  Field,
  type IconName
} from "../../../playground/src/ui/Primitives.js"
import { mount } from "./BrowserMount.js"

let mounted: Awaited<ReturnType<typeof mount>> | undefined

afterEach(async () => {
  await mounted?.dispose()
  mounted = undefined
})

const field = (label: string, control: ReactElement<{ id?: string }>) => (
  <Field label={label} key={label}>
    {control}
  </Field>
)

const associations = (container: HTMLElement) => {
  const labels = Array.from(container.querySelectorAll("label"), (label) => label.htmlFor)
  const controls = Array.from(
    container.querySelectorAll("input, select, textarea"),
    (control) => control.id
  )
  expect(labels).toEqual(controls)
  expect(controls.every((id) => id.length > 0)).toBe(true)
  expect(new Set(controls).size).toBe(controls.length)
  return controls
}

test("Field associates generated native and custom controls with unique labels", async () => {
  const CustomControl = (props: { readonly id?: string }) => <input id={props.id} />
  mounted = await mount(
    <form>
      {field("Search", <input defaultValue="kept" />)}
      {field(
        "State",
        <select>
          <option>All</option>
        </select>
      )}
      {field("Notes", <textarea id="" defaultValue="notes" />)}
      {field("Custom", createElement(CustomControl))}
    </form>
  )
  expect(associations(mounted.container)).toHaveLength(4)
  expect(mounted.container.querySelector("input")?.value).toBe("kept")
  expect(mounted.container.querySelector("textarea")?.value).toBe("notes")
})

test("Field preserves explicit id and native checkbox props", async () => {
  mounted = await mount(
    field(
      "Only due",
      <input
        id="due-jobs"
        type="checkbox"
        defaultChecked
        disabled
        className="caller-control"
        style={{ color: "red" }}
      />
    )
  )
  expect(associations(mounted.container)).toEqual(["due-jobs"])
  const input = mounted.container.querySelector("input")!
  expect(input.type).toBe("checkbox")
  expect(input.checked).toBe(true)
  expect(input.disabled).toBe(true)
  expect(input.classList.contains("caller-control")).toBe(true)
  expect(input.style.color).toBe("red")
})

test("decorative icon preserves the button's accessible name and keyboard activation", async () => {
  let clicks = 0
  mounted = await mount(
    <Button
      onClick={() => {
        clicks++
      }}
    >
      <Icon name="refresh" />
      Refresh reads
    </Button>
  )
  const button = page.getByRole("button", { name: "Refresh reads", exact: true })
  await expect.element(button).toBeVisible()
  const svg = mounted.container.querySelector("svg")!
  expect(svg.getAttribute("aria-hidden")).toBe("true")
  expect(svg.getAttribute("focusable")).toBe("false")
  await button.click()
  expect(clicks).toBe(1)
  const native = mounted.container.querySelector("button")!
  native.focus()
  await userEvent.keyboard("{Enter}")
  expect(clicks).toBe(2)
})

const iconCases = [
  ["grid", "layout-grid"],
  ["jobs", "briefcase-business"],
  ["activity", "activity"],
  ["layers", "layers"],
  ["settings", "settings"],
  ["chevron", "chevron-right"],
  ["down", "chevron-down"],
  ["search", "search"],
  ["refresh", "refresh-cw"],
  ["plus", "plus"],
  ["check", "check"],
  ["clock", "clock"],
  ["alert", "triangle-alert"],
  ["arrow", "arrow-right"],
  ["book", "book-open"],
  ["shield", "shield-check"],
  ["close", "x"],
  ["filter", "list-filter"],
  ["code", "code"],
  ["mail", "mail"],
  ["image", "image"],
  ["webhook", "webhook"],
  ["upload", "upload"],
  ["terminal", "terminal"],
  ["globe", "globe"]
] as const satisfies ReadonlyArray<readonly [IconName, string]>

test("all public icon names render named Lucide graphics with decorative semantics and sizing", async () => {
  mounted = await mount(
    <div>
      {iconCases.map(([name]) => (
        <Icon key={name} name={name} />
      ))}
      <Icon name="refresh" size={32} />
    </div>
  )
  const graphics = Array.from(mounted.container.querySelectorAll("svg"))
  expect(graphics).toHaveLength(iconCases.length + 1)
  for (const [index, [, lucide]] of iconCases.entries()) {
    const svg = graphics[index]!
    expect(svg.classList.contains(`lucide-${lucide}`)).toBe(true)
    expect(svg.getAttribute("width")).toBe("18")
    expect(svg.getAttribute("height")).toBe("18")
    expect(svg.getAttribute("stroke-width")).toBe("1.5")
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect(svg.getAttribute("focusable")).toBe("false")
    expect(svg.children.length).toBeGreaterThan(0)
  }
  expect(graphics.at(-1)!.getAttribute("width")).toBe("32")
  expect(graphics.at(-1)!.getAttribute("height")).toBe("32")
})

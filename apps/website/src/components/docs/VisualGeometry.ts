import { useEffect, useRef, type RefObject } from "react"
import type { Variant } from "./VisualState.js"
interface Connection {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly color: string
  readonly at: number
  readonly label: string
}
export const connectionMap: Record<Variant, ReadonlyArray<Connection>> = {
  overview: [
    { id: "save", from: "api", to: "database", color: "#64aaff", at: 1, label: "order" },
    { id: "claim", from: "job", to: "worker", color: "#e7bd65", at: 3, label: "job" },
    { id: "send", from: "worker", to: "email", color: "#b39aff", at: 4, label: "mail" }
  ],
  transaction: [
    { id: "claim", from: "job", to: "worker", color: "#e7bd65", at: 4, label: "job" }
  ],
  handoff: [
    {
      id: "confirmation",
      from: "origin",
      to: "confirmation",
      color: "#b39aff",
      at: 1,
      label: "job"
    },
    {
      id: "invoice",
      from: "origin",
      to: "invoice",
      color: "#e7bd65",
      at: 1,
      label: "job"
    },
    {
      id: "delivery",
      from: "invoice",
      to: "delivery",
      color: "#69c6a5",
      at: 3,
      label: "job"
    }
  ]
}

/** Native SVG measurement/rAF FFI. React owns nodes and all semantic playback state. */
export const useGeometry = (
  root: RefObject<HTMLElement | null>,
  connections: ReadonlyArray<Connection>,
  step: number,
  enabled: boolean,
  running: boolean,
  advance: () => void
) => {
  const onAdvance = useRef(advance)
  onAdvance.current = advance
  useEffect(() => {
    const element = root.current
    if (!element) {
      return
    }
    const stage = element.querySelector<HTMLElement>(".jv-stage")!
    const node = (name: string) =>
      element.querySelector<HTMLElement>(`[data-node="${name}"]`)!
    const path = (id: string) =>
      element.querySelector<SVGPathElement>(`[data-connection="${id}"]`)!
    const layout = () => {
      const box = stage.getBoundingClientRect()
      element
        .querySelector(".jv-wires")!
        .setAttribute("viewBox", `0 0 ${box.width} ${box.height}`)
      for (const connection of connections) {
        const from = node(connection.from).getBoundingClientRect()
        const to = node(connection.to).getBoundingClientRect()
        const horizontal =
          Math.abs(to.left - from.left) > from.width * 0.6 &&
          !(to.top >= from.bottom + 10 && to.left < from.right)
        const forward = horizontal ? to.left > from.left : to.top > from.top
        const a = {
          x:
            (horizontal
              ? forward
                ? from.right
                : from.left
              : from.left + from.width / 2) - box.left,
          y:
            (horizontal ? from.top + from.height / 2 : forward ? from.bottom : from.top) -
            box.top
        }
        const b = {
          x:
            (horizontal ? (forward ? to.left : to.right) : to.left + to.width / 2) -
            box.left,
          y:
            (horizontal ? to.top + to.height / 2 : forward ? to.top : to.bottom) - box.top
        }
        const bend = horizontal ? (a.x + b.x) / 2 : (a.y + b.y) / 2
        path(connection.id).setAttribute(
          "d",
          horizontal
            ? `M${a.x} ${a.y} C${bend} ${a.y} ${bend} ${b.y} ${b.x} ${b.y}`
            : `M${a.x} ${a.y} C${a.x} ${bend} ${b.x} ${bend} ${b.x} ${b.y}`
        )
      }
    }
    const observer = new ResizeObserver(layout)
    observer.observe(stage)
    element.querySelectorAll("[data-node]").forEach((item) => observer.observe(item))
    layout()
    return () => observer.disconnect()
  }, [root, connections])
  useEffect(() => {
    const element = root.current
    if (!element) {
      return
    }
    const packets = connections.map((connection) => ({
      connection,
      path: element.querySelector<SVGPathElement>(
        `[data-connection="${connection.id}"]`
      )!,
      packet: element.querySelector<SVGGElement>(`[data-packet="${connection.id}"]`)!
    }))
    for (const item of packets) {
      item.packet.setAttribute("opacity", "0")
    }
    if (!running) {
      return
    }
    let frame: number
    let previous: number | undefined
    let progress = 0
    const tick = (now: number) => {
      if (previous !== undefined) {
        progress += Math.min(now - previous, 100) / 1300
      }
      previous = now
      if (progress >= 1) {
        onAdvance.current()
        return
      }
      for (const item of packets) {
        if (!enabled || item.connection.at !== step + 1) {
          continue
        }
        const point = item.path.getPointAtLength(item.path.getTotalLength() * progress)
        item.packet.setAttribute("transform", `translate(${point.x} ${point.y})`)
        item.packet.setAttribute(
          "opacity",
          String(Math.min(1, progress * 8, (1 - progress) * 8))
        )
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      for (const item of packets) {
        item.packet.setAttribute("opacity", "0")
      }
    }
  }, [root, connections, step, enabled, running])
}

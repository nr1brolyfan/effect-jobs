type Variant = "overview" | "transaction" | "handoff"
type Side = "left" | "right" | "top" | "bottom"
interface Connection {
  id: string
  from: string
  to: string
  color: string
  at: number
  label: string
  path: SVGPathElement
  packet: SVGGElement
}

const svgNamespace = "http://www.w3.org/2000/svg"
let sequence = 0

class JobVisual extends HTMLElement {
  private variant: Variant = "overview"
  private step = 0
  private progress = 0
  private playing = false
  private visible = false
  private mode: "commit" | "rollback" = "commit"
  private frame: number | undefined
  private previous: number | undefined
  private connections: Connection[] = []
  private abort: AbortController | undefined
  private resize: ResizeObserver | undefined
  private intersection: IntersectionObserver | undefined
  private motion: MediaQueryList | undefined

  connectedCallback() {
    const variant = this.dataset.jobVisual
    if (variant !== "overview" && variant !== "transaction" && variant !== "handoff")
      return
    this.variant = variant
    this.abort = new AbortController()
    const options = { signal: this.abort.signal }
    this.motion = matchMedia("(prefers-reduced-motion: reduce)")
    const wire = this.querySelector<SVGSVGElement>(".jv-wires")!
    const marker = wire.querySelector("marker")!
    marker.id = `jv-arrow-${++sequence}`
    const add = (
      id: string,
      from: string,
      to: string,
      color: string,
      at: number,
      label = "job"
    ) => {
      const path = document.createElementNS(svgNamespace, "path")
      path.classList.add("jv-wire")
      path.dataset.connection = id
      path.style.setProperty("--wire-color", color)
      path.setAttribute("marker-end", `url(#${marker.id})`)
      const packet = document.createElementNS(svgNamespace, "g")
      packet.classList.add("jv-packet")
      packet.style.setProperty("--wire-color", color)
      packet.setAttribute("opacity", "0")
      const box = document.createElementNS(svgNamespace, "rect")
      box.setAttribute("x", "-22")
      box.setAttribute("y", "-11")
      box.setAttribute("width", "44")
      box.setAttribute("height", "22")
      box.setAttribute("rx", "4")
      const text = document.createElementNS(svgNamespace, "text")
      text.textContent = label
      packet.append(box, text)
      wire.append(path, packet)
      this.connections.push({ id, from, to, color, at, label, path, packet })
    }
    if (variant === "overview") {
      add("save", "api", "database", "#64aaff", 1, "order")
      add("claim", "job", "worker", "#e7bd65", 3)
      add("send", "worker", "email", "#b39aff", 4, "mail")
    } else if (variant === "transaction") {
      add("claim", "job", "worker", "#e7bd65", 4)
    } else {
      add("confirmation", "origin", "confirmation", "#b39aff", 1)
      add("invoice", "origin", "invoice", "#e7bd65", 1)
      add("delivery", "invoice", "delivery", "#69c6a5", 3)
    }
    this.querySelectorAll<HTMLElement>(".jv-controls, .jv-modes").forEach((element) => {
      element.hidden = false
    })
    this.querySelector("[data-action=step]")!.addEventListener(
      "click",
      () => {
        this.pause()
        this.progress = 0
        this.step = Math.min(this.maximum, this.step + 1)
        this.render()
      },
      options
    )
    this.querySelector("[data-action=reset]")!.addEventListener(
      "click",
      () => this.reset(),
      options
    )
    this.querySelector("[data-action=play]")!.addEventListener(
      "click",
      () => {
        if (this.playing) this.pause()
        else {
          if (this.step === this.maximum) this.step = 0
          this.playing = true
          this.render()
          this.schedule()
        }
      },
      options
    )
    this.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          this.mode = button.dataset.mode === "rollback" ? "rollback" : "commit"
          this.reset()
        },
        options
      )
    })
    document.addEventListener("visibilitychange", () => this.schedule(), options)
    this.motion.addEventListener(
      "change",
      () => {
        if (this.motion?.matches) this.pause()
        this.schedule()
      },
      options
    )
    this.resize = new ResizeObserver(() => this.layout())
    this.resize.observe(this.querySelector(".jv-stage")!)
    this.querySelectorAll("[data-node]").forEach((node) => this.resize!.observe(node))
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting)
      this.schedule()
    })
    this.intersection.observe(this)
    this.render()
    this.layout()
  }

  disconnectedCallback() {
    this.pause()
    this.abort?.abort()
    this.resize?.disconnect()
    this.intersection?.disconnect()
    for (const connection of this.connections) {
      connection.path.remove()
      connection.packet.remove()
    }
    this.connections = []
  }

  private get maximum() {
    return this.variant === "transaction" ? 4 : 5
  }
  private node(name: string) {
    return this.querySelector<HTMLElement>(`[data-node="${name}"]`)!
  }
  private text(name: string, value: string) {
    const label = this.querySelector<HTMLElement>(`[data-label="${name}"]`)!
    label.textContent = value
    label.dataset.done = String(
      ["201 Created", "Completed", "Sent", "Done"].includes(value)
    )
  }
  private active(name: string, active: boolean) {
    this.node(name).dataset.active = String(active)
  }

  private render() {
    const s = this.step
    this.dataset.step = String(s)
    this.dataset.playing = String(this.playing)
    this.dataset.outcome = this.mode
    let stages: string[]
    if (this.variant === "overview") {
      stages = [
        "Ready",
        "Order + job committed",
        "Order accepted",
        "Worker claims the job",
        "Confirmation sent",
        "Job completed"
      ]
      this.text("response", s >= 2 ? "201 Created" : s === 1 ? "Saved" : "Ready")
      this.text("order", s >= 1 ? "#041" : "—")
      this.text("orderState", s >= 1 ? "✓" : "")
      this.text(
        "jobState",
        s >= 5 ? "Completed" : s >= 3 ? "Active" : s >= 1 ? "Pending" : "—"
      )
      this.text(
        "workerState",
        s >= 5 ? "Done" : s === 4 ? "Finalizing" : s === 3 ? "Sending…" : "Waiting"
      )
      this.text("emailState", s >= 4 ? "Sent" : "—")
      this.active("api", s >= 1)
      this.active("job", s >= 1)
      this.active("worker", s >= 3)
      this.active("email", s >= 4)
    } else if (this.variant === "transaction") {
      const rolledBack = this.mode === "rollback" && s >= 3
      const committed = this.mode === "commit" && s >= 3
      stages = [
        "Ready",
        "Insert order",
        "Enqueue confirmation",
        rolledBack ? "Nothing persisted" : "Both records committed",
        rolledBack ? "Nothing to claim" : "Worker claims the job"
      ]
      this.text("decision", s >= 3 ? (rolledBack ? "ROLLBACK" : "COMMIT") : "Uncommitted")
      this.text("order", s >= 1 && !rolledBack ? "#041" : "—")
      this.text("job", s >= 2 && !rolledBack ? "Confirmation" : "—")
      this.text("orderState", committed ? "✓" : "")
      this.text("jobState", committed ? "✓" : "")
      this.text("workerState", rolledBack ? "No job" : s === 4 ? "Claimed" : "Waiting")
      this.node("boundary").dataset.result = s >= 3 ? this.mode : "staged"
      this.active("order", s >= 1 && !rolledBack)
      this.active("job", s >= 2 && !rolledBack)
      this.active("worker", committed && s === 4)
      this.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) =>
        button.setAttribute("aria-pressed", String(button.dataset.mode === this.mode))
      )
    } else {
      stages = [
        "Ready",
        "Two independent jobs",
        "Both handlers run",
        "Invoice saved + delivery enqueued",
        "Delivery runs independently",
        "Both emails sent"
      ]
      this.text(
        "confirmationState",
        s === 5 ? "Completed" : s >= 2 ? "Active" : s === 1 ? "Pending" : "—"
      )
      this.text(
        "invoiceState",
        s >= 3 ? "Completed" : s === 2 ? "Active" : s === 1 ? "Pending" : "—"
      )
      this.text(
        "deliveryState",
        s === 5 ? "Completed" : s === 4 ? "Active" : s === 3 ? "Pending" : "—"
      )
      this.active("origin", s >= 1)
      this.active("confirmation", s >= 2)
      this.active("invoice", s >= 2)
      this.active("delivery", s >= 4)
      this.node("delivery").dataset.dim = String(s < 3)
    }
    this.text("progress", stages[s]!)
    const next = this.querySelector<HTMLButtonElement>("[data-action=step]")!
    next.disabled = s === this.maximum
    const play = this.querySelector<HTMLButtonElement>("[data-action=play]")!
    play.textContent = this.playing ? "Pause" : s === this.maximum ? "Replay" : "Play"
    play.setAttribute("aria-pressed", String(this.playing))
    for (const connection of this.connections) {
      const enabled = !(this.variant === "transaction" && this.mode === "rollback")
      connection.path.dataset.active = String(enabled && s >= connection.at)
      connection.packet.setAttribute("opacity", "0")
    }
  }

  private layout() {
    const stage = this.querySelector<HTMLElement>(".jv-stage")!
    const box = stage.getBoundingClientRect()
    this.querySelector(".jv-wires")!.setAttribute(
      "viewBox",
      `0 0 ${box.width} ${box.height}`
    )
    const point = (name: string, side: Side) => {
      const r = this.node(name).getBoundingClientRect()
      return {
        x:
          (side === "left" ? r.left : side === "right" ? r.right : r.left + r.width / 2) -
          box.left,
        y:
          (side === "top" ? r.top : side === "bottom" ? r.bottom : r.top + r.height / 2) -
          box.top
      }
    }
    for (const connection of this.connections) {
      const fromBox = this.node(connection.from).getBoundingClientRect()
      const toBox = this.node(connection.to).getBoundingClientRect()
      const horizontal =
        Math.abs(toBox.left - fromBox.left) > fromBox.width * 0.6 &&
        !(toBox.top >= fromBox.bottom + 10 && toBox.left < fromBox.right)
      const forward = horizontal ? toBox.left > fromBox.left : toBox.top > fromBox.top
      const a = point(
        connection.from,
        horizontal ? (forward ? "right" : "left") : forward ? "bottom" : "top"
      )
      const b = point(
        connection.to,
        horizontal ? (forward ? "left" : "right") : forward ? "top" : "bottom"
      )
      const bend = horizontal ? (a.x + b.x) / 2 : (a.y + b.y) / 2
      connection.path.setAttribute(
        "d",
        horizontal
          ? `M${a.x} ${a.y} C${bend} ${a.y} ${bend} ${b.y} ${b.x} ${b.y}`
          : `M${a.x} ${a.y} C${a.x} ${bend} ${b.x} ${bend} ${b.x} ${b.y}`
      )
    }
  }

  private reset() {
    this.pause()
    this.progress = 0
    this.step = 0
    this.render()
  }
  private pause() {
    this.playing = false
    this.schedule()
    this.render()
    this.drawPackets()
  }
  private schedule() {
    const running =
      this.playing && this.visible && !document.hidden && !this.motion?.matches
    if (!running) {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame)
      this.frame = undefined
      this.previous = undefined
      return
    }
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame((now) => this.tick(now))
  }
  private tick(now: number) {
    this.frame = undefined
    if (this.previous !== undefined)
      this.progress += Math.min(now - this.previous, 100) / 1300
    this.previous = now
    if (this.progress >= 1) {
      this.progress = 0
      this.step++
      if (this.step === this.maximum) this.playing = false
      this.render()
    }
    this.drawPackets()
    this.schedule()
  }

  private drawPackets() {
    for (const connection of this.connections) {
      if (
        this.progress === 0 ||
        connection.at !== this.step + 1 ||
        (this.variant === "transaction" && this.mode === "rollback")
      )
        continue
      const point = connection.path.getPointAtLength(
        connection.path.getTotalLength() * this.progress
      )
      connection.packet.setAttribute("transform", `translate(${point.x} ${point.y})`)
      connection.packet.setAttribute(
        "opacity",
        String(Math.min(1, this.progress * 8, (1 - this.progress) * 8))
      )
    }
  }
}

if (!customElements.get("job-visual")) customElements.define("job-visual", JobVisual)

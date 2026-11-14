import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  PlaybackClock,
  transactionStages,
  workerStages,
  codeOperations
} from "./PlaybackClock.js"
import type { SceneKind, CodeOperation } from "./PlaybackClock.js"

type Outcome = "commit" | "rollback"

/** One RAF clock owns phase timing, countdowns and the paused Web Animation.
 * Observers, DOM events and Web Animations are owned browser FFI. */
export default function Playback() {
  const root = useRef<HTMLDivElement>(null)
  const animation = useRef<Animation | null>(null)
  const [transaction] = useState(() => new PlaybackClock(transactionStages))
  const [worker] = useState(() => new PlaybackClock(workerStages))
  const [outcome, setOutcome] = useState<Outcome>("commit")
  const selectedOutcome = useRef<Outcome>("commit")
  const [, render] = useState(0)
  const [portals, setPortals] = useState<{
    transaction: HTMLElement
    worker: HTMLElement
  } | null>(null)
  const [environment, setEnvironment] = useState({
    ready: false,
    reduced: false,
    transactionVisible: false,
    workerVisible: false
  })
  const operations = useRef(new Map<HTMLElement, CodeOperation>())
  const seekRef = useRef<((kind: SceneKind, phase: number) => void) | null>(null)
  const tickRef = useRef<((now: number) => void) | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const settle = () => tickRef.current?.(performance.now())
  const refresh = () => {
    drawRef.current?.()
    render((version) => version + 1)
  }
  const txPhase = environment.ready ? transaction.phase : 3
  const workerPhase = environment.ready ? worker.phase : 4
  const eligible = txPhase === 3 && outcome === "commit"
  const txPlaying =
    environment.ready &&
    !environment.reduced &&
    environment.transactionVisible &&
    !transaction.paused &&
    !transaction.terminal
  const workerPlaying =
    environment.ready &&
    !environment.reduced &&
    environment.workerVisible &&
    !worker.paused &&
    !worker.terminal &&
    eligible

  drawRef.current = () => {
    const main = root.current?.closest("main")
    const tx = main?.querySelector<HTMLElement>("#transaction")
    const execution = main?.querySelector<HTMLElement>("#handler")
    if (!main || !tx || !execution) {
      return
    }
    const currentTx = environment.ready ? transaction.phase : 3
    const currentWorker = environment.ready ? worker.phase : 4
    const committed = currentTx === 3 && outcome === "commit"
    main.dataset.outcome = outcome
    main.dataset.result = currentTx < 3 ? "pending" : committed ? "saved" : "rolled-back"
    tx.dataset.phase = String(currentTx)
    execution.dataset.phase = String(currentWorker)
    tx.dataset.focused = String(environment.ready && transaction.focused)
    execution.dataset.focused = String(environment.ready && committed && worker.focused)
    tx.dataset.playing = String(txPlaying && !transaction.paused && !transaction.terminal)
    execution.dataset.playing = String(
      workerPlaying && !worker.paused && !worker.terminal && committed
    )
    for (const [scene, clock] of [
      [tx, transaction],
      [execution, worker]
    ] as const) {
      scene.dataset.remainingMs = String(clock.remaining)
      scene.dataset.elapsedMs = String(clock.elapsed)
      scene.querySelectorAll<HTMLElement>("[data-stage]").forEach((button) => {
        const active = button.dataset.stage === String(clock.phase)
        button
          .querySelector<HTMLElement>(".stage-progress")
          ?.style.setProperty("transform", `scaleX(${active ? clock.ratio : 0})`)
      })
    }
    for (const [line, operation] of operations.current) {
      const allowed = operation.kind === "transaction" || committed
      const clock = operation.kind === "transaction" ? transaction : worker
      line.dataset.active = String(operation.active.includes(clock.phase))
      line.setAttribute("aria-disabled", String(!allowed))
      if (line.getAttribute("role") === "button") {
        line.tabIndex = allowed ? 0 : -1
      }
    }
    if (worker.phase === 1 && animation.current) {
      animation.current.currentTime = worker.elapsed
    }
  }

  useEffect(() => {
    const main = root.current?.closest("main")
    const tx = main?.querySelector<HTMLElement>("#transaction")
    const execution = main?.querySelector<HTMLElement>("#handler")
    const txPortal = main?.querySelector<HTMLElement>("#transaction-stages")
    const workerPortal = main?.querySelector<HTMLElement>("#worker-controls")
    if (!main || !tx || !execution || !txPortal || !workerPortal) {
      return
    }
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    let txVisible = false
    let workerVisible = false
    const update = () => {
      settle()
      const next = {
        ready: true,
        reduced: motion.matches,
        transactionVisible: tx.isConnected && txVisible && !document.hidden,
        workerVisible: execution.isConnected && workerVisible && !document.hidden
      }
      setEnvironment((previous) =>
        previous.ready === next.ready &&
        previous.reduced === next.reduced &&
        previous.transactionVisible === next.transactionVisible &&
        previous.workerVisible === next.workerVisible
          ? previous
          : next
      )
    }
    if (motion.matches) {
      transaction.finish()
      worker.finish()
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === tx) {
          txVisible = entry.isIntersecting
        }
        if (entry.target === execution) {
          workerVisible = entry.isIntersecting
        }
      }
      update()
    })
    observer.observe(tx)
    observer.observe(execution)
    const connection = new MutationObserver(update)
    connection.observe(document.body, { childList: true, subtree: true })
    const changed = () => {
      settle()
      animation.current?.cancel()
      transaction.finish()
      if (motion.matches) {
        worker.finish()
      } else {
        worker.reset()
      }
      update()
      refresh()
    }
    for (const operation of codeOperations) {
      const lines = main.querySelectorAll<HTMLElement>(`${operation.selector} .line`)
      for (let index = operation.first; index <= operation.last; index++) {
        const line = lines[index - 1]!
        operations.current.set(line, operation)
        line.dataset.codeSeek = String(operation.phase)
        if (index === operation.first) {
          line.setAttribute("role", "button")
          line.setAttribute("aria-label", `Inspect: ${operation.label}`)
          line.tabIndex = 0
        }
      }
    }
    const codeSeek = (event: MouseEvent | KeyboardEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-code-seek]")
          : null
      const operation = target ? operations.current.get(target) : undefined
      if (!target || !operation) {
        return
      }
      if (event instanceof KeyboardEvent) {
        if (
          target.getAttribute("role") !== "button" ||
          (event.key !== "Enter" && event.key !== " ")
        ) {
          return
        }
        event.preventDefault()
      } else if (!document.getSelection()?.isCollapsed) {
        return
      }
      seekRef.current?.(operation.kind, operation.phase)
    }
    main.addEventListener("click", codeSeek)
    main.addEventListener("keydown", codeSeek)
    motion.addEventListener("change", changed)
    document.addEventListener("visibilitychange", update)
    setPortals({ transaction: txPortal, worker: workerPortal })
    update()
    return () => {
      observer.disconnect()
      connection.disconnect()
      main.removeEventListener("click", codeSeek)
      main.removeEventListener("keydown", codeSeek)
      motion.removeEventListener("change", changed)
      document.removeEventListener("visibilitychange", update)
      animation.current?.cancel()
      for (const line of operations.current.keys()) {
        for (const name of [
          "role",
          "tabindex",
          "aria-label",
          "aria-disabled",
          "data-code-seek",
          "data-active"
        ]) {
          line.removeAttribute(name)
        }
      }
      operations.current.clear()
      main.dataset.result = "saved"
      main.dataset.outcome = "commit"
      tx.dataset.phase = "3"
      execution.dataset.phase = "4"
      tx.dataset.focused = execution.dataset.focused = "false"
      execution.dataset.playing = tx.dataset.playing = "false"
    }
  }, [transaction, worker])

  useLayoutEffect(() => {
    drawRef.current?.()
  })

  // Only one requestAnimationFrame runs. Pausing captures the last partial frame;
  // resuming starts a fresh timestamp without resetting either elapsed value.
  useEffect(() => {
    if (!txPlaying && !workerPlaying) {
      return
    }
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const delta = Math.max(0, now - last)
      last = now
      const txChanged = txPlaying && transaction.advance(delta)
      const workerChanged =
        workerPlaying &&
        transaction.terminal &&
        selectedOutcome.current === "commit" &&
        worker.advance(delta)
      drawRef.current?.()
      if (txChanged || workerChanged) {
        render((version) => version + 1)
      }
    }
    const next = (now: number) => {
      tick(now)
      frame = requestAnimationFrame(next)
    }
    tickRef.current = tick
    frame = requestAnimationFrame(next)
    return () => {
      cancelAnimationFrame(frame)
      if (tickRef.current === tick) {
        tickRef.current = null
      }
    }
  }, [txPlaying, workerPlaying, transaction, worker, transaction.run, worker.run])

  // This Web Animation NEVER plays on its own. The shared stage clock seeks its
  // currentTime, so pause/hidden/reflow cannot diverge from the countdown.
  useLayoutEffect(() => {
    if (!eligible || workerPhase !== 1) {
      return
    }
    const scene = root.current?.closest("main")?.querySelector("#handler")
    const flow = scene?.querySelector<HTMLElement>(".worker-flow")
    const source = scene?.querySelector<HTMLElement>(".stored-job")
    const target = scene?.querySelector<HTMLElement>(".received-job")
    const row = scene?.querySelector<HTMLElement>(".travel-row")
    if (!flow || !source || !target || !row) {
      return
    }
    const frames = () => {
      const origin = flow.getBoundingClientRect()
      const from = source.getBoundingClientRect()
      const to = target.getBoundingClientRect()
      row.style.width = `${from.width}px`
      return [
        {
          transform: `translate(${from.left - origin.left}px, ${from.top - origin.top}px)`
        },
        { transform: `translate(${to.left - origin.left}px, ${to.top - origin.top}px)` }
      ]
    }
    const moving = row.animate(frames(), {
      duration: workerStages[1]!.duration,
      easing: "ease-in-out",
      fill: "both"
    })
    moving.pause()
    moving.currentTime = worker.elapsed
    animation.current = moving
    const reflow = new ResizeObserver(() => {
      if (moving.effect instanceof KeyframeEffect) {
        moving.effect.setKeyframes(frames())
      }
    })
    reflow.observe(flow)
    return () => {
      reflow.disconnect()
      moving.cancel()
      if (animation.current === moving) {
        animation.current = null
      }
    }
  }, [eligible, workerPhase, worker.run, worker])

  const seek = (kind: SceneKind, phase: number) => {
    if (
      kind === "worker" &&
      (!transaction.terminal || selectedOutcome.current !== "commit")
    ) {
      return
    }
    settle()
    animation.current?.cancel()
    if (kind === "transaction") {
      transaction.seek(phase)
      worker.reset(true)
    } else {
      worker.seek(phase)
    }
    refresh()
  }
  seekRef.current = seek
  const select = (selected: Outcome) => {
    if (selected === outcome) {
      return
    }
    settle()
    animation.current?.cancel()
    selectedOutcome.current = selected
    setOutcome(selected)
    transaction.reset()
    worker.reset()
    if (environment.reduced) {
      transaction.finish()
      worker.finish()
    }
    refresh()
  }
  const toggle = (kind: SceneKind) => {
    if (
      kind === "worker" &&
      (!transaction.terminal || selectedOutcome.current !== "commit")
    ) {
      return
    }
    const clock = kind === "transaction" ? transaction : worker
    const replay = clock.terminal
    settle()
    if (replay) {
      animation.current?.cancel()
      clock.reset()
      if (kind === "transaction") {
        worker.reset()
      }
    } else if (clock.paused) {
      clock.resume()
    } else {
      clock.pause()
    }
    refresh()
  }
  const action = (clock: PlaybackClock) =>
    clock.terminal ? "Replay" : clock.paused ? "Play" : "Pause"
  const playButton = (kind: SceneKind) => {
    const clock = kind === "transaction" ? transaction : worker
    return createElement(
      "button",
      {
        className: `playback ${kind === "transaction" ? "transaction" : "worker"}-playback`,
        type: "button",
        hidden:
          !environment.ready || environment.reduced || (kind === "worker" && !eligible),
        "data-playing": kind === "transaction" ? txPlaying : workerPlaying,
        "aria-label": `${action(clock)} ${kind === "transaction" ? outcome : "worker"} animation`,
        onClick: () => toggle(kind)
      },
      action(clock),
      createElement(
        "span",
        { "aria-hidden": true },
        clock.terminal ? "↻" : clock.paused ? "▷" : "Ⅱ"
      )
    )
  }
  const strip = (kind: SceneKind) => {
    const clock = kind === "transaction" ? transaction : worker
    return createElement(
      "div",
      {
        className: "stage-strip",
        role: "group",
        "aria-label": `${kind === "transaction" ? "Transaction" : "Worker"} stages`
      },
      ...clock.stages.map((stage, phase) => {
        const label =
          kind === "transaction" && phase === 3 && outcome === "rollback"
            ? "Rollback"
            : stage.label
        return createElement(
          "button",
          {
            key: phase,
            className: "stage-button",
            type: "button",
            "data-stage": phase,
            "aria-label": `Inspect ${kind}: ${label}`,
            "aria-current":
              phase === clock.phase && (kind !== "worker" || eligible)
                ? "step"
                : undefined,
            disabled: kind === "worker" && !eligible,
            onClick: () => seek(kind, phase)
          },
          label,
          createElement(
            "span",
            {
              className: "stage-track",
              "aria-hidden": true,
              hidden:
                environment.reduced ||
                phase !== clock.phase ||
                stage.duration === 0 ||
                (kind === "worker" && !eligible)
            },
            createElement("span", { className: "stage-progress" })
          )
        )
      }),
      createElement(
        "span",
        { className: "visually-hidden", "aria-live": "polite", "aria-atomic": true },
        kind === "worker" && !eligible
          ? "Waiting for a committed job"
          : `${kind === "transaction" && clock.terminal && outcome === "rollback" ? "Rollback" : clock.stages[clock.phase]!.label}${clock.paused ? ", paused" : clock.terminal ? ", finished" : ""}`
      )
    )
  }
  return createElement(
    "div",
    { ref: root, className: "playback-host", "data-playing": txPlaying },
    createElement(
      "fieldset",
      { className: "outcome-selector", hidden: !environment.ready },
      createElement("legend", { className: "visually-hidden" }, "Transaction outcome"),
      ...(["commit", "rollback"] as const).map((value) =>
        createElement(
          "label",
          { key: value },
          createElement("input", {
            type: "radio",
            name: "transaction-outcome",
            value,
            checked: outcome === value,
            onChange: () => select(value)
          }),
          value === "commit" ? "Commit" : "Rollback"
        )
      )
    ),
    playButton("transaction"),
    environment.ready && portals
      ? createPortal(strip("transaction"), portals.transaction)
      : null,
    environment.ready && portals
      ? createPortal(
          createElement(
            "div",
            { className: "stage-controls" },
            strip("worker"),
            playButton("worker")
          ),
          portals.worker
        )
      : null
  )
}

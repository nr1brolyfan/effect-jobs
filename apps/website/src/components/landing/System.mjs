if (!customElements.get("ej-job-system")) {
  customElements.define(
    "ej-job-system",
    class extends HTMLElement {
      connectedCallback() {
        // A finite storyboard, independent of elapsed wall time or network activity.
        const frames = [
          ["Pending", "Awaiting request", "Awaiting request", "Awaiting request"],
          ["Active:0", "Pending", "Awaiting request", "Awaiting request"],
          ["Active:0", "Active:1", "Awaiting request", "Awaiting request"],
          ["Active:0", "Active:1", "Pending", "Pending"],
          ["Completed", "RetryScheduled", "Pending", "Pending"],
          ["Completed", "RetryScheduled", "Active:0", "Active:1"],
          ["Completed", "RetryScheduled", "Active:0", "Active:1"],
          ["Completed", "RetryScheduled", "Completed", "Active:1"],
          ["Completed", "RetryScheduled", "Completed", "Completed"],
          ["Completed", "Active:0", "Completed", "Completed"],
          ["Completed", "Active:0", "Completed", "Completed"],
          ["Completed", "Completed", "Completed", "Completed"]
        ]
        const explanations = {
          "Awaiting request":
            "The next synthetic request has not arrived. No job has been enqueued.",
          Pending:
            "The job is persisted. A free worker slot can claim it when it is due.",
          Active:
            "A worker is executing the handler. The worker owns durable finalization; the handler does not acknowledge its own job.",
          RetryScheduled:
            "Report 02 has a confirmed retryable failure. Its first persisted policy allows another attempt after the stored delay. This is not an unknown outcome.",
          Completed:
            "The worker has confirmed completion. Retention bounds how long the producer identity can prevent duplicate production."
        }
        const controller = new AbortController()
        this.cleanup = () => {
          controller.abort()
          clearTimeout(timer)
          observer.disconnect()
        }
        const on = (target, event, fn) =>
          target.addEventListener(event, fn, { signal: controller.signal })
        const reduced = matchMedia("(prefers-reduced-motion: reduce)")
        const rows = [...this.querySelectorAll("[data-job]")]
        const toggle = this.querySelector("[data-toggle]")
        const next = this.querySelector("[data-next]")
        let frame = 0
        let selected = 0
        let playing = !reduced.matches
        let visible = false
        let timer
        const stateOf = (value) => value.split(":")[0]
        const announce = () => {
          this.querySelector("[data-announcement]").textContent =
            `${rows[selected].querySelector(".job-title").firstChild.textContent}: ${stateOf(frames[frame][selected])}. Step ${frame + 1} of ${frames.length}.`
        }
        const render = () => {
          const values = frames[frame]
          rows.forEach((row, i) => {
            const state = stateOf(values[i])
            row.disabled = false
            row.setAttribute("aria-pressed", String(selected === i))
            const badge = row.querySelector(".state")
            badge.textContent = state
            badge.dataset.state = state
            row.querySelector("[data-detail]").textContent =
              state === "Active"
                ? `Worker ${Number(values[i].split(":")[1]) + 1} · attempt ${i === 1 && frame >= 9 ? 2 : 1}`
                : state === "RetryScheduled"
                  ? "Confirmed failure · waiting for stored delay"
                  : state === "Completed"
                    ? "Finalization confirmed"
                    : state === "Pending"
                      ? "Committed · waiting for a worker"
                      : "No job enqueued yet"
          })
          this.querySelectorAll("[data-worker]").forEach((worker, i) => {
            const job = values.findIndex((value) => value === `Active:${i}`)
            worker.dataset.busy = String(job >= 0)
            worker.querySelector("span").textContent =
              job < 0 ? "ready" : `report 0${job + 1}`
          })
          this.querySelector("[data-capacity]").textContent =
            `${values.filter((value) => stateOf(value) === "Active").length} / 2 active`
          this.querySelector("[data-code-title]").textContent =
            `0${selected + 1} / ${rows[selected].querySelector(".job-title").firstChild.textContent}`
          const region = ["Pending", "Awaiting request"].includes(
            stateOf(values[selected])
          )
            ? "enqueue"
            : "handler"
          const snippet = this.querySelector(
            `[data-source="${region}"]`
          ).content.querySelector("code").textContent
          this.querySelector("[data-code]").textContent = snippet
          this.querySelector("[data-code]").parentElement.setAttribute(
            "aria-label",
            `Partial ${region} source for the selected report`
          )
          this.querySelector("[data-explanation]").textContent =
            explanations[stateOf(values[selected])]
          this.querySelector("[data-step]").textContent =
            `Step ${frame + 1} / ${frames.length}`
          toggle.textContent = playing ? "Pause" : "Play"
          toggle.disabled = reduced.matches || frame === frames.length - 1
          next.disabled = frame === frames.length - 1
          this.dataset.playing = String(
            playing && visible && !document.hidden && !reduced.matches
          )
        }
        const schedule = () => {
          clearTimeout(timer)
          render()
          if (
            playing &&
            visible &&
            !document.hidden &&
            !reduced.matches &&
            frame < frames.length - 1
          ) {
            timer = setTimeout(() => {
              frame++
              if (frame === frames.length - 1) {
                playing = false
              }
              schedule()
            }, 2200)
          }
        }
        on(toggle, "click", () => {
          playing = !playing
          schedule()
          announce()
        })
        on(next, "click", () => {
          playing = false
          frame = Math.min(frame + 1, frames.length - 1)
          schedule()
          announce()
        })
        on(this.querySelector("[data-restart]"), "click", () => {
          frame = 0
          playing = false
          schedule()
          announce()
        })
        rows.forEach((row, i) =>
          on(row, "click", () => {
            selected = i
            playing = false
            schedule()
            announce()
          })
        )
        on(document, "visibilitychange", schedule)
        on(reduced, "change", () => {
          playing = false
          schedule()
        })
        const observer = new IntersectionObserver((entries) => {
          if (this.isConnected) {
            visible = entries.at(-1).isIntersecting
            schedule()
          }
        })
        observer.observe(this)
        this.querySelector(".playback").hidden = false
        render()
      }
      disconnectedCallback() {
        this.cleanup?.()
      }
    }
  )
}

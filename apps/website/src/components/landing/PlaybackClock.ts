export interface Stage {
  readonly label: string
  readonly duration: number
}

export const transactionStages: ReadonlyArray<Stage> = [
  { label: "BEGIN", duration: 2200 },
  { label: "Order", duration: 2200 },
  { label: "Enqueue", duration: 2200 },
  { label: "Commit", duration: 0 }
]
export const workerStages: ReadonlyArray<Stage> = [
  { label: "Start", duration: 2200 },
  { label: "Claim", duration: 1800 },
  { label: "Receive", duration: 1500 },
  { label: "Handle", duration: 2200 },
  { label: "Send", duration: 0 }
]

/** Pure UI clock. Its elapsed time drives BOTH the track and the row's currentTime.
 * Visibility suspension belongs to the caller: suspended time is never advanced. */
export class PlaybackClock {
  phase = 0
  elapsed = 0
  paused = false
  focused = true
  run = 0
  readonly stages: ReadonlyArray<Stage>
  constructor(stages: ReadonlyArray<Stage>) {
    this.stages = stages
  }

  get terminal() {
    return this.phase === this.stages.length - 1
  }
  get duration() {
    return this.stages[this.phase]!.duration
  }
  get remaining() {
    return this.duration - this.elapsed
  }
  get ratio() {
    return this.duration === 0 ? 0 : this.remaining / this.duration
  }

  advance(delta: number) {
    if (this.paused || this.terminal) {
      return false
    }
    this.elapsed = Math.min(this.duration, this.elapsed + delta)
    if (this.remaining > 0) {
      return false
    }
    this.phase++
    this.elapsed = 0
    if (this.terminal) {
      this.focused = false
    }
    return true
  }
  seek(phase: number) {
    this.phase = phase
    this.elapsed = 0
    this.paused = true
    this.focused = true
    this.run++
  }
  reset(paused = false) {
    this.seek(0)
    this.paused = paused
  }
  finish() {
    this.seek(this.stages.length - 1)
    this.paused = false
    this.focused = false
  }
  resume() {
    this.paused = false
  }
  pause() {
    this.paused = true
  }
}

export type SceneKind = "transaction" | "worker"
export interface CodeOperation {
  readonly kind: SceneKind
  readonly selector: string
  readonly first: number
  readonly last: number
  readonly phase: number
  readonly active: ReadonlyArray<number>
  readonly label: string
}
// Inclusive Shiki line ranges, token/source-checked by tests/Content.mjs.
// Claim and receipt are internal drain events, so they have stage controls but
// no invented, separately clickable source operation.
export const codeOperations: ReadonlyArray<CodeOperation> = [
  {
    kind: "transaction",
    selector: ".commit-code",
    first: 2,
    last: 2,
    phase: 0,
    active: [0],
    label: "Open transaction"
  },
  {
    kind: "transaction",
    selector: ".commit-code",
    first: 4,
    last: 4,
    phase: 1,
    active: [1],
    label: "Insert order"
  },
  {
    kind: "transaction",
    selector: ".commit-code",
    first: 6,
    last: 10,
    phase: 2,
    active: [2],
    label: "Enqueue confirmation"
  },
  {
    kind: "transaction",
    selector: ".commit-code",
    first: 11,
    last: 12,
    phase: 3,
    active: [3],
    label: "Commit transaction"
  },
  {
    kind: "transaction",
    selector: ".rollback-code",
    first: 2,
    last: 2,
    phase: 0,
    active: [0],
    label: "Open transaction"
  },
  {
    kind: "transaction",
    selector: ".rollback-code",
    first: 4,
    last: 4,
    phase: 1,
    active: [1],
    label: "Insert order"
  },
  {
    kind: "transaction",
    selector: ".rollback-code",
    first: 5,
    last: 9,
    phase: 2,
    active: [2],
    label: "Enqueue confirmation"
  },
  {
    kind: "transaction",
    selector: ".rollback-code",
    first: 10,
    last: 12,
    phase: 3,
    active: [3],
    label: "Rollback after rejection"
  },
  {
    kind: "worker",
    selector: ".worker-code",
    first: 7,
    last: 9,
    phase: 0,
    active: [0, 1, 2],
    label: "Start worker drain"
  },
  {
    kind: "worker",
    selector: ".registration-code",
    first: 3,
    last: 5,
    phase: 3,
    active: [3],
    label: "Run confirmation handler"
  },
  {
    kind: "worker",
    selector: ".registration-code",
    first: 6,
    last: 9,
    phase: 4,
    active: [4],
    label: "Call email adapter"
  }
]

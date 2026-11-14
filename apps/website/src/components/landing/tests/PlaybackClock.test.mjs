import assert from "node:assert/strict"
import { PlaybackClock, transactionStages, workerStages } from "../PlaybackClock.ts"

// Retain the standalone oracle and register it with the workspace runner too.
const { test } = await import(process.env.VITEST ? "vitest" : "node:test")

test("countdown starts full, drains, then the next actual phase starts full", () => {
  const clock = new PlaybackClock(transactionStages)
  assert.equal(clock.ratio, 1)
  assert.equal(clock.advance(700), false)
  assert.equal(clock.remaining, 1500)
  assert.equal(clock.phase, 0)
  assert.equal(clock.advance(1500), true)
  assert.equal(clock.phase, 1)
  assert.equal(clock.ratio, 1)
})
test("pause preserves remaining time; resume never restarts a phase", () => {
  const clock = new PlaybackClock(workerStages)
  clock.seek(1)
  clock.resume()
  clock.advance(650)
  clock.pause()
  assert.equal(clock.advance(10000), false)
  assert.equal(clock.elapsed, 650)
  assert.equal(clock.remaining, 1150)
  clock.resume()
  assert.equal(clock.advance(1149), false)
  assert.equal(clock.phase, 1)
  assert.equal(clock.advance(1), true)
  assert.equal(clock.phase, 2)
  assert.equal(clock.ratio, 1)
})
test("all manual seeks reset their own clock and pause, including rapid repeated seeks", () => {
  const clock = new PlaybackClock(workerStages)
  for (let index = 0; index < 1000; index++) {
    const phase = index % workerStages.length
    clock.seek(phase)
    assert.equal(clock.phase, phase)
    assert.equal(clock.elapsed, 0)
    assert.equal(clock.paused, true)
    clock.advance(10000)
    assert.equal(clock.phase, phase)
  }
})
test("terminal states are finite, idle source stays readable, replay is a fresh clock", () => {
  const clock = new PlaybackClock(transactionStages)
  for (let index = 0; index < 3; index++) {
    clock.advance(2200)
  }
  assert.equal(clock.terminal, true)
  assert.equal(clock.ratio, 0)
  assert.equal(clock.focused, false)
  assert.equal(clock.advance(100000), false)
  clock.reset()
  assert.equal(clock.phase, 0)
  assert.equal(clock.remaining, 2200)
  assert.equal(clock.focused, true)
  assert.equal(clock.paused, false)
  clock.finish()
  assert.equal(clock.terminal, true)
  assert.equal(clock.focused, false)
})

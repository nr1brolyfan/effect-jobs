import { createHistogram } from "node:perf_hooks"
import { parseArgs } from "node:util"

export const parseOptions = (args) => {
  const values = parseArgs({
    args,
    options: {
      run: { type: "boolean", default: false },
      smoke: { type: "boolean", default: false },
      duration: { type: "string" },
      rate: { type: "string" },
      history: { type: "string" },
      workers: { type: "string" },
      image: { type: "string", default: "postgres:16.15-alpine" }
    }
  }).values
  const integer = (key, fallback, min, max) => {
    const text = values[key] ?? String(fallback)
    const number = Number(text)
    if (
      !/^\d+$/.test(text) ||
      !Number.isSafeInteger(number) ||
      number < min ||
      number > max
    ) {
      throw new Error(`Invalid --${key}: expected integer ${min}–${max}`)
    }
    return number
  }
  if (!/^postgres:(\d+\.)+\d+(-alpine)?$/.test(values.image)) {
    throw new Error("Use an explicitly versioned official postgres image")
  }
  const options = {
    run: values.run,
    smoke: values.smoke,
    image: values.image,
    durationSeconds: integer("duration", values.smoke ? 12 : 1800, 5, 7200),
    rate: integer("rate", values.smoke ? 10 : 100, 1, 1000),
    history: integer("history", values.smoke ? 100 : 10000, 0, 500000),
    workers: integer("workers", 3, 1, 8),
    producers: 4,
    queues: 2,
    kindsPerQueue: 2,
    concurrency: 4,
    payloadBytes: 1024,
    handlerMillis: 10,
    poolSize: 32,
    sampleMillis: values.smoke ? 1000 : 5000,
    churnEvery: 10,
    churnRetentionSeconds: values.smoke ? 2 : 30,
    drainSeconds: values.smoke ? 10 : 60
  }
  if (options.rate * options.durationSeconds + options.history > 1000000) {
    throw new Error("Run exceeds the 1,000,000-job budget")
  }
  return options
}

export class Measurements {
  counters = {}
  histograms = new Map()
  count(key, amount = 1) {
    this.counters[key] = (this.counters[key] ?? 0) + amount
  }
  record(key, millis) {
    let histogram = this.histograms.get(key)
    if (!histogram) {
      histogram = createHistogram({ lowest: 1, highest: 3600000000, figures: 3 })
      this.histograms.set(key, histogram)
    }
    histogram.record(Math.max(1, Math.min(3600000000, Math.round(millis * 1000))))
  }
  snapshot() {
    return {
      counters: { ...this.counters },
      latencyMillis: Object.fromEntries(
        [...this.histograms].map(([name, h]) => [
          name,
          {
            count: h.count,
            p50: h.percentile(50) / 1000,
            p95: h.percentile(95) / 1000,
            p99: h.percentile(99) / 1000,
            max: h.max / 1000
          }
        ])
      )
    }
  }
}

export const nextArrival = (now, start, lane, lanes, rate, previous) => {
  const interval = (1000 * lanes) / rate
  const first = start + (1000 * lane) / rate
  const slot = Math.max(previous + 1, Math.floor((now - first) / interval))
  return { slot, due: first + slot * interval, missed: slot - previous - 1 }
}

export const ownedContainer = (inspection, token) =>
  inspection.Config?.Labels?.["effect-jobs.soak.owner"] === token &&
  inspection.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostIp === "127.0.0.1"

export const rates = (before, after) => {
  const seconds = (after.elapsedMillis - before.elapsedMillis) / 1000
  const difference = (name) => (after.counters[name] ?? 0) - (before.counters[name] ?? 0)
  return {
    seconds,
    insertedPerSecond: difference("enqueue.Inserted") / seconds,
    confirmedCompletedPerSecond: difference("completed.Applied") / seconds,
    missedArrivalSlots: difference("producer.missedSlots")
  }
}

export const healthChecks = ({ counters, durable, history, orphanPayloads, options }) => {
  const inserted = counters["enqueue.Inserted"] ?? 0
  const deleted = counters["cleanup.rows"] ?? 0
  const retained = durable.reduce((sum, row) => sum + row.count, 0)
  return {
    allOfferedInserted: inserted === (counters["producer.offered"] ?? 0) && inserted > 0,
    allInsertedCompleted: (counters["completed.Applied"] ?? 0) === inserted,
    onlyCompletedRemain: durable.every((row) => row.state === "Completed"),
    historyPreserved: history === options.history,
    accounting: retained + deleted === options.history + inserted,
    noOrphanPayloads: orphanPayloads === 0,
    cleanupExercised:
      options.durationSeconds <= options.churnRetentionSeconds + 2 || deleted > 0,
    noOperationFailures: !Object.entries(counters).some(
      ([name, value]) => /\.(Failure|Unknown|Backoff)$/.test(name) && value > 0
    )
  }
}

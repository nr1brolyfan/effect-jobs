import { Schema } from "effect"
import { Observation } from "./QueueObservation.js"

const decode = Schema.decodeUnknownSync(Schema.Array(Observation), {
  onExcessProperty: "error"
})

// Loopback fixture transport only. Production Worker has no such route or RPC.
export const read = async (origin: string) => {
  const response = await fetch(origin + "/_integration/queues", {
    signal: AbortSignal.timeout(2000)
  })
  if (response.status !== 200) {
    throw new Error("Native observation transport failed")
  }
  return decode(await response.json())
}

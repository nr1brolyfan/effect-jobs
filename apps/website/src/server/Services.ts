import type { Layer } from "effect"
import type {
  Changes,
  JobsRead,
  SandboxAuthority,
  Scenarios
} from "@effect-jobs/playground-contracts/Services"

// Integration supplies one app-owned authority/read/command/notification composition.
export type ApplicationLayer = Layer.Layer<
  SandboxAuthority | JobsRead | Scenarios | Changes
>

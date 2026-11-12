// Negative controls for deliberately removed public names; these are not aliases.
import type { Service } from "../../src/postgresql/PostgreSqlJobs.js"
import { JobPersistenceError } from "../../src/JobEnqueue.js"
// @ts-expect-error removed configured jobs contract
import type { Backend } from "../../src/postgresql/PostgreSqlJobs.js"
// @ts-expect-error removed persistence error
import { JobBackendError } from "../../src/JobEnqueue.js"
import * as Jobs from "../../src/postgresql/PostgreSqlJobs.js"

declare const jobs: Service
export const storage = jobs.storage
export const error = new JobPersistenceError({
  reason: "unqualified-storage",
  commitKnowledge: "NotCommitted"
})
// @ts-expect-error removed namespace contract
export type Removed = Jobs.Backend
void JobPersistenceError
void JobBackendError
export type RemovedImport = Backend

import { Effect, Schema } from "effect"
import { JobProblem } from "@effect-jobs/playground-contracts/Repairs"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Tables from "../authority/Schema.js"

export const relations = (schema: string) => ({
  ...Tables.relations(schema),
  admission: `"${schema}"."repair_admission"`,
  receipts: `"${schema}"."repair_receipts"`,
  problems: `"${schema}"."job_problems"`,
  members: `"${schema}"."job_repair_members"`,
  edges: `"${schema}"."job_repairs"`,
  audit: `"${schema}"."repair_audit"`,
  payloads: `"${schema}"."job_payloads"`
})
export const decodeProblem = (input: unknown) =>
  Schema.decodeUnknownEffect(JobProblem)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => new PlaygroundError({ code: "unavailable" })),
    Effect.flatMap((problem) =>
      (problem.state === "InProgress" && problem.activeSuccessorJobId === null) ||
      (problem.state === "Resolved") !== (problem.resolution !== null) ||
      (problem.resolution !== null &&
        problem.resolution.successorJobId !== problem.activeSuccessorJobId)
        ? Effect.fail(new PlaygroundError({ code: "unavailable" }))
        : Effect.succeed(problem)
    )
  )

// Additive v6 proposal ONLY. Serial owner registers/runs it AFTER the core
// lineage migration. No v1-v5 descriptor/checksum is modified by this module.
export const proposal = (schema: string): string => {
  const t = relations(schema)
  const legacy = `"${schema}"."operator_redrives"`
  return `LOCK TABLE ${t.jobs},${t.associations},${legacy} IN ACCESS EXCLUSIVE MODE;
CREATE TABLE ${t.admission} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    operation text NOT NULL CHECK (operation IN ('Repair','Resolution')),
    request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
    command_digest text NOT NULL CHECK (command_digest ~ '^[a-f0-9]{64}$'),
    actor_category text NOT NULL CHECK (actor_category IN ('LocalOperator','SyntheticSeed')),
    PRIMARY KEY(sandbox_id,generation,operation,request_id)
  );
CREATE TABLE ${t.receipts} (
    sandbox_id text NOT NULL, generation bigint NOT NULL, operation text NOT NULL,
    request_id text NOT NULL, command_digest text NOT NULL, receipt jsonb NOT NULL,
    CHECK (octet_length(receipt::text) <= 16384),
    PRIMARY KEY(sandbox_id,generation,operation,request_id),
    FOREIGN KEY(sandbox_id,generation,operation,request_id) REFERENCES ${t.admission}(sandbox_id,generation,operation,request_id)
  );
CREATE TABLE ${t.problems} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
    root_job_id text NOT NULL, problem jsonb NOT NULL,
    CHECK (problem->>'rootJobId'=root_job_id),
    CHECK (problem->>'state' IN ('Open','InProgress','Resolved')),
    CHECK ((problem->>'version')::bigint BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY(sandbox_id,generation,root_job_id)
  );
CREATE TABLE ${t.members} (
    sandbox_id text NOT NULL, generation bigint NOT NULL,
    job_id text NOT NULL, live_job_id text, root_job_id text NOT NULL,
    CHECK(live_job_id IS NULL OR live_job_id=job_id),
    PRIMARY KEY(sandbox_id,generation,job_id),
    FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id),
    FOREIGN KEY(sandbox_id,generation,live_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (live_job_id)
  );
CREATE INDEX ON ${t.members}(sandbox_id,generation,root_job_id,job_id);
CREATE INDEX ON ${t.members}(live_job_id) WHERE live_job_id IS NOT NULL;
CREATE TABLE ${t.edges} (
    sandbox_id text NOT NULL, generation bigint NOT NULL, request_id text NOT NULL,
    operation text NOT NULL DEFAULT 'Repair' CHECK(operation='Repair'),
    root_job_id text NOT NULL, original_source_job_id text NOT NULL, source_job_id text,
    result_job_id text NOT NULL, live_result_job_id text,
    action text NOT NULL CHECK(action IN ('redrive','corrected-redrive')),
    observed_at bigint NOT NULL, reason text NOT NULL, changes jsonb,
    CHECK(source_job_id IS NULL OR source_job_id=original_source_job_id),
    CHECK(live_result_job_id IS NULL OR live_result_job_id=result_job_id),
    CHECK(original_source_job_id<>result_job_id),
    PRIMARY KEY(sandbox_id,generation,request_id),
    UNIQUE(sandbox_id,generation,result_job_id),
    FOREIGN KEY(sandbox_id,generation,operation,request_id) REFERENCES ${t.receipts}(sandbox_id,generation,operation,request_id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id),
    FOREIGN KEY(sandbox_id,generation,source_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (source_job_id),
    FOREIGN KEY(sandbox_id,generation,live_result_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (live_result_job_id)
  );
CREATE INDEX ON ${t.edges}(sandbox_id,generation,root_job_id,result_job_id);
CREATE INDEX ON ${t.edges}(source_job_id) WHERE source_job_id IS NOT NULL;
CREATE INDEX ON ${t.edges}(live_result_job_id) WHERE live_result_job_id IS NOT NULL;
CREATE TABLE ${t.audit} (
    sandbox_id text NOT NULL, generation bigint NOT NULL, identity text NOT NULL,
    root_job_id text NOT NULL, successor_job_id text, observed_lifecycle_version bigint,
    action text NOT NULL, fact jsonb NOT NULL, observed_at bigint NOT NULL,
    PRIMARY KEY(sandbox_id,generation,identity,action),
    FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id)
  );
CREATE INDEX ON ${t.audit}(sandbox_id,generation,root_job_id,observed_at,identity);
CREATE UNIQUE INDEX ON ${t.audit}(sandbox_id,generation,root_job_id,successor_job_id,observed_lifecycle_version) NULLS NOT DISTINCT WHERE action='reconciliation';

-- Validate exact historical acceptance before generic lineage backfill. Fail
-- ambiguity instead of deriving history from matching producer identity.
DO $repair$ BEGIN
  IF EXISTS(SELECT 1 FROM ${legacy} e LEFT JOIN ${Tables.relations(schema).receipts} r
    ON r.sandbox_id=e.sandbox_id AND r.generation=e.generation AND r.request_id=e.request_id AND r.operation='Operator'
    WHERE r.receipt->'result'->>'_tag' IS DISTINCT FROM 'Committed'
      OR r.receipt->'result'->>'action' IS DISTINCT FROM 'redrive'
      OR r.receipt->'result'->>'sourceJobId' IS DISTINCT FROM e.source_job_id
      OR r.receipt->'result'->>'resultJobId' IS DISTINCT FROM e.successor_job_id
      OR (r.receipt->'result'->>'sourceLifecycleVersion')::bigint IS DISTINCT FROM e.source_lifecycle_version
      OR r.receipt->'result'->>'sourceState' IS DISTINCT FROM e.source_state
      OR r.receipt->'result'->'sandbox'->>'sandboxId' IS DISTINCT FROM e.sandbox_id
      OR (r.receipt->'result'->'sandbox'->>'generation')::bigint IS DISTINCT FROM e.generation
      OR r.receipt->'result'->>'requestId' IS DISTINCT FROM e.request_id)
    THEN RAISE EXCEPTION 'Invalid historical redrive receipt'; END IF;
  IF EXISTS(SELECT 1 FROM ${legacy} GROUP BY sandbox_id,generation,source_job_id HAVING count(*)>1)
    THEN RAISE EXCEPTION 'Ambiguous historical repair branch'; END IF;
END $repair$;
CREATE TEMP TABLE repair_backfill ON COMMIT DROP AS
WITH RECURSIVE chain AS (
  SELECT e.sandbox_id,e.generation,e.source_job_id AS root_job_id,e.source_job_id AS job_id,ARRAY[e.source_job_id] AS path
  FROM ${legacy} e WHERE NOT EXISTS(SELECT 1 FROM ${legacy} p WHERE p.sandbox_id=e.sandbox_id AND p.generation=e.generation AND p.successor_job_id=e.source_job_id)
  UNION ALL
  SELECT c.sandbox_id,c.generation,c.root_job_id,e.successor_job_id,c.path||e.successor_job_id
  FROM chain c JOIN ${legacy} e ON e.sandbox_id=c.sandbox_id AND e.generation=c.generation AND e.source_job_id=c.job_id
  WHERE NOT e.successor_job_id=ANY(c.path)
) SELECT * FROM chain;
DO $repair$ BEGIN
  IF EXISTS(SELECT 1 FROM ${legacy} e WHERE NOT EXISTS(SELECT 1 FROM repair_backfill b WHERE b.sandbox_id=e.sandbox_id AND b.generation=e.generation AND b.job_id=e.successor_job_id))
    THEN RAISE EXCEPTION 'Cyclic historical repair chain'; END IF;
  IF EXISTS(SELECT 1 FROM ${legacy} e JOIN ${t.jobs} j ON j.id=e.successor_job_id
    WHERE j.original_source_job_id IS NOT NULL AND (j.original_source_job_id<>e.source_job_id OR j.redrive_kind<>'Redrive'))
    THEN RAISE EXCEPTION 'Conflicting historical core lineage'; END IF;
END $repair$;
UPDATE ${t.jobs} j SET original_source_job_id=e.source_job_id,source_job_id=e.source_job_id,redrive_kind='Redrive'
FROM ${legacy} e WHERE j.id=e.successor_job_id AND j.original_source_job_id IS NULL;
INSERT INTO ${t.problems}(sandbox_id,generation,root_job_id,problem)
SELECT DISTINCT ON (b.sandbox_id,b.generation,b.root_job_id) b.sandbox_id,b.generation,b.root_job_id,
  jsonb_build_object('rootJobId',b.root_job_id,'state','InProgress','version',1,'updatedAt',e.observed_at,
    'activeSuccessorJobId',e.successor_job_id,'outcomeKnowledge','Unknown','resolution',NULL)
FROM repair_backfill b JOIN ${legacy} e ON e.sandbox_id=b.sandbox_id AND e.generation=b.generation AND e.successor_job_id=b.job_id
WHERE NOT EXISTS(SELECT 1 FROM ${legacy} n WHERE n.sandbox_id=e.sandbox_id AND n.generation=e.generation AND n.source_job_id=e.successor_job_id)
ORDER BY b.sandbox_id,b.generation,b.root_job_id;
INSERT INTO ${t.members}(sandbox_id,generation,root_job_id,job_id,live_job_id)
SELECT sandbox_id,generation,root_job_id,job_id,job_id FROM repair_backfill;

-- Retain durable identities while releasing the old restrictive live references.
ALTER TABLE ${legacy} ADD COLUMN original_source_job_id text;
ALTER TABLE ${legacy} ADD COLUMN original_successor_job_id text;
ALTER TABLE ${legacy} ADD COLUMN root_job_id text;
ALTER TABLE ${legacy} ADD COLUMN redrive_kind text NOT NULL DEFAULT 'Redrive' CHECK(redrive_kind='Redrive');
ALTER TABLE ${legacy} ADD COLUMN reason text;
UPDATE ${legacy} SET original_source_job_id=source_job_id,original_successor_job_id=successor_job_id;
UPDATE ${legacy} e SET root_job_id=b.root_job_id FROM repair_backfill b
WHERE b.sandbox_id=e.sandbox_id AND b.generation=e.generation AND b.job_id=e.source_job_id;
ALTER TABLE ${legacy} ALTER COLUMN original_source_job_id SET NOT NULL;
ALTER TABLE ${legacy} ALTER COLUMN original_successor_job_id SET NOT NULL;
ALTER TABLE ${legacy} ALTER COLUMN root_job_id SET NOT NULL;
ALTER TABLE ${legacy} ADD UNIQUE(sandbox_id,generation,original_successor_job_id);
ALTER TABLE ${legacy} ADD CHECK(original_source_job_id<>original_successor_job_id);
ALTER TABLE ${legacy} ADD FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id);
ALTER TABLE ${legacy} ALTER COLUMN source_job_id DROP NOT NULL;
ALTER TABLE ${legacy} ALTER COLUMN successor_job_id DROP NOT NULL;
DO $repair$ DECLARE c record; n integer:=0; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='${legacy}'::regclass AND contype='f' AND confrelid='${t.associations}'::regclass LOOP
    EXECUTE format('ALTER TABLE ${legacy} DROP CONSTRAINT %I',c.conname); n:=n+1;
  END LOOP;
  IF n<>2 THEN RAISE EXCEPTION 'Unexpected historical lineage constraints'; END IF;
END $repair$;
ALTER TABLE ${legacy} ADD CHECK(source_job_id IS NULL OR source_job_id=original_source_job_id);
ALTER TABLE ${legacy} ADD CHECK(successor_job_id IS NULL OR successor_job_id=original_successor_job_id);
ALTER TABLE ${legacy} ADD FOREIGN KEY(sandbox_id,generation,source_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (source_job_id);
ALTER TABLE ${legacy} ADD FOREIGN KEY(sandbox_id,generation,successor_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (successor_job_id);
CREATE INDEX ON ${legacy}(source_job_id) WHERE source_job_id IS NOT NULL;`
}

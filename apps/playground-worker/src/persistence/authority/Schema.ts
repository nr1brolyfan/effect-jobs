// App-owned DDL proposal. The serial migration owner invokes this explicitly.
// No lifecycle writes, migrations or pools start on import.
export const relations = (schema: string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Invalid playground schema")
  }
  const table = (name: string) => `"${schema}"."${name}"`
  return {
    sandboxes: table("sandboxes"),
    associations: table("associations"),
    receipts: table("command_receipts"),
    admission: table("command_admission"),
    audit: table("command_audit"),
    ledger: table("provider_ledger"),
    jobs: table("jobs")
  }
}
export const proposal = (schema: string) => {
  const t = relations(schema)
  return `CREATE TABLE ${t.sandboxes} (
    sandbox_id text PRIMARY KEY,
    generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    expires_at bigint NOT NULL,
    credential_hash text NOT NULL UNIQUE,
    viewer_until bigint NOT NULL DEFAULT 0,
    next_generation_at bigint NOT NULL DEFAULT 0,
    retained_jobs integer NOT NULL DEFAULT 0 CHECK (retained_jobs BETWEEN 0 AND 100)
  );
  CREATE TABLE ${t.associations} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL,
    job_id text NOT NULL UNIQUE REFERENCES ${t.jobs}(id),
    relations jsonb NOT NULL,
    PRIMARY KEY (sandbox_id,generation,job_id)
  );
  CREATE TABLE ${t.admission} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL, operation text NOT NULL, request_id text NOT NULL,
    PRIMARY KEY (sandbox_id,generation,operation,request_id)
  );
  CREATE TABLE ${t.receipts} (
    sandbox_id text NOT NULL, generation bigint NOT NULL,
    operation text NOT NULL, request_id text NOT NULL, receipt jsonb NOT NULL,
    PRIMARY KEY (sandbox_id,generation,operation,request_id),
    FOREIGN KEY (sandbox_id,generation,operation,request_id)
      REFERENCES ${t.admission}(sandbox_id,generation,operation,request_id)
  );
  CREATE TABLE ${t.audit} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL, operation text NOT NULL, reason text NOT NULL,
    count integer NOT NULL CHECK (count BETWEEN 0 AND 10), observed_at bigint NOT NULL
  );
  CREATE TABLE ${t.ledger} (
    sandbox_id text NOT NULL, generation bigint NOT NULL,
    job_id text NOT NULL UNIQUE REFERENCES ${t.jobs}(id),
    signature text NOT NULL, accepted boolean NOT NULL, invocations integer NOT NULL,
    PRIMARY KEY (sandbox_id,generation,job_id),
    FOREIGN KEY (sandbox_id,generation,job_id)
      REFERENCES ${t.associations}(sandbox_id,generation,job_id)
  );
  CREATE INDEX ON ${t.associations}(sandbox_id,generation);
  CREATE INDEX ON ${t.sandboxes}(viewer_until);`
}

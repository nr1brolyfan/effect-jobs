import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"

// #region migration
// Apply once through application-owned migrations, before serving requests.
// This is SQL generation, never executed by module import or backend.ready.
export const migrationSql = `${PostgreSqlSchema.migration()}
CREATE TABLE report_requests (
  operation_id text PRIMARY KEY,
  report_id text NOT NULL UNIQUE
);
CREATE TABLE report_request_receipts (
  operation_id text PRIMARY KEY REFERENCES report_requests(operation_id),
  job_id text NOT NULL REFERENCES jobs(id)
);
CREATE TABLE generated_reports (
  report_id text PRIMARY KEY REFERENCES report_requests(report_id),
  generated_by text NOT NULL UNIQUE REFERENCES jobs(id)
);`
// The unique report_id prevents different requests from overwriting one artifact.
// Retain this application evidence for its own deduplication/authority lifetime.
// #endregion migration

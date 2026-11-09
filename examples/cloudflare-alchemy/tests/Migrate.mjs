// Explicit application migration tooling; importing application source runs no DDL.
import * as Schema from "effect-jobs/PostgreSqlSchema"
export const migration =
  Schema.migration(Schema.tables({ schema: "alchemy_example" })) +
  `
CREATE TABLE alchemy_example.tenants (tenant_id text PRIMARY KEY, enabled boolean NOT NULL);
CREATE TABLE alchemy_example.invoices (
  tenant_id text REFERENCES alchemy_example.tenants, invoice_id text NOT NULL, issued boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, invoice_id)
);
CREATE TABLE alchemy_example.receipts (
  operation_id text PRIMARY KEY, tenant_id text NOT NULL, invoice_id text NOT NULL,
  job_id text REFERENCES alchemy_example.jobs(id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES alchemy_example.invoices
);
INSERT INTO alchemy_example.tenants VALUES ('tenant-a',true),('tenant-b',true);
INSERT INTO alchemy_example.invoices (tenant_id,invoice_id) VALUES ('tenant-a','invoice-a'),('tenant-b','invoice-b'),('tenant-a','invoice-reject');
ALTER TABLE alchemy_example.jobs ADD CHECK (operation_id <> 'tenant-a/rollback-request');
`

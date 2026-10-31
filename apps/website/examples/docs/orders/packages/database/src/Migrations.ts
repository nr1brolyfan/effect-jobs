import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"

// Application-owned DDL. Run with the host migration tool before serving work.
// No migration executes at import or during backend.ready.
export const migrationSql = `${PostgreSqlSchema.migration()}
CREATE TABLE orders (
  operation_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  invoice_requested boolean NOT NULL
);
CREATE TABLE order_receipts (
  operation_id text PRIMARY KEY REFERENCES orders(operation_id),
  confirmation_job_id text NOT NULL REFERENCES jobs(id),
  invoice_job_id text REFERENCES jobs(id)
);
CREATE TABLE invoices (
  invoice_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES orders(order_id),
  document text NOT NULL,
  delivery_job_id text NOT NULL UNIQUE REFERENCES jobs(id)
);
CREATE TABLE synthetic_mail (
  delivery_key text PRIMARY KEY,
  subject text NOT NULL,
  body text NOT NULL
);`

import { relations, tables, type Tables } from "effect-jobs/PostgreSqlSchema"
// Frozen v4 SQL; never regenerate historical checksums.
const operatorChecks = {
  state:
    "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated','Cancelled']",
  terminal: "state=ANYARRAY['Completed','Dead','Cancelled']=completed_atISNOTNULL"
} as const
/** Adds Cancelled to exactly the two known legacy CHECKs; refuses unexpected schema.
 * Does not alter rows, indexes or unrelated constraints. The application runs it
 * in its migration transaction after preserving historical migration bytes.
 * @category operations
 */
export const operatorMigration = (mapping: Tables = tables()): string => {
  const { jobs } = relations(mapping)
  const oldState =
    "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated']"
  const oldTerminal = "state=ANYARRAY['Completed','Dead']=completed_atISNOTNULL"
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  return `DO $operator_migration$
DECLARE c record; state_name text; terminal_name text; state_count integer := 0; terminal_count integer := 0;
BEGIN
  LOCK TABLE ${jobs} IN ACCESS EXCLUSIVE MODE;
  FOR c IN SELECT conname, regexp_replace(pg_get_expr(conbin,conrelid), '[[:space:]()]|::text', '', 'g') AS expression
    FROM pg_catalog.pg_constraint WHERE conrelid=${literal(jobs)}::regclass AND contype='c'
  LOOP
    IF c.expression IN (${literal(oldState)},${literal(operatorChecks.state)}) THEN
      state_name := c.conname; state_count := state_count + 1;
    ELSIF c.expression IN (${literal(oldTerminal)},${literal(operatorChecks.terminal)}) THEN
      terminal_name := c.conname; terminal_count := terminal_count + 1;
    END IF;
  END LOOP;
  IF state_count <> 1 OR terminal_count <> 1 THEN
    RAISE EXCEPTION 'unsupported operator CHECK constraints';
  END IF;
  EXECUTE format('ALTER TABLE ${jobs} DROP CONSTRAINT %I, DROP CONSTRAINT %I', state_name, terminal_name);
  EXECUTE format('ALTER TABLE ${jobs} ADD CONSTRAINT %I CHECK (state IN (''Pending'',''Active'',''RetryScheduled'',''Completed'',''Dead'',''Isolated'',''Cancelled'')), ADD CONSTRAINT %I CHECK ((state IN (''Completed'',''Dead'',''Cancelled'')) = (completed_at IS NOT NULL))', state_name, terminal_name);
END $operator_migration$;`
}

// Fork: schedule auto-budgeting — adds the `auto_budget_category` column to
// `schedules`. Idempotent (skips if the column already exists) because files
// migrated by the original fork build already have it; `patchBadMigrations`
// removes that build's interleaved migration id (1778270218300) so this
// re-based migration runs in its place. See FORK.md.
export default async function runMigration(db) {
  const columns = db.runQuery(`PRAGMA table_info(schedules)`, [], true);
  const hasColumn = columns.some(
    column => column.name === 'auto_budget_category',
  );
  if (!hasColumn) {
    db.execQuery(`ALTER TABLE schedules ADD COLUMN auto_budget_category TEXT;`);
  }
}

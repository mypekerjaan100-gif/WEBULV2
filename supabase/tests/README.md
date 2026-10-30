# Variable Cost monthly input tests

## Local checks

- Domain and retirement checks: `node src/data/variableMonthlyActuals.test.js`
- Real UI/repository with mocked transport: `node src/data/variableMonthlyActuals.browser.test.js`
- Isolated Postgres: `node supabase/tests/variable_monthly_direct_input.test.mjs <path-to-pglite/dist/index.js>`
- Production bundle: `npm run build`

The Postgres test requires **@electric-sql/pglite@0.3.14**. Install it in a temporary directory with `npm install --prefix <temporary-directory> --no-audit --no-fund @electric-sql/pglite@0.3.14`, then pass `<temporary-directory>/node_modules/@electric-sql/pglite/dist/index.js` to the test. It does not connect to Supabase. The browser test uses the project's existing Playwright installation and Chrome (`CHROME_PATH` can override its executable).

The tests cover exact-unit writes, management read-only access, RLS, atomic batches, optimistic revisions, immutable history, blanks versus zero, SLA synchronization, month-end prices, non-billable ROW Fix, financial/trend reconciliation, unchanged legacy data, and disabled legacy mutation RPCs.

## Project smoke test

`variable_monthly_live_smoke.sql` must be run through a privileged SQL connection, **not** from the application. It discovers existing authorized actors and an active October 2026 scope. All test writes are enclosed in a transaction and rolled back. No monthly quantities are imported or left behind. Do not remove the final `ROLLBACK`.

The migration filename matches the version applied to Supabase: `20261030050330_variable_monthly_direct_input.sql`.

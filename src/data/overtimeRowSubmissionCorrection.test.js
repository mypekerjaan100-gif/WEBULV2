import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../supabase/migrations/20261029075057_correct_row_oct21_submission_oct28.sql', import.meta.url), 'utf8')
const body = sql.replace(/--[^\n]*/g, '')

// One maintenance transaction, not a reusable way to bypass submission rules.
assert.equal((body.match(/do \$correction\$/g) ?? []).length, 1)
assert.doesNotMatch(body, /\b(?:alter|create|drop|truncate|delete|grant|revoke|commit|rollback)\b/i)
assert.doesNotMatch(body, /session_replication_role|disable trigger|request\.jwt|overtime\.time_correction/i)
assert.doesNotMatch(body, /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i, 'Resolve IDs from exact business keys')
assert.match(body, /auth\.uid\(\) is not null/)
assert.match(body, /pg_advisory_xact_lock/)
assert.match(body, /into strict v_before/)
assert.match(body, /for update of a;/)
assert.match(body, /order by targets\.location/)
assert.match(body, /order by id for update/)
assert.match(body, /order by id for share/)

for (const key of ['pelayanan-teknik', 'up3', 'ulp-5', 'Keraban', 'Ds.Jambu', 'Ds.Sasak Dalam', '2026-10-21', '2026-10-28']) {
  assert.ok(body.includes(`'${key}'`), `Missing business key: ${key}`)
}
for (const nip of ['7219009SKW', '02251680PTK', '7519004SKW', '7919004SKW', '8119006SKW', '7219007SKW', '8419009SKW', '8319002SKW', '01251674PTK']) {
  assert.ok(body.includes(`"nip":"${nip}"`), `Missing exact participant: ${nip}`)
}
for (const timestamp of ['2026-10-28 09:54:17.843285+07', '2026-10-28 10:17:29.056268+07', '2026-10-28 10:28:53.589259+07']) {
  assert.ok(body.includes(`timestamptz '${timestamp}'`), `Missing agreed effective time: ${timestamp}`)
}
assert.match(body, /v_target\.submitted_at is distinct from v_last_complete_at \+ interval '1 second'/)
assert.match(body, /v_target\.submitted_at < v_before\.created_at/)
assert.match(body, /v_target\.submitted_at > v_deadline/)
assert.match(body, /resolve_overtime_initial_deadline/)
assert.match(body, /v_before\.status is distinct from 'CLOSED'/)
assert.match(body, /v_before\.closure_reason is distinct from 'EXPIRED'/)
assert.match(body, /v_before\.revision is distinct from v_target\.activity_revision/)
assert.match(body, /e\.revision is distinct from v_target\.entry_revision/)
assert.match(body, /v_before\.submission_count is distinct from 0/)
assert.match(body, /v_before\.submitted_at is not null/)
assert.match(body, /e\.approval_status is distinct from 'DRAFT'/)
assert.match(body, /v_participants is distinct from/)
assert.match(body, /md5\(v_evidence::text\) is distinct from v_target\.evidence_fingerprint/)
assert.match(body, /status in \('PENDING', 'DELETE_PENDING'\)/)
assert.match(body, /\('SPK'\), \('FOTO_PROSES'\), \('FOTO_SELESAI'\)/)
assert.match(body, /ev\.evidence_type = 'FOTO_BRIEFING' and ev\.status = 'ACTIVE'/)
assert.match(body, /storage\.objects o where o\.bucket_id = 'overtime-evidence' and o\.name = ev\.storage_path/)

const activityUpdate = body.match(/update public\.overtime_activities([\s\S]+?)returning \* into v_after;/)?.[1]
const entryUpdate = body.match(/update public\.overtime_entries([\s\S]+?);/)?.[1]
assert.ok(activityUpdate && entryUpdate)
assert.match(activityUpdate, /status = 'SUBMITTED', submitted_at = v_target\.submitted_at/)
assert.match(activityUpdate, /submitted_by = auth\.uid\(\), submission_count = 1, current_submission_number = 1/)
assert.match(activityUpdate, /closure_reason = null, closed_at = null, closed_by = null/)
assert.match(activityUpdate, /where id = v_before\.id and revision = v_before\.revision/)
assert.match(activityUpdate, /and status = 'CLOSED' and closure_reason = 'EXPIRED' and submission_count = 0/)
assert.doesNotMatch(activityUpdate, /\b(?:overtime_date|period_month|started_at|ended_at|submission_deadline|approved_at|approved_by|description|row_var_span_count)\s*=/)
assert.match(entryUpdate, /set approval_status = 'SUBMITTED', updated_by = auth\.uid\(\)/)
assert.match(entryUpdate, /where activity_id = v_before\.id and approval_status = 'DRAFT' and revision = v_target\.entry_revision/)
assert.doesNotMatch(entryUpdate, /\b(?:employee_id|employee_name_snapshot|work_date|participant_started_at|participant_ended_at|hours|hourly_rate_snapshot|calculated_amount_snapshot|description)\s*=/)
assert.equal((body.match(/update public\./g) ?? []).length, 2)

assert.match(body, /v_before\.id, 'SUBMITTED', auth\.uid\(\), 'DRAFT', 'SUBMITTED', 1, v_target\.submitted_at/)
assert.match(body, /v_before\.id, 'CORRECTED', auth\.uid\(\), 'CLOSED', 'SUBMITTED', 1, clock_timestamp\(\)/)
assert.equal((body.match(/insert into public\.overtime_activity_history/g) ?? []).length, 2)
assert.match(body, /not an authenticated application-user action/)
assert.match(body, /'recorded_at', now\(\)/)
assert.match(body, /'before', jsonb_build_object\('activity', to_jsonb\(v_before\), 'entries', v_entries_before\)/)
assert.match(body, /v_after\.revision <> v_before\.revision \+ 1/)
assert.match(body, /v_evidence is distinct from/)
assert.match(body, /v_history is distinct from/)
assert.match(body, /h\.id not in \(v_submitted_history_id, v_correction_history_id\)/)
assert.match(body, /v_target\.history_count \+ 2/)
assert.match(body, /v_activities_updated <> 3 or v_entries_updated <> 9/)

console.log('Overtime ROW historical submission correction guards passed')

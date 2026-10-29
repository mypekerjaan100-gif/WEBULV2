import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../supabase/migrations/20261029071928_correct_sekura_replacement_maradona.sql', import.meta.url), 'utf8')

// One-off data maintenance: strict business-key targeting, no new API/privileges.
assert.match(sql, /into strict v_before_activity/)
assert.match(sql, /into strict v_before_entry/)
for (const key of ['pelayanan-teknik', 'ulp-6', '7919002SKW', '01210543PTK', '8819008SKW', '2026-10-26']) {
  assert.ok(sql.includes(key), `Missing exact business key: ${key}`)
}
assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'Do not hardcode generated IDs')
assert.match(sql, /for update of a;/)
assert.match(sql, /v_before_activity\.revision <> 3 or v_before_entry\.revision <> 2/)
assert.match(sql, /public\.overtime_employee_is_eligible_l2/)
assert.match(sql, /MARADONA already has overtime on this date or overlapping time/)
assert.match(sql, /effective_from <= v_date/)
assert.match(sql, /round\(v_rate \* v_before_entry\.multiplier_hours_snapshot, 2\)/)
assert.match(sql, /v_amount is distinct from v_before_entry\.calculated_amount_snapshot/)
assert.match(sql, /where id = v_before_activity\.id and revision = v_before_activity\.revision/)
assert.match(sql, /where id = v_before_entry\.id and revision = v_before_entry\.revision/)
assert.match(sql, /Must update exactly one activity/)
assert.match(sql, /Must update exactly one entry/)
assert.match(sql, /employee_id = v_employee_id, employee_name_snapshot = v_employee_name/)
assert.match(sql, /description = v_new_description/)
assert.match(sql, /'CORRECTED', auth\.uid\(\), 'APPROVED', 'APPROVED'/)
assert.match(sql, /'maintenance_key', v_key, 'database_role', current_user/)
assert.match(sql, /not an authenticated application-user action/)
assert.match(sql, /v_after_activity\.revision <> v_before_activity\.revision \+ 1/)
assert.match(sql, /v_after_entry\.revision <> v_before_entry\.revision \+ 1/)
assert.match(sql, /to_jsonb\(v_after_activity\)/)
assert.match(sql, /to_jsonb\(v_after_entry\)/)
assert.match(sql, /v_evidence is distinct from/)
assert.match(sql, /v_history is distinct from/)
assert.match(sql, /id <> v_audit_id/)
assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(?:alter|drop|truncate|delete|grant|revoke)\b/i, 'Correction must not change schema, privileges, or delete data')
assert.doesNotMatch(sql, /set\s+(?:status|approval_status|approved_at|approved_by|started_at|ended_at)\s*=/i, 'Keep approval and time fields unchanged')
assert.equal((sql.match(/\bupdate public\./g) ?? []).length, 2, 'Only the target activity and entry may be updated')

console.log('Overtime Maradona correction guards passed')

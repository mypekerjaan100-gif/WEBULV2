import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const migrationUrl = new URL(
  '../../supabase/migrations/20261019100000_overtime_row_quantities.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
assert(sql.includes('add column if not exists row_var_span_count integer'), 'Kolom row_var_span_count hilang')
assert(sql.includes('add column if not exists row_pruning_span_count integer'), 'Kolom row_pruning_span_count hilang')
assert(sql.includes('add column if not exists row_felling_20_40_count integer'), 'Kolom row_felling_20_40_count hilang')
assert(sql.includes('add column if not exists row_felling_41_60_count integer'), 'Kolom row_felling_41_60_count hilang')
assert(sql.includes('overtime_activities_row_quantities_check'), 'Constraint volume ROW hilang')
assert(sql.includes('row_var_span_count >= 0'), 'Constraint nilai negatif hilang')

const guardUrl = new URL(
  '../../supabase/migrations/20261023010000_overtime_row_volume_guard.sql',
  import.meta.url,
)
const guardSql = readFileSync(fileURLToPath(guardUrl), 'utf8')
assert(guardSql.includes('create trigger overtime_activities_row_volume_guard'), 'Trigger guard volume hilang')
assert(guardSql.includes('old.row_var_span_count is not null and new.row_var_span_count is null'), 'Guard penghapusan Var ROW hilang')
assert(guardSql.includes("raise exception 'Volume pekerjaan ROW tidak boleh dikosongkan setelah terisi'"), 'Pesan guard penghapusan hilang')

const strictUrl = new URL(
  '../../supabase/migrations/20261023020000_overtime_row_new_strict.sql',
  import.meta.url,
)
const strictSql = readFileSync(fileURLToPath(strictUrl), 'utf8')
const strictSaveStart = strictSql.indexOf('create or replace function public.save_overtime_work_draft_l3(')
assert(strictSaveStart >= 0, 'M2 save_overtime_work_draft_l3 tidak ditemukan')
const strictSave = strictSql.slice(strictSaveStart, strictSql.indexOf('grant execute on function public.save_overtime_work_draft_l3'))
assert(strictSave.includes("raise exception 'Jumlah gawang Var ROW wajib diisi'"), 'M2 validasi wajib Var ROW hilang')
assert(strictSave.includes("raise exception 'Jumlah gawang Var ROW minimal 1'"), 'M2 validasi minimal 1 hilang')
assert(strictSave.includes("raise exception 'Volume pekerjaan ROW hanya berlaku untuk kategori ROW'"), 'M2 penolakan volume non-ROW hilang')
assert(strictSave.includes("v_activity.status = 'CORRECTION_REQUIRED'"), 'M2 toleransi revisi data lama hilang')
assert(strictSave.includes('v_activity.row_var_span_count is null'), 'M2 toleransi revisi data lama (kolom) hilang')
assert(strictSave.includes('v_activity.row_var_span_count is distinct from p_row_var_span_count'), 'M2 kunci revisi Var ROW hilang')

const strictSubmitStart = strictSql.indexOf('create or replace function public.submit_overtime_work_l3(')
assert(strictSubmitStart >= 0, 'M2 submit_overtime_work_l3 tidak ditemukan')
const strictSubmit = strictSql.slice(strictSubmitStart, strictSql.indexOf('grant execute on function public.submit_overtime_work_l3'))
assert(strictSubmit.includes("raise exception 'Jumlah gawang Var ROW wajib diisi minimal 1'"), 'M2 submit tidak memvalidasi volume ROW')

const saveStart = sql.indexOf('create or replace function public.save_overtime_work_draft_l3(')
assert(saveStart >= 0, 'RPC save_overtime_work_draft_l3 tidak ditemukan')
const saveBody = sql.slice(saveStart, sql.indexOf('grant execute on function public.save_overtime_work_draft_l3'))
assert(saveBody.includes('p_row_var_span_count integer default null'), 'Param RPC save tidak lengkap')
assert(saveBody.includes("raise exception 'Jumlah gawang Var ROW wajib diisi'"), 'Validasi wajib Var ROW hilang')
assert(saveBody.includes("raise exception 'Jumlah gawang Var ROW minimal 1'"), 'Validasi minimal 1 hilang')
assert(saveBody.includes("raise exception 'Jumlah gawang pangkas tidak boleh negatif'"), 'Validasi pangkas hilang')
assert(saveBody.includes("raise exception 'Jumlah tebang 20-40 cm tidak boleh negatif'"), 'Validasi tebang 20-40 hilang')
assert(saveBody.includes("raise exception 'Jumlah tebang 41-60 cm tidak boleh negatif'"), 'Validasi tebang 41-60 hilang')
assert(saveBody.includes("raise exception 'Volume pekerjaan ROW hanya berlaku untuk kategori ROW'"), 'Penolakan volume non-ROW hilang')
assert(saveBody.includes('v_activity.row_var_span_count is distinct from p_row_var_span_count'), 'Kunci revisi Var ROW hilang')
assert(saveBody.includes('row_var_span_count = p_row_var_span_count'), 'Penulisan Var ROW hilang')
assert(saveBody.includes('row_felling_41_60_count'), 'Penulisan tebang 41-60 hilang')

const listStart = sql.indexOf('create function public.list_overtime_work_l3(')
assert(listStart >= 0, 'RPC list_overtime_work_l3 tidak ditemukan')
const listBody = sql.slice(listStart, sql.indexOf('grant execute on function public.list_overtime_work_l3'))
assert(listBody.includes('row_var_span_count integer'), 'List tidak mengembalikan kolom ROW')
assert(listBody.includes('activity.row_var_span_count'), 'List tidak menyeleksi kolom ROW')

const submitStart = sql.indexOf('create or replace function public.submit_overtime_work_l3(')
assert(submitStart >= 0, 'RPC submit_overtime_work_l3 tidak ditemukan')
const submitBody = sql.slice(submitStart, sql.indexOf('grant execute on function public.submit_overtime_work_l3'))
assert(submitBody.includes("raise exception 'Jumlah gawang Var ROW wajib diisi minimal 1'"), 'Submit tidak memvalidasi volume ROW')

const detailStart = sql.indexOf('create function public.get_overtime_detail_l5(')
assert(detailStart >= 0, 'RPC get_overtime_detail_l5 tidak ditemukan')
const detailBody = sql.slice(detailStart, sql.indexOf('grant execute on function public.get_overtime_detail_l5'))
assert(detailBody.includes('row_felling_20_40_count integer'), 'Detail tidak mengembalikan kolom ROW')

const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('rowVarSpanCount: nullableNumber(row.row_var_span_count)'), 'Mapping rowVarSpanCount hilang')
assert(repo.includes('rowPruningSpanCount: nullableNumber(row.row_pruning_span_count)'), 'Mapping rowPruningSpanCount hilang')
assert(repo.includes('rowFelling2040Count: nullableNumber(row.row_felling_20_40_count)'), 'Mapping rowFelling2040Count hilang')
assert(repo.includes('rowFelling4160Count: nullableNumber(row.row_felling_41_60_count)'), 'Mapping rowFelling4160Count hilang')
assert(repo.includes('p_row_var_span_count: rowVarSpanCount ?? null'), 'Repo tidak mengirim Var ROW')
assert(repo.includes('p_row_felling_20_40_count: rowFelling2040Count ?? null'), 'Repo tidak mengirim tebang 20-40')
assert(repo.includes('p_row_felling_41_60_count: rowFelling4160Count ?? null'), 'Repo tidak mengirim tebang 41-60')

const componentUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes("rowVarSpanCount: ''"), 'initialDraft tidak memuat rowVarSpanCount')
assert(component.includes("rowFelling4160Count: ''"), 'initialDraft tidak memuat rowFelling4160Count')
assert(component.includes('const isRowWork = workCategory === \'ROW\''), 'Penanda kategori ROW hilang')
assert(component.includes("return invalid('Jumlah gawang Var ROW wajib diisi.', 'rowVarSpanCount')"), 'Validasi wajib Var ROW di form hilang')
assert(component.includes('Jumlah Gawang Var ROW *'), 'Label Var ROW hilang')
assert(component.includes('Jumlah Gawang Pangkas'), 'Label gawang pangkas hilang')
assert(component.includes('Jumlah Tebang Diameter 20–40 cm'), 'Label tebang 20-40 hilang')
assert(component.includes('Jumlah Tebang Diameter 41–60 cm'), 'Label tebang 41-60 hilang')
assert(component.includes('<span>gawang</span>'), 'Satuan gawang hilang')
assert(component.includes('<span>batang</span>'), 'Satuan batang hilang')
assert(!/Total Tebang|Jumlah Tebang Total|rowTotalCount/.test(component), 'Tidak boleh ada total otomatis tebang')
assert(!component.includes('rowVarSpanCount) +'), 'Var ROW tidak boleh dijumlahkan dengan field lain')
assert(component.includes('rowVarSpanCount: isRowWork ? parseRowCount(draft.rowVarSpanCount) : null'), 'Payload hanya untuk kategori ROW')
assert(component.includes('Revisi data ROW lama: angka volume boleh kosong'), 'Catatan toleransi revisi ROW lama hilang')
assert(component.includes("if (varSpan != null && (!Number.isInteger(varSpan) || varSpan < 1))"), 'Toleransi revisi ROW lama (Var kosong lolos) hilang')
assert(component.includes('disabled={isEvidenceOnlyRevision || isRevision}'), 'Input ROW harus terkunci saat revisi')
assert(component.includes('first.rowVarSpanCount == null'), 'editDraft tidak memuat nilai tersimpan')
assert(component.includes('<h3>Hasil Pekerjaan ROW</h3>'), 'Detail tidak menampilkan Hasil Pekerjaan ROW')
assert(component.includes('Rincian volume belum tersedia pada data lama.'), 'Catatan data lama hilang')
assert(component.includes("formatRowUnit(detailActivity.rowFelling4160Count, 'batang')"), 'Detail tidak memformat tebang 41-60')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.lembur-row-volume-grid'), 'Style grid volume ROW hilang')
assert(css.includes('.lembur-row-detail-grid'), 'Style detail volume ROW hilang')

console.log(`Overtime ROW quantities tests passed: ${passed}`)

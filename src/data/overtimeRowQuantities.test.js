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

const optionalUrl = new URL('../../supabase/migrations/20261105062153_overtime_row_var_optional.sql', import.meta.url)
const optionalSql = readFileSync(fileURLToPath(optionalUrl), 'utf8')
assert(optionalSql.includes('pg_get_functiondef'), 'Migration tidak mengganti fungsi server yang aktif')
assert(optionalSql.includes('v_activity.row_var_span_count'), 'Migration tidak mempertahankan nilai Var ROW tersimpan')
assert(optionalSql.includes('v_row_var_span_count < 0'), 'Validasi nilai Var ROW negatif hilang')
const optionalSaveBlock = optionalSql.match(/\$new\$-- Var ROW tidak lagi wajib diinput[\s\S]*?\$new\$/)?.[0]
assert(optionalSaveBlock, 'Validasi simpan opsional Var ROW hilang')
assert(!optionalSaveBlock.includes("raise exception 'Jumlah gawang Var ROW wajib diisi'"), 'Simpan masih mewajibkan Var ROW')
assert(!optionalSaveBlock.includes("raise exception 'Jumlah gawang Var ROW minimal 1'"), 'Simpan masih mewajibkan minimal 1 Var ROW')
assert(optionalSaveBlock.includes('v_row_var_span_count := v_activity.row_var_span_count'), 'Nilai Var ROW lama tidak dipertahankan saat update')
const optionalSubmitBlock = optionalSql.match(/v_new text := \$new\$([\s\S]*?)\$new\$/)?.[1]
assert(optionalSubmitBlock?.includes('Var ROW is optional'), 'Submit masih mewajibkan Var ROW')
assert(!optionalSubmitBlock.includes("raise exception 'Jumlah gawang Var ROW wajib diisi minimal 1'"), 'Submit masih mewajibkan Var ROW')
assert(optionalSql.includes('expected_replacements'), 'Migration harus memeriksa bahwa perubahan fungsi tepat sasaran')

const pruningUrl = new URL('../../supabase/migrations/20261105062314_overtime_row_pruning_required.sql', import.meta.url)
const pruningSql = readFileSync(fileURLToPath(pruningUrl), 'utf8')
assert(pruningSql.includes("Jumlah gawang pangkas wajib diisi minimal 1"), 'Server tidak mewajibkan pangkas lebih dari 0')
assert(pruningSql.includes("v_activity.status = 'CORRECTION_REQUIRED'"), 'Migration tidak menjaga revisi lama')
assert(pruningSql.includes('v_activity.row_pruning_span_count'), 'Nilai pangkas historis tidak dicek saat revisi')
assert(pruningSql.includes('pg_get_functiondef'), 'Migration pangkas tidak memperbarui RPC server')

// Verify both follow-up migrations can patch the original deployed RPC source
// in order, without losing the old Var ROW value or existing ROW rules.
const countOccurrences = (text, fragment) => text.split(fragment).length - 1
let simulatedSave = strictSave
const optionalSaveReplacements = [...optionalSql.matchAll(/\(\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*(\d+)\s*\)/g)]
assert(optionalSaveReplacements.length === 5, 'Migration Var ROW harus memiliki lima patch save yang terjaga')
for (const [, oldText, newText, expectedCountText] of optionalSaveReplacements) {
  const expectedCount = Number(expectedCountText)
  const actualCount = countOccurrences(simulatedSave, oldText)
  assert(actualCount === expectedCount, `Fragmen save Var ROW tidak cocok: expected ${expectedCount}, found ${actualCount}: ${oldText.slice(0, 90)}`)
  simulatedSave = simulatedSave.replaceAll(oldText, newText)
}
const pruningSaveOld = pruningSql.match(/v_old text := \$old\$([\s\S]*?)\$old\$;/)?.[1]
const pruningSaveNew = pruningSql.match(/v_new text := \$new\$([\s\S]*?)\$new\$;/)?.[1]
assert(pruningSaveOld && pruningSaveNew, 'Patch validasi pangkas pada save RPC tidak lengkap')
assert(countOccurrences(simulatedSave, pruningSaveOld) === 1, 'Patch pangkas tidak cocok setelah migration Var ROW')
simulatedSave = simulatedSave.replace(pruningSaveOld, pruningSaveNew)
assert(simulatedSave.includes('Jumlah gawang pangkas wajib diisi minimal 1'), 'Validasi pangkas wajib tidak aktif pada save RPC')
assert(simulatedSave.includes('v_row_var_span_count := v_activity.row_var_span_count'), 'Patch pangkas menghilangkan perlindungan Var ROW lama')

let simulatedSubmit = strictSubmit
const optionalSubmitOld = optionalSql.match(/v_old text := \$old\$([\s\S]*?)\$old\$;/)?.[1]
const optionalSubmitNew = optionalSql.match(/v_new text := \$new\$([\s\S]*?)\$new\$;/)?.[1]
assert(optionalSubmitOld && optionalSubmitNew, 'Patch submit opsional Var ROW tidak lengkap')
assert(countOccurrences(simulatedSubmit, optionalSubmitOld) === 1, 'Patch submit Var ROW tidak cocok dengan RPC dasar')
simulatedSubmit = simulatedSubmit.replace(optionalSubmitOld, optionalSubmitNew)
const pruningSubmitOlds = [...pruningSql.matchAll(/v_old text := \$old\$([\s\S]*?)\$old\$;/g)].map((match) => match[1])
const pruningSubmitNews = [...pruningSql.matchAll(/v_new text := \$new\$([\s\S]*?)\$new\$;/g)].map((match) => match[1])
assert(pruningSubmitOlds.length === 2, 'Migration pangkas harus mengubah save dan submit')
assert(pruningSubmitNews.length === 2, 'Migration pangkas harus mengubah save dan submit')
assert(countOccurrences(simulatedSubmit, pruningSubmitOlds[1]) === 1, 'Patch pangkas tidak cocok setelah migration Var ROW')
simulatedSubmit = simulatedSubmit.replace(pruningSubmitOlds[1], pruningSubmitNews[1])
assert(simulatedSubmit.includes('row_pruning_span_count is null or v_activity.row_pruning_span_count < 1'), 'Submit ROW belum mewajibkan pangkas positif')

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
assert(!component.includes("return invalid('Jumlah gawang Var ROW wajib diisi.'"), 'Form masih mewajibkan Var ROW')
assert(!component.includes('Jumlah Gawang Var ROW *'), 'Input Var ROW masih tampil')
assert(!component.includes("fieldRef('rowVarSpanCount')"), 'Input Var ROW masih memiliki field ref')
assert(component.includes('Jumlah Gawang Pangkas'), 'Label gawang pangkas hilang')
assert(component.includes('Jumlah Gawang Pangkas *'), 'Jumlah pangkas belum ditandai wajib')
assert(component.includes("Jumlah gawang pangkas wajib diisi."), 'Validasi input pangkas kosong hilang')
assert(component.includes("Jumlah gawang pangkas harus bilangan bulat minimal 1."), 'Validasi nol/negatif pangkas hilang')
assert(component.includes("if (!isRevision) {\n        const pruningCount = parseRowCount(draft.rowPruningSpanCount)"), 'Validasi pangkas dapat menghalangi revisi historis')
assert(component.includes('min="1" step="1"'), 'Input pangkas masih menerima nol')
assert(component.includes('placeholder="Min. 1"'), 'Placeholder pangkas belum menunjukkan batas minimum')
assert(component.includes('Jumlah Tebang Diameter 20–40 cm'), 'Label tebang 20-40 hilang')
assert(component.includes('Jumlah Tebang Diameter 41–60 cm'), 'Label tebang 41-60 hilang')
assert(component.includes('<span>gawang</span>'), 'Satuan gawang hilang')
assert(component.includes('<span>batang</span>'), 'Satuan batang hilang')
assert(!/Total Tebang|Jumlah Tebang Total|rowTotalCount/.test(component), 'Tidak boleh ada total otomatis tebang')
assert(!component.includes('rowVarSpanCount) +'), 'Var ROW tidak boleh dijumlahkan dengan field lain')
assert(component.includes('rowVarSpanCount: isRowWork ? parseRowCount(draft.rowVarSpanCount) : null'), 'Payload hanya untuk kategori ROW')
assert(component.includes('Nilai lama tetap berada di'), 'Catatan pelestarian nilai Var ROW lama hilang')
assert(component.includes('rowVarSpanCount: first.rowVarSpanCount == null ?'), 'Draft/revisi tidak mengisi ulang nilai Var ROW historis')
assert(component.includes('<dt>Gawang Var ROW</dt>'), 'Detail tidak lagi menampilkan nilai Var ROW historis')
assert(component.includes('disabled={isEvidenceOnlyRevision || isRevision}'), 'Input ROW harus terkunci saat revisi')
assert(component.includes('first.rowVarSpanCount == null'), 'editDraft tidak memuat nilai tersimpan')
assert(component.includes('<h3>Hasil Pekerjaan ROW</h3>'), 'Detail tidak menampilkan Hasil Pekerjaan ROW')
assert(component.includes('Rincian volume belum tersedia pada data lama.'), 'Catatan data lama hilang')
assert(component.includes("formatRowUnit(detailActivity.rowFelling4160Count, 'batang')"), 'Detail tidak memformat tebang 41-60')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.lembur-row-volume-grid'), 'Style grid volume ROW hilang')
assert(css.includes('.lembur-row-detail-grid'), 'Style detail volume ROW hilang')
assert(/\.lembur-row-volume-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/.test(css), 'Grid volume ROW tidak berpasangan 2 kolom')
assert(css.includes('@media (max-width: 480px)'), 'Media query ponsel untuk grid volume hilang')
assert(css.includes('.lembur-row-count:focus-within'), 'Fokus kotak volume ROW hilang')
assert(css.includes('.lembur-row-count > span'), 'Satuan pada kotak volume ROW hilang')
assert(component.includes('placeholder="Opsional"'), 'Placeholder volume opsional hilang')

console.log(`Overtime ROW quantities tests passed: ${passed}`)

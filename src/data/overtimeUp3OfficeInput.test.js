import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

function fnBodyAt(source, start) {
  const open = source.indexOf('$function$', start)
  const bodyStart = open + '$function$'.length
  const close = source.indexOf('$function$', bodyStart)
  return source.slice(bodyStart, close)
}

// ---------------------------------------------------------------------------
// Migrasi: input lembur untuk pegawai kantor UP3
// ---------------------------------------------------------------------------
const migrationUrl = new URL(
  '../../supabase/migrations/20261022000000_up3_office_overtime_input.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')

const createCount = (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length
assert(createCount === 8, `Diharapkan 8 fungsi didefinisikan ulang, ada ${createCount}`)

// A) Helper mutasi: unit UP3 sendiri boleh, hanya Admin UP3 exact / Super Admin.
const mutateStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.auth_can_mutate_overtime_replacement_l2(')
assert(mutateStart >= 0, 'Helper mutasi lembur tidak ditemukan')
const mutateBody = fnBodyAt(sql, mutateStart)
assert(mutateBody.includes("(u.type = 'ULP' and u.parent_id = p_up3_id)"), 'Branch ULP child harus tetap ada')
assert(mutateBody.includes("(u.type = 'UP3' and u.id = p_up3_id)"), 'Branch unit UP3 sendiri hilang')
assert(mutateBody.includes("m.contract_role = 'ADMIN_ULP'"), 'Branch ADMIN_ULP harus tetap ada')
assert(mutateBody.includes("m.contract_role = 'ADMIN_UP3' and m.operational_unit_id is null"), 'Branch Admin UP3 exact hilang')
assert(mutateBody.includes('public.auth_can_manage_overtime_scope'), 'Scope dasar harus tetap dipakai')

// B) Evidence: Admin UP3 exact hanya untuk aktivitas unit UP3 sendiri.
const evStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.auth_can_manage_overtime_evidence_scope(')
assert(evStart >= 0, 'Helper evidence tidak ditemukan')
const evBody = fnBodyAt(sql, evStart)
assert(evBody.includes('p_unit_id = p_up3_id'), 'Gerbang unit UP3 sendiri hilang')
assert(evBody.includes("membership.contract_role = 'ADMIN_UP3'"), 'Branch Admin UP3 evidence hilang')
assert(evBody.includes('membership.operational_unit_id is null'), 'Admin UP3 harus exact (tanpa unit)')
assert(evBody.includes("membership.contract_role = 'ADMIN_ULP'"), 'Branch Admin ULP evidence harus tetap ada')

// C) Daftar pegawai: penugasan langsung ke UP3 ikut direkomendasikan.
const empStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.list_overtime_replacement_employees_l2(')
assert(empStart >= 0, 'Fungsi list pegawai tidak ditemukan')
const empBody = fnBodyAt(sql, empStart)
assert(empBody.includes("(u.type='ULP' and u.parent_id=p_up3_id) or (u.type='UP3' and u.id=p_up3_id)"), 'Join unit UP3 kantor hilang')
assert(empBody.includes("m.contract_role='ADMIN_UP3' and m.operational_unit_id is null"), 'Filter membership Admin UP3 hilang')
assert(empBody.includes("m.contract_role='ADMIN_ULP' and m.operational_unit_id=a.unit_id"), 'Filter membership Admin ULP hilang')
assert(empBody.includes('overtime_employee_is_eligible_l2'), 'Filter kelayakan pegawai hilang')

// D) Keputusan kantor UP3 hanya Super Admin pada 4 RPC approve/reject.
const guardNeedle = "if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin'"
assert((sql.match(new RegExp(guardNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length === 4, 'Tambalan keputusan harus ada pada 4 RPC approve/reject')

for (const name of [
  'approve_overtime_l5',
  'reject_overtime_l5',
  'approve_overtime_entry_l5',
  'reject_overtime_entry_l5',
]) {
  const fnStart = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert(fnStart >= 0, `${name} tidak ditemukan`)
  const fnBody = fnBodyAt(sql, fnStart)
  const guardPos = fnBody.indexOf('v_activity.up3_id and not public.auth_is_super_admin()')
  const reviewPos = fnBody.indexOf('auth_can_review_overtime_l5')
  assert(guardPos >= 0 && reviewPos > guardPos, `Tambalan ${name} harus sebelum pemeriksaan review`)
}

// E) Koreksi lembur disetujui: unit kantor UP3 hanya Super Admin.
const corrStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.correct_approved_overtime_work_l6(')
assert(corrStart >= 0, 'RPC koreksi tidak ditemukan')
const corrBody = fnBodyAt(sql, corrStart)
assert(corrBody.includes('Koreksi lembur kantor UP3 hanya dapat dilakukan oleh Super Admin'), 'Tambalan koreksi kantor UP3 hilang')
assert(corrBody.includes('Hanya Super Admin atau Admin UP3 pada scope ini'), 'Guard lama koreksi harus tetap ada')

// ---------------------------------------------------------------------------
// Halaman: Admin UP3 exact mendapat hak input, diteruskan sebagai prop eksak
// ---------------------------------------------------------------------------
const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
assert(page.includes("canMutate={isSuperAdmin || (isAdminUlp && role === 'ulp') || isAdminUp3}"), 'canMutate harus mencakup Admin UP3 exact')
assert(page.includes('isExactAdminUp3={isAdminUp3}'), 'Prop eksak Admin UP3 harus diteruskan')
assert(page.includes('canCorrectApprovedWork={isSuperAdmin || isAdminUp3}'), 'Prop koreksi harus tetap eksak')

// ---------------------------------------------------------------------------
// Komponen: gerbang input kantor UP3 + pembatasan per record
// ---------------------------------------------------------------------------
const componentUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('isExactAdminUp3 = false,'), 'Prop isExactAdminUp3 hilang')
assert(component.includes('const canInputOffice = canMutate && isExactAdminUp3 && !!up3Id'), 'Flag input kantor UP3 hilang')
assert(component.includes('const officeRecordGuard = (record) => !isExactAdminUp3 || record?.unitId === up3Id'), 'Gerbang record kantor UP3 hilang')
assert(component.includes('rows.filter((row) => row.unitId === up3Id)'), 'Daftar pegawai harus dibatasi unit UP3 kantor untuk Admin UP3')
assert(component.includes('if (!officeRecordGuard(record)) return false'), 'Hapus harus dibatasi unit kantor UP3')
assert(component.includes("'Lembur ini bukan untuk pegawai kantor UP3 Anda.'"), 'Edit harus dibatasi unit kantor UP3')
assert(component.includes('if (!isSuperAdmin && record.unitId === up3Id) return false'), 'Koreksi record kantor UP3 harus diblokir untuk Admin UP3')
assert(component.includes('const detailOfficeBlocked = Boolean(detailActivity && up3Id && detailActivity.unitId === up3Id && !isSuperAdmin)'), 'Detail kantor UP3 harus dibedakan')
assert(component.includes('(isAdminUp3||isSuperAdmin) && detailCanApprove && !detailOfficeBlocked'), 'Tombol approval harus disembunyikan untuk lembur kantor UP3')
assert(component.includes('Lembur kantor UP3 hanya dapat disetujui atau ditolak oleh Super Admin'), 'Keterangan approval kantor UP3 hilang')
assert(component.includes('isSuperAdmin || isManagement || !canMutate || isExactAdminUp3'), 'Kolom unit harus tampil untuk Admin UP3')
assert(component.includes('Anda dapat mengajukan lembur untuk pegawai yang bertugas di kantor UP3'), 'Notifikasi input kantor UP3 hilang')
assert(component.includes("u.type==='UP3' && u.uuid===up3Id"), 'Filter unit harus ada opsi kantor UP3')
assert(component.includes("deleteTarget?.unitId === up3Id ? 'ADMIN UP3' : 'ADMIN ULP'"), 'Kicker dialog hapus kantor UP3 hilang')

// ---------------------------------------------------------------------------
// Browser test D+7 harus menggambarkan arsitektur baru
// ---------------------------------------------------------------------------
const browserUrl = new URL('./lemburFormD7.browser.test.js', import.meta.url)
const browserTest = readFileSync(fileURLToPath(browserUrl), 'utf8')
assert(browserTest.includes('isExactAdminUp3: true'), 'Browser test harus memakai prop eksak')
assert(browserTest.includes("throw new Error('ADMIN_UP3 tidak melihat tombol Tambah Lembur')"), 'Browser test harus memastikan tombol Tambah muncul')

console.log(`Overtime UP3 office input tests passed: ${passed}`)

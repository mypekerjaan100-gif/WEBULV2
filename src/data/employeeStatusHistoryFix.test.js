import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectiveEmploymentStatusOf } from './pensiunPelayananTeknik.js'

const migration = readFileSync(
  new URL('../../supabase/migrations/20261113120000_employee_status_history_fix.sql', import.meta.url),
  'utf8',
)
assert.ok(migration.includes('create or replace function private.reconcile_employee_status_history'), 'Helper rekonsiliasi status hilang')
assert.ok(migration.includes('v_same_values and (v_status = \'Aktif\' or v_current.effective_from = v_effective)'), 'Edit tanpa perubahan status harus berhenti tanpa menulis riwayat')
assert.ok(migration.includes('if v_effective = v_current.effective_from then'), 'Transisi pada tanggal yang sama harus memperbarui baris yang ada')
assert.ok(migration.includes('set effective_from = v_effective'), 'Koreksi tanggal nonaktif harus memindahkan awal status')
assert.ok(migration.includes('set effective_to = v_effective'), 'Batas akhir status sebelumnya harus ikut disesuaikan')
assert.ok(migration.includes('update public.employee_status_history\n       set effective_to = v_effective\n     where id = v_current.id;'), 'Transisi normal harus menutup status berjalan')
assert.ok(migration.includes('perform private.reconcile_employee_status_history('), 'Snapshot harus memakai helper rekonsiliasi')
assert.ok(!migration.includes('least(p_effective, v_status_eff)'), 'Penutupan dengan least() yang membuat interval nol harus dihapus')
assert.ok(migration.includes("case when v_emp_status='Aktif' then p_effective else v_status_eff end"), 'Status Aktif baru tidak boleh memakai tanggal resign lama')
assert.ok(migration.includes('Tanggal status tidak boleh sebelum awal riwayat status sebelumnya'), 'Validasi tanggal retroaktif harus jelas')

const repository = readFileSync(new URL('./employeeRepository.js', import.meta.url), 'utf8')
assert.ok(repository.includes('currentStatus?.status === \'Nonaktif\' ? (currentStatus?.effectiveDate ?? null) : null'), 'Tanggal awal Aktif tidak boleh masuk form sebagai tanggal resign')

const component = readFileSync(new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url), 'utf8')
assert.ok(component.includes('const openStatus = [...(e.statusHistory ?? [])].find((entry) => entry.validTo == null)'), 'Form edit harus memakai baris status terakhir')
assert.ok(component.includes("statusEffectiveDate: formStatus === 'Nonaktif'"), 'Tanggal status hanya diisi untuk Nonaktif')
assert.ok(component.includes('effectiveEmploymentStatusOf(data, todayStr, pensionPolicy).status !== filterStatus'), 'Filter status harus memakai status efektif')
assert.ok(component.includes("{ value: effectiveEmploymentStatusOf(data, todayStr, pensionPolicy).status }"), 'Export status harus memakai status efektif')

const headerStart = component.indexOf('<th>Foto</th>')
const headerEnd = component.indexOf('</tr>', headerStart)
const header = component.slice(headerStart, headerEnd)
assert.ok(header.indexOf('<th>Status</th>') > header.indexOf('<th>Nama</th>'), 'Status harus tampil setelah Nama')
assert.ok(header.indexOf('<th>Status</th>') < header.indexOf('<th>Unit</th>'), 'Status harus berada di bagian awal tabel')
assert.ok(component.includes('const effectiveStatus = effectiveEmploymentStatusOf(data, todayStr, pensionPolicy)'), 'Baris tabel harus memakai status efektif')
assert.ok(component.includes('{effectiveStatus.status}'), 'Badge status tabel harus merender status efektif')

assert.equal(effectiveEmploymentStatusOf({ employmentStatus: 'Nonaktif', statusReason: 'Resign', statusEffectiveDate: '2026-11-01' }, '2026-11-13', null).effectiveDate, '2026-11-01')
assert.equal(effectiveEmploymentStatusOf({ employmentStatus: 'Aktif', retirementDateOverride: '2026-11-01' }, '2026-11-13', null).status, 'Nonaktif')
assert.equal(effectiveEmploymentStatusOf({ employmentStatus: 'Aktif', retirementDateOverride: '2026-12-01' }, '2026-11-13', null).status, 'Aktif')

console.log('Employee status history fix tests passed')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const migration = read('../../supabase/migrations/20261027120000_employee_employment_type.sql')
assert(migration.includes('employment_type'), 'Kolom employment_type hilang')
assert(migration.includes("in ('PKWT', 'PKWTT')"), 'Batasan PKWT/PKWTT hilang')
assert(migration.includes('grant select (employment_type) on public.employees to authenticated'),
  'Grant baca kolom untuk authenticated hilang')
assert(migration.includes("v_has_emp_type"), 'Pertahankan nilai lama saat key tidak dikirim hilang')
assert(migration.includes("employment_type=case when v_has_emp_type then v_emp_type else employment_type end"),
  'Update employment_type tidak aman untuk snapshot lama')

const employeeRepo = read('./employeeRepository.js')
assert(employeeRepo.includes('employment_type'), 'Select employees belum memuat employment_type')
assert(employeeRepo.includes("employmentType: row.employment_type ?? ''"), 'Mapping employmentType hilang')

const mutationRepo = read('./employeeMutationRepository.js')
assert(mutationRepo.includes('normalizeEmploymentType'), 'Normalisasi jenis perjanjian hilang')
assert(mutationRepo.includes('employment_type:'), 'Snapshot RPC belum memuat employment_type')
assert(mutationRepo.includes('employmentType: snap.employment_type'), 'Snapshot ke UI belum memuat employmentType')
assert(mutationRepo.includes("'jenis_perjanjian'"), 'Header import jenis perjanjian hilang')
assert(mutationRepo.includes('hasEmploymentTypeColumn'), 'Impor template lama harus mempertahankan nilai')

const component = read('../components/sla/SLADatabasePegawai.jsx')
assert(component.includes('Jenis Perjanjian Kerja'), 'Field form/detail hilang')
assert(component.includes('<option value="PKWT">PKWT</option>'), 'Opsi PKWT hilang')
assert(component.includes('<option value="PKWTT">PKWTT</option>'), 'Opsi PKWTT hilang')
assert(component.includes('filterEmploymentType'), 'Filter jenis perjanjian hilang')
assert(component.includes("{ label: 'Jenis Perjanjian Kerja', width: 20 }"), 'Kolom export hilang')
assert(component.includes('employmentType: e.employmentType ?? \'\''), 'Edit form tidak memuat employmentType')
assert(component.includes('employmentType: employee.employmentType ?? \'\''), 'Snapshot aplikasi tidak memuat employmentType')

const domain = read('./pegawaiPelayananTeknik.js')
assert(domain.includes('employmentType'), 'Domain pegawai belum memuat employmentType')

console.log('Employee employment type tests passed')

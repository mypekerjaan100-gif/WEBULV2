import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const tableMigrationUrl = new URL(
  '../../supabase/migrations/20261013120000_employee_photos.sql',
  import.meta.url,
)
const tableSql = readFileSync(fileURLToPath(tableMigrationUrl), 'utf8')
assert(tableSql.includes('create table if not exists public.employee_photos'), 'Tabel employee_photos hilang')
assert(tableSql.includes('uq_employee_photos_one_active'), 'Unique satu foto aktif hilang')
assert(tableSql.includes('524288'), 'Batas 512 KB hilang')
assert(tableSql.includes("stored_mime_type = 'image/webp'"), 'Format WebP hilang')
assert(tableSql.includes('employee-photos'), 'Bucket employee-photos hilang')
assert(tableSql.includes('auth_can_read_employee_photo'), 'Helper baca foto hilang')
assert(tableSql.includes('auth_can_upload_employee_photo_object'), 'Helper upload Storage hilang')
assert(tableSql.includes('auth_can_delete_employee_photo_object'), 'Helper hapus Storage hilang')
assert(!tableSql.includes('getPublicUrl'), 'Tidak boleh memakai public URL')

const lifecycleMigrationUrl = new URL(
  '../../supabase/migrations/20261013121000_employee_photos_lifecycle.sql',
  import.meta.url,
)
const lifecycleSql = readFileSync(fileURLToPath(lifecycleMigrationUrl), 'utf8')
assert(lifecycleSql.includes('prepare_employee_photo_upload'), 'Prepare foto hilang')
assert(lifecycleSql.includes('finalize_employee_photo_upload'), 'Finalize foto hilang')
assert(lifecycleSql.includes('list_employee_photos'), 'List foto hilang')
assert(lifecycleSql.includes('get_employee_photo_preview_path'), 'Preview path hilang')
assert(lifecycleSql.includes('begin_employee_photo_delete'), 'Delete lifecycle hilang')
assert(lifecycleSql.includes('Foto pegawai wajib diunggah untuk pegawai baru'), 'Validasi wajib foto tambah hilang')
assert(lifecycleSql.includes('belum memiliki foto'), 'Validasi backfill saat edit hilang')
assert(lifecycleSql.includes("status='ABANDONED'"), 'Reject harus abandon foto staged')
assert(lifecycleSql.includes("status='SUPERSEDED'"), 'Penggantian harus supersede foto lama')

const processorUrl = new URL('./employeePhotoProcessor.js', import.meta.url)
const processor = readFileSync(fileURLToPath(processorUrl), 'utf8')
assert(processor.includes('EMPLOYEE_PHOTO_MAX_BYTES'), 'Konstanta batas foto hilang')
assert(processor.includes('processEmployeePhotoFile'), 'Fungsi proses foto hilang')
assert(processor.includes('image/webp'), 'Output harus WebP')
assert(processor.includes('1200'), 'Batas dimensi 1200 hilang')

const repoUrl = new URL('./employeePhotoRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('uploadEmployeePhoto'), 'Upload foto hilang')
assert(repo.includes('listEmployeePhotos'), 'List foto hilang')
assert(repo.includes('createEmployeePhotoSignedUrl'), 'Signed URL hilang')
assert(repo.includes('createSignedUrl'), 'Harus memakai signed URL')
assert(!repo.includes('getPublicUrl'), 'Tidak boleh memakai public URL')
assert(repo.includes('cancel_employee_photo_upload'), 'Cleanup PENDING hilang')

const mutationUrl = new URL('./employeeMutationRepository.js', import.meta.url)
const mutation = readFileSync(fileURLToPath(mutationUrl), 'utf8')
assert(mutation.includes('photo_asset_id'), 'photo_asset_id harus diteruskan ke RPC')

const componentUrl = new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('sp-pegawai-photo'), 'Class foto pegawai hilang')
assert(component.includes('Foto Pegawai'), 'Label foto pegawai hilang')
assert(component.includes('Foto pegawai wajib diunggah'), 'Validasi wajib foto hilang')
assert(component.includes('Foto belum tersedia'), 'Placeholder foto hilang')
assert(component.includes('listEmployeePhotos'), 'Komponen harus memuat foto')
assert(component.includes('uploadEmployeePhoto'), 'Komponen harus mengunggah foto')
assert(component.includes('<th>Foto</th>'), 'Kolom foto tabel hilang')
assert(component.includes('photoAssetId'), 'Form harus membawa photoAssetId')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.sp-pegawai-photo'), 'Style foto pegawai hilang')
assert(css.includes('.sp-pegawai-photo-thumb'), 'Style thumbnail hilang')
assert(css.includes('.sp-pegawai-photo-large'), 'Style foto besar hilang')

console.log(`Employee photo feature tests passed: ${passed}`)

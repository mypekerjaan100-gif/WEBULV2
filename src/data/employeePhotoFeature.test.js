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
assert(tableSql.includes('2097152'), 'Batas 2 MB hilang')
assert(!tableSql.includes('524288'), 'Sisa batas 512 KB harus sudah diganti 2 MB')
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
assert(lifecycleSql.includes('2097152'), 'Batas 2 MB di lifecycle hilang')
assert(lifecycleSql.includes('Foto hasil kompresi maksimal 2 MB'), 'Pesan batas prepare hilang')
assert(lifecycleSql.includes('Foto melebihi 2 MB'), 'Pesan batas finalize hilang')
assert(!lifecycleSql.includes('524288'), 'Sisa batas 512 KB di lifecycle harus sudah diganti 2 MB')

const limitMigrationUrl = new URL(
  '../../supabase/migrations/20261014120000_employee_photos_2mb.sql',
  import.meta.url,
)
const limitSql = readFileSync(fileURLToPath(limitMigrationUrl), 'utf8')
assert(limitSql.includes('2097152'), 'Migration delta 2 MB hilang')
assert(limitSql.includes('ep_stored_size_limit'), 'Migration delta harus memperbarui constraint')
assert(limitSql.includes("update storage.buckets"), 'Migration delta harus memperbarui bucket')

const processorUrl = new URL('./employeePhotoProcessor.js', import.meta.url)
const processor = readFileSync(fileURLToPath(processorUrl), 'utf8')
assert(processor.includes('EMPLOYEE_PHOTO_MAX_BYTES'), 'Konstanta batas foto hilang')
assert(processor.includes('2 * 1024 * 1024'), 'Batas hasil kompresi harus 2 MB')
assert(processor.includes('processEmployeePhotoFile'), 'Fungsi proses foto hilang')
assert(processor.includes('image/webp'), 'Output harus WebP')
assert(processor.includes('1200'), 'Batas dimensi 1200 hilang')
assert(!processor.includes('512 KB'), 'Sisa teks 512 KB di processor harus sudah diganti')

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
assert(component.includes('processEmployeePhotoFile'), 'Komponen harus memakai processEmployeePhotoFile')
assert(!component.includes('prepareEmployeePhotoFile'), 'Import foto yang salah harus sudah diperbaiki')
assert(component.includes('sp-pegawai-photo-dropzone'), 'Dropzone foto hilang')
assert(component.includes('Klik atau tarik foto ke sini'), 'Teks dropzone hilang')
assert(component.includes('hasil maks. 2 MB'), 'Teks batas 2 MB hilang')
assert(!component.includes('maks. 512 KB'), 'Sisa teks 512 KB harus sudah diganti')
assert(component.includes('onDrop={handlePhotoDrop}'), 'Dukungan drag-and-drop hilang')
assert(component.includes('Memproses dan mengompresi foto'), 'Status kompresi hilang')
assert(component.includes('openPhotoViewer'), 'Viewer foto detail hilang')
assert(component.includes('Klik untuk memperbesar'), 'Petunjuk perbesar foto hilang')
assert(component.includes('sp-pegawai-photo-zoom'), 'Tombol zoom foto hilang')
assert(component.includes('sp-pegawai-viewer'), 'Modal viewer foto hilang')
assert(component.includes("event.key === 'Escape'"), 'Tombol Esc viewer hilang')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.sp-pegawai-photo'), 'Style foto pegawai hilang')
assert(css.includes('.sp-pegawai-photo-thumb'), 'Style thumbnail hilang')
assert(css.includes('.sp-pegawai-photo-large'), 'Style foto besar hilang')
assert(css.includes('.sp-pegawai-photo-dropzone'), 'Style dropzone hilang')
assert(css.includes('.sp-pegawai-photo-drop'), 'Style preview dropzone hilang')
assert(css.includes('.sp-pegawai-photo-loading'), 'Style indikator kompresi hilang')
assert(css.includes('.sp-pegawai-photo-zoom'), 'Style tombol zoom hilang')
assert(css.includes('.sp-pegawai-viewer-img'), 'Style gambar viewer hilang')

console.log(`Employee photo feature tests passed: ${passed}`)

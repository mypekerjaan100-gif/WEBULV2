import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const migrationUrl = new URL(
  '../../supabase/migrations/20261014150000_overtime_participant_v2.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
assert(sql.includes('evidence_mode'), 'Kolom evidence_mode hilang')
assert(sql.includes('PARTICIPANT_V2'), 'Mode PARTICIPANT_V2 hilang')
assert(sql.includes('LEGACY_SHARED'), 'Fallback LEGACY_SHARED hilang')
assert(sql.includes('list_overtime_activity_entries'), 'RPC daftar peserta hilang')
assert(sql.includes('get_overtime_sync_version'), 'RPC versi sinkron hilang')
assert(sql.includes('wajib memakai evidence per peserta'), 'Penolakan shared prepare V2 hilang')
assert(sql.includes('Authentication required') && sql.includes('auth_can_read_overtime_evidence_scope'), 'Perbaikan auth history hilang')
assert(sql.includes("'PARTICIPANT_V2', auth.uid(), auth.uid()"), 'Aktivitas baru harus V2')
assert(sql.includes('Jam peserta yang sudah diajukan tidak dapat diubah'), 'Kunci jam SUBMITTED hilang')
assert(sql.includes('tidak pernah menghitung ulang snapshot finansial peserta APPROVED') || sql.includes('snapshot finansial peserta APPROVED'), 'Immutabilitas finansial approved hilang')
assert(sql.includes('Gunakan resubmit per peserta'), 'Guard resubmit aktivitas V2 hilang')
assert(sql.includes('Peserta %: Foto Proses Pekerjaan belum lengkap'), 'Validasi submit per peserta hilang')
assert(sql.includes('entry_id is null or entry_id = v_entry.id'), 'Pending check resubmit harus per entry')

const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('listOvertimeActivityEntries'), 'Repo daftar peserta hilang')
assert(repo.includes('getOvertimeSyncVersion'), 'Repo versi sinkron hilang')
assert(repo.includes('evidenceMode'), 'Mapping evidenceMode hilang')

const componentUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('participantEntries'), 'State peserta per entry hilang')
assert(component.includes('isV2Work'), 'Flag model V2 hilang')
assert(component.includes('isEntryRevision'), 'Revisi berbasis entry hilang')
assert(component.includes('stagedKeyFor'), 'Staging per peserta hilang')
assert(component.includes('effectiveRequirementComplete'), 'Evidence efektif per peserta hilang')
assert(component.includes('participantComplete'), 'Kelengkapan per peserta hilang')
assert(component.includes('entryId: revisionEntryId'), 'Upload harus ke entryId peserta')
assert(component.includes('isParticipantLocked'), 'Penguncian baris peserta hilang')
assert(component.includes('detailEvidenceGroups'), 'Grouping evidence detail hilang')
assert(component.includes('approvalTarget.entryId'), 'Target notifikasi harus membawa entryId')
assert(
  component.indexOf('const evidenceByType') < component.indexOf('const v2CompleteCount'),
  'v2CompleteCount harus dihitung setelah evidenceByType (hindari crash render)',
)
assert(
  component.indexOf('const sharedComplete =') < component.indexOf('const v2CompleteCount'),
  'sharedComplete harus dideklarasikan sebelum v2CompleteCount (hindari crash render)',
)
assert(component.includes('Evidence Bersama'), 'Blok evidence bersama hilang')
assert(component.includes('Foto briefing wajib diunggah untuk'), 'Penjelasan briefing per pegawai hilang')
assert(component.includes('briefingRequirements'), 'Split briefing/shared hilang')
assert(component.includes('sharedRequirements'), 'Split shared hilang')
assert(component.includes('briefingRequirementComplete'), 'Kelengkapan briefing per pegawai hilang')
assert(component.includes('effectiveRequirementComplete'), 'Kelengkapan efektif revisi hilang')
assert(component.includes('sharedStagedKey'), 'Staging evidence bersama hilang')
assert(component.includes('ownerEntryIdOf'), 'Kepemilikan baris evidence hilang')
assert(component.includes('sharedExistingFor'), 'Pembaca evidence bersama hilang')
assert(component.includes('scopedExistingFor'), 'Pembaca evidence khusus hilang')
assert(component.includes('entryId: null'), 'Upload bersama harus memakai entryId null')
assert(component.includes('Foto Briefing wajib diunggah pada kartu'), 'Guard briefing bersama hilang')
assert(component.includes('Evidence peserta lain dikunci'), 'Catatan revisi per peserta hilang')
assert(!component.includes('evidenceSourceByTemp'), 'State pilihan sumber harus sudah dihapus')
assert(!component.includes('setParticipantSource'), 'Radio sumber harus sudah dihapus')
assert(component.includes('lembur-member-card'), 'Kartu gabungan pegawai hilang')
assert(component.includes('Pegawai, Waktu & Foto Briefing'), 'Judul section gabungan hilang')
assert(!component.includes('Ganti evidence pada bagian C di bawah.'), 'Briefing tidak boleh diarahkan pindah ke bagian C')
assert(component.includes('lembur-member-briefing'), 'Slot briefing dalam kartu hilang')
assert(component.includes('effectiveExistingFor'), 'Evidence efektif target revisi hilang')
assert(component.includes('Revisi Pengajuan'), 'Label Revisi Pengajuan hilang')
assert(component.includes('Ajukan Ulang ${activeRevisionParticipantName}'), 'Tombol ajukan ulang bernama hilang')
assert(component.includes('Simpan Revisi ${activeRevisionParticipantName}'), 'Tombol simpan revisi bernama hilang')
assert(component.includes('historyEventText'), 'Label riwayat Indonesia hilang')
assert(component.includes('historyStatusLabel'), 'Label status riwayat hilang')
assert(component.includes('Revisi Disimpan'), 'Judul Revisi Disimpan hilang')
assert(component.includes('Dikembalikan Untuk Revisi'), 'Judul penolakan hilang')
assert(component.includes('lembur-history-reason'), 'Blok alasan penolakan hilang')
assert(!component.includes('actor_user_id?.slice(0,8)'), 'Potongan UUID harus dihapus dari riwayat')
assert(component.includes('isLegacyRevisionMarker'), 'Deteksi marker revisi lama hilang')
assert(component.includes('detailEntryRejectionCount'), 'Atribusi marker ke peserta ditolak hilang')
assert(component.includes('Catatan lama: peserta tidak tercatat.'), 'Penanda batch untuk marker lama hilang')
assert(repo.includes('softDeleteOvertimeEntry'), 'Repo hapus peserta hilang')
assert(component.includes('softDeleteOvertimeEntry'), 'Form harus memakai hapus per peserta')
assert(component.includes('Hapus Peserta Lembur'), 'Judul dialog hapus peserta hilang')
assert(component.includes('Hanya peserta ini yang dihapus'), 'Penjelasan hapus peserta hilang')
assert(!component.includes('ikut dihapus'), 'Teks hapus seluruh batch harus dihapus')

const entryDeleteMigrationUrl = new URL(
  '../../supabase/migrations/20261014210000_overtime_entry_delete.sql',
  import.meta.url,
)
const entryDeleteSql = readFileSync(fileURLToPath(entryDeleteMigrationUrl), 'utf8')
assert(entryDeleteSql.includes('soft_delete_overtime_entry_l5'), 'RPC hapus peserta hilang')
assert(entryDeleteSql.includes('Hanya peserta yang belum disetujui'), 'Proteksi hapus target approved hilang')
assert(component.includes('Data Belum Lengkap'), 'Judul warning data belum lengkap hilang')
assert(component.includes('is-invalid'), 'Penanda field belum lengkap hilang')
assert(component.includes('validation-banner'), 'Anchor banner warning hilang')
assert(component.includes('failValidation'), 'Alur warning validasi hilang')
assert(component.includes('Lokasi pekerjaan wajib diisi.'), 'Pesan lokasi wajib hilang')
assert(component.includes('Lengkapi seluruh evidence wajib sebelum mengajukan Lembur.'), 'Batas evidence saat ajukan hilang')

const historyMigrationUrl = new URL(
  '../../supabase/migrations/20261014190000_overtime_history_revision_saved.sql',
  import.meta.url,
)
const historySql = readFileSync(fileURLToPath(historyMigrationUrl), 'utf8')
assert(historySql.includes('REVISION_SAVED'), 'Event REVISION_SAVED hilang')
assert(historySql.includes("'UPDATED'"), 'Event UPDATED hilang')

const targetMigrationUrl = new URL(
  '../../supabase/migrations/20261014200000_overtime_save_explicit_target.sql',
  import.meta.url,
)
const targetSql = readFileSync(fileURLToPath(targetMigrationUrl), 'utf8')
assert(targetSql.includes('p_revision_entry_id uuid default null'), 'Param target revisi hilang')
assert(targetSql.includes('Hanya peserta yang ditolak dapat direvisi'), 'Validasi target revisi hilang')
assert(targetSql.includes('selain target eksplisit tidak ditulis ulang'), 'Skip non-target hilang')
assert(repo.includes('p_revision_entry_id'), 'Repo harus meneruskan target revisi')
assert(component.includes('revisionEntryId: isEntryRevision'), 'Form harus mengirim target revisi saat simpan')
assert(component.includes('evidenceReloadToken'), 'Token reload evidence hilang')
assert(component.includes('evidenceLoading'), 'Status memuat evidence hilang')
assert(component.includes('Memuat evidence...'), 'Indikator memuat evidence hilang')
assert(
  component.lastIndexOf('setEvidenceReloadToken') > component.indexOf('const editDraft = (record)'),
  'editDraft harus memicu reload evidence',
)

const sharedMigrationUrl = new URL(
  '../../supabase/migrations/20261014160000_overtime_v2_shared_evidence.sql',
  import.meta.url,
)
const sharedSql = readFileSync(fileURLToPath(sharedMigrationUrl), 'utf8')
assert(sharedSql.includes('PARTICIPANT_V2'), 'Guard V2 hilang dari migration bersama')
assert(sharedSql.includes("submission_count, 0) <> 0"), 'Shared V2 harus dibatasi draft awal')
assert(sharedSql.includes('Revisi memakai evidence khusus peserta'), 'Pesan revisi scoped hilang')

const briefingMigrationUrl = new URL(
  '../../supabase/migrations/20261014170000_overtime_v2_briefing_per_participant.sql',
  import.meta.url,
)
const briefingSql = readFileSync(fileURLToPath(briefingMigrationUrl), 'utf8')
assert(briefingSql.includes("wajib diunggah per pegawai (entry_id)"), 'Penolakan briefing bersama hilang')
assert(briefingSql.includes('Foto Briefing Pekerjaan wajib diunggah per pegawai'), 'Validasi submit briefing scoped hilang')
assert(briefingSql.includes('v_submission_number,'), 'Insert history submit harus membawa nomor submission')

const isolationMigrationUrl = new URL(
  '../../supabase/migrations/20261014180000_overtime_entry_isolation_fix.sql',
  import.meta.url,
)
const isolationSql = readFileSync(fileURLToPath(isolationMigrationUrl), 'utf8')
assert(isolationSql.includes('entry_approval_status'), 'List harus mengembalikan status per entry')
assert(isolationSql.includes('entry_rejection_count'), 'List harus mengembalikan jumlah tolak per entry')
assert(isolationSql.includes('entry_revision_deadline_at'), 'List harus mengembalikan batas revisi per entry')
assert(isolationSql.includes('v_draft = v_total'), 'Aggregator harus menangani draft murni')
assert(isolationSql.includes('tidak ditulis ulang sama sekali'), 'Save revisi tidak boleh menulis ulang peserta lain')
assert(isolationSql.includes('Batas revisi peserta telah lewat'), 'Batas revisi harus dicek per entry')
assert(isolationSql.includes('Data pekerjaan dikunci selama revisi'), 'Metadata bersama harus dikunci saat revisi')
assert(isolationSql.includes('v_cover_min'), 'Envelope harus diperlebar dulu saat revisi jam')
assert(component.includes('memberTimeLocked'), 'Jam target revisi harus bisa diedit')
assert(component.includes('record.entryId === activeRevisionEntryId'), 'Status form harus mengikuti peserta yang dipilih')
assert(component.includes('verified === false'), 'Verifikasi harus membedakan belum-terverifikasi')
assert(repo.includes("'entry_revision_deadline_at' in row"), 'Batas revisi null per entry tidak boleh diwarisi batch')

const cardUrl = new URL('../components/sla/EvidenceUploadCard.jsx', import.meta.url)
const card = readFileSync(fileURLToPath(cardUrl), 'utf8')
assert(card.includes('lockedNote'), 'Catatan kunci kustom hilang')

const notifUrl = new URL('./approvalNotificationRepository.js', import.meta.url)
const notif = readFileSync(fileURLToPath(notifUrl), 'utf8')
assert(notif.includes('entryId: row.entryId'), 'Notifikasi harus membawa entryId')
assert(notif.includes('satu notifikasi per peserta') || notif.includes('per peserta'), 'Komentar notifikasi per peserta hilang')

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
assert(page.includes('refreshLembur({ background: true })'), 'Polling lembur latar hilang')
assert(page.includes('30000'), 'Interval sinkron lembur hilang')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.lembur-participant-evidence-list'), 'Style daftar evidence peserta hilang')
assert(css.includes('.lembur-participant-evidence-heading'), 'Style heading evidence peserta hilang')
assert(css.includes('.lembur-member-card'), 'Style kartu gabungan hilang')
assert(css.includes('.lembur-member-fields'), 'Style field kartu gabungan hilang')

const entryDeleteFixUrl = new URL(
  '../../supabase/migrations/20261014230000_overtime_entry_delete_storage_api.sql',
  import.meta.url,
)
const entryDeleteFixSql = readFileSync(fileURLToPath(entryDeleteFixUrl), 'utf8')
assert(entryDeleteFixSql.includes('soft_delete_overtime_entry_l5'), 'RPC hapus peserta pengganti hilang')
assert(!/delete\s+from\s+storage\.objects/i.test(entryDeleteFixSql), 'RPC tidak boleh menghapus storage.objects langsung')
assert(entryDeleteFixSql.includes('delete from public.overtime_evidence where entry_id = p_entry_id'), 'Metadata scoped harus tetap dibersihkan server')

const evidenceRepoUrl = new URL('./overtimeEvidenceRepository.js', import.meta.url)
const evidenceRepo = readFileSync(fileURLToPath(evidenceRepoUrl), 'utf8')
assert(evidenceRepo.includes('removeOvertimeEvidenceFiles'), 'Helper hapus file Storage hilang')
assert(component.includes('removeOvertimeEvidenceFiles'), 'Form hapus peserta harus membersihkan file via Storage API')
assert(component.includes('includeHistory: true'), 'Daftar file peserta harus mencakup semua status')
assert(component.includes('(!isRevision || isRevisionTarget(v2info))'), 'Briefing revisi harus tetap di kartu peserta')
assert(component.includes('foto briefing tetap di kartu'), 'Petunjuk briefing di kartu peserta hilang')
assert(component.includes('const visibleRequirements = sharedRequirements'), 'Bagian C revisi harus tanpa briefing')
assert(component.includes('detailProfileByEmployee'), 'State foto profil detail hilang')
assert(component.includes('listEmployeePhotos'), 'Detail harus memuat foto profil pegawai')
assert(component.includes('createEmployeePhotoSignedUrls'), 'URL foto profil harus via signed URL')
assert(component.includes("photo.status !== 'ACTIVE'"), 'Hanya foto ACTIVE yang dipakai')
assert(component.includes('Foto Profil Pegawai'), 'Judul preview foto profil hilang')
assert(component.includes('Foto profil belum tersedia'), 'Fallback foto kosong hilang')
assert(component.includes('lembur-participant-identity'), 'Identitas peserta + foto hilang')
assert(css.includes('.lembur-participant-identity'), 'Style identitas peserta hilang')
assert(css.includes('button.lembur-profile-thumb'), 'Style tombol foto profil hilang')

console.log(`Overtime participant evidence tests passed: ${passed}`)

import { currentNameOf, initialOrganizationUnits } from './organisasiPelayananTeknik.js'

export const slaUnits = initialOrganizationUnits.map((unit) => ({
  id: unit.id,
  type: unit.type,
  parentUnitId: unit.parentUnitId,
  name: currentNameOf(unit),
}))

export const slaContractScope = {
  contractId: 'pelayanan-teknik',
  contractName: 'Pelayanan Teknik',
  region: 'UP3 Singkawang',
  up3: { id: 'up3', name: 'UP3 Singkawang' },
  ulpIds: ['ulp-1', 'ulp-2', 'ulp-3', 'ulp-4', 'ulp-5', 'ulp-6'],
}

export const slaPeriods = [
  'Januari 2026',
  'Februari 2026',
  'Maret 2026',
  'April 2026',
  'Mei 2026',
  'Juni 2026',
  'Juli 2026',
  'Agustus 2026',
  'September 2026',
  'Oktober 2026',
  'November 2026',
  'Desember 2026',
  'Januari 2027',
  'Februari 2027',
  'Maret 2027',
  'April 2027',
  'Mei 2027',
  'Juni 2027',
  'Juli 2027',
  'Agustus 2027',
]

export const slaVersions = [
  {
    id: 'v1',
    name: 'SLA Versi 1',
    status: 'Aktif',
    period: 'Januari 2026 - Desember 2026',
    source: 'csv',
    targets: null,
    effectiveDate: '2026-01-01',
    agreementName: 'Surat Perjanjian Kerja Sama Pelayanan Teknik No. 001/SPK/UP3SKW/2026',
    metadataNote:
      'SLA awal kontrak Pelayanan Teknik. Berlaku sejak 01-01-2026 sampai dengan 31-12-2026.',
  },
  {
    id: 'v2',
    name: 'SLA Versi 2 (Draft)',
    status: 'Draft',
    period: 'Januari 2026 - Desember 2026',
    source: 'copy-active',
    targets: null,
    effectiveDate: '2026-01-01',
    agreementName: 'Surat Perjanjian Kerja Sama Pelayanan Teknik No. 001/SPK/UP3SKW/2026',
    metadataNote: 'Draft addendum; metadata mengikuti versi aktif sampai diaktifkan.',
  },
].map((version) => ({
  ...version,
  contractId: 'pelayanan-teknik',
  up3Id: 'up3',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
}))

export const slaCategories = [
  { id: 'A', name: 'A. SLA Teknis' },
  { id: 'B', name: 'B. SLA Keselamatan dan Kesehatan Kerja' },
  { id: 'C', name: 'C. SLA Pemenuhan Hak Normatif' },
  { id: 'D', name: 'D. SLA Integritas Layanan Publik' },
]

export const variableCostPoints = new Set([
  '2.1a',
  '2.1b',
  '2.1c',
  '2.1d',
  '3.1a',
  '3.1b',
  '3.2a',
  '3.2b',
])

export const variableCostLabelsByCode = {
  '2.1a': 'Inspeksi SUTM Tier 1',
  '2.1b': 'Inspeksi SUTM Tier 2',
  '2.1c': 'Inspeksi Gardu/Keypoint Tier 1',
  '2.1d': 'Inspeksi Gardu/Keypoint Tier 2',
  '3.1a': 'ROW Fix',
  '3.1b': 'ROW Var',
  '3.2a': 'Pengukuran Gardu',
  '3.2b': 'Pemeliharaan Gardu',
  '3.1c': 'Konstruksi',
  TEBANG_20_40_CM: 'Tebang 20\u201340 cm',
  TEBANG_40_60_CM: 'Tebang 40\u201360 cm',
}

export const slaIndicators = [
  // ---------- A. SLA TEKNIS ----------
  {
    id: 'A-1.1a',
    category: 'A',
    scope: 'Pelayanan Teknik',
    point: '1.1a',
    criteria:
      'Melakukan penanganan gangguan (termasuk Gangguan JTM/JTR 3 Tiang dan 2 Gawang)',
    performanceTarget:
      '100% terpenuhinya rata-rata response time bulanan gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit',
    evidence:
      'EIS APKT Menu Rekapitulasi Gangguan All Response - Dispatching',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-1.1b',
    category: 'A',
    scope: 'Pelayanan Teknik',
    point: '1.1b',
    criteria:
      'Melakukan penanganan gangguan (termasuk Gangguan JTM/JTR 3 Tiang dan 2 Gawang)',
    performanceTarget:
      '100% terpenuhinya rata-rata recovery time bulanan gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit',
    evidence: 'EIS APKT Menu Rekapitulasi Gangguan All Recovery',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-1.2',
    category: 'A',
    scope: 'Pelayanan Teknik',
    point: '1.2',
    criteria: 'YANTEK Optimization',
    performanceTarget:
      'Tidak ada Performa Individu YANTEK dibawah posisi middle (kecuali cuti dan sakit, dibuktikan dengan surat cuti dari PCN/PLNT, surat sakit dari Dokter/PUSKESMAS/RS) dan jika ybs di PHK atau resign',
    evidence: 'Rekap YO Bulanan',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-1.3',
    category: 'A',
    scope: 'Pelayanan Teknik',
    point: '1.3',
    criteria: 'Rating Kepuasan Pelanggan Bulanan',
    performanceTarget:
      'Feedback Rating Negatif pada PLN Mobile sesuai dengan target yang ditetapkan pada masing-masing unit',
    evidence: 'Laporan EIS APKT',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-1.4',
    category: 'A',
    scope: 'Pelayanan Teknik',
    point: '1.4',
    criteria: 'Laporan Berulang Bulanan',
    performanceTarget:
      'Laporan Berulang pada PLN Mobile sesuai dengan target yang ditetapkan pada masing-masing unit',
    evidence: 'Laporan EIS APKT',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-2.1a',
    category: 'A',
    scope: 'Inspeksi Jaringan Distribusi',
    point: '2.1a',
    criteria:
      'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)',
    performanceTarget: 'Inspeksi SUTM Tier 1: 17.539 gawang/bulan',
    evidence: 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'gawang',
    target: 17539,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-2.1b',
    category: 'A',
    scope: 'Inspeksi Jaringan Distribusi',
    point: '2.1b',
    criteria:
      'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)',
    performanceTarget: 'Inspeksi SUTM Tier 2: 4.385 gawang/bulan',
    evidence: 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'gawang',
    target: 4385,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-2.1c',
    category: 'A',
    scope: 'Inspeksi Jaringan Distribusi',
    point: '2.1c',
    criteria:
      'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)',
    performanceTarget: 'Inspeksi Gardu/Keypoint Tier 1: 331 buah/bulan',
    evidence: 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'buah',
    target: 331,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-2.1d',
    category: 'A',
    scope: 'Inspeksi Jaringan Distribusi',
    point: '2.1d',
    criteria:
      'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)',
    performanceTarget: 'Inspeksi Gardu/Keypoint Tier 2: 331 buah/bulan',
    evidence: 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'buah',
    target: 331,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-3.1a',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.1a',
    criteria:
      'Melakukan pemeliharaan jaringan, meliputi: Fix Right of Way (ROW): 4.530 gawang/bulan',
    performanceTarget: '100% terlaksananya pemeliharaan sesuai dengan WO Fix.',
    evidence: 'Work Order (WO) dan terinput di Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'gawang',
    target: 4530,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-3.1b',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.1b',
    criteria:
      'Melakukan pemeliharaan jaringan, meliputi: Var Right of Way (ROW): 4.239 gawang/bulan atau sesuai dengan WO yang diberikan',
    performanceTarget: '100% terlaksananya pemeliharaan sesuai dengan WO Var',
    evidence: 'Work Order (WO) dan terinput di Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'gawang',
    target: 4239,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-3.1c',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.1c',
    criteria: 'Konstruksi (termasuk Pemeliharaan 3 Tiang dan 2 Gawang)',
    performanceTarget: '100% terlaksananya pemeliharaan sesuai dengan WO VAR.',
    evidence: 'Work Order (WO) dan terinput di Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-3.2a',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.2a',
    criteria:
      'Melakukan pemeliharaan gardu distribusi, meliputi: Pengukuran 331 buah Gardu Distribusi',
    performanceTarget: '100% terlaksananya pengukuran Gardu sesuai dengan WO',
    evidence: 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'buah',
    target: 331,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-3.2b',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.2b',
    criteria: 'Pemeliharaan 331 buah Gardu Distribusi dan lingkungan',
    performanceTarget: '100% terlaksananya pemeliharaan Gardu sesuai dengan WO',
    evidence: 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
    unit: 'buah',
    target: 331,
    inputMode: 'variable-cost',
  },
  {
    id: 'A-3.3',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.3',
    criteria:
      'Memastikan kualitas pekerjaan paska pemeliharaan jaringan dan gardu (sampling maks 10%)',
    performanceTarget:
      '100% kesesuaian data hasil sampling yang dilakukan oleh PLN terhadap pekerjaan yang dilaporkan oleh Pihak Kedua',
    evidence: 'Berita Acara sampling',
    weightType: 'Prioritas 2',
    weight: 1,
    penalty: '1/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-3.4a',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.4a',
    criteria: 'Memastikan pencapaian kinerja distribusi: Gangguan zona 1',
    performanceTarget:
      'Penurunan Gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit dalam 1 (satu) periode bulanan',
    evidence: 'Laporan gangguan bulanan di APKT',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-3.4b',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.4b',
    criteria: 'Memastikan pencapaian kinerja distribusi: Gangguan zona 2',
    performanceTarget:
      'Penurunan Gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit dalam 1 (satu) periode bulanan',
    evidence: 'Laporan gangguan bulanan di APKT',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/30 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'A-3.5',
    category: 'A',
    scope: 'Pemeliharaan Jaringan Distribusi',
    point: '3.5',
    criteria: 'Ketepatan waktu penyelesaian WO pemeliharaan variable cost',
    performanceTarget: 'Sesuai jadwal yang ditentukan pihak pertama',
    evidence: 'SPK / Laporan logsheet UP2D',
    weightType: 'Prioritas 2',
    weight: 1,
    penalty: '1/30 x 9% x tagihan bulan berjalan',
  },
  // ---------- B. SLA KESELAMATAN DAN KESEHATAN KERJA ----------
  {
    id: 'B-1.1',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.1',
    criteria: 'Kualitas SDM dan Kompetensi Pekerja',
    performanceTarget: '100% kompetensi SDM sesuai dengan kualifikasi pekerjaannya',
    evidence: 'Sertifikasi atau Pelatihan',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.2a',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.2a',
    criteria: 'Peralatan Kerja sesuai dengan persyaratan dan dalam kondisi laik',
    performanceTarget:
      '100% kesesuaian peralatan kerja dan peralatan K3 dengan persyaratan',
    evidence:
      'Laporan BA Pemeriksaan Peralatan Kerja dan Peralatan K3 Bulanan dan Formulir Checklist Pemeriksaan alat kerja',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.2b',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.2b',
    criteria: 'Peralatan Kerja sesuai dengan persyaratan dan dalam kondisi laik',
    performanceTarget:
      '100% kesesuaian peralatan kerja dan peralatan K3 dalam kondisi laik',
    evidence:
      'Laporan BA Pemeriksaan Peralatan Kerja dan Peralatan K3 Bulanan dan Formulir Checklist Pemeriksaan alat kerja',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.3a',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.3a',
    criteria:
      'Kendaraan operasional sesuai dengan persyaratan dan dalam kondisi laik',
    performanceTarget:
      '100% kesesuaian kendaraan operasional dengan persyaratan',
    evidence: 'Laporan BA Pemeriksaan Kendaraan Operasional',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.3b',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.3b',
    criteria:
      'Kendaraan operasional sesuai dengan persyaratan dan dalam kondisi laik',
    performanceTarget:
      '100% kesesuaian kendaraan operasional dalam kondisi laik',
    evidence: 'Laporan BA Pemeriksaan Kendaraan Operasional',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.4a',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.4a',
    criteria: 'Alat Keselamatan Kerja (APD, rambu, LOTO)',
    performanceTarget:
      '100% penyediaan Alat Pelindung Diri sesuai risiko pekerjaan dan kepatuhan menggunakan',
    evidence: 'Berita Acara Pemeriksaan APD dan Checklist APD',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.4b',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.4b',
    criteria: 'Alat Keselamatan Kerja (APD, rambu, LOTO)',
    performanceTarget:
      '100% penyediaan rambu dan LOTO pada satuan kerja',
    evidence:
      'Berita Acara Pemeriksaan Rambu dan LOTO dan Checklist Rambu dan LOTO',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.5',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.5',
    criteria:
      'Melakukan pekerjaan sesuai dengan prosedur dan instruksi kerja yang berlaku (SOP, IK, WP)',
    performanceTarget:
      'Nol (0) temuan pelanggaran prosedur dan instruksi kerja sesuai dengan sistem manajemen K3',
    evidence: 'Laporan Inspeksi K3',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.6',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.6',
    criteria: 'Melakukan pengisian CCV HSSE Yantek Mobile',
    performanceTarget: 'Tidak ada (0) Work Order belum CCV',
    evidence: 'Aplikasi VCC HSSE',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-1.7',
    category: 'B',
    scope: 'Penerapan Keselamatan dan Kesehatan Kerja (K3) di tempat kerja',
    point: '1.7',
    criteria: 'Inspeksi K3 oleh Direksi atau Management Perusahaan Alih Daya',
    performanceTarget:
      'Pelaksanaan Inspeksi oleh Direksi atau Management Perusahaan Alih Daya 2 kali / bulan',
    evidence: 'Laporan Inspeksi K3',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/20 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'B-2.1',
    category: 'B',
    scope: 'Kejadian Kecelakaan',
    point: '2.1',
    criteria: 'Nihil Kejadian Kecelakaan Kerja Luka Berat dan Fatality',
    performanceTarget: 'Zero Accident',
    evidence: 'Laporan Kecelakaan Kerja',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/2 x 9% x tagihan bulan berjalan',
  },
  // ---------- C. SLA PEMENUHAN HAK NORMATIF ----------
  {
    id: 'C-1.1',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.1',
    criteria:
      'Mengadakan hubungan kerja dengan Pekerja dalam bentuk Perjanjian Kerja Waktu Tidak Tertentu (PKWTT)',
    performanceTarget:
      '100% ketersediaan dokumen Perjanjian Kerja (PKWTT) dengan seluruh Pekerja',
    evidence: 'Dokumen Perjanjian Kerja (PKWTT)',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.2',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.2',
    criteria:
      'Membayarkan upah kepada para Pekerjanya paling lambat pada tanggal 5 setiap bulannya (n+1)',
    performanceTarget:
      '100% upah Pekerja terbayar paling lambat pada tanggal 5 setiap bulannya (n+1)',
    evidence: 'Bukti transfer & daftar pembayaran',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.3',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.3',
    criteria:
      'Membayarkan Tunjangan Hari Raya Keagamaan (THRK) dan hak normatif lainnya sesuai peraturan perundang-undangan',
    performanceTarget:
      '100% THRK dan hak normatif lainnya terbayar sesuai peraturan perundang-undangan',
    evidence: 'Bukti transfer & daftar pembayaran',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.4',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.4',
    criteria:
      'Membayar angsuran uang pengakhiran hubungan kerja (uang pesangon, uang penghargaan masa kerja, dan uang penggantian hak) atau uang kompensasi Pekerja sesuai dengan peraturan perundang-undangan dengan program Dana Pensiun Lembaga Keuangan (DPLK) yang dijamin LPS paling lambat pada tanggal 5 setiap bulannya (n+1)',
    performanceTarget:
      '100% angsuran uang pengakhiran hubungan Pekerja terbayar sesuai peraturan perundang-undangan',
    evidence: 'Bukti transfer & daftar pembayaran bulan pekerjaan',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.5a',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.5a',
    criteria:
      'Mengikutsertakan Pekerja dalam program Badan Penyelenggaraan Jaminan Sosial (BPJS Kesehatan dan Ketenagakerjaan) dan membayar iuran tersebut sesuai peraturan perundang-undangan.',
    performanceTarget:
      '100% Pekerja terdaftar dalam program BPJS Kesehatan dan Ketenagakerjaan',
    evidence: 'Bukti transfer & daftar pembayaran bulan pekerjaan',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.5b',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.5b',
    criteria:
      'Mengikutsertakan Pekerja dalam program Badan Penyelenggaraan Jaminan Sosial (BPJS Kesehatan dan Ketenagakerjaan) dan membayar iuran tersebut sesuai peraturan perundang-undangan.',
    performanceTarget:
      '100% iuran BPJS Kesehatan dan Ketenagakerjaan terbayar sesuai peraturan perundang-undangan setiap bulan',
    evidence: 'Bukti transfer & daftar pembayaran bulan pekerjaan',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.6',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.6',
    criteria:
      'Memberikan minimal 4 set seragam per tahun kepada Pekerja selama jangka waktu Perjanjian',
    performanceTarget:
      '100% ketersediaan bukti tanda terima pemberian seragam pada Pekerja',
    evidence: 'Bukti tanda terima pemberian seragam',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.7a',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.7a',
    criteria:
      'Memastikan kelengkapan dan akurasi data Pekerja yang diinput pertama kali pada Aplikasi Alih Daya serta melakukan pengkinian data paling lambat 5 hari kerja umum sebelum tanggal dimulai Pelaksanaan Pekerjaan dan minggu ke-1 setiap bulan untuk masa Pelaksanaan Pekerjaan',
    performanceTarget:
      '100% akurasi dan kelengkapan atas data pada Aplikasi Alih Daya',
    evidence: 'Aplikasi Alih Daya',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.7b',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.7b',
    criteria:
      'Memastikan kelengkapan dan akurasi data Pekerja yang diinput pertama kali pada Aplikasi Alih Daya serta melakukan pengkinian data paling lambat 5 hari kerja umum sebelum tanggal dimulai Pelaksanaan Pekerjaan dan minggu ke-1 setiap bulan untuk masa Pelaksanaan Pekerjaan',
    performanceTarget:
      '100% ketersediaan bukti data pemutakhiran',
    evidence: 'Bukti data pemutakhiran',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.8',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.8',
    criteria:
      'Memenuhi kewajiban memiliki modal yang cukup untuk pembayaran operasional, termasuk namun tidak terbatas pada modal pemenuhan hak normatif ketenagakerjaan Pekerja selama 90 hari kalender berikutnya, dan selanjutnya sejak tagihan per bulan terkait telah dibayarkan oleh Pihak Pertama',
    performanceTarget:
      '100% ketersediaan bukti rekening koran dalam nominal modal yang cukup untuk membayar operasional pekerjaan selama minimal 90 hari',
    evidence:
      'Bukti Rekening Koran dari Bank atas nama PIHAK KEDUA yang berisi saldo (sesuai bulan pembayaran tahap 2) untuk membayar operasional Pekerjaan selama 90 hari kalender berikutnya (Fix Cost tanpa ROK dan PPN)',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'C-1.9',
    category: 'C',
    scope: 'Pemenuhan Hak Normatif Ketenagakerjaan',
    point: '1.9',
    criteria:
      'Menyalurkan reward atas pencapaian service level agreement yang diberikan oleh PLN kepada Perusahaan Alih Daya paling sedikit sebesar 70% (tujuh puluh persen) kepada Tenaga Alih Daya berdasarkan capaian kinerja individual',
    performanceTarget:
      '100% ketersediaan bukti penyaluran reward atas pencapaian SLA',
    evidence:
      'Bukti transfer & daftar pembayaran individu yang menerima reward',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/22 x 9% x tagihan bulan berjalan',
  },
  // ---------- D. SLA INTEGRITAS LAYANAN PUBLIK ----------
  {
    id: 'D-1.1',
    category: 'D',
    scope: 'Komitmen Integritas Layanan Publik terkait lingkup bisnis PLN (penanganan gangguan, pasang baru, tambah daya, penyambungan sementara, P2TL, dll)',
    point: '1.1',
    criteria:
      'Meminta / menerima imbalan (gratifikasi) dari pelanggan yang dialami dan/atau dari PIHAK PERTAMA secara langsung',
    performanceTarget: 'Tidak ada (0) laporan pelanggaran ILP',
    evidence: 'Dokumen laporan pelanggaran ILP',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/6 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'D-1.2',
    category: 'D',
    scope: 'Komitmen Integritas Layanan Publik terkait lingkup bisnis PLN (penanganan gangguan, pasang baru, tambah daya, penyambungan sementara, P2TL, dll)',
    point: '1.2',
    criteria: 'Melakukan pungutan liar, Kolusi Korupsi atau Nepotisme (KKN), dan lain-lain',
    performanceTarget: 'Tidak ada (0) laporan pelanggaran ILP',
    evidence: 'Dokumen laporan pelanggaran ILP',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/6 x 9% x tagihan bulan berjalan',
  },
  {
    id: 'D-1.3',
    category: 'D',
    scope: 'Komitmen Integritas Layanan Publik terkait lingkup bisnis PLN (penanganan gangguan, pasang baru, tambah daya, penyambungan sementara, P2TL, dll)',
    point: '1.3',
    criteria:
      'Dengan sengaja tidak memberikan kemudahan, kecepatan, dan transparansi terkait layanan publik',
    performanceTarget: 'Tidak ada (0) laporan pelanggaran ILP',
    evidence: 'Dokumen laporan pelanggaran ILP',
    weightType: 'Prioritas 1',
    weight: 2,
    penalty: '2/6 x 9% x tagihan bulan berjalan',
  },
].map((indicator) => ({
  ...indicator,
  inputMode: indicator.inputMode ?? 'manual',
}))

const existingVariableIndicators = [...variableCostPoints, '3.1c']
  .map((point) => slaIndicators.find((indicator) => indicator.point === point))
  .map((indicator) => ({
    ...indicator,
    code: indicator.point,
    key: indicator.id,
    label: variableCostLabelsByCode[indicator.point],
    slaLinked: variableCostPoints.has(indicator.point),
    workflowEnabled: true,
    ...(indicator.id === 'A-3.1a' ? { revenueEligible: false } : {}),
    ...(indicator.id === 'A-3.1c' ? { revenueMode: 'DIRECT_RUPIAH' } : {}),
  }))

export const variableCostIndicators = [
  ...existingVariableIndicators,
  {
    id: '7e5b0214-f394-4f1e-86ad-2040d1972040',
    key: 'VC-TEBANG-20-40',
    code: 'TEBANG_20_40_CM',
    label: variableCostLabelsByCode.TEBANG_20_40_CM,
    unit: 'batang',
    slaLinked: false,
    workflowEnabled: false,
    revenueEligible: true,
    revenueMode: 'UNIT_RATE',
  },
  {
    id: 'b612e8c7-68b6-4ed7-9bba-4060d1974060',
    key: 'VC-TEBANG-40-60',
    code: 'TEBANG_40_60_CM',
    label: variableCostLabelsByCode.TEBANG_40_60_CM,
    unit: 'batang',
    slaLinked: false,
    workflowEnabled: false,
    revenueEligible: true,
    revenueMode: 'UNIT_RATE',
  },
]

export const variableCostIndicatorCount = variableCostIndicators.length
export const slaVariableLinkedCount = variableCostPoints.size
export const slaManualIndicatorCount = slaIndicators.length - slaVariableLinkedCount

export const slaRoles = [
  { id: 'up3', name: 'Admin UP3' },
  { id: 'ulp', name: 'Admin ULP' },
]

export const pelayananTeknikModules = [
  { id: 'sla', name: 'SLA' },
  { id: 'variable-cost', name: 'Variable Cost' },
  { id: 'lembur', name: 'Lembur' },
  { id: 'master-organisasi', name: 'Master Organisasi', adminOnly: true },
  { id: 'master-lokasi', name: 'Master Lokasi', adminOnly: true },
  { id: 'master-jabatan', name: 'Master Jabatan', adminOnly: true },
  { id: 'database-pegawai', name: 'Master Pegawai' },
  { id: 'pengaturan-sla', name: 'Pengaturan SLA', adminOnly: true },
  { id: 'master-penandatangan', name: 'Master Penandatangan', adminOnly: true },
]

const FIRST_PARTY_MEMBERS = [
  {
    id: 's-p1-1',
    name: 'Ir. Andi Wijaya, M.T.',
    position: 'Manager UP3 Singkawang',
    order: 1,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    status: 'Aktif',
  },
  {
    id: 's-p1-2',
    name: 'Budi Santoso, S.T.',
    position: 'Assistant Manager Pelayanan Teknik',
    order: 2,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    status: 'Aktif',
  },
]

const SECOND_PARTY_MEMBERS = [
  {
    id: 's-p2-1',
    name: 'Rina Marlina',
    position: 'Manajer Unit Pelaksana Layanan',
    order: 1,
    periodStart: '2026-01-01',
    periodEnd: '2026-06-30',
    status: 'Aktif',
  },
  {
    id: 's-p2-2',
    name: 'Dedi Kurniawan, S.E.',
    position: 'Manajer Unit Pelaksana Layanan',
    order: 2,
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
    status: 'Aktif',
  },
]

const SAKSI_MEMBERS = [
  {
    id: 's-saksi-1',
    name: 'Hj. Sri Rahayu, S.H.',
    position: 'Kepala Bagian Perekonomian (Contoh)',
    order: 1,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    status: 'Aktif',
  },
]

export const slaSignatureGroups = [
  {
    id: 'g-up3-pertama',
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    documentScope: 'sla-up3',
    unitId: null,
    title: 'Pihak Pertama',
    institution: 'PT PLN (Persero) UP3 Singkawang',
    order: 1,
    status: 'Aktif',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    signatories: FIRST_PARTY_MEMBERS.map((member) => ({ ...member })),
  },
  {
    id: 'g-up3-kedua',
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    documentScope: 'sla-up3',
    unitId: null,
    title: 'Pihak Kedua',
    institution: 'PT Daya Usaha Bersama (Contoh)',
    order: 2,
    status: 'Aktif',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    signatories: SECOND_PARTY_MEMBERS.map((member) => ({ ...member })),
  },
  ...slaContractScope.ulpIds.flatMap((ulpId) => [
    {
      id: `g-ulp-${ulpId}-pertama`,
      contractId: 'pelayanan-teknik',
      up3Id: 'up3',
      documentScope: 'sla-ulp',
      unitId: ulpId,
      title: 'Pihak Pertama',
      institution: 'PT PLN (Persero) UP3 Singkawang',
      order: 1,
      status: 'Aktif',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      signatories: FIRST_PARTY_MEMBERS.map((member) => ({
        ...member,
        id: `s-${ulpId}-p1-${member.order}`,
      })),
    },
    {
      id: `g-ulp-${ulpId}-kedua`,
      contractId: 'pelayanan-teknik',
      up3Id: 'up3',
      documentScope: 'sla-ulp',
      unitId: ulpId,
      title: 'Pihak Kedua',
      institution: 'PT Daya Usaha Bersama (Contoh)',
      order: 2,
      status: 'Aktif',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      signatories: SECOND_PARTY_MEMBERS.map((member) => ({
        ...member,
        id: `s-${ulpId}-p2-${member.order}`,
      })),
    },
  ]),
  {
    id: 'g-ulp-saksi-1',
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    documentScope: 'sla-ulp',
    unitId: 'ulp-1',
    title: 'Saksi',
    institution: 'Pemerintah Kota Singkawang (Contoh)',
    order: 3,
    status: 'Aktif',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    signatories: SAKSI_MEMBERS.map((member) => ({ ...member })),
  },
]

const ulpIds = slaUnits
  .filter((unit) => unit.type === 'ULP' && unit.parentUnitId === slaContractScope.up3.id)
  .map((unit) => unit.id)

const satuanDummies = ['WO', 'laporan', 'kali', 'orang', '%', 'gawang', 'buah']

slaIndicators.forEach((indicator, index) => {
  indicator.ulpTarget =
    indicator.inputMode === 'variable-cost'
      ? Math.max(1, Math.round(indicator.target / 6))
      : null
  indicator.unit ??= satuanDummies[index % satuanDummies.length]
})

function buildUlpEntry(ulpIndex, indicator, index) {
  const isVc = indicator.inputMode === 'variable-cost'
  const base = indicator.ulpTarget ?? 18 + index
  const wo = isVc
    ? base + ((ulpIndex * 37 + index * 7) % 41)
    : 18 + ((ulpIndex + index) % 10)
  const realization = Math.max(0, wo - ((ulpIndex * 3 + index) % 5))
  const achievement = isVc
    ? 92 + ((ulpIndex + index) % 7)
    : 85 + ((ulpIndex + index) % 12)
  return {
    unit: indicator.unit,
    wo,
    realization,
    achievement,
  }
}

export const slaUlpEntries = {}
slaIndicators.forEach((indicator, index) => {
  ulpIds.forEach((ulpId, ulpIndex) => {
    slaUlpEntries[ulpId] ??= {}
    slaUlpEntries[ulpId][indicator.id] = buildUlpEntry(ulpIndex, indicator, index)
  })
})

export const slaUp3Entries = {}
slaIndicators.forEach((indicator) => {
  const aggregate = {
    unit: indicator.unit,
    wo: 0,
    realization: 0,
    achievement: null,
  }
  ulpIds.forEach((ulpId) => {
    const entry = slaUlpEntries[ulpId][indicator.id]
    aggregate.wo += entry.wo
    aggregate.realization += entry.realization
  })
  slaUp3Entries[indicator.id] = aggregate
})

export const slaIndicatorCount = slaIndicators.length
export const slaVariableCostCount = slaIndicators.filter(
  (indicator) => indicator.inputMode === 'variable-cost',
).length

export function buildDefaultTargets(up3Id = slaContractScope.up3.id, units = null) {
  const targetUlpIds =
    up3Id === slaContractScope.up3.id
      ? slaContractScope.ulpIds
      : (units ?? [])
          .filter((unit) => unit.type === 'ULP' && unit.parentUnitId === up3Id)
          .map((unit) => unit.id)
  const map = {}
  slaIndicators.forEach((indicator) => {
    const ulp = indicator.ulpTarget ?? null
    const ulpTargets = {}
    targetUlpIds.forEach((ulpId) => {
      ulpTargets[ulpId] = ulp
    })
    map[indicator.id] = { up3: indicator.target ?? null, ulp, ulpTargets }
  })
  return map
}

export function buildVersionIndicators() {
  return slaIndicators.map((indicator) => ({ ...indicator }))
}

export function buildVersionSections() {
  return slaCategories.map((category) => ({
    id: `section-${category.id}`,
    code: category.id,
    name: category.name,
    indicators: slaIndicators
      .filter((indicator) => indicator.category === category.id)
      .map((indicator) => ({ ...indicator })),
  }))
}

export function flattenVersionIndicators(version) {
  return (version.sections ?? []).flatMap((section) =>
    section.indicators.map((indicator) => ({
      ...indicator,
      category: section.code,
      categoryName: section.name,
    })),
  )
}

export function cloneTargets(targets) {
  return JSON.parse(JSON.stringify(targets))
}

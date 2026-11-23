// Pemetaan status dan pesan kegagalan validasi AI agar semua keadaan
// (cocok, berbeda, tidak terbaca, nonaktif, dan gangguan layanan) tampil
// konsisten dan tidak membocorkan detail teknis ke pengguna.

export const AI_CHECK_META = {
  checking: { label: 'Memeriksa', tone: 'info', icon: 'loader' },
  match: { label: 'Cocok', tone: 'success', icon: 'check' },
  mismatch: { label: 'Berbeda', tone: 'danger', icon: 'alert-triangle' },
  unreadable: { label: 'Tidak terbaca', tone: 'warning', icon: 'info' },
  error: { label: 'Gagal diperiksa', tone: 'warning', icon: 'x-circle' },
  idle: { label: 'Belum diperiksa', tone: 'neutral', icon: 'sparkles' },
}

export const aiCheckMeta = (status) => AI_CHECK_META[status] ?? AI_CHECK_META.idle

export function describeAiFailure(rawMessage) {
  const message = String(rawMessage ?? '').trim()
  if (/authentication_required|sesi.*(berakhir|habis)|session.*(expired|invalid)|silakan masuk|login ulang/i.test(message)) {
    return {
      title: 'Sesi login berakhir',
      message: 'Sesi Anda berakhir saat validasi AI. Foto sudah tersimpan; muat ulang halaman, masuk kembali, lalu periksa lagi.',
    }
  }
  if (/pengaturan ai belum dapat dibaca|konfigurasi ai.*(gagal|bermasalah|tidak)/i.test(message)) {
    return {
      title: 'Konfigurasi AI bermasalah',
      message: 'Pengaturan AI tidak dapat dibaca oleh server. Foto tetap tersimpan; hubungi Super Admin untuk memeriksa Pengaturan AI.',
    }
  }
  if (/401|unauthor|invalid.*(api key|key)|api key.*(salah|invalid|tidak valid)|kredensial/i.test(message)) {
    return {
      title: 'API key AI bermasalah',
      message: 'Penyedia AI menolak kredensial yang tersimpan. Foto tetap tersimpan; minta Super Admin memeriksa Pengaturan AI lalu menguji koneksi.',
    }
  }
  if (/tidak memiliki akses|akses ke kendaraan|permission denied|forbidden/i.test(message)) {
    return {
      title: 'Akses validasi AI ditolak',
      message: 'Akun Anda tidak memiliki akses ke kendaraan ini. Foto tetap tersimpan; hubungi Admin ULP/UP3 bila akses perlu diperluas.',
    }
  }
  if (/belum diaktifkan|nonaktif|tidak ada api key|api key.*belum/i.test(message)) {
    return {
      title: 'Validasi AI belum aktif',
      message: 'Validasi AI belum diaktifkan oleh Super Admin. Foto tetap tersimpan dan laporan dapat dilanjutkan tanpa validasi AI.',
    }
  }
  if (/429|quota|kuota|rate.?limit|terlalu banyak|resource.?exhausted/i.test(message)) {
    return {
      title: 'Kuota AI sedang tercapai',
      message: 'Layanan AI membatasi permintaan saat ini. Foto tetap tersimpan; coba periksa lagi beberapa saat lagi atau hubungi Super Admin.',
    }
  }
  if (/HTTP 400|unsupported.*(image|content)|model.*(tidak|not).*(gambar|image|support)|vision/i.test(message)) {
    return {
      title: 'Model AI tidak mendukung foto',
      message: 'Model yang dipilih belum dapat memproses gambar. Minta Super Admin memilih model yang mendukung input gambar pada Pengaturan AI.',
    }
  }
  if (/timeout|abort|failed to send|failed to fetch|network|koneksi|jaringan|edge function|functionsfetch/i.test(message)) {
    return {
      title: 'Koneksi AI gagal',
      message: 'Validasi AI tidak dapat menghubungi layanan penyedia. Foto tetap tersimpan; periksa koneksi internet lalu coba periksa lagi.',
    }
  }
  if (/ukuran.*besar|terlalu besar|format.*tidak didukung|foto.*tidak dapat dibaca|foto.*tidak valid/i.test(message)) {
    return {
      title: 'Foto tidak dapat diperiksa AI',
      message: 'AI tidak dapat membaca berkas foto ini. Pastikan foto berformat JPG, PNG, atau WebP dengan ukuran wajar, lalu unggah ulang.',
    }
  }
  return {
    title: 'Validasi AI gagal',
    message: 'AI belum dapat memeriksa foto ini. Foto tetap tersimpan dan laporan dapat dilanjutkan; silakan coba periksa lagi.',
  }
}

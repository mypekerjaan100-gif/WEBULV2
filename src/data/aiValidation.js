// Pemetaan status dan pesan kegagalan pemeriksaan odometer agar semua keadaan
// (sesuai, berbeda, tidak terbaca, nonaktif, dan gangguan layanan) tampil
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
      message: 'Sesi Anda berakhir saat pemeriksaan berlangsung. Foto sudah tersimpan; muat ulang halaman, masuk kembali, lalu periksa lagi.',
    }
  }
  if (/pengaturan ai belum dapat dibaca|konfigurasi.*(gagal|bermasalah|tidak)/i.test(message)) {
    return {
      title: 'Pemeriksaan belum siap',
      message: 'Pengaturan layanan pemeriksaan tidak dapat dibaca oleh server. Foto tetap tersimpan; hubungi Super Admin untuk memeriksa pengaturan.',
    }
  }
  if (/semua api key/i.test(message)) {
    return {
      title: 'Semua API key perlu diperbarui',
      message: 'Tidak ada API key pemeriksaan yang dapat dipakai. Foto tetap tersimpan; minta Super Admin memperbarui API key di Pengaturan AI.',
    }
  }
  if (/401|unauthor|invalid.*(api key|key)|api key.*(salah|invalid|tidak valid)|kredensial/i.test(message)) {
    return {
      title: 'Pemeriksaan belum dapat dijalankan',
      message: 'Layanan pemeriksaan menolak kredensial yang tersimpan. Foto tetap tersimpan; hubungi Super Admin untuk memeriksa pengaturan layanan.',
    }
  }
  if (/tidak memiliki akses|akses ke kendaraan|permission denied|forbidden/i.test(message)) {
    return {
      title: 'Akses pemeriksaan ditolak',
      message: 'Akun Anda tidak memiliki akses ke kendaraan ini. Foto tetap tersimpan; hubungi Admin ULP/UP3 bila akses perlu diperluas.',
    }
  }
  if (/belum diaktifkan|nonaktif|tidak ada api key|api key.*belum/i.test(message)) {
    return {
      title: 'Pemeriksaan belum aktif',
      message: 'Pemeriksaan angka belum diaktifkan oleh Super Admin. Foto tetap tersimpan dan laporan dapat dilanjutkan.',
    }
  }
  if (/429|quota|kuota|rate.?limit|terlalu banyak|resource.?exhausted/i.test(message)) {
    return {
      title: 'Layanan pemeriksaan sedang sibuk',
      message: 'Layanan pemeriksaan membatasi permintaan saat ini. Foto tetap tersimpan; coba periksa lagi beberapa saat lagi.',
    }
  }
  if (/HTTP 400|unsupported.*(image|content)|model.*(tidak|not).*(gambar|image|support)|vision/i.test(message)) {
    return {
      title: 'Pemeriksaan foto belum didukung',
      message: 'Layanan pemeriksaan belum dapat memproses gambar. Foto tetap tersimpan; hubungi Super Admin untuk melengkapi pengaturan layanan.',
    }
  }
  if (/timeout|abort|failed to send|failed to fetch|network|koneksi|jaringan|edge function|functionsfetch/i.test(message)) {
    return {
      title: 'Pemeriksaan tidak dapat terhubung',
      message: 'Layanan pemeriksaan tidak dapat dihubungi. Foto tetap tersimpan; periksa koneksi internet lalu coba periksa lagi.',
    }
  }
  if (/ukuran.*besar|terlalu besar|format.*tidak didukung|foto.*tidak dapat dibaca|foto.*tidak valid/i.test(message)) {
    return {
      title: 'Foto tidak dapat diperiksa',
      message: 'Angka pada foto belum dapat dibaca. Pastikan foto berformat JPG, PNG, atau WebP dengan ukuran wajar, lalu unggah ulang.',
    }
  }
  return {
    title: 'Pemeriksaan belum berhasil',
    message: 'Angka pada foto belum dapat diperiksa. Foto tetap tersimpan dan laporan dapat dilanjutkan; silakan coba periksa lagi.',
  }
}

alter table public.overtime_evidence
  add constraint overtime_evidence_lembur_photo_only
  check (
    evidence_type not in (
      'FORM_CUTI',
      'FORM_SAKIT',
      'SURAT_SAKIT',
      'FORM_IZIN',
      'SURAT_IZIN',
      'SPK',
      'FOTO_SEBELUM',
      'FOTO_SESUDAH',
      'FOTO_BRIEFING',
      'FOTO_PROSES',
      'FOTO_SELESAI'
    )
    or stored_mime_type in ('image/jpeg', 'image/webp')
  ) not valid;

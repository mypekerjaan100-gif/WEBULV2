-- Final SLA-only closure: repair the proven 43-row registry corruption in place,
-- close Variable-to-SLA source boundaries, and expose scoped SLA hierarchy reads.

-- The canonical metadata is sourced verbatim from src/data/slaPelayananTeknik.js.
-- Existing indicator IDs, entries, targets, and version history are preserved.
do $repair$
declare
  v_bad_version uuid;
begin
  select v.id into v_bad_version
  from public.sla_versions v
  left join public.sla_indicators i on i.sla_version_id = v.id
  group by v.id
  having count(i.id) <> 43
     or count(i.id) filter (where i.legacy_key = any (array[
       'A-1.1a','A-1.1b','A-1.2','A-1.3','A-1.4','A-2.1a','A-2.1b','A-2.1c','A-2.1d',
       'A-3.1a','A-3.1b','A-3.1c','A-3.2a','A-3.2b','A-3.3','A-3.4a','A-3.4b','A-3.5',
       'B-1.1','B-1.2a','B-1.2b','B-1.3a','B-1.3b','B-1.4a','B-1.4b','B-1.5','B-1.6','B-1.7','B-2.1',
       'C-1.1','C-1.2','C-1.3','C-1.4','C-1.5a','C-1.5b','C-1.6','C-1.7a','C-1.7b','C-1.8','C-1.9',
       'D-1.1','D-1.2','D-1.3'
     ]::text[])) <> 43
  limit 1;

  if v_bad_version is not null then
    raise exception 'SLA registry repair precondition failed for version %', v_bad_version;
  end if;

  alter table public.sla_indicators disable trigger trg_sla_indicators_mutability;

  -- Move all existing values out of the destination range before assigning 0..42.
  update public.sla_indicators set sort_order = sort_order + 1000000;

  with canonical(
    legacy_key, point_code, criteria, performance_target, evidence,
    weight_type, weight, penalty_formula, input_mode, variable_cost_profile,
    sort_order, standard_measurement_unit
  ) as (values
    ('A-1.1a','1.1a','Melakukan penanganan gangguan (termasuk Gangguan JTM/JTR 3 Tiang dan 2 Gawang)','100% terpenuhinya rata-rata response time bulanan gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit','EIS APKT Menu Rekapitulasi Gangguan All Response - Dispatching','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,0,null),
    ('A-1.1b','1.1b','Melakukan penanganan gangguan (termasuk Gangguan JTM/JTR 3 Tiang dan 2 Gawang)','100% terpenuhinya rata-rata recovery time bulanan gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit','EIS APKT Menu Rekapitulasi Gangguan All Recovery','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,1,null),
    ('A-1.2','1.2','YANTEK Optimization','Tidak ada Performa Individu YANTEK dibawah posisi middle (kecuali cuti dan sakit, dibuktikan dengan surat cuti dari PCN/PLNT, surat sakit dari Dokter/PUSKESMAS/RS) dan jika ybs di PHK atau resign','Rekap YO Bulanan','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,2,null),
    ('A-1.3','1.3','Rating Kepuasan Pelanggan Bulanan','Feedback Rating Negatif pada PLN Mobile sesuai dengan target yang ditetapkan pada masing-masing unit','Laporan EIS APKT','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,3,null),
    ('A-1.4','1.4','Laporan Berulang Bulanan','Laporan Berulang pada PLN Mobile sesuai dengan target yang ditetapkan pada masing-masing unit','Laporan EIS APKT','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,4,null),
    ('A-2.1a','2.1a','Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)','Inspeksi SUTM Tier 1: 17.539 gawang/bulan','Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',5,'gawang'),
    ('A-2.1b','2.1b','Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)','Inspeksi SUTM Tier 2: 4.385 gawang/bulan','Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',6,'gawang'),
    ('A-2.1c','2.1c','Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)','Inspeksi Gardu/Keypoint Tier 1: 331 buah/bulan','Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',7,'buah'),
    ('A-2.1d','2.1d','Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan (titik sambung, SSO, recloser, keypoint, CBO, PMFD, GFD)','Inspeksi Gardu/Keypoint Tier 2: 331 buah/bulan','Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',8,'buah'),
    ('A-3.1a','3.1a','Melakukan pemeliharaan jaringan, meliputi: Fix Right of Way (ROW): 4.530 gawang/bulan','100% terlaksananya pemeliharaan sesuai dengan WO Fix.','Work Order (WO) dan terinput di Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',9,'gawang'),
    ('A-3.1b','3.1b','Melakukan pemeliharaan jaringan, meliputi: Var Right of Way (ROW): 4.239 gawang/bulan atau sesuai dengan WO yang diberikan','100% terlaksananya pemeliharaan sesuai dengan WO Var','Work Order (WO) dan terinput di Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',10,'gawang'),
    ('A-3.1c','3.1c','Konstruksi (termasuk Pemeliharaan 3 Tiang dan 2 Gawang)','100% terlaksananya pemeliharaan sesuai dengan WO VAR.','Work Order (WO) dan terinput di Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','KONSTRUKSI',11,null),
    ('A-3.2a','3.2a','Melakukan pemeliharaan gardu distribusi, meliputi: Pengukuran 331 buah Gardu Distribusi','100% terlaksananya pengukuran Gardu sesuai dengan WO','Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',12,'buah'),
    ('A-3.2b','3.2b','Pemeliharaan 331 buah Gardu Distribusi dan lingkungan','100% terlaksananya pemeliharaan Gardu sesuai dengan WO','Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','VARIABLE_COST','STANDARD',13,'buah'),
    ('A-3.3','3.3','Memastikan kualitas pekerjaan paska pemeliharaan jaringan dan gardu (sampling maks 10%)','100% kesesuaian data hasil sampling yang dilakukan oleh PLN terhadap pekerjaan yang dilaporkan oleh Pihak Kedua','Berita Acara sampling','Prioritas 2',1::numeric,'1/30 x 9% x tagihan bulan berjalan','MANUAL',null,14,null),
    ('A-3.4a','3.4a','Memastikan pencapaian kinerja distribusi: Gangguan zona 1','Penurunan Gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit dalam 1 (satu) periode bulanan','Laporan gangguan bulanan di APKT','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,15,null),
    ('A-3.4b','3.4b','Memastikan pencapaian kinerja distribusi: Gangguan zona 2','Penurunan Gangguan total sesuai dengan target yang ditetapkan pada masing-masing unit dalam 1 (satu) periode bulanan','Laporan gangguan bulanan di APKT','Prioritas 1',2::numeric,'2/30 x 9% x tagihan bulan berjalan','MANUAL',null,16,null),
    ('A-3.5','3.5','Ketepatan waktu penyelesaian WO pemeliharaan variable cost','Sesuai jadwal yang ditentukan pihak pertama','SPK / Laporan logsheet UP2D','Prioritas 2',1::numeric,'1/30 x 9% x tagihan bulan berjalan','MANUAL',null,17,null),
    ('B-1.1','1.1','Kualitas SDM dan Kompetensi Pekerja','100% kompetensi SDM sesuai dengan kualifikasi pekerjaannya','Sertifikasi atau Pelatihan','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,18,null),
    ('B-1.2a','1.2a','Peralatan Kerja sesuai dengan persyaratan dan dalam kondisi laik','100% kesesuaian peralatan kerja dan peralatan K3 dengan persyaratan','Laporan BA Pemeriksaan Peralatan Kerja dan Peralatan K3 Bulanan dan Formulir Checklist Pemeriksaan alat kerja','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,19,null),
    ('B-1.2b','1.2b','Peralatan Kerja sesuai dengan persyaratan dan dalam kondisi laik','100% kesesuaian peralatan kerja dan peralatan K3 dalam kondisi laik','Laporan BA Pemeriksaan Peralatan Kerja dan Peralatan K3 Bulanan dan Formulir Checklist Pemeriksaan alat kerja','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,20,null),
    ('B-1.3a','1.3a','Kendaraan operasional sesuai dengan persyaratan dan dalam kondisi laik','100% kesesuaian kendaraan operasional dengan persyaratan','Laporan BA Pemeriksaan Kendaraan Operasional','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,21,null),
    ('B-1.3b','1.3b','Kendaraan operasional sesuai dengan persyaratan dan dalam kondisi laik','100% kesesuaian kendaraan operasional dalam kondisi laik','Laporan BA Pemeriksaan Kendaraan Operasional','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,22,null),
    ('B-1.4a','1.4a','Alat Keselamatan Kerja (APD, rambu, LOTO)','100% penyediaan Alat Pelindung Diri sesuai risiko pekerjaan dan kepatuhan menggunakan','Berita Acara Pemeriksaan APD dan Checklist APD','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,23,null),
    ('B-1.4b','1.4b','Alat Keselamatan Kerja (APD, rambu, LOTO)','100% penyediaan rambu dan LOTO pada satuan kerja','Berita Acara Pemeriksaan Rambu dan LOTO dan Checklist Rambu dan LOTO','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,24,null),
    ('B-1.5','1.5','Melakukan pekerjaan sesuai dengan prosedur dan instruksi kerja yang berlaku (SOP, IK, WP)','Nol (0) temuan pelanggaran prosedur dan instruksi kerja sesuai dengan sistem manajemen K3','Laporan Inspeksi K3','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,25,null),
    ('B-1.6','1.6','Melakukan pengisian CCV HSSE Yantek Mobile','Tidak ada (0) Work Order belum CCV','Aplikasi VCC HSSE','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,26,null),
    ('B-1.7','1.7','Inspeksi K3 oleh Direksi atau Management Perusahaan Alih Daya','Pelaksanaan Inspeksi oleh Direksi atau Management Perusahaan Alih Daya 2 kali / bulan','Laporan Inspeksi K3','Prioritas 1',2::numeric,'2/20 x 9% x tagihan bulan berjalan','MANUAL',null,27,null),
    ('B-2.1','2.1','Nihil Kejadian Kecelakaan Kerja Luka Berat dan Fatality','Zero Accident','Laporan Kecelakaan Kerja','Prioritas 1',2::numeric,'2/2 x 9% x tagihan bulan berjalan','MANUAL',null,28,null),
    ('C-1.1','1.1','Mengadakan hubungan kerja dengan Pekerja dalam bentuk Perjanjian Kerja Waktu Tidak Tertentu (PKWTT)','100% ketersediaan dokumen Perjanjian Kerja (PKWTT) dengan seluruh Pekerja','Dokumen Perjanjian Kerja (PKWTT)','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,29,null),
    ('C-1.2','1.2','Membayarkan upah kepada para Pekerjanya paling lambat pada tanggal 5 setiap bulannya (n+1)','100% upah Pekerja terbayar paling lambat pada tanggal 5 setiap bulannya (n+1)','Bukti transfer & daftar pembayaran','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,30,null),
    ('C-1.3','1.3','Membayarkan Tunjangan Hari Raya Keagamaan (THRK) dan hak normatif lainnya sesuai peraturan perundang-undangan','100% THRK dan hak normatif lainnya terbayar sesuai peraturan perundang-undangan','Bukti transfer & daftar pembayaran','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,31,null),
    ('C-1.4','1.4','Membayar angsuran uang pengakhiran hubungan kerja (uang pesangon, uang penghargaan masa kerja, dan uang penggantian hak) atau uang kompensasi Pekerja sesuai dengan peraturan perundang-undangan dengan program Dana Pensiun Lembaga Keuangan (DPLK) yang dijamin LPS paling lambat pada tanggal 5 setiap bulannya (n+1)','100% angsuran uang pengakhiran hubungan Pekerja terbayar sesuai peraturan perundang-undangan','Bukti transfer & daftar pembayaran bulan pekerjaan','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,32,null),
    ('C-1.5a','1.5a','Mengikutsertakan Pekerja dalam program Badan Penyelenggaraan Jaminan Sosial (BPJS Kesehatan dan Ketenagakerjaan) dan membayar iuran tersebut sesuai peraturan perundang-undangan.','100% Pekerja terdaftar dalam program BPJS Kesehatan dan Ketenagakerjaan','Bukti transfer & daftar pembayaran bulan pekerjaan','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,33,null),
    ('C-1.5b','1.5b','Mengikutsertakan Pekerja dalam program Badan Penyelenggaraan Jaminan Sosial (BPJS Kesehatan dan Ketenagakerjaan) dan membayar iuran tersebut sesuai peraturan perundang-undangan.','100% iuran BPJS Kesehatan dan Ketenagakerjaan terbayar sesuai peraturan perundang-undangan setiap bulan','Bukti transfer & daftar pembayaran bulan pekerjaan','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,34,null),
    ('C-1.6','1.6','Memberikan minimal 4 set seragam per tahun kepada Pekerja selama jangka waktu Perjanjian','100% ketersediaan bukti tanda terima pemberian seragam pada Pekerja','Bukti tanda terima pemberian seragam','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,35,null),
    ('C-1.7a','1.7a','Memastikan kelengkapan dan akurasi data Pekerja yang diinput pertama kali pada Aplikasi Alih Daya serta melakukan pengkinian data paling lambat 5 hari kerja umum sebelum tanggal dimulai Pelaksanaan Pekerjaan dan minggu ke-1 setiap bulan untuk masa Pelaksanaan Pekerjaan','100% akurasi dan kelengkapan atas data pada Aplikasi Alih Daya','Aplikasi Alih Daya','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,36,null),
    ('C-1.7b','1.7b','Memastikan kelengkapan dan akurasi data Pekerja yang diinput pertama kali pada Aplikasi Alih Daya serta melakukan pengkinian data paling lambat 5 hari kerja umum sebelum tanggal dimulai Pelaksanaan Pekerjaan dan minggu ke-1 setiap bulan untuk masa Pelaksanaan Pekerjaan','100% ketersediaan bukti data pemutakhiran','Bukti data pemutakhiran','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,37,null),
    ('C-1.8','1.8','Memenuhi kewajiban memiliki modal yang cukup untuk pembayaran operasional, termasuk namun tidak terbatas pada modal pemenuhan hak normatif ketenagakerjaan Pekerja selama 90 hari kalender berikutnya, dan selanjutnya sejak tagihan per bulan terkait telah dibayarkan oleh Pihak Pertama','100% ketersediaan bukti rekening koran dalam nominal modal yang cukup untuk membayar operasional pekerjaan selama minimal 90 hari','Bukti Rekening Koran dari Bank atas nama PIHAK KEDUA yang berisi saldo (sesuai bulan pembayaran tahap 2) untuk membayar operasional Pekerjaan selama 90 hari kalender berikutnya (Fix Cost tanpa ROK dan PPN)','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,38,null),
    ('C-1.9','1.9','Menyalurkan reward atas pencapaian service level agreement yang diberikan oleh PLN kepada Perusahaan Alih Daya paling sedikit sebesar 70% (tujuh puluh persen) kepada Tenaga Alih Daya berdasarkan capaian kinerja individual','100% ketersediaan bukti penyaluran reward atas pencapaian SLA','Bukti transfer & daftar pembayaran individu yang menerima reward','Prioritas 1',2::numeric,'2/22 x 9% x tagihan bulan berjalan','MANUAL',null,39,null),
    ('D-1.1','1.1','Meminta / menerima imbalan (gratifikasi) dari pelanggan yang dialami dan/atau dari PIHAK PERTAMA secara langsung','Tidak ada (0) laporan pelanggaran ILP','Dokumen laporan pelanggaran ILP','Prioritas 1',2::numeric,'2/6 x 9% x tagihan bulan berjalan','MANUAL',null,40,null),
    ('D-1.2','1.2','Melakukan pungutan liar, Kolusi Korupsi atau Nepotisme (KKN), dan lain-lain','Tidak ada (0) laporan pelanggaran ILP','Dokumen laporan pelanggaran ILP','Prioritas 1',2::numeric,'2/6 x 9% x tagihan bulan berjalan','MANUAL',null,41,null),
    ('D-1.3','1.3','Dengan sengaja tidak memberikan kemudahan, kecepatan, dan transparansi terkait layanan publik','Tidak ada (0) laporan pelanggaran ILP','Dokumen laporan pelanggaran ILP','Prioritas 1',2::numeric,'2/6 x 9% x tagihan bulan berjalan','MANUAL',null,42,null)
  )
  update public.sla_indicators i
  set point_code = c.point_code,
      criteria = c.criteria,
      performance_target = c.performance_target,
      evidence = c.evidence,
      weight_type = c.weight_type,
      weight = c.weight,
      penalty_formula = c.penalty_formula,
      input_mode = c.input_mode,
      variable_cost_profile = c.variable_cost_profile,
      sort_order = c.sort_order,
      measurement_unit = case
        when c.standard_measurement_unit is not null then c.standard_measurement_unit
        else i.measurement_unit
      end
  from canonical c
  where i.legacy_key = c.legacy_key;

  alter table public.sla_indicators enable trigger trg_sla_indicators_mutability;
end
$repair$;

-- Draft revisions copy every indicator metadata column, including the Variable profile.
-- Targets remain restricted to months in the requested new period.
create or replace function public.create_sla_draft_revision(
  p_source_version_id uuid,
  p_legacy_key text,
  p_name text,
  p_parent_contract_number text,
  p_addendum_number text,
  p_effective_date date,
  p_period_start date,
  p_period_end date,
  p_notes text
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_source public.sla_versions%rowtype;
  v_new_version_id uuid;
  v_section record;
  v_scope record;
  v_indicator record;
  v_new_section_id uuid;
  v_new_scope_id uuid;
  v_new_indicator_id uuid;
begin
  select * into v_source from public.sla_versions where id = p_source_version_id;
  if not found then raise exception 'Source SLA version not found'; end if;

  insert into public.sla_versions (
    legacy_key, contract_id, up3_id, name, parent_contract_number,
    addendum_number, effective_date, period_start, period_end, status,
    previous_active_version_id, source, source_version_id, notes, created_by
  ) values (
    p_legacy_key, v_source.contract_id, v_source.up3_id, p_name,
    p_parent_contract_number, p_addendum_number, p_effective_date,
    p_period_start, p_period_end, 'DRAFT',
    case when v_source.status = 'ACTIVE' then v_source.id else v_source.previous_active_version_id end,
    'COPY', v_source.id, p_notes, auth.uid()
  ) returning id into v_new_version_id;

  for v_section in
    select * from public.sla_sections
    where sla_version_id = v_source.id order by sort_order
  loop
    insert into public.sla_sections (
      sla_version_id, legacy_key, code, name, sort_order, created_by
    ) values (
      v_new_version_id, v_section.legacy_key, v_section.code,
      v_section.name, v_section.sort_order, auth.uid()
    ) returning id into v_new_section_id;

    for v_scope in
      select * from public.sla_scopes
      where sla_version_id = v_source.id and section_id = v_section.id
      order by sort_order
    loop
      insert into public.sla_scopes (
        sla_version_id, section_id, legacy_key, name, sort_order, created_by
      ) values (
        v_new_version_id, v_new_section_id, v_scope.legacy_key,
        v_scope.name, v_scope.sort_order, auth.uid()
      ) returning id into v_new_scope_id;

      for v_indicator in
        select * from public.sla_indicators
        where sla_version_id = v_source.id and scope_id = v_scope.id
        order by sort_order
      loop
        insert into public.sla_indicators (
          sla_version_id, section_id, scope_id, legacy_key, point_code,
          criteria, performance_target, evidence, weight_type, weight,
          penalty_formula, measurement_unit, default_target_value,
          input_mode, variable_cost_profile, sort_order, created_by
        ) values (
          v_new_version_id, v_new_section_id, v_new_scope_id,
          v_indicator.legacy_key, v_indicator.point_code, v_indicator.criteria,
          v_indicator.performance_target, v_indicator.evidence,
          v_indicator.weight_type, v_indicator.weight,
          v_indicator.penalty_formula, v_indicator.measurement_unit,
          v_indicator.default_target_value, v_indicator.input_mode,
          v_indicator.variable_cost_profile, v_indicator.sort_order, auth.uid()
        ) returning id into v_new_indicator_id;

        insert into public.sla_targets (
          contract_id, up3_id, unit_id, sla_version_id, indicator_id,
          period_month, target_scope, target_value, created_by
        )
        select v_source.contract_id, v_source.up3_id, t.unit_id,
               v_new_version_id, v_new_indicator_id, t.period_month,
               t.target_scope, t.target_value, auth.uid()
        from public.sla_targets t
        where t.sla_version_id = v_source.id
          and t.indicator_id = v_indicator.id
          and t.period_month between
              date_trunc('month', p_period_start::timestamp)::date and
              date_trunc('month', p_period_end::timestamp)::date;
      end loop;
    end loop;
  end loop;
  return v_new_version_id;
end;
$$;

comment on function public.create_sla_draft_revision(uuid,text,text,text,text,date,date,date,text)
  is 'Copies an SLA hierarchy with all indicator metadata and only targets inside the requested revision period.';

-- Activation is deliberately still service-role-only and now proves the complete contract registry.
create or replace function public.activate_sla_version(p_version_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target public.sla_versions%rowtype;
  v_previous_id uuid;
  v_keys text[];
begin
  select * into v_target from public.sla_versions
  where id = p_version_id for update;
  if not found then raise exception 'SLA version not found'; end if;
  if v_target.status <> 'DRAFT' then raise exception 'Only DRAFT SLA can be activated'; end if;

  select array_agg(i.legacy_key order by i.sort_order) into v_keys
  from public.sla_indicators i where i.sla_version_id = p_version_id;

  if coalesce(cardinality(v_keys), 0) <> 43
     or v_keys is distinct from array[
       'A-1.1a','A-1.1b','A-1.2','A-1.3','A-1.4','A-2.1a','A-2.1b','A-2.1c','A-2.1d',
       'A-3.1a','A-3.1b','A-3.1c','A-3.2a','A-3.2b','A-3.3','A-3.4a','A-3.4b','A-3.5',
       'B-1.1','B-1.2a','B-1.2b','B-1.3a','B-1.3b','B-1.4a','B-1.4b','B-1.5','B-1.6','B-1.7','B-2.1',
       'C-1.1','C-1.2','C-1.3','C-1.4','C-1.5a','C-1.5b','C-1.6','C-1.7a','C-1.7b','C-1.8','C-1.9',
       'D-1.1','D-1.2','D-1.3'
     ]::text[] then
    raise exception 'SLA activation requires the canonical 43-key A-D order';
  end if;

  if (select count(distinct legacy_key) from public.sla_indicators where sla_version_id = p_version_id) <> 43
     or (select count(distinct sort_order) from public.sla_indicators where sla_version_id = p_version_id) <> 43
     or (select min(sort_order) from public.sla_indicators where sla_version_id = p_version_id) <> 0
     or (select max(sort_order) from public.sla_indicators where sla_version_id = p_version_id) <> 42 then
    raise exception 'SLA activation requires unique identities and contiguous sort order 0..42';
  end if;

  if (select count(*) from public.sla_indicators i
      where i.sla_version_id = p_version_id
        and i.input_mode = 'VARIABLE_COST'
        and i.variable_cost_profile = 'STANDARD'
        and (i.legacy_key, i.point_code) in (
          ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
          ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
        )) <> 8
     or (select count(*) from public.sla_indicators i
         where i.sla_version_id = p_version_id
           and not (i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
                    and (i.legacy_key, i.point_code) in (
                      ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
                      ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
                    ))) <> 35
     or exists (
       select 1 from public.sla_indicators i
       where i.sla_version_id = p_version_id
         and not (
           (i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
            and (i.legacy_key, i.point_code) in (
              ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
              ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
            ))
           or (i.legacy_key = 'A-3.1c' and i.point_code = '3.1c'
               and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'KONSTRUKSI')
           or (i.legacy_key <> 'A-3.1c'
               and i.input_mode = 'MANUAL' and i.variable_cost_profile is null)
         )
     ) then
    raise exception 'SLA activation requires exactly eight STANDARD Variable-linked and 35 non-linked indicators';
  end if;

  if (select count(*) from unnest(v_keys) k where k like 'A-%') <> 18
     or (select count(*) from unnest(v_keys) k where k like 'B-%') <> 11
     or (select count(*) from unnest(v_keys) k where k like 'C-%') <> 11
     or (select count(*) from unnest(v_keys) k where k like 'D-%') <> 3 then
    raise exception 'SLA activation requires canonical A-D key counts';
  end if;

  select id into v_previous_id
  from public.sla_versions
  where contract_id = v_target.contract_id
    and up3_id = v_target.up3_id
    and status = 'ACTIVE'
  order by effective_date desc
  limit 1 for update;

  update public.sla_versions set status = 'ARCHIVED'
  where contract_id = v_target.contract_id
    and up3_id = v_target.up3_id
    and status = 'ACTIVE';

  update public.sla_versions
  set status = 'ACTIVE', previous_active_version_id = v_previous_id
  where id = p_version_id;
  return p_version_id;
end;
$$;

revoke execute on function public.activate_sla_version(uuid) from public, anon, authenticated;
grant execute on function public.activate_sla_version(uuid) to service_role;
comment on function public.activate_sla_version(uuid)
  is 'Service-role-only activation with strict canonical 43-indicator SLA integrity checks.';

-- Only the exact eight canonical STANDARD indicators may materialize an SLA aggregate.
create or replace function public.sync_variable_cost_month(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_period_month date
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
  v_unit text;
  v_target numeric(18,4);
  v_work_order numeric(18,4);
  v_realization numeric(18,4);
  v_achievement numeric(12,4);
  v_denominator numeric(18,4);
begin
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id,
    p_indicator_id, p_period_month), 0));

  if not exists (
    select 1 from public.sla_indicators i
    where i.id = p_indicator_id and i.sla_version_id = p_sla_version_id
      and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
      and (i.legacy_key, i.point_code) in (
        ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
        ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
      )
  ) then
    delete from public.sla_entries
    where contract_id = p_contract_id and up3_id = p_up3_id
      and unit_id = p_unit_id and sla_version_id = p_sla_version_id
      and indicator_id = p_indicator_id and period_month = p_period_month
      and source_type = 'VARIABLE_COST_AGGREGATE';
    return;
  end if;

  select count(*), min(vc.measurement_unit),
         sum(coalesce(vc.work_order, 0)), sum(coalesce(vc.realization, 0))
  into v_count, v_unit, v_work_order, v_realization
  from public.variable_cost_entries vc
  where vc.contract_id = p_contract_id and vc.up3_id = p_up3_id
    and vc.unit_id = p_unit_id and vc.sla_version_id = p_sla_version_id
    and vc.indicator_id = p_indicator_id
    and vc.work_date >= p_period_month
    and vc.work_date < (p_period_month + interval '1 month')::date
    and vc.status = 'APPROVED';

  if v_count = 0 then
    delete from public.sla_entries
    where contract_id = p_contract_id and up3_id = p_up3_id
      and unit_id = p_unit_id and sla_version_id = p_sla_version_id
      and indicator_id = p_indicator_id and period_month = p_period_month
      and source_type = 'VARIABLE_COST_AGGREGATE';
    return;
  end if;

  select t.target_value into v_target
  from public.sla_targets t
  where t.contract_id = p_contract_id and t.up3_id = p_up3_id
    and t.unit_id = p_unit_id and t.sla_version_id = p_sla_version_id
    and t.indicator_id = p_indicator_id and t.period_month = p_period_month
    and t.target_scope = 'ULP';

  if v_target > 0 and v_work_order > 0 then
    v_denominator := least(v_target, v_work_order);
    v_achievement := (v_realization / v_denominator * 100)::numeric(12,4);
  end if;

  insert into public.sla_entries (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id,
    period_month, source_type, measurement_unit, target_value,
    work_order, realization, achievement, penalty_value
  ) values (
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id,
    p_period_month, 'VARIABLE_COST_AGGREGATE', v_unit, v_target,
    v_work_order, v_realization, v_achievement, null
  )
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month)
  do update set source_type = 'VARIABLE_COST_AGGREGATE',
    measurement_unit = excluded.measurement_unit,
    target_value = excluded.target_value,
    work_order = excluded.work_order,
    realization = excluded.realization,
    achievement = excluded.achievement,
    penalty_value = null;
end;
$$;

comment on function public.sync_variable_cost_month(uuid,uuid,uuid,uuid,uuid,date)
  is 'Synchronizes approved nonfinancial Variable work into SLA for only the eight canonical STANDARD indicators.';

create or replace function public.validate_sla_entry_source()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_indicator public.sla_indicators%rowtype;
begin
  select * into v_indicator from public.sla_indicators
  where id = new.indicator_id and sla_version_id = new.sla_version_id;
  if not found then raise exception 'SLA indicator not found in version'; end if;

  if new.source_type = 'MANUAL' and not (
    v_indicator.input_mode = 'MANUAL'
    or (v_indicator.legacy_key = 'A-3.1c' and v_indicator.point_code = '3.1c'
        and v_indicator.input_mode = 'VARIABLE_COST'
        and v_indicator.variable_cost_profile = 'KONSTRUKSI')
  ) then
    raise exception 'MANUAL SLA entry requires a non-linked SLA indicator';
  end if;

  if new.source_type = 'VARIABLE_COST_AGGREGATE' and not (
    v_indicator.input_mode = 'VARIABLE_COST'
    and v_indicator.variable_cost_profile = 'STANDARD'
    and (v_indicator.legacy_key, v_indicator.point_code) in (
      ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
      ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
    )
  ) then
    raise exception 'Variable Cost aggregate requires a canonical STANDARD linked indicator';
  end if;
  return new;
end;
$$;

comment on function public.validate_sla_entry_source()
  is 'Restricts manual SLA input to non-linked indicators and aggregates to the eight canonical STANDARD indicators.';

create or replace function public.save_manual_sla_entry(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_period_month date,
  p_measurement_unit text,
  p_work_order numeric,
  p_realization numeric,
  p_achievement numeric
)
returns public.sla_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sla_entries%rowtype;
  v_month date;
  v_period_start date;
  v_period_end date;
  v_indicator public.sla_indicators%rowtype;
  v_target numeric(18,4);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP'
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = p_unit_id
        and cm.status = 'ACTIVE' and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
    )
  ) then
    raise exception 'Only SUPER_ADMIN or the exact-unit ADMIN_ULP may save manual SLA input' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_units ou
    where ou.id = p_unit_id and ou.type = 'ULP'
      and ou.parent_id = p_up3_id and ou.own_status = 'Aktif'
  ) then raise exception 'unit_id must be an active child ULP of up3_id'; end if;

  if p_period_month is null then raise exception 'period_month is required'; end if;
  if p_work_order is null or p_work_order < 0
     or p_realization is null or p_realization < 0
     or p_achievement is null or p_achievement < 0 then
    raise exception 'work_order, realization, and achievement must be nonnegative';
  end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;

  select v.period_start, v.period_end into v_period_start, v_period_end
  from public.sla_versions v
  where v.id = p_sla_version_id and v.contract_id = p_contract_id
    and v.up3_id = p_up3_id and v.status = 'ACTIVE';
  if not found then raise exception 'Manual SLA input requires the ACTIVE version in the exact scope'; end if;
  if v_month < date_trunc('month', v_period_start::timestamp)::date
     or v_month > date_trunc('month', v_period_end::timestamp)::date then
    raise exception 'period_month is outside the SLA version period';
  end if;

  select * into v_indicator from public.sla_indicators
  where id = p_indicator_id and sla_version_id = p_sla_version_id;
  if not found then raise exception 'indicator not found in version'; end if;
  if not (
    v_indicator.input_mode = 'MANUAL'
    or (v_indicator.legacy_key = 'A-3.1c' and v_indicator.point_code = '3.1c'
        and v_indicator.input_mode = 'VARIABLE_COST'
        and v_indicator.variable_cost_profile = 'KONSTRUKSI')
  ) then raise exception 'indicator is linked to Variable Cost and cannot be entered manually'; end if;

  if v_indicator.input_mode = 'MANUAL' then
    select t.target_value into v_target from public.sla_targets t
    where t.contract_id = p_contract_id and t.up3_id = p_up3_id
      and t.unit_id = p_unit_id and t.sla_version_id = p_sla_version_id
      and t.indicator_id = p_indicator_id and t.period_month = v_month
      and t.target_scope = 'ULP';
  end if;

  insert into public.sla_entries (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id,
    period_month, source_type, measurement_unit, target_value,
    work_order, realization, achievement, penalty_value, created_by, updated_by
  ) values (
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id,
    v_month, 'MANUAL', nullif(btrim(p_measurement_unit), ''), v_target,
    p_work_order, p_realization, p_achievement, null, auth.uid(), auth.uid()
  )
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month)
  do update set source_type = 'MANUAL',
    measurement_unit = excluded.measurement_unit,
    target_value = excluded.target_value,
    work_order = excluded.work_order,
    realization = excluded.realization,
    achievement = excluded.achievement,
    penalty_value = null,
    updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.save_manual_sla_entry(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric) from public, anon;
grant execute on function public.save_manual_sla_entry(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric) to authenticated, service_role;
comment on function public.save_manual_sla_entry(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric)
  is 'Saves nonfinancial manual ULP SLA input for an exact active scope; A-3.1c is manual only in SLA behavior.';

-- Referenced ACTIVE versions permit only operational target inserts/value changes:
-- ULP targets for the eight linked points and ULP/UP3 targets for true MANUAL rows.
create or replace function public.guard_sla_target_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_status text;
  v_old_is_mutable boolean := false;
  v_new_is_mutable boolean := false;
  v_identity_unchanged boolean := false;
begin
  if tg_op = 'DELETE' then
    v_old_version_id := old.sla_version_id;
  elsif tg_op = 'INSERT' then
    v_new_version_id := new.sla_version_id;
  else
    v_old_version_id := old.sla_version_id;
    v_new_version_id := new.sla_version_id;
    v_identity_unchanged := old.contract_id is not distinct from new.contract_id
      and old.up3_id is not distinct from new.up3_id
      and old.unit_id is not distinct from new.unit_id
      and old.sla_version_id is not distinct from new.sla_version_id
      and old.indicator_id is not distinct from new.indicator_id
      and old.period_month is not distinct from new.period_month
      and old.target_scope is not distinct from new.target_scope;
  end if;

  if v_old_version_id is not null then
    select v.status into v_status from public.sla_versions v where v.id = v_old_version_id;
    if v_status = 'ARCHIVED' then raise exception 'ARCHIVED SLA targets are immutable'; end if;
    select exists (
      select 1 from public.sla_indicators i
      where i.id = old.indicator_id and i.sla_version_id = old.sla_version_id
        and (
          (old.target_scope = 'ULP' and old.unit_id is not null
           and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
           and (i.legacy_key, i.point_code) in (
             ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
             ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
           ))
          or (i.input_mode = 'MANUAL' and i.variable_cost_profile is null
              and ((old.target_scope = 'ULP' and old.unit_id is not null)
                   or (old.target_scope = 'UP3' and old.unit_id is null)))
        )
    ) into v_old_is_mutable;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_old_version_id)
       and not (tg_op = 'UPDATE' and v_identity_unchanged and v_old_is_mutable) then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if v_new_version_id is not null then
    select v.status into v_status from public.sla_versions v where v.id = v_new_version_id;
    if v_status = 'ARCHIVED' then raise exception 'ARCHIVED SLA targets are immutable'; end if;
    select exists (
      select 1 from public.sla_indicators i
      where i.id = new.indicator_id and i.sla_version_id = new.sla_version_id
        and (
          (new.target_scope = 'ULP' and new.unit_id is not null
           and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
           and (i.legacy_key, i.point_code) in (
             ('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),
             ('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b')
           ))
          or (i.input_mode = 'MANUAL' and i.variable_cost_profile is null
              and ((new.target_scope = 'ULP' and new.unit_id is not null)
                   or (new.target_scope = 'UP3' and new.unit_id is null)))
        )
    ) into v_new_is_mutable;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_new_version_id)
       and not (
         (tg_op = 'INSERT' and v_new_is_mutable)
         or (tg_op = 'UPDATE' and v_identity_unchanged and v_old_is_mutable and v_new_is_mutable)
       ) then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function public.guard_sla_target_mutation()
  is 'Preserves SLA target history while allowing value-only operational STANDARD ULP and true MANUAL ULP/UP3 target writes.';

create or replace function public.set_manual_sla_up3_target(
  p_contract_id uuid,
  p_up3_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_period_month date,
  p_target_value numeric
)
returns public.sla_targets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sla_targets%rowtype;
  v_month date;
  v_period_start date;
  v_period_end date;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(p_contract_id, p_up3_id)) then
    raise exception 'Not authorized to set the UP3 SLA target' using errcode = '42501';
  end if;
  if p_period_month is null then raise exception 'period_month is required'; end if;
  if p_target_value is null or p_target_value < 0 then raise exception 'target_value must be nonnegative'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;

  select v.period_start, v.period_end into v_period_start, v_period_end
  from public.sla_versions v
  where v.id = p_sla_version_id and v.contract_id = p_contract_id
    and v.up3_id = p_up3_id and v.status = 'ACTIVE';
  if not found then raise exception 'Target requires the ACTIVE version in the exact scope'; end if;
  if v_month < date_trunc('month', v_period_start::timestamp)::date
     or v_month > date_trunc('month', v_period_end::timestamp)::date then
    raise exception 'period_month is outside the SLA version period';
  end if;

  if not exists (
    select 1 from public.sla_indicators i
    where i.id = p_indicator_id and i.sla_version_id = p_sla_version_id
      and i.input_mode = 'MANUAL' and i.variable_cost_profile is null
      and i.legacy_key <> 'A-3.1c'
  ) then raise exception 'UP3 manual targets require a true MANUAL indicator'; end if;

  insert into public.sla_targets (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id,
    period_month, target_scope, target_value, created_by, updated_by
  ) values (
    p_contract_id, p_up3_id, null, p_sla_version_id, p_indicator_id,
    v_month, 'UP3', p_target_value, auth.uid(), auth.uid()
  )
  on conflict (contract_id, up3_id, sla_version_id, indicator_id, period_month)
    where target_scope = 'UP3' and unit_id is null
  do update set target_value = excluded.target_value, updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.set_manual_sla_up3_target(uuid,uuid,uuid,uuid,date,numeric) from public, anon;
grant execute on function public.set_manual_sla_up3_target(uuid,uuid,uuid,uuid,date,numeric) to authenticated, service_role;
comment on function public.set_manual_sla_up3_target(uuid,uuid,uuid,uuid,date,numeric)
  is 'Sets an UP3 monthly target for a true MANUAL indicator in the exact ACTIVE SLA version.';

-- Hierarchy rows inherit the same exact version visibility as the SLA registry.
drop policy if exists sla_sections_select_authorized on public.sla_sections;
create policy sla_sections_select_authorized
  on public.sla_sections for select to authenticated
  using (exists (
    select 1 from public.sla_versions v
    where v.id = sla_sections.sla_version_id
      and (
        public.auth_is_super_admin()
        or public.auth_can_access_operational_up3(v.contract_id, v.up3_id)
        or public.auth_can_read_management_overtime_scope(v.contract_id, v.up3_id, null)
      )
  ));

drop policy if exists sla_scopes_select_authorized on public.sla_scopes;
create policy sla_scopes_select_authorized
  on public.sla_scopes for select to authenticated
  using (exists (
    select 1 from public.sla_versions v
    where v.id = sla_scopes.sla_version_id
      and (
        public.auth_is_super_admin()
        or public.auth_can_access_operational_up3(v.contract_id, v.up3_id)
        or public.auth_can_read_management_overtime_scope(v.contract_id, v.up3_id, null)
      )
  ));

grant select on public.sla_sections, public.sla_scopes to authenticated;
comment on policy sla_sections_select_authorized on public.sla_sections
  is 'Authenticated users may read sections only through authorized exact SLA version scope.';
comment on policy sla_scopes_select_authorized on public.sla_scopes
  is 'Authenticated users may read scopes only through authorized exact SLA version scope.';

notify pgrst, 'reload schema';

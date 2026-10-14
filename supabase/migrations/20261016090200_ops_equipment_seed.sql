-- TAHAP 1 seed: jenis, penugasan, kategori, katalog contoh, template R2-Koordinator.
-- Idempoten (where not exists). Kode contoh awal, dapat diubah admin.

-- Jenis kendaraan
insert into public.ops_vehicle_types(contract_id, up3_id, code, name, sort_order)
select 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid, '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid, x.code, x.name, x.ord
from (values ('R2', 'Roda 2', 1), ('R4', 'Roda 4', 2)) as x(code, name, ord)
where not exists (select 1 from public.ops_vehicle_types
  where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and code = x.code);

-- Penugasan
insert into public.ops_vehicle_assignments(contract_id, up3_id, code, name, sort_order)
select 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid, '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid, x.code, x.name, x.ord
from (values
  ('PG001', 'Koordinator', 1),
  ('PG002', 'K3', 2),
  ('PG003', 'Dinas Gangguan / Pelayanan Teknik', 3),
  ('PG004', 'ULC', 4),
  ('PG005', 'Inspeksi TM/TR', 5),
  ('PG006', 'Pemeliharaan JTM / Rabas', 6),
  ('PG007', 'Pemeliharaan Konstruksi', 7),
  ('PG008', 'Ukur Gardu', 8)
) as x(code, name, ord)
where not exists (select 1 from public.ops_vehicle_assignments
  where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and code = x.code);

-- Kategori
insert into public.ops_equipment_categories(contract_id, up3_id, code, name, sort_order)
select 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid, '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid, x.code, x.name, x.ord
from (values
  ('KAT01', 'Peralatan Kerja', 1),
  ('KAT02', 'Peralatan K2/K3', 2),
  ('KAT03', 'Peralatan Ukur', 3),
  ('KAT04', 'Peralatan Komunikasi', 4),
  ('KAT05', 'Perlengkapan Administrasi', 5)
) as x(code, name, ord)
where not exists (select 1 from public.ops_equipment_categories
  where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and code = x.code);

-- Katalog contoh
insert into public.ops_equipment_items(contract_id, up3_id, code, name, category_id, unit, description, sort_order)
select 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid, '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid,
  x.code, x.name, c.id, 'unit', x.descr, x.ord
from (values
  ('ALT001', 'Radio HT VHF + IP Set', 'KAT01', 'Satuan diverifikasi admin', 1),
  ('ALT002', 'HP Pendukung APKT Mobile 8GB/128 GB + Hardcase + Powerbank 5000 mAH', 'KAT01', 'Nama sesuai referensi', 2),
  ('ALT003', 'Paket Data Aplikasi', 'KAT01', 'Item kebutuhan nonfisik', 3),
  ('ALT004', 'Tes Pen', 'KAT01', null, 4),
  ('ALT005', 'Sarung Tangan Kerja', 'KAT02', null, 5),
  ('ALT006', 'Kotak P3K', 'KAT02', null, 6),
  ('ALT007', 'Tang Ampere (AVO Meter)', 'KAT03', null, 7),
  ('ALT008', 'Telescopic hotstick 20 kV 10,5 Meter', 'KAT01', null, 8),
  ('ALT009', 'Tangga Fiber ( 2 section ladder ) 9,6 mtr', 'KAT01', null, 9),
  ('ALT010', 'Groundcluster', 'KAT01', null, 10)
) as x(code, name, cat, descr, ord)
join public.ops_equipment_categories c
  on c.contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
  and c.up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and c.code = x.cat
where not exists (select 1 from public.ops_equipment_items
  where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and code = x.code);

-- Template contoh A: Roda 2 — Koordinator (Aktif v1)
insert into public.ops_equipment_templates(contract_id, up3_id, template_code, template_name,
  vehicle_type_id, assignment_id, vehicle_variant, version_number, effective_from, status)
select 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid, '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid,
  'TMP-R2-PG001-V1', 'Roda 2 — Koordinator', t.id, a.id, null, 1, current_date, 'Aktif'
from public.ops_vehicle_types t, public.ops_vehicle_assignments a
where t.contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
  and t.up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and t.code = 'R2'
  and a.contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
  and a.up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and a.code = 'PG001'
  and not exists (select 1 from public.ops_equipment_templates
    where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
      and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and template_code = 'TMP-R2-PG001-V1');

insert into public.ops_equipment_template_items(template_id, equipment_id, required_qty, sort_order)
select tpl.id, eq.id, 1, x.ord
from (values ('ALT001', 1), ('ALT002', 2), ('ALT003', 3), ('ALT004', 4), ('ALT005', 5), ('ALT006', 6)) as x(code, ord)
join public.ops_equipment_templates tpl
  on tpl.contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
  and tpl.up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and tpl.template_code = 'TMP-R2-PG001-V1'
join public.ops_equipment_items eq
  on eq.contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
  and eq.up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid and eq.code = x.code
where not exists (select 1 from public.ops_equipment_template_items
  where template_id = tpl.id and equipment_id = eq.id);

-- Seed canonical Variable Cost 9 indicators for V3 daily input
-- Uses existing contract/up3 scope; creates one ACTIVE version covering 2026

do $$
declare
  v_contract uuid := 'e1e2c8bc-ed1c-46db-bd39-70757a90863c';
  v_up3 uuid := '3215235c-c194-43a1-84d2-25c767c75d7a';
  v_version uuid;
  v_section uuid;
  v_scope uuid;
begin
  -- do not re-seed if already exists
  select id into v_version from public.sla_versions where contract_id=v_contract and up3_id=v_up3 and legacy_key='v1' and status='ACTIVE';
  if v_version is not null then return; end if;

  insert into public.sla_versions (id, legacy_key, contract_id, up3_id, name, parent_contract_number, effective_date, period_start, period_end, status)
  values (gen_random_uuid(), 'v1', v_contract, v_up3, 'SLA Versi 1', '001/SPK/UP3SKW/2026', '2026-01-01', '2026-01-01', '2026-12-31', 'ACTIVE')
  returning id into v_version;

  insert into public.sla_sections (id, sla_version_id, legacy_key, code, name, sort_order)
  values (gen_random_uuid(), v_version, 'sec-A', 'A', 'A. SLA Teknis', 0)
  returning id into v_section;

  insert into public.sla_scopes (id, sla_version_id, section_id, legacy_key, name, sort_order)
  values (gen_random_uuid(), v_version, v_section, 'scope-variable', 'Variable Cost', 0)
  returning id into v_scope;

  -- 8 STANDARD
  insert into public.sla_indicators (id, sla_version_id, section_id, scope_id, legacy_key, point_code, criteria, performance_target, evidence, weight_type, weight, measurement_unit, input_mode, variable_cost_profile, sort_order)
  values
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-2.1a', '2.1a', 'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan', 'Inspeksi SUTM Tier 1: 17.539 gawang/bulan', 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN', 'Prioritas 1', 2, 'gawang', 'VARIABLE_COST', 'STANDARD', 0),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-2.1b', '2.1b', 'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan', 'Inspeksi SUTM Tier 2: 4.385 gawang/bulan', 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN', 'Prioritas 1', 2, 'gawang', 'VARIABLE_COST', 'STANDARD', 1),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-2.1c', '2.1c', 'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan', 'Inspeksi Gardu/Keypoint Tier 1: 331 buah/bulan', 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN', 'Prioritas 1', 2, 'buah', 'VARIABLE_COST', 'STANDARD', 2),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-2.1d', '2.1d', 'Melakukan inspeksi tier 1 dan 2 jaringan, gardu distribusi, dan peralatan jaringan', 'Inspeksi Gardu/Keypoint Tier 2: 331 buah/bulan', 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN', 'Prioritas 1', 2, 'buah', 'VARIABLE_COST', 'STANDARD', 3),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-3.1a', '3.1a', 'Melakukan pemeliharaan jaringan, meliputi: Fix Right of Way (ROW): 4.530 gawang/bulan', '100% terlaksananya pemeliharaan sesuai dengan WO Fix.', 'Work Order (WO) dan terinput di Aplikasi PLN', 'Prioritas 1', 2, 'gawang', 'VARIABLE_COST', 'STANDARD', 4),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-3.1b', '3.1b', 'Melakukan pemeliharaan jaringan, meliputi: Var Right of Way (ROW): 4.239 gawang/bulan atau sesuai dengan WO yang diberikan', '100% terlaksananya pemeliharaan sesuai dengan WO Var', 'Work Order (WO) dan terinput di Aplikasi PLN', 'Prioritas 1', 2, 'gawang', 'VARIABLE_COST', 'STANDARD', 5),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-3.2a', '3.2a', 'Melakukan pemeliharaan gardu distribusi, meliputi: Pengukuran 331 buah Gardu Distribusi', '100% terlaksananya pengukuran Gardu sesuai dengan WO', 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN', 'Prioritas 1', 2, 'buah', 'VARIABLE_COST', 'STANDARD', 6),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-3.2b', '3.2b', 'Pemeliharaan 331 buah Gardu Distribusi dan lingkungan', '100% terlaksananya pemeliharaan Gardu sesuai dengan WO', 'Work Order (WO) dan terinput di Aplikasi EAM Maximo atau Aplikasi PLN', 'Prioritas 1', 2, 'buah', 'VARIABLE_COST', 'STANDARD', 7),
    (gen_random_uuid(), v_version, v_section, v_scope, 'A-3.1c', '3.1c', 'Konstruksi (termasuk Pemeliharaan 3 Tiang dan 2 Gawang)', '100% terlaksananya pemeliharaan sesuai dengan WO VAR.', 'Work Order (WO) dan terinput di Aplikasi PLN', 'Prioritas 1', 2, null, 'VARIABLE_COST', 'KONSTRUKSI', 8);
end $$;

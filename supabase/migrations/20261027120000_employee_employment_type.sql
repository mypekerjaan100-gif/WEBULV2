-- Jenis perjanjian kerja per pegawai: PKWT / PKWTT (nullable = belum diisi).
-- Terpisah dari status kepegawaian Aktif/Nonaktif.

alter table public.employees
  add column if not exists employment_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_employment_type_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_employment_type_check
      check (employment_type is null or employment_type in ('PKWT', 'PKWTT'));
  end if;
end;
$$;

comment on column public.employees.employment_type is
  'Jenis perjanjian kerja: PKWT, PKWTT, atau null bila belum diisi.';

-- Kolom baru butuh grant eksplisit karena tabel memakai column-level grants.
grant select (employment_type) on public.employees to authenticated;
grant select (employment_type) on public.employees to service_role;

-- Terapkan employment_type dari snapshot perubahan pegawai. Bila key tidak
-- dikirim (mis. request lama), nilai yang sudah ada dipertahankan saat edit.
create or replace function private.apply_employee_snapshot(
  p_employee_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_proposed jsonb,
  p_effective date
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_employee_id uuid := p_employee_id;
  v_nip text := nullif(btrim(coalesce(p_proposed->>'nip','')), '');
  v_name text := nullif(btrim(coalesce(p_proposed->>'name','')), '');
  v_unit_id uuid := nullif(p_proposed->>'unit_id','')::uuid;
  v_position_id uuid := nullif(p_proposed->>'position_id','')::uuid;
  v_location_id uuid := nullif(p_proposed->>'location_id','');
  v_bank text := nullif(btrim(coalesce(p_proposed->>'bank','')), '');
  v_account text := nullif(btrim(coalesce(p_proposed->>'account_number','')), '');
  v_rate numeric := coalesce(nullif(p_proposed->>'hourly_rate','')::numeric, 0);
  v_birth date := nullif(p_proposed->>'birth_date','')::date;
  v_ret_override date := nullif(p_proposed->>'retirement_date_override','')::date;
  v_pension_reason text := nullif(btrim(coalesce(p_proposed->>'pension_override_reason','')), '');
  v_source_pos text := nullif(btrim(coalesce(p_proposed->>'source_position','')), '');
  v_emp_status text := coalesce(nullif(btrim(p_proposed->>'employment_status'),''), 'Aktif');
  v_status_reason text := nullif(btrim(coalesce(p_proposed->>'status_reason','')), '');
  v_status_note text := nullif(btrim(coalesce(p_proposed->>'status_reason_note','')), '');
  v_status_eff date := coalesce(nullif(p_proposed->>'status_effective_date','')::date, p_effective);
  v_emp_type text := nullif(upper(btrim(coalesce(p_proposed->>'employment_type',''))), '');
  v_has_emp_type boolean := coalesce(p_proposed ? 'employment_type', false);
  v_unit uuid;
  v_loc uuid;
begin
  if v_nip is null or v_name is null then raise exception 'NIP dan Nama wajib diisi' using errcode='22023'; end if;
  if v_unit_id is null then raise exception 'Unit wajib diisi' using errcode='22023'; end if;
  if v_emp_status not in ('Aktif','Nonaktif') then raise exception 'Status tidak valid' using errcode='22023'; end if;
  if v_emp_status='Nonaktif' and v_status_reason is null then raise exception 'Alasan Nonaktif wajib diisi' using errcode='22023'; end if;
  if v_emp_type is not null and v_emp_type not in ('PKWT','PKWTT') then
    raise exception 'Jenis perjanjian kerja tidak valid' using errcode='22023';
  end if;
  if v_rate is null or v_rate < 0 then raise exception 'Tarif tidak valid' using errcode='22023'; end if;

  -- validate unit belongs to up3
  select id into v_unit from public.organization_units where id=v_unit_id and own_status='Aktif' and ((type='UP3' and id=p_up3_id) or (type='ULP' and parent_id=p_up3_id));
  if not found then raise exception 'Unit di luar scope UP3' using errcode='23514'; end if;

  -- validate position scope if provided
  if v_position_id is not null and not exists (select 1 from public.positions where id=v_position_id and contract_id=p_contract_id and up3_id=p_up3_id and status='Aktif') then
    raise exception 'Jabatan di luar scope kontrak/UP3' using errcode='23514';
  end if;

  -- validate location scope if provided
  if p_proposed->>'location_id' is not null and nullif(p_proposed->>'location_id','') is not null then
    begin v_loc := nullif(p_proposed->>'location_id','')::uuid; exception when others then raise exception 'Lokasi tidak valid' using errcode='22023'; end;
    if not exists (select 1 from public.locations where id=v_loc and contract_id=p_contract_id and up3_id=p_up3_id and unit_id=v_unit_id and own_status='Aktif') then
      raise exception 'Lokasi tidak valid untuk unit ini' using errcode='23514';
    end if;
  else
    v_loc := null;
  end if;

  if v_employee_id is null then
    -- ADD: check NIP unique
    if exists (select 1 from public.employees where nip=v_nip) then raise exception 'NIP sudah digunakan: %', v_nip using errcode='23505'; end if;
    insert into public.employees (nip, name, birth_date, bank, account_number, source_position, retirement_date_override, pension_override_reason, employment_type, created_by, updated_by)
    values (v_nip, v_name, v_birth, v_bank, v_account, v_source_pos, v_ret_override, v_pension_reason, v_emp_type, auth.uid(), auth.uid())
    returning id into v_employee_id;
    insert into public.employee_unit_history (employee_id, contract_id, up3_id, unit_id, effective_from, created_by)
    values (v_employee_id, p_contract_id, p_up3_id, v_unit_id, p_effective, auth.uid());
    if v_position_id is not null then
      insert into public.employee_position_history (employee_id, position_id, effective_from, created_by)
      values (v_employee_id, v_position_id, p_effective, auth.uid());
    end if;
    if v_loc is not null then
      insert into public.employee_work_location_history (employee_id, location_id, effective_from, created_by)
      values (v_employee_id, v_loc, p_effective, auth.uid());
    end if;
    insert into public.employee_status_history (employee_id, status, reason, reason_note, effective_from, created_by)
    values (v_employee_id, v_emp_status, case when v_emp_status='Aktif' then null else v_status_reason end, case when v_emp_status='Aktif' then null else v_status_note end, v_status_eff, auth.uid());
    insert into public.employee_hourly_rate_history (employee_id, hourly_rate, effective_from, created_by)
    values (v_employee_id, v_rate, p_effective, auth.uid());
  else
    -- EDIT: check exists + NIP unique to others
    if not exists (select 1 from public.employees where id=v_employee_id) then raise exception 'Pegawai tidak ditemukan' using errcode='22023'; end if;
    if exists (select 1 from public.employees where nip=v_nip and id<>v_employee_id) then raise exception 'NIP sudah digunakan pegawai lain: %', v_nip using errcode='23505'; end if;
    update public.employees set nip=v_nip, name=v_name, birth_date=v_birth, bank=v_bank, account_number=v_account,
      source_position=v_source_pos, retirement_date_override=v_ret_override, pension_override_reason=v_pension_reason,
      employment_type=case when v_has_emp_type then v_emp_type else employment_type end,
      updated_by=auth.uid()
    where id=v_employee_id;

    -- unit history: close + open if changed
    if not exists (select 1 from public.employee_unit_history where employee_id=v_employee_id and effective_to is null and contract_id=p_contract_id and up3_id=p_up3_id and unit_id=v_unit_id) then
      update public.employee_unit_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
      insert into public.employee_unit_history (employee_id, contract_id, up3_id, unit_id, effective_from, created_by)
      values (v_employee_id, p_contract_id, p_up3_id, v_unit_id, p_effective, auth.uid());
      -- unit changed resets location unless new location provided in same snapshot
      if v_loc is distinct from null then
        update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
        if v_loc is not null then insert into public.employee_work_location_history (employee_id, location_id, effective_from, created_by) values (v_employee_id, v_loc, p_effective, auth.uid()); end if;
      else
        -- keep existing location only if still same unit scope; else clear
        -- if location belongs to old unit, clear it
        update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null
          and not exists (select 1 from public.locations l where l.id=employee_work_location_history.location_id and l.unit_id=v_unit_id);
      end if;
    else
      -- same unit: handle location change
      if v_loc is distinct from (select location_id from public.employee_work_location_history where employee_id=v_employee_id and effective_to is null) then
        update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
        if v_loc is not null then insert into public.employee_work_location_history (employee_id, location_id, effective_from, created_by) values (v_employee_id, v_loc, p_effective, auth.uid()); end if;
      end if;
    end if;

    -- position history
    if v_position_id is distinct from (select position_id from public.employee_position_history where employee_id=v_employee_id and effective_to is null) then
      if (select count(*) from public.employee_position_history where employee_id=v_employee_id and effective_to is null) > 0 then
        update public.employee_position_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
      end if;
      if v_position_id is not null then insert into public.employee_position_history (employee_id, position_id, effective_from, created_by) values (v_employee_id, v_position_id, p_effective, auth.uid()); end if;
    end if;

    -- status history
    if v_emp_status is distinct from (select status from public.employee_status_history where employee_id=v_employee_id and effective_to is null) or
       coalesce(v_status_reason,'') is distinct from coalesce((select reason from public.employee_status_history where employee_id=v_employee_id and effective_to is null),'') then
      update public.employee_status_history set effective_to=least(p_effective, v_status_eff) where employee_id=v_employee_id and effective_to is null;
      insert into public.employee_status_history (employee_id, status, reason, reason_note, effective_from, created_by)
      values (v_employee_id, v_emp_status, case when v_emp_status='Aktif' then null else v_status_reason end, case when v_emp_status='Aktif' then null else v_status_note end, v_status_eff, auth.uid());
    end if;

    -- rate history
    if v_rate is distinct from (select hourly_rate from public.employee_hourly_rate_history where employee_id=v_employee_id and effective_to is null) then
      update public.employee_hourly_rate_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
      insert into public.employee_hourly_rate_history (employee_id, hourly_rate, effective_from, created_by) values (v_employee_id, v_rate, p_effective, auth.uid());
    end if;
  end if;
  return v_employee_id;
end;
$function$;

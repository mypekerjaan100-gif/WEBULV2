-- Perbaikan riwayat pegawai untuk perubahan pada tanggal yang sama.
--
-- Kasus yang diperbaiki:
--   * jabatan diubah dua kali pada hari yang sama;
--   * lokasi/unit berubah pada hari yang sama;
--   * tarif lembur diubah dua kali pada hari yang sama.
--
-- Sebelumnya baris berjalan ditutup dengan effective_to = effective_from
-- sehingga melanggar check constraint effective_to > effective_from.
-- Sekarang perubahan pada tanggal yang sama memperbarui baris berjalan.
-- Perubahan pada tanggal berikutnya tetap menutup baris lama dan membuat
-- baris baru. Semua baris berjalan dikunci agar edit bersamaan terserialisasi.

create or replace function private.reconcile_employee_position_history(
  p_employee_id uuid,
  p_position_id uuid,
  p_effective date,
  p_created_by uuid
) returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_open public.employee_position_history%rowtype;
  v_effective date := coalesce(p_effective, current_date);
begin
  if p_employee_id is null then
    return;
  end if;

  select *
    into v_open
    from public.employee_position_history
   where employee_id = p_employee_id
     and effective_to is null
   order by effective_from desc, created_at desc
   limit 1
   for update;

  if not found then
    if p_position_id is not null then
      insert into public.employee_position_history
        (employee_id, position_id, effective_from, created_by)
      values
        (p_employee_id, p_position_id, v_effective, p_created_by);
    end if;
    return;
  end if;

  if v_open.position_id is not distinct from p_position_id then
    return;
  end if;

  -- Tanggal yang sama atau baris terjadwal: perbarui baris yang ada agar
  -- tidak pernah terbentuk interval nol.
  if v_open.effective_from >= v_effective then
    if p_position_id is null then
      delete from public.employee_position_history where id = v_open.id;
    else
      update public.employee_position_history
         set position_id = p_position_id
       where id = v_open.id;
    end if;
    return;
  end if;

  update public.employee_position_history
     set effective_to = v_effective
   where id = v_open.id;

  if p_position_id is not null then
    insert into public.employee_position_history
      (employee_id, position_id, effective_from, created_by)
    values
      (p_employee_id, p_position_id, v_effective, p_created_by);
  end if;
end;
$function$;

create or replace function private.reconcile_employee_location_history(
  p_employee_id uuid,
  p_location_id uuid,
  p_effective date,
  p_created_by uuid
) returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_open public.employee_work_location_history%rowtype;
  v_effective date := coalesce(p_effective, current_date);
begin
  if p_employee_id is null then
    return;
  end if;

  select *
    into v_open
    from public.employee_work_location_history
   where employee_id = p_employee_id
     and effective_to is null
   order by effective_from desc, created_at desc
   limit 1
   for update;

  if not found then
    if p_location_id is not null then
      insert into public.employee_work_location_history
        (employee_id, location_id, effective_from, created_by)
      values
        (p_employee_id, p_location_id, v_effective, p_created_by);
    end if;
    return;
  end if;

  if v_open.location_id is not distinct from p_location_id then
    return;
  end if;

  if v_open.effective_from >= v_effective then
    if p_location_id is null then
      delete from public.employee_work_location_history where id = v_open.id;
    else
      update public.employee_work_location_history
         set location_id = p_location_id
       where id = v_open.id;
    end if;
    return;
  end if;

  update public.employee_work_location_history
     set effective_to = v_effective
   where id = v_open.id;

  if p_location_id is not null then
    insert into public.employee_work_location_history
      (employee_id, location_id, effective_from, created_by)
    values
      (p_employee_id, p_location_id, v_effective, p_created_by);
  end if;
end;
$function$;

create or replace function private.reconcile_employee_rate_history(
  p_employee_id uuid,
  p_rate numeric,
  p_effective date,
  p_created_by uuid
) returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_open public.employee_hourly_rate_history%rowtype;
  v_rate numeric := coalesce(p_rate, 0);
  v_effective date := coalesce(p_effective, current_date);
begin
  if p_employee_id is null then
    return;
  end if;

  select *
    into v_open
    from public.employee_hourly_rate_history
   where employee_id = p_employee_id
     and effective_to is null
   order by effective_from desc, created_at desc
   limit 1
   for update;

  if not found then
    insert into public.employee_hourly_rate_history
      (employee_id, hourly_rate, effective_from, created_by)
    values
      (p_employee_id, v_rate, v_effective, p_created_by);
    return;
  end if;

  if v_open.hourly_rate is not distinct from v_rate then
    return;
  end if;

  if v_open.effective_from >= v_effective then
    update public.employee_hourly_rate_history
       set hourly_rate = v_rate
     where id = v_open.id;
    return;
  end if;

  update public.employee_hourly_rate_history
     set effective_to = v_effective
   where id = v_open.id;
  insert into public.employee_hourly_rate_history
    (employee_id, hourly_rate, effective_from, created_by)
  values
    (p_employee_id, v_rate, v_effective, p_created_by);
end;
$function$;

create or replace function private.reconcile_employee_unit_and_location(
  p_employee_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_location_id uuid,
  p_effective date,
  p_created_by uuid
) returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_unit_open public.employee_unit_history%rowtype;
  v_loc_open public.employee_work_location_history%rowtype;
  v_has_unit boolean := false;
  v_has_loc boolean := false;
  v_unit_changed boolean := false;
  v_effective date := coalesce(p_effective, current_date);
begin
  if p_employee_id is null then
    return;
  end if;

  select *
    into v_unit_open
    from public.employee_unit_history
   where employee_id = p_employee_id
     and effective_to is null
   order by effective_from desc, created_at desc
   limit 1
   for update;
  v_has_unit := found;

  if not v_has_unit then
    insert into public.employee_unit_history
      (employee_id, contract_id, up3_id, unit_id, effective_from, created_by)
    values
      (p_employee_id, p_contract_id, p_up3_id, p_unit_id, v_effective, p_created_by);
    v_unit_changed := true;
  elsif v_unit_open.contract_id = p_contract_id
    and v_unit_open.up3_id = p_up3_id
    and v_unit_open.unit_id = p_unit_id then
    v_unit_changed := false;
  elsif v_unit_open.effective_from >= v_effective then
    update public.employee_unit_history
       set contract_id = p_contract_id,
           up3_id = p_up3_id,
           unit_id = p_unit_id
     where id = v_unit_open.id;
    v_unit_changed := true;
  else
    update public.employee_unit_history
       set effective_to = v_effective
     where id = v_unit_open.id;
    insert into public.employee_unit_history
      (employee_id, contract_id, up3_id, unit_id, effective_from, created_by)
    values
      (p_employee_id, p_contract_id, p_up3_id, p_unit_id, v_effective, p_created_by);
    v_unit_changed := true;
  end if;

  select *
    into v_loc_open
    from public.employee_work_location_history
   where employee_id = p_employee_id
     and effective_to is null
   order by effective_from desc, created_at desc
   limit 1
   for update;
  v_has_loc := found;

  if v_unit_changed then
    if p_location_id is not null then
      if not v_has_loc then
        insert into public.employee_work_location_history
          (employee_id, location_id, effective_from, created_by)
        values
          (p_employee_id, p_location_id, v_effective, p_created_by);
      elsif v_loc_open.location_id = p_location_id then
        -- Lokasi tujuan sudah menjadi baris berjalan.
        null;
      elsif v_loc_open.effective_from >= v_effective then
        update public.employee_work_location_history
           set location_id = p_location_id
         where id = v_loc_open.id;
      else
        update public.employee_work_location_history
           set effective_to = v_effective
         where id = v_loc_open.id;
        insert into public.employee_work_location_history
          (employee_id, location_id, effective_from, created_by)
        values
          (p_employee_id, p_location_id, v_effective, p_created_by);
      end if;
    elsif v_has_loc and not exists (
      select 1
        from public.locations l
       where l.id = v_loc_open.location_id
         and l.unit_id = p_unit_id
    ) then
      -- Tanpa lokasi baru: pertahankan lokasi yang masih berada di unit baru.
      if v_loc_open.effective_from >= v_effective then
        delete from public.employee_work_location_history where id = v_loc_open.id;
      else
        update public.employee_work_location_history
           set effective_to = v_effective
         where id = v_loc_open.id;
      end if;
    end if;
  else
    if not v_has_loc then
      if p_location_id is not null then
        insert into public.employee_work_location_history
          (employee_id, location_id, effective_from, created_by)
        values
          (p_employee_id, p_location_id, v_effective, p_created_by);
      end if;
    elsif v_loc_open.location_id is distinct from p_location_id then
      if v_loc_open.effective_from >= v_effective then
        if p_location_id is null then
          delete from public.employee_work_location_history where id = v_loc_open.id;
        else
          update public.employee_work_location_history
             set location_id = p_location_id
           where id = v_loc_open.id;
        end if;
      else
        update public.employee_work_location_history
           set effective_to = v_effective
         where id = v_loc_open.id;
        if p_location_id is not null then
          insert into public.employee_work_location_history
            (employee_id, location_id, effective_from, created_by)
          values
            (p_employee_id, p_location_id, v_effective, p_created_by);
        end if;
      end if;
    end if;
  end if;
end;
$function$;

revoke all on function private.reconcile_employee_position_history(uuid, uuid, date, uuid)
  from public, anon, authenticated;
revoke all on function private.reconcile_employee_location_history(uuid, uuid, date, uuid)
  from public, anon, authenticated;
revoke all on function private.reconcile_employee_rate_history(uuid, numeric, date, uuid)
  from public, anon, authenticated;
revoke all on function private.reconcile_employee_unit_and_location(uuid, uuid, uuid, uuid, uuid, date, uuid)
  from public, anon, authenticated;

grant execute on function private.reconcile_employee_position_history(uuid, uuid, date, uuid)
  to postgres;
grant execute on function private.reconcile_employee_location_history(uuid, uuid, date, uuid)
  to postgres;
grant execute on function private.reconcile_employee_rate_history(uuid, numeric, date, uuid)
  to postgres;
grant execute on function private.reconcile_employee_unit_and_location(uuid, uuid, uuid, uuid, uuid, date, uuid)
  to postgres;

create or replace function private.apply_employee_snapshot(p_employee_id uuid, p_contract_id uuid, p_up3_id uuid, p_proposed jsonb, p_effective date)
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

  select id into v_unit from public.organization_units where id=v_unit_id and own_status='Aktif' and ((type='UP3' and id=p_up3_id) or (type='ULP' and parent_id=p_up3_id));
  if not found then raise exception 'Unit di luar scope UP3' using errcode='23514'; end if;

  if v_position_id is not null and not exists (select 1 from public.positions where id=v_position_id and contract_id=p_contract_id and up3_id=p_up3_id and status='Aktif') then
    raise exception 'Jabatan di luar scope kontrak/UP3' using errcode='23514';
  end if;

  if p_proposed->>'location_id' is not null and nullif(p_proposed->>'location_id','') is not null then
    begin v_loc := nullif(p_proposed->>'location_id','')::uuid; exception when others then raise exception 'Lokasi tidak valid' using errcode='22023'; end;
    if not exists (select 1 from public.locations where id=v_loc and contract_id=p_contract_id and up3_id=p_up3_id and unit_id=v_unit_id and own_status='Aktif') then
      raise exception 'Lokasi tidak valid untuk unit ini' using errcode='23514';
    end if;
  else
    v_loc := null;
  end if;

  if v_employee_id is null then
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
    values (v_employee_id, v_emp_status, case when v_emp_status='Aktif' then null else v_status_reason end, case when v_emp_status='Aktif' then null else v_status_note end, case when v_emp_status='Aktif' then p_effective else v_status_eff end, auth.uid());
    insert into public.employee_hourly_rate_history (employee_id, hourly_rate, effective_from, created_by)
    values (v_employee_id, v_rate, p_effective, auth.uid());
  else
    if not exists (select 1 from public.employees where id=v_employee_id) then raise exception 'Pegawai tidak ditemukan' using errcode='22023'; end if;
    if exists (select 1 from public.employees where nip=v_nip and id<>v_employee_id) then raise exception 'NIP sudah digunakan pegawai lain: %', v_nip using errcode='23505'; end if;
    update public.employees set nip=v_nip, name=v_name, birth_date=v_birth, bank=v_bank, account_number=v_account,
      source_position=v_source_pos, retirement_date_override=v_ret_override, pension_override_reason=v_pension_reason,
      employment_type=case when v_has_emp_type then v_emp_type else employment_type end,
      updated_by=auth.uid()
    where id=v_employee_id;

    perform private.reconcile_employee_unit_and_location(
      v_employee_id,
      p_contract_id,
      p_up3_id,
      v_unit_id,
      v_loc,
      p_effective,
      auth.uid()
    );

    perform private.reconcile_employee_position_history(
      v_employee_id,
      v_position_id,
      p_effective,
      auth.uid()
    );

    perform private.reconcile_employee_status_history(
      v_employee_id,
      v_emp_status,
      v_status_reason,
      v_status_note,
      v_status_eff,
      auth.uid()
    );

    perform private.reconcile_employee_rate_history(
      v_employee_id,
      v_rate,
      p_effective,
      auth.uid()
    );
  end if;
  return v_employee_id;
end;
$function$;

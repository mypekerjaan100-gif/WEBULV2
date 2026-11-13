-- Perbaikan riwayat status pegawai:
--   * perubahan hanya pada tanggal efektif nonaktif kini tersimpan;
--   * perubahan hanya pada keterangan/alasan juga tersimpan;
--   * pergantian status pada tanggal yang sama tidak membuat interval nol;
--   * edit lokasi/PKWT/PKWTT tidak lagi menyentuh riwayat status;
--   * tanggal status Aktif yang terbawa snapshot lama tidak dipakai sebagai
--     tanggal penutupan status.
--
-- Constraint yang harus dijaga:
--   emp_status_history_effective_range : effective_to > effective_from
--   ex_emp_status_history_no_overlap   : rentang per pegawai tidak bertumpuk

create or replace function private.reconcile_employee_status_history(
  p_employee_id uuid,
  p_status text,
  p_reason text,
  p_note text,
  p_effective date,
  p_created_by uuid
) returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_reason text := case
    when nullif(btrim(coalesce(p_status, '')), '') = 'Nonaktif'
      then nullif(btrim(coalesce(p_reason, '')), '')
    else null
  end;
  v_note text := case
    when nullif(btrim(coalesce(p_status, '')), '') = 'Nonaktif'
      then nullif(btrim(coalesce(p_note, '')), '')
    else null
  end;
  v_effective date := coalesce(p_effective, current_date);
  v_current public.employee_status_history%rowtype;
  v_previous public.employee_status_history%rowtype;
  v_has_current boolean := false;
  v_has_previous boolean := false;
  v_same_values boolean := false;
begin
  if p_employee_id is null then
    return;
  end if;
  if v_status is null or v_status not in ('Aktif', 'Nonaktif') then
    raise exception 'Status tidak valid' using errcode = '22023';
  end if;
  if v_status = 'Nonaktif' and v_reason is null then
    raise exception 'Alasan Nonaktif wajib diisi' using errcode = '22023';
  end if;

  select *
    into v_current
    from public.employee_status_history
   where employee_id = p_employee_id
     and effective_to is null
   order by effective_from desc, created_at desc
   limit 1;
  v_has_current := found;

  if not v_has_current then
    insert into public.employee_status_history
      (employee_id, status, reason, reason_note, effective_from, created_by)
    values
      (p_employee_id, v_status, v_reason, v_note, v_effective, p_created_by);
    return;
  end if;

  v_same_values := v_current.status = v_status
    and coalesce(v_current.reason, '') = coalesce(v_reason, '')
    and coalesce(v_current.reason_note, '') = coalesce(v_note, '');

  -- Status dan seluruh keterangan sama. Tanggal hanya relevan untuk Nonaktif;
  -- tanggal pada baris Aktif tidak boleh menggeser awal masa aktif.
  if v_same_values and (v_status = 'Aktif' or v_current.effective_from = v_effective) then
    return;
  end if;

  select *
    into v_previous
    from public.employee_status_history
   where employee_id = p_employee_id
     and effective_to is not null
     and effective_from < v_current.effective_from
   order by effective_from desc, created_at desc
   limit 1;
  v_has_previous := found;

  if v_same_values then
    -- Koreksi tanggal status berjalan. Urutan update dijaga agar exclusion
    -- constraint tidak melihat rentang yang bertumpuk di tengah proses.
    if v_has_previous and v_effective <= v_previous.effective_from then
      raise exception 'Tanggal status tidak boleh sebelum awal riwayat status sebelumnya'
        using errcode = '22023';
    end if;
    if v_effective > v_current.effective_from then
      update public.employee_status_history
         set effective_from = v_effective
       where id = v_current.id;
      if v_has_previous then
        update public.employee_status_history
           set effective_to = v_effective
         where id = v_previous.id;
      end if;
    else
      if v_has_previous then
        update public.employee_status_history
           set effective_to = v_effective
         where id = v_previous.id;
      end if;
      update public.employee_status_history
         set effective_from = v_effective
       where id = v_current.id;
    end if;
    return;
  end if;

  if v_effective > v_current.effective_from then
    -- Transisi normal: tutup status berjalan pada tanggal efektif baru.
    update public.employee_status_history
       set effective_to = v_effective
     where id = v_current.id;
    insert into public.employee_status_history
      (employee_id, status, reason, reason_note, effective_from, created_by)
    values
      (p_employee_id, v_status, v_reason, v_note, v_effective, p_created_by);
    return;
  end if;

  if v_effective = v_current.effective_from then
    -- Pergantian pada hari yang sama: perbarui baris yang ada, jangan membuat
    -- rentang nol dengan menutupnya pada tanggal mulai yang sama.
    update public.employee_status_history
       set status = v_status,
           reason = v_reason,
           reason_note = v_note
     where id = v_current.id;
    return;
  end if;

  -- Tanggal efektif lebih awal dari baris berjalan: mundurkan batas akhir
  -- status sebelumnya terlebih dahulu agar tidak tumpang tindih.
  if v_has_previous and v_effective <= v_previous.effective_from then
    raise exception 'Tanggal status tidak boleh sebelum awal riwayat status sebelumnya'
      using errcode = '22023';
  end if;
  if v_has_previous then
    update public.employee_status_history
       set effective_to = v_effective
     where id = v_previous.id;
  end if;
  update public.employee_status_history
     set status = v_status,
         reason = v_reason,
         reason_note = v_note,
         effective_from = v_effective
   where id = v_current.id;
end;
$function$;

revoke all on function private.reconcile_employee_status_history(uuid, text, text, text, date, uuid)
  from public, anon, authenticated;
grant execute on function private.reconcile_employee_status_history(uuid, text, text, text, date, uuid)
  to postgres;

comment on function private.reconcile_employee_status_history(uuid, text, text, text, date, uuid) is
  'Menyimpan status pegawai tanpa membuat interval nol/tumpang tindih; koreksi tanggal hanya untuk status Nonaktif.';

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

    if not exists (select 1 from public.employee_unit_history where employee_id=v_employee_id and effective_to is null and contract_id=p_contract_id and up3_id=p_up3_id and unit_id=v_unit_id) then
      update public.employee_unit_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
      insert into public.employee_unit_history (employee_id, contract_id, up3_id, unit_id, effective_from, created_by)
      values (v_employee_id, p_contract_id, p_up3_id, v_unit_id, p_effective, auth.uid());
      if v_loc is distinct from null then
        update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
        if v_loc is not null then insert into public.employee_work_location_history (employee_id, location_id, effective_from, created_by) values (v_employee_id, v_loc, p_effective, auth.uid()); end if;
      else
        update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null
          and not exists (select 1 from public.locations l where l.id=employee_work_location_history.location_id and l.unit_id=v_unit_id);
      end if;
    else
      if v_loc is distinct from (select location_id from public.employee_work_location_history where employee_id=v_employee_id and effective_to is null) then
        update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
        if v_loc is not null then insert into public.employee_work_location_history (employee_id, location_id, effective_from, created_by) values (v_employee_id, v_loc, p_effective, auth.uid()); end if;
      end if;
    end if;

    if v_position_id is distinct from (select position_id from public.employee_position_history where employee_id=v_employee_id and effective_to is null) then
      if (select count(*) from public.employee_position_history where employee_id=v_employee_id and effective_to is null) > 0 then
        update public.employee_position_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
      end if;
      if v_position_id is not null then insert into public.employee_position_history (employee_id, position_id, effective_from, created_by) values (v_employee_id, v_position_id, p_effective, auth.uid()); end if;
    end if;

    perform private.reconcile_employee_status_history(
      v_employee_id,
      v_emp_status,
      v_status_reason,
      v_status_note,
      v_status_eff,
      auth.uid()
    );

    if v_rate is distinct from (select hourly_rate from public.employee_hourly_rate_history where employee_id=v_employee_id and effective_to is null) then
      update public.employee_hourly_rate_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null;
      insert into public.employee_hourly_rate_history (employee_id, hourly_rate, effective_from, created_by) values (v_employee_id, v_rate, p_effective, auth.uid());
    end if;
  end if;
  return v_employee_id;
end;
$function$;

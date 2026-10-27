-- RPC inspeksi per alat, issue, serah terima pengganti, dan bukti foto.

create or replace function public.ops_tool_age_months(p_from timestamptz, p_to timestamptz)
returns integer
language sql
immutable
as $$
  select case
    when p_from is null or p_to is null then null
    else greatest(0,
      (extract(year from age(p_to, p_from)) * 12
       + extract(month from age(p_to, p_from)))::integer)
  end
$$;

create or replace function public.ops_vehicle_can_manage_plate(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = p_ulp_id
    )
  )
$function$;

-- Nopol tetap wewenang Super Admin dan Admin ULP yang tepat.
create or replace function public.ops_vehicle_can_manage(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.ops_vehicle_can_manage_plate(p_contract_id, p_up3_id, p_ulp_id)
$function$;

create or replace function public.ops_vehicle_can_access(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and (cm.contract_role = 'ADMIN_UP3' or (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_ulp_id))
    )
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.read')
    or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, p_ulp_id)
  )
$function$;

create or replace function public.ops_tool_can_read_scope(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and (cm.contract_role = 'ADMIN_UP3'
          or (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_ulp_id))
    )
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.read')
    or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, p_ulp_id)
  )
$function$;

create or replace function public.ops_tool_can_inspect_scope(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.inspect')
  )
$function$;

create or replace function public.ops_tool_can_resolve_scope(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.issue.resolve')
  )
$function$;

create or replace function public.ops_tool_evidence_parts(p_name text)
returns table (contract_id uuid, up3_id uuid, ulp_id uuid)
language plpgsql
immutable
as $$
declare v_parts text[];
begin
  v_parts := string_to_array(coalesce(p_name, ''), '/');
  if coalesce(array_length(v_parts, 1), 0) < 4 then return; end if;
  begin
    contract_id := v_parts[1]::uuid;
    up3_id := v_parts[2]::uuid;
    ulp_id := v_parts[3]::uuid;
  exception when others then
    return;
  end;
  return next;
end;
$$;

create or replace function public.ops_tool_can_read_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select public.ops_tool_can_read_scope(p.contract_id, p.up3_id, p.ulp_id)
    from public.ops_tool_evidence_parts(p_name) p
    limit 1
  ), false)
$function$;

create or replace function public.ops_tool_can_upload_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select public.ops_tool_can_inspect_scope(p.contract_id, p.up3_id, p.ulp_id)
      or public.ops_tool_can_resolve_scope(p.contract_id, p.up3_id, p.ulp_id)
    from public.ops_tool_evidence_parts(p_name) p
    limit 1
  ), false)
$function$;

drop policy if exists ops_tool_evidence_select on storage.objects;
drop policy if exists ops_tool_evidence_insert on storage.objects;
create policy ops_tool_evidence_select
  on storage.objects for select to authenticated
  using (bucket_id = 'ops-tool-evidence' and public.ops_tool_can_read_evidence_object(name));
create policy ops_tool_evidence_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ops-tool-evidence' and public.ops_tool_can_upload_evidence_object(name));

create or replace function public.ops_validate_tool_photo_paths(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_paths jsonb
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_path text;
  v_prefix text;
begin
  if p_paths is null or jsonb_typeof(p_paths) <> 'array' then
    raise exception 'Minimal satu foto bukti wajib diunggah';
  end if;
  if jsonb_array_length(p_paths) < 1 or jsonb_array_length(p_paths) > 5 then
    raise exception 'Foto bukti harus berjumlah 1 sampai 5';
  end if;
  if exists (select 1 from jsonb_array_elements(p_paths) e where jsonb_typeof(e.value) <> 'string') then
    raise exception 'Path foto bukti tidak valid';
  end if;
  v_prefix := p_contract_id::text || '/' || p_up3_id::text || '/' || p_ulp_id::text || '/';
  for v_path in select jsonb_array_elements_text(p_paths) loop
    if v_path = '' or v_path like '%..%' or v_path not like v_prefix || '%' then
      raise exception 'Foto bukti berada di luar scope ULP ini';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'ops-tool-evidence' and o.name = v_path
    ) then
      raise exception 'Foto bukti tidak ditemukan di penyimpanan';
    end if;
  end loop;
end;
$$;

create or replace function public.ops_submit_tool_inspection(
  p_asset_id uuid,
  p_inspected_at timestamptz,
  p_condition text,
  p_note text,
  p_photo_paths jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.ops_tool_assets;
  v_inspection public.ops_tool_inspections;
  v_issue public.ops_tool_issues;
  v_condition text := upper(btrim(coalesce(p_condition, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_month date;
  v_age integer;
  v_before_life boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_inspected_at is null then raise exception 'Tanggal dan waktu inspeksi wajib diisi'; end if;
  if p_inspected_at > now() then raise exception 'Waktu inspeksi tidak boleh melewati waktu sekarang'; end if;
  if v_condition not in ('GOOD', 'DAMAGED') then raise exception 'Kondisi alat harus Baik atau Rusak'; end if;
  if length(v_note) > 2000 then raise exception 'Catatan inspeksi maksimal 2000 karakter'; end if;

  select * into a from public.ops_tool_assets where id = p_asset_id for update;
  if not found then raise exception 'Alat tidak ditemukan'; end if;
  if not public.ops_tool_can_inspect_scope(a.contract_id, a.up3_id, a.ulp_id) then
    raise exception 'Hanya petugas inspeksi pada ULP ini yang dapat mengisi kondisi alat' using errcode = '42501';
  end if;
  if a.status <> 'ACTIVE' then raise exception 'Alat ini sudah diganti dan tidak dapat diperiksa lagi'; end if;
  if a.commissioned_at is not null and p_inspected_at < a.commissioned_at then
    raise exception 'Waktu inspeksi tidak boleh sebelum waktu serah terima alat';
  end if;
  if exists (
    select 1 from public.ops_tool_issues i
    where i.asset_id = a.id and i.status = 'OPEN'
  ) then
    raise exception 'Masih ada issue terbuka pada alat ini. Selesaikan dengan bukti penggantian terlebih dahulu.';
  end if;

  perform public.ops_validate_tool_photo_paths(a.contract_id, a.up3_id, a.ulp_id, p_photo_paths);
  v_month := date_trunc('month', (p_inspected_at at time zone 'Asia/Pontianak'))::date;

  insert into public.ops_tool_inspections (
    asset_id, contract_id, up3_id, ulp_id, slot_id, equipment_id,
    period_month, inspected_at, condition, note, photo_paths, inspected_by
  ) values (
    a.id, a.contract_id, a.up3_id, a.ulp_id, a.slot_id, a.equipment_id,
    v_month, p_inspected_at, v_condition, v_note, p_photo_paths, auth.uid()
  ) returning * into v_inspection;

  if v_condition = 'DAMAGED' then
    v_age := public.ops_tool_age_months(a.commissioned_at, p_inspected_at);
    v_before_life := case
      when v_age is null or a.useful_life_months is null then null
      else v_age < a.useful_life_months
    end;
    insert into public.ops_tool_issues (
      asset_id, inspection_id, contract_id, up3_id, ulp_id, slot_id, equipment_id,
      status, opened_at, opened_by, note, age_at_failure_months,
      standard_life_months, damaged_before_life
    ) values (
      a.id, v_inspection.id, a.contract_id, a.up3_id, a.ulp_id, a.slot_id, a.equipment_id,
      'OPEN', p_inspected_at, auth.uid(), v_note, v_age,
      a.useful_life_months, v_before_life
    ) returning * into v_issue;
  end if;

  return jsonb_build_object(
    'inspection', to_jsonb(v_inspection),
    'issue', case when v_issue.id is null then null else to_jsonb(v_issue) end
  );
end;
$$;

create or replace function public.ops_resolve_tool_issue(
  p_issue_id uuid,
  p_resolved_at timestamptz,
  p_note text,
  p_photo_paths jsonb,
  p_expected_revision integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  i public.ops_tool_issues;
  a public.ops_tool_assets;
  v_replacement public.ops_tool_assets;
  v_note text := btrim(coalesce(p_note, ''));
  v_seq integer;
  v_age integer;
  v_life integer;
  v_before_life boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_resolved_at is null then raise exception 'Tanggal dan waktu serah terima wajib diisi'; end if;
  if p_resolved_at > now() then raise exception 'Waktu serah terima tidak boleh melewati waktu sekarang'; end if;
  if length(v_note) > 2000 then raise exception 'Catatan penyelesaian maksimal 2000 karakter'; end if;

  select * into i from public.ops_tool_issues where id = p_issue_id for update;
  if not found then raise exception 'Issue tidak ditemukan'; end if;
  if i.status <> 'OPEN' then raise exception 'Issue ini sudah diselesaikan'; end if;
  if i.revision is distinct from p_expected_revision then
    raise exception 'Issue telah berubah; muat ulang data' using errcode = '40001';
  end if;
  if not public.ops_tool_can_resolve_scope(i.contract_id, i.up3_id, i.ulp_id) then
    raise exception 'Hanya petugas inspeksi pada ULP ini yang dapat menyelesaikan issue' using errcode = '42501';
  end if;
  if p_resolved_at < i.opened_at then
    raise exception 'Waktu serah terima tidak boleh sebelum issue dibuka';
  end if;
  perform public.ops_validate_tool_photo_paths(i.contract_id, i.up3_id, i.ulp_id, p_photo_paths);

  select * into a from public.ops_tool_assets where id = i.asset_id for update;
  if not found or a.status <> 'ACTIVE' then raise exception 'Alat yang rusak sudah tidak aktif'; end if;
  v_age := i.age_at_failure_months;
  v_life := coalesce(a.useful_life_months, i.standard_life_months);
  v_before_life := case
    when v_age is null or v_life is null then null
    else v_age < v_life
  end;

  select coalesce(max(asset_sequence), 0) + 1 into v_seq
  from public.ops_tool_assets
  where slot_id = a.slot_id and equipment_id = a.equipment_id;

  insert into public.ops_tool_assets (
    contract_id, up3_id, ulp_id, slot_id, equipment_id,
    equipment_code, equipment_name, equipment_category, equipment_unit,
    specification, asset_sequence, useful_life_months, status,
    commissioned_at, commissioned_by, created_by, updated_by
  ) values (
    a.contract_id, a.up3_id, a.ulp_id, a.slot_id, a.equipment_id,
    a.equipment_code, a.equipment_name, a.equipment_category, a.equipment_unit,
    a.specification, v_seq, v_life, 'ACTIVE',
    p_resolved_at, auth.uid(), auth.uid(), auth.uid()
  ) returning * into v_replacement;

  update public.ops_tool_assets
    set status = 'REPLACED', replaced_at = p_resolved_at, replaced_by = auth.uid()
    where id = a.id;

  update public.ops_tool_issues
    set status = 'RESOLVED', resolved_at = p_resolved_at, resolved_by = auth.uid(),
        resolution_note = v_note, handover_photo_paths = p_photo_paths,
        replacement_asset_id = v_replacement.id,
        age_at_failure_months = v_age, standard_life_months = v_life,
        damaged_before_life = v_before_life, revision = revision + 1
    where id = i.id
    returning * into i;

  return jsonb_build_object('issue', to_jsonb(i), 'replacement_asset', to_jsonb(v_replacement));
end;
$$;

create or replace function public.ops_list_open_tool_issues(p_contract_id uuid, p_up3_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (
    public.auth_is_super_admin()
    or public.ops_can_manage_master(p_contract_id, p_up3_id)
    or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, null)
  ) then
    raise exception 'Tidak berwenang melihat issue alat pada scope ini' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'asset_id', i.asset_id,
    'slot_id', i.slot_id,
    'ulp_id', i.ulp_id,
    'vehicle_label', s.label,
    'plate_display', s.plate_display,
    'equipment_code', a.equipment_code,
    'equipment_name', a.equipment_name,
    'opened_at', i.opened_at,
    'note', i.note,
    'age_at_failure_months', i.age_at_failure_months,
    'standard_life_months', i.standard_life_months,
    'damaged_before_life', i.damaged_before_life
  ) order by i.opened_at, i.id), '[]'::jsonb)
  into v_result
  from public.ops_tool_issues i
  join public.ops_tool_assets a on a.id = i.asset_id
  join public.ops_prescribed_vehicles s on s.id = i.slot_id
  where i.contract_id = p_contract_id
    and i.up3_id = p_up3_id
    and i.status = 'OPEN';
  return v_result;
end;
$$;

create or replace function public.ops_get_tool_inspection_bundle(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_vehicles jsonb := '[]'::jsonb;
  v_assets jsonb;
  v_slot record;
  v_template_name text;
  v_template_version text;
  v_loc text;
  v_loc_type text;
  v_history jsonb;
  v_open jsonb;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if not public.ops_tool_can_read_scope(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Tidak berwenang melihat alat pada ULP ini' using errcode = '42501';
  end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);

  for v_slot in
    select s.* from public.ops_prescribed_vehicles s
    where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.ulp_id = p_ulp_id
      and (
        (s.effective_month <= public.ops_business_today()
          and (s.end_month is null or public.ops_business_today() < s.end_month))
        or exists (
          select 1 from public.ops_tool_issues i
          where i.slot_id = s.id and i.status = 'OPEN'
        )
      )
    order by s.label, s.id
  loop
    select coalesce(t.template_name, ''), coalesce(t.version_number::text, '')
    into v_template_name, v_template_version
    from public.ops_equipment_templates t
    where t.id = v_slot.template_id;
    select l.type,
      (select h.name from public.location_name_history h
       where h.location_id = l.id and h.effective_from <= public.ops_business_today()
         and (h.effective_to is null or h.effective_to > public.ops_business_today())
       order by h.effective_from desc limit 1)
    into v_loc_type, v_loc
    from public.locations l
    where l.id = v_slot.location_id;

    select coalesce(jsonb_agg(asset_row order by category_name, equipment_name, asset_sequence), '[]'::jsonb)
    into v_assets
    from (
      select jsonb_build_object(
        'id', a.id,
        'equipment_id', a.equipment_id,
        'equipment_code', a.equipment_code,
        'equipment_name', a.equipment_name,
        'equipment_category', a.equipment_category,
        'equipment_unit', a.equipment_unit,
        'specification', a.specification,
        'asset_sequence', a.asset_sequence,
        'status', a.status,
        'commissioned_at', a.commissioned_at,
        'useful_life_months', a.useful_life_months,
        'age_months', cal.age_months,
        'remaining_months', case
          when cal.age_months is null or a.useful_life_months is null then null
          else a.useful_life_months - cal.age_months
        end,
        'latest_inspection', (
          select jsonb_build_object(
            'id', i.id, 'inspected_at', i.inspected_at, 'condition', i.condition,
            'note', i.note, 'photo_paths', i.photo_paths,
            'inspected_by', i.inspected_by, 'inspected_by_name', p.display_name
          )
          from public.ops_tool_inspections i
          left join public.profiles p on p.id = i.inspected_by
          where i.asset_id = a.id
          order by i.inspected_at desc, i.created_at desc
          limit 1
        ),
        'open_issue', (
          select jsonb_build_object(
            'id', x.id, 'opened_at', x.opened_at, 'note', x.note,
            'age_at_failure_months', x.age_at_failure_months,
            'standard_life_months', x.standard_life_months,
            'damaged_before_life', x.damaged_before_life,
            'revision', x.revision
          )
          from public.ops_tool_issues x
          where x.asset_id = a.id and x.status = 'OPEN'
          limit 1
        )
      ) as asset_row,
      a.equipment_category as category_name,
      a.equipment_name,
      a.asset_sequence
      from public.ops_tool_assets a
      cross join lateral (
        select public.ops_tool_age_months(a.commissioned_at, now()) as age_months
      ) cal
      where a.slot_id = v_slot.id and a.status = 'ACTIVE'
    ) rows;

    v_vehicles := v_vehicles || jsonb_build_array(jsonb_build_object(
      'id', v_slot.id,
      'label', v_slot.label,
      'plate_display', v_slot.plate_display,
      'plate_normalized', v_slot.plate_normalized,
      'revision', v_slot.revision,
      'template_name', v_template_name,
      'template_version', v_template_version,
      'location_name', v_loc,
      'location_type', v_loc_type,
      'assets', v_assets
    ));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_id', h.id,
    'asset_id', h.asset_id,
    'vehicle_id', h.slot_id,
    'equipment_name', h.equipment_name,
    'opened_at', h.opened_at,
    'resolved_at', h.resolved_at,
    'age_at_failure_months', h.age_at_failure_months,
    'standard_life_months', h.standard_life_months,
    'damaged_before_life', h.damaged_before_life,
    'inspection_photo_paths', h.inspection_photo_paths,
    'resolution_note', h.resolution_note,
    'handover_photo_paths', h.handover_photo_paths,
    'replacement_asset_id', h.replacement_asset_id,
    'resolved_by_name', h.resolved_by_name
  ) order by h.resolved_at desc), '[]'::jsonb)
  into v_history
  from (
    select i.id, i.asset_id, i.slot_id, a.equipment_name, i.opened_at, i.resolved_at,
      i.age_at_failure_months, i.standard_life_months, i.damaged_before_life,
      ins.photo_paths as inspection_photo_paths,
      i.resolution_note, i.handover_photo_paths, i.replacement_asset_id,
      p.display_name as resolved_by_name
    from public.ops_tool_issues i
    join public.ops_tool_assets a on a.id = i.asset_id
    left join public.ops_tool_inspections ins on ins.id = i.inspection_id
    left join public.profiles p on p.id = i.resolved_by
    where i.contract_id = p_contract_id and i.up3_id = p_up3_id and i.ulp_id = p_ulp_id
      and i.status = 'RESOLVED'
    order by i.resolved_at desc
    limit 50
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'asset_id', i.asset_id,
    'vehicle_id', i.slot_id,
    'vehicle_label', s.label,
    'plate_display', s.plate_display,
    'equipment_name', a.equipment_name,
    'opened_at', i.opened_at,
    'note', i.note,
    'age_at_failure_months', i.age_at_failure_months,
    'standard_life_months', i.standard_life_months,
    'damaged_before_life', i.damaged_before_life,
    'revision', i.revision
  ) order by i.opened_at), '[]'::jsonb)
  into v_open
  from public.ops_tool_issues i
  join public.ops_tool_assets a on a.id = i.asset_id
  join public.ops_prescribed_vehicles s on s.id = i.slot_id
  where i.contract_id = p_contract_id and i.up3_id = p_up3_id
    and i.ulp_id = p_ulp_id and i.status = 'OPEN';

  return jsonb_build_object(
    'vehicles', v_vehicles,
    'history', v_history,
    'open_issues', v_open
  );
end;
$$;

-- Alur agregat lama dihentikan; laporan tersimpan tetap dapat dibaca.
create or replace function public.ops_save_vehicle_condition_report(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date,
  p_expected_revision integer, p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'Pemeriksaan agregat telah diganti dengan inspeksi per alat. Gunakan menu Alat & Kendaraan.' using errcode = '0A000';
end;
$$;

create or replace function public.ops_save_vehicle_condition_subset(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date,
  p_vehicle_id uuid, p_expected_revision integer, p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'Pemeriksaan agregat telah diganti dengan inspeksi per alat. Gunakan menu Alat & Kendaraan.' using errcode = '0A000';
end;
$$;

revoke all on function public.ops_tool_can_read_scope(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_tool_can_inspect_scope(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_tool_can_resolve_scope(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_tool_evidence_parts(text) from public, anon;
revoke all on function public.ops_tool_can_read_evidence_object(text) from public, anon;
revoke all on function public.ops_tool_can_upload_evidence_object(text) from public, anon;
revoke all on function public.ops_validate_tool_photo_paths(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.ops_submit_tool_inspection(uuid, timestamptz, text, text, jsonb) from public, anon;
revoke all on function public.ops_resolve_tool_issue(uuid, timestamptz, text, jsonb, integer) from public, anon;
revoke all on function public.ops_list_open_tool_issues(uuid, uuid) from public, anon;
revoke all on function public.ops_get_tool_inspection_bundle(uuid, uuid, uuid) from public, anon;
grant execute on function public.ops_tool_can_read_scope(uuid, uuid, uuid) to authenticated;
grant execute on function public.ops_tool_can_inspect_scope(uuid, uuid, uuid) to authenticated;
grant execute on function public.ops_tool_can_resolve_scope(uuid, uuid, uuid) to authenticated;
grant execute on function public.ops_tool_evidence_parts(text) to authenticated;
grant execute on function public.ops_tool_can_read_evidence_object(text) to authenticated;
grant execute on function public.ops_tool_can_upload_evidence_object(text) to authenticated;
grant execute on function public.ops_validate_tool_photo_paths(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.ops_submit_tool_inspection(uuid, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.ops_resolve_tool_issue(uuid, timestamptz, text, jsonb, integer) to authenticated;
grant execute on function public.ops_list_open_tool_issues(uuid, uuid) to authenticated;
grant execute on function public.ops_get_tool_inspection_bundle(uuid, uuid, uuid) to authenticated;

-- Route open tool issues to the ULP coordinator. K3 retains issue detail on
-- its own ULP assets so it can complete the replacement handover.

create or replace function public.ops_tool_can_view_issue_scope(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.contract_memberships cm
    join public.authorization_roles r
      on r.code = cm.contract_role
     and r.role_namespace = 'CONTRACT'
     and r.is_custom
     and r.is_active
     and r.role_level = 'ULP'
    join public.authorization_role_permissions rp on rp.role_id = r.id
    join public.authorization_permissions p on p.id = rp.permission_id
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and cm.operational_unit_id = p_ulp_id
      and r.code in ('CUSTOM_K3', 'CUSTOM_KOORDINATOR_ULP')
      and p.code = 'alat.read'
  )
$$;

revoke all on function public.ops_tool_can_view_issue_scope(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.ops_tool_can_verify_issue_scope(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.contract_memberships cm
    join public.authorization_roles r
      on r.code = cm.contract_role
     and r.role_namespace = 'CONTRACT'
     and r.is_custom
     and r.is_active
     and r.role_level = 'ULP'
    join public.authorization_role_permissions rp on rp.role_id = r.id
    join public.authorization_permissions p on p.id = rp.permission_id
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and cm.operational_unit_id is not null
      and (p_ulp_id is null or cm.operational_unit_id = p_ulp_id)
      and r.code = 'CUSTOM_KOORDINATOR_ULP'
      and p.code = 'alat.issue.verify'
  )
$$;

revoke all on function public.ops_tool_can_verify_issue_scope(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

-- Grant read/verification to the existing ULP coordinator role and remove the
-- former Area Coordinator grant. Keep this permission when the role is saved.
delete from public.authorization_role_permissions rp
using public.authorization_roles r, public.authorization_permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code = 'CUSTOM_KOORDINATOR_AREA'
  and p.code = 'alat.issue.verify';

-- Keep the existing ULP coordinator role read-only. It verifies replacement
-- handover; K3 retains inspection and resolution permissions.
update public.authorization_roles
set menu_access = jsonb_set(coalesce(menu_access, '{}'::jsonb), '{alat_kendaraan}', '"read"'::jsonb),
    revision = revision + 1,
    updated_at = now()
where code = 'CUSTOM_KOORDINATOR_ULP'
  and role_namespace = 'CONTRACT'
  and is_custom
  and is_active
  and role_level = 'ULP'
  and menu_access ->> 'alat_kendaraan' is distinct from 'read';

delete from public.authorization_role_permissions rp
using public.authorization_roles r, public.authorization_permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code = 'CUSTOM_KOORDINATOR_ULP'
  and r.role_namespace = 'CONTRACT'
  and r.is_custom
  and r.role_level = 'ULP'
  and p.code in ('alat.inspect', 'alat.issue.resolve', 'alat.manage');

insert into public.authorization_role_permissions (role_id, permission_id)
select r.id, p.id
from public.authorization_roles r
join public.authorization_permissions p on p.code in ('alat.read', 'alat.issue.verify')
where r.code = 'CUSTOM_KOORDINATOR_ULP'
  and r.role_namespace = 'CONTRACT'
  and r.is_custom
  and r.is_active
  and r.role_level = 'ULP'
  and r.menu_access ->> 'alat_kendaraan' in ('read', 'edit')
on conflict do nothing;

create function pg_temp.replace_definition(target regprocedure, old_text text, new_text text)
returns void language plpgsql as $$
declare source text := pg_get_functiondef(target);
begin
  if position(old_text in source) = 0 then
    raise exception 'Unexpected definition: %', target;
  end if;
  execute replace(source, old_text, new_text);
end $$;

-- The legacy UP3 role used the `verify` menu level to receive this permission.
-- Do not let saves on that role restore issue verification.
select pg_temp.replace_definition(
  'public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  'if v_value = ''verify'' then
    insert into public.authorization_role_permissions(role_id,permission_id)
    select v_role.id,id from public.authorization_permissions where code=''alat.issue.verify'' on conflict do nothing;
  end if;
  if v_value = ''edit'' then',
  'if v_value = ''verify'' and v_role.code = ''CUSTOM_KOORDINATOR_ULP'' and v_role.role_level = ''ULP'' then
     insert into public.authorization_role_permissions(role_id,permission_id)
     select v_role.id,id from public.authorization_permissions where code=''alat.issue.verify'' on conflict do nothing;
   end if;
   if v_value = ''edit'' then'
);

select pg_temp.replace_definition(
  'public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  'if v_value is null or v_value not in (''none'', ''read'', ''edit'', ''verify'') then',
  'if v_role.code = ''CUSTOM_KOORDINATOR_ULP'' and v_role.role_level = ''ULP''
     and v_key = ''alat_kendaraan'' and v_value = ''edit'' then
     raise exception ''Koordinator ULP hanya dapat melihat issue dan memverifikasi'';
   end if;
   if v_value is null or v_value not in (''none'', ''read'', ''edit'', ''verify'') then'
);

select pg_temp.replace_definition(
  'public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  '  insert into public.authorization_audit_events (',
  '  if v_role.code = ''CUSTOM_KOORDINATOR_ULP''
     and v_role.role_level = ''ULP''
     and v_role.menu_access ->> ''alat_kendaraan'' in (''read'', ''edit'') then
     insert into public.authorization_role_permissions(role_id,permission_id)
     select v_role.id,id from public.authorization_permissions where code=''alat.issue.verify'' on conflict do nothing;
   end if;
   insert into public.authorization_audit_events ('
);

create or replace function public.ops_tool_issues_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Tool issues cannot be deleted'; end if;
  if old.status <> 'OPEN' then raise exception 'Closed issues are immutable'; end if;
  if new.status = 'OPEN' then
    if auth.uid() is null
      or not public.ops_tool_can_verify_issue_scope(old.contract_id, old.up3_id, old.ulp_id) then
      raise exception 'Hanya Koordinator ULP yang dapat memverifikasi' using errcode = '42501';
    end if;
    if old.handover_verified_at is not null or new.handover_verified_at is null
      or new.handover_verified_by is distinct from auth.uid()
      or new.handover_verified_at > now() or new.handover_verified_at < old.opened_at then
      raise exception 'Verifikasi tidak valid atau sudah dilakukan';
    end if;
    if (to_jsonb(new) - array['handover_verified_at','handover_verified_by','handover_verification_recorded_at','revision','updated_at'])
      is distinct from (to_jsonb(old) - array['handover_verified_at','handover_verified_by','handover_verification_recorded_at','revision','updated_at']) then
      raise exception 'Verifikasi hanya mengubah bukti penyerahan';
    end if;
    new.handover_verification_recorded_at := now();
  elsif new.status = 'RESOLVED' then
    if old.handover_verified_at is null then
      raise exception 'Menunggu verifikasi penyerahan oleh Koordinator ULP';
    end if;
    if new.resolved_at < old.handover_verified_at then
      raise exception 'Serah terima pengganti tidak boleh sebelum verifikasi';
    end if;
    if (to_jsonb(new) - array['status','resolved_at','resolved_by','resolution_note','handover_photo_paths','replacement_asset_id','age_at_failure_months','standard_life_months','damaged_before_life','revision','updated_at'])
      is distinct from (to_jsonb(old) - array['status','resolved_at','resolved_by','resolution_note','handover_photo_paths','replacement_asset_id','age_at_failure_months','standard_life_months','damaged_before_life','revision','updated_at']) then
      raise exception 'Issue identity and verification are immutable';
    end if;
  else
    raise exception 'Invalid issue transition';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.ops_verify_tool_issue_handover(
  p_issue_id uuid, p_verified_at timestamptz, p_expected_revision integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare i public.ops_tool_issues;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into i from public.ops_tool_issues where id = p_issue_id for update;
  if not found
    or not public.ops_tool_can_verify_issue_scope(i.contract_id, i.up3_id, i.ulp_id) then
    raise exception 'Tidak berwenang memverifikasi issue ini' using errcode = '42501';
  end if;
  if i.revision is distinct from p_expected_revision then raise exception 'Issue berubah; muat ulang' using errcode = '40001'; end if;
  if p_verified_at is null or not isfinite(p_verified_at) then raise exception 'Waktu verifikasi wajib diisi'; end if;
  update public.ops_tool_issues
    set handover_verified_at = p_verified_at, handover_verified_by = auth.uid()
    where id = i.id returning * into i;
  return to_jsonb(i);
end
$$;

revoke all on function public.ops_verify_tool_issue_handover(uuid,timestamptz,integer) from public, anon;
grant execute on function public.ops_verify_tool_issue_handover(uuid,timestamptz,integer) to authenticated;

create or replace function public.ops_list_open_tool_issues(p_contract_id uuid, p_up3_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null
    or not public.ops_tool_can_verify_issue_scope(p_contract_id, p_up3_id, null) then
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
    'damaged_before_life', i.damaged_before_life,
    'revision', i.revision,
    'handover_verified_at', i.handover_verified_at,
    'handover_verified_by', i.handover_verified_by,
    'handover_verified_by_name', (select p.display_name from public.profiles p where p.id = i.handover_verified_by)
  ) order by i.opened_at, i.id), '[]'::jsonb)
  into v_result
  from public.ops_tool_issues i
  join public.ops_tool_assets a on a.id = i.asset_id
  join public.ops_prescribed_vehicles s on s.id = i.slot_id
  where i.contract_id = p_contract_id
    and i.up3_id = p_up3_id
    and i.status = 'OPEN'
    and public.ops_tool_can_verify_issue_scope(i.contract_id, i.up3_id, i.ulp_id);
  return v_result;
end
$$;

revoke all on function public.ops_list_open_tool_issues(uuid,uuid) from public, anon;
grant execute on function public.ops_list_open_tool_issues(uuid,uuid) to authenticated;

-- Preserve the current bundle implementation and filter its issue payload in a
-- wrapper. The legacy implementation already applies the vehicle/ULP scope.
alter function public.ops_get_tool_inspection_bundle(uuid,uuid,uuid)
  rename to ops_get_tool_inspection_bundle_before_ulp_scope;
revoke all on function public.ops_get_tool_inspection_bundle_before_ulp_scope(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.ops_get_tool_inspection_bundle(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b jsonb;
  v jsonb;
  a jsonb;
  vehicles jsonb := '[]'::jsonb;
  assets jsonb;
  metadata jsonb;
  history jsonb := '[]'::jsonb;
  h jsonb;
  can_view_issues boolean;
  can_verify_issues boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  can_view_issues := public.ops_tool_can_view_issue_scope(p_contract_id, p_up3_id, p_ulp_id);
  can_verify_issues := public.ops_tool_can_verify_issue_scope(p_contract_id, p_up3_id, p_ulp_id);
  b := public.ops_get_tool_inspection_bundle_before_ulp_scope(p_contract_id, p_up3_id, p_ulp_id);

  for v in select value from jsonb_array_elements(b -> 'vehicles') loop
    assets := '[]'::jsonb;
    for a in select value from jsonb_array_elements(v -> 'assets') loop
      if not can_view_issues then
        a := a - 'open_issue' - 'handover';
      elsif a -> 'open_issue' <> 'null'::jsonb then
          select jsonb_build_object(
            'handover_verified_at', i.handover_verified_at,
            'handover_verified_by', i.handover_verified_by
          )
          into metadata
          from public.ops_tool_issues i
          where i.id = (a -> 'open_issue' ->> 'id')::uuid;
          a := jsonb_set(a, '{open_issue}', (a -> 'open_issue') || coalesce(metadata, '{}'::jsonb));
      end if;
      assets := assets || jsonb_build_array(a);
    end loop;
    vehicles := vehicles || jsonb_build_array(jsonb_set(v, '{assets}', assets));
  end loop;

  if can_view_issues then
    for h in select value from jsonb_array_elements(b -> 'history') loop
      select jsonb_build_object(
        'handover_verified_at', i.handover_verified_at,
        'handover_verified_by_name', p.display_name
      )
      into metadata
      from public.ops_tool_issues i
      left join public.profiles p on p.id = i.handover_verified_by
      where i.id = (h ->> 'issue_id')::uuid;
      history := history || jsonb_build_array(h || coalesce(metadata, '{}'::jsonb));
    end loop;
  else
    b := b - 'history';
  end if;

  if not can_verify_issues then
    b := b - 'open_issues';
  end if;
  return b || jsonb_build_object('vehicles', vehicles, 'history', history);
end
$$;

revoke all on function public.ops_get_tool_inspection_bundle(uuid,uuid,uuid) from public, anon;
grant execute on function public.ops_get_tool_inspection_bundle(uuid,uuid,uuid) to authenticated;

select pg_temp.replace_definition(
  'public.ops_resolve_tool_issue(uuid,timestamptz,text,jsonb,integer)',
  'Menunggu verifikasi penyerahan oleh Koordinator Area',
  'Menunggu verifikasi penyerahan oleh Koordinator ULP'
);

notify pgrst, 'reload schema';

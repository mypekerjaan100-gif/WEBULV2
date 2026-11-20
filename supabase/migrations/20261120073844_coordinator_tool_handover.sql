-- Extend existing checked RPCs without changing prior inspection/replacement history.
create function pg_temp.replace_definition(target regprocedure, old_text text, new_text text)
returns void language plpgsql as $$
declare source text := pg_get_functiondef(target);
begin
  if position(old_text in source)=0 then raise exception 'Unexpected definition: %', target; end if;
  execute replace(source,old_text,new_text);
end $$;

insert into public.authorization_permissions(code,description)
values ('alat.issue.verify','Verify damaged equipment handover to K3') on conflict do nothing;

select pg_temp.replace_definition('public.validate_contract_membership_role()',
  'v_level is distinct from ''ULP''', 'coalesce(v_level, '''') not in (''ULP'', ''UP3'')');
select pg_temp.replace_definition('public.validate_contract_membership_role()',
  'if new.operational_unit_id is null then',
  'if v_level = ''UP3'' then
    if new.operational_unit_id is not null then raise exception ''Custom UP3 role must not have ULP''; end if;
    return new;
  end if;
  if new.operational_unit_id is null then');
select pg_temp.replace_definition('public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid)',
  'v_role_level is distinct from ''ULP''', 'coalesce(v_role_level, '''') not in (''ULP'', ''UP3'')');
select pg_temp.replace_definition('public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid)',
  '(v_is_custom or p_role = ''ADMIN_ULP'')', '((v_is_custom and v_role_level = ''ULP'') or p_role = ''ADMIN_ULP'')');
select pg_temp.replace_definition('public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid)',
  'if p_role = ''ADMIN_UP3'' and p_unit_id is not null then',
  'if (p_role = ''ADMIN_UP3'' or (v_is_custom and v_role_level = ''UP3'')) and p_unit_id is not null then');

select pg_temp.replace_definition('public.auth_custom_has_permission(uuid,uuid,uuid,text)',
  'and r.role_level = ''ULP''', 'and r.role_level in (''ULP'', ''UP3'')');
select pg_temp.replace_definition('public.auth_custom_has_permission(uuid,uuid,uuid,text)',
  '(p_unit_id is null or cm.operational_unit_id = p_unit_id)',
  '(p_unit_id is null or cm.operational_unit_id = p_unit_id or
    (r.role_level = ''UP3'' and cm.operational_unit_id is null and exists
      (select 1 from public.organization_units u where u.id=p_unit_id and u.type=''ULP'' and u.parent_id=p_up3_id)))');
select pg_temp.replace_definition('public.auth_is_custom_contract_role(uuid,uuid,uuid)',
  '(p_unit_id is null or cm.operational_unit_id = p_unit_id)',
  '(p_unit_id is null or cm.operational_unit_id = p_unit_id or
    (r.role_level = ''UP3'' and cm.operational_unit_id is null and exists
      (select 1 from public.organization_units u where u.id=p_unit_id and u.type=''ULP'' and u.parent_id=p_up3_id)))');

select pg_temp.replace_definition('public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  'if v_level <> ''ULP'' then', 'if v_level not in (''ULP'', ''UP3'') then');
select pg_temp.replace_definition('public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  'v_before := jsonb_build_object',
  'if v_role.role_level is distinct from v_level and exists
    (select 1 from public.contract_memberships where contract_role=v_role.code) then
    raise exception ''Cakupan role yang sudah ditugaskan tidak dapat diubah'';
  end if;
  v_before := jsonb_build_object');
select pg_temp.replace_definition('public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  'if v_value not in (''none'', ''read'', ''edit'') then',
  'if v_level = ''UP3'' and v_value <> ''none'' and (v_key <> ''alat_kendaraan'' or v_value not in (''read'', ''verify'')) then
    raise exception ''Role custom UP3 hanya mendukung lihat/verifikasi Alat & Kendaraan'';
  end if;
  if v_value = ''verify'' and (v_key <> ''alat_kendaraan'' or v_level <> ''UP3'') then
    raise exception ''Verifikasi hanya untuk Alat & Kendaraan cakupan UP3'';
  end if;
  if v_value is null or v_value not in (''none'', ''read'', ''edit'', ''verify'') then');
select pg_temp.replace_definition('public.save_custom_role(uuid,text,text,text,text,jsonb,integer)',
  'if v_value = ''edit'' then',
  'if v_value = ''verify'' then
    insert into public.authorization_role_permissions(role_id,permission_id)
    select v_role.id,id from public.authorization_permissions where code=''alat.issue.verify'' on conflict do nothing;
  end if;
  if v_value = ''edit'' then');

alter table public.ops_tool_issues
  add column handover_verified_at timestamptz,
  add column handover_verified_by uuid references auth.users(id),
  add column handover_verification_recorded_at timestamptz,
  add constraint tool_verification_complete check (
    (handover_verified_at is null and handover_verified_by is null and handover_verification_recorded_at is null)
    or (handover_verified_at is not null and handover_verified_by is not null and handover_verification_recorded_at is not null
      and isfinite(handover_verified_at) and handover_verified_at >= opened_at
      and handover_verified_at <= handover_verification_recorded_at));
create index ops_tool_issues_verifier on public.ops_tool_issues(handover_verified_by) where handover_verified_by is not null;

create or replace function public.ops_tool_issues_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'Tool issues cannot be deleted'; end if;
  if old.status <> 'OPEN' then raise exception 'Closed issues are immutable'; end if;
  if new.status='OPEN' then
    if auth.uid() is null or not (public.auth_is_super_admin()
      or public.auth_custom_has_permission(old.contract_id,old.up3_id,old.ulp_id,'alat.issue.verify')) then
      raise exception 'Hanya Koordinator Area dapat memverifikasi' using errcode='42501';
    end if;
    if old.handover_verified_at is not null or new.handover_verified_at is null
      or new.handover_verified_by is distinct from auth.uid()
      or new.handover_verified_at > now() or new.handover_verified_at < old.opened_at then
      raise exception 'Verifikasi tidak valid atau sudah dilakukan';
    end if;
    if (to_jsonb(new)-array['handover_verified_at','handover_verified_by','handover_verification_recorded_at','revision','updated_at'])
      is distinct from (to_jsonb(old)-array['handover_verified_at','handover_verified_by','handover_verification_recorded_at','revision','updated_at']) then
      raise exception 'Verifikasi hanya mengubah bukti penyerahan';
    end if;
    new.handover_verification_recorded_at:=now();
  elsif new.status='RESOLVED' then
    if old.handover_verified_at is null then raise exception 'Menunggu verifikasi penyerahan oleh Koordinator Area'; end if;
    if new.resolved_at < old.handover_verified_at then raise exception 'Serah terima pengganti tidak boleh sebelum verifikasi'; end if;
    if (to_jsonb(new)-array['status','resolved_at','resolved_by','resolution_note','handover_photo_paths','replacement_asset_id','age_at_failure_months','standard_life_months','damaged_before_life','revision','updated_at'])
      is distinct from (to_jsonb(old)-array['status','resolved_at','resolved_by','resolution_note','handover_photo_paths','replacement_asset_id','age_at_failure_months','standard_life_months','damaged_before_life','revision','updated_at']) then
      raise exception 'Issue identity and verification are immutable';
    end if;
  else raise exception 'Invalid issue transition'; end if;
  new.revision:=old.revision+1; new.updated_at:=now(); return new;
end $$;

-- Existing application uses checked definer RPCs with no direct table access.
create function public.ops_verify_tool_issue_handover(p_issue_id uuid,p_verified_at timestamptz,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.ops_tool_issues;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into i from public.ops_tool_issues where id=p_issue_id for update;
  if not found or not (public.auth_is_super_admin()
    or public.auth_custom_has_permission(i.contract_id,i.up3_id,i.ulp_id,'alat.issue.verify')) then
    raise exception 'Tidak berwenang memverifikasi issue ini' using errcode='42501';
  end if;
  if i.revision is distinct from p_expected_revision then raise exception 'Issue berubah; muat ulang' using errcode='40001'; end if;
  if p_verified_at is null or not isfinite(p_verified_at) then raise exception 'Waktu verifikasi wajib diisi'; end if;
  update public.ops_tool_issues set handover_verified_at=p_verified_at,handover_verified_by=auth.uid()
    where id=i.id returning * into i;
  return to_jsonb(i);
end $$;
revoke all on function public.ops_verify_tool_issue_handover(uuid,timestamptz,integer) from public,anon;
grant execute on function public.ops_verify_tool_issue_handover(uuid,timestamptz,integer) to authenticated;

select pg_temp.replace_definition('public.ops_resolve_tool_issue(uuid,timestamptz,text,jsonb,integer)',
  'if p_resolved_at < i.opened_at then',
  'if i.handover_verified_at is null then raise exception ''Menunggu verifikasi penyerahan oleh Koordinator Area''; end if;
  if p_resolved_at < i.handover_verified_at then raise exception ''Serah terima pengganti tidak boleh sebelum verifikasi''; end if;
  if p_resolved_at < i.opened_at then');

select pg_temp.replace_definition('public.ops_list_open_tool_issues(uuid,uuid)',
  'or public.ops_can_manage_master(p_contract_id, p_up3_id)',
  'or public.ops_can_manage_master(p_contract_id, p_up3_id)
    or public.auth_custom_has_permission(p_contract_id,p_up3_id,null,''alat.issue.verify'')');
select pg_temp.replace_definition('public.ops_list_open_tool_issues(uuid,uuid)',
  '''asset_id'', i.asset_id,',
  '''asset_id'', i.asset_id, ''revision'', i.revision,
    ''handover_verified_at'', i.handover_verified_at,
    ''handover_verified_by'', i.handover_verified_by,
    ''handover_verified_by_name'', (select display_name from public.profiles where id=i.handover_verified_by),');
-- Enrich active unit issues and history without duplicating the underlying bundle logic.
select pg_temp.replace_definition('public.ops_list_vehicle_condition_overview(uuid,uuid,date)',
  'perform public.ops_prescribed_assert_scope(p_contract_id,p_up3_id,null);',
  'if not (public.auth_custom_has_permission(p_contract_id,p_up3_id,null,''alat.read'') and exists (
    select 1 from public.contract_memberships cm join public.authorization_roles r on r.code=cm.contract_role and r.role_namespace=''CONTRACT''
    where cm.user_id=auth.uid() and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id
      and cm.operational_unit_id is null and cm.status=''ACTIVE'' and r.is_custom and r.role_level=''UP3''
  )) then perform public.ops_prescribed_assert_scope(p_contract_id,p_up3_id,null); end if;');
alter function public.ops_get_tool_inspection_bundle(uuid,uuid,uuid) rename to ops_get_tool_inspection_bundle_before_verification;
revoke all on function public.ops_get_tool_inspection_bundle_before_verification(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.ops_get_tool_inspection_bundle(p_contract_id uuid,p_up3_id uuid,p_ulp_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b jsonb; v jsonb; a jsonb; vehicles jsonb:='[]'; assets jsonb; metadata jsonb; history jsonb:='[]'; h jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  b:=public.ops_get_tool_inspection_bundle_before_verification(p_contract_id,p_up3_id,p_ulp_id);
  for v in select value from jsonb_array_elements(b->'vehicles') loop
    assets:='[]';
    for a in select value from jsonb_array_elements(v->'assets') loop
      if a->'open_issue' <> 'null'::jsonb then
        select jsonb_build_object('handover_verified_at',i.handover_verified_at,'handover_verified_by',i.handover_verified_by)
        into metadata from public.ops_tool_issues i where i.id=(a->'open_issue'->>'id')::uuid;
        a:=jsonb_set(a,'{open_issue}',(a->'open_issue')||metadata);
      end if;
      assets:=assets||jsonb_build_array(a);
    end loop;
    vehicles:=vehicles||jsonb_build_array(jsonb_set(v,'{assets}',assets));
  end loop;
  for h in select value from jsonb_array_elements(b->'history') loop
    select jsonb_build_object('handover_verified_at',i.handover_verified_at,'handover_verified_by_name',p.display_name)
    into metadata from public.ops_tool_issues i left join public.profiles p on p.id=i.handover_verified_by where i.id=(h->>'issue_id')::uuid;
    history:=history||jsonb_build_array(h||metadata);
  end loop;
  return b||jsonb_build_object('vehicles',vehicles,'history',history);
end $$;
revoke all on function public.ops_get_tool_inspection_bundle(uuid,uuid,uuid) from public,anon;
grant execute on function public.ops_get_tool_inspection_bundle(uuid,uuid,uuid) to authenticated;

do $$
declare r public.authorization_roles;
begin
  select * into r from public.authorization_roles
    where code='CUSTOM_KOORDINATOR_AREA' and role_namespace='CONTRACT' for update;
  if not found then
    insert into public.authorization_roles(role_namespace,code,display_name,description,is_custom,is_active,
      role_level,menu_access,revision,created_by,updated_by,updated_at)
    values('CONTRACT','CUSTOM_KOORDINATOR_AREA','KOORDINATOR AREA','',true,true,'UP3',
      jsonb_build_object('sla','none','lembur','none','variable_cost','none','alat_kendaraan','verify'),
      1,null,null,now())
    returning * into r;
  else
    if exists(select 1 from public.contract_memberships where contract_role=r.code) then
      raise exception 'Role already assigned; review scope first';
    end if;
    update public.authorization_roles set role_level='UP3',
      menu_access=jsonb_build_object('sla','none','lembur','none','variable_cost','none','alat_kendaraan','verify'),
      revision=revision+1,updated_at=now()
      where id=r.id returning * into r;
  end if;
  delete from public.authorization_role_permissions where role_id=r.id;
  insert into public.authorization_role_permissions(role_id,permission_id)
    select r.id,id from public.authorization_permissions where code in ('alat.read','alat.issue.verify');
end $$;
notify pgrst,'reload schema';

-- Run after migration, inside a rollback-only transaction. No storage writes.
create function pg_temp.expect_failure(command text, expected text) returns void language plpgsql as $$
declare message text;
begin
  begin execute command; exception when others then
    get stacked diagnostics message=message_text;
    if position(expected in message)=0 then raise exception 'Wrong error: % (expected %)',message,expected; end if;
    return;
  end;
  raise exception 'Expected rejection: %',command;
end $$;

do $$
declare a public.ops_tool_assets; i public.ops_tool_issues; inspection uuid; actor uuid; coordinator uuid; admin_id uuid;
  photo text; result jsonb; c uuid; u uuid; unit_id uuid; role_row public.authorization_roles; verified timestamptz:=now()-interval '1 minute';
begin
  select s.user_id into admin_id from public.system_role_memberships s join public.authorization_roles r on r.id=s.role_id
    where r.code='SUPER_ADMIN' and s.status='ACTIVE' limit 1;
  select x.* into a from public.ops_tool_assets x where x.status='ACTIVE'
    and exists(select 1 from public.contract_memberships m where m.contract_role='CUSTOM_K3' and m.status='ACTIVE' and m.operational_unit_id=x.ulp_id)
    and exists(select 1 from storage.objects o where o.bucket_id='ops-tool-evidence' and split_part(o.name,'/',3)=x.ulp_id::text) limit 1;
  if a.id is null or admin_id is null then raise exception 'Fixture requires active K3, admin and existing evidence'; end if;
  c:=a.contract_id; u:=a.up3_id; unit_id:=a.ulp_id;
  select m.user_id into actor from public.contract_memberships m where m.contract_role='CUSTOM_K3' and m.status='ACTIVE' and m.operational_unit_id=a.ulp_id limit 1;
  select m.user_id into coordinator from public.contract_memberships m where m.contract_role='CUSTOM_K3' and m.status='ACTIVE' and m.user_id<>actor limit 1;
  if coordinator is null then raise exception 'Fixture requires second K3 account'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  select * into role_row from public.authorization_roles where code='CUSTOM_KOORDINATOR_AREA';
  perform public.save_custom_role(role_row.id,role_row.code,role_row.display_name,'','UP3',role_row.menu_access,role_row.revision);
  perform pg_temp.expect_failure(format('select public.save_custom_role(null,''TEST_COORDINATOR'',''test'','''',''ULP'',%L::jsonb,null)', '{"alat_kendaraan":"verify"}'),'Verifikasi hanya');
  perform pg_temp.expect_failure(format('select public.save_custom_role(null,''TEST_COORDINATOR'',''test'','''',''UP3'',%L::jsonb,null)', '{"alat_kendaraan":"edit"}'),'hanya mendukung');
  perform public.admin_set_user_access(coordinator,'CUSTOM_KOORDINATOR_AREA',null,c,u,null,admin_id);
  perform pg_temp.expect_failure(format('select public.admin_set_user_access(%L,''CUSTOM_KOORDINATOR_AREA'',null,%L,%L,%L,%L)',coordinator,c,u,unit_id,admin_id),'must not have unit');
  select name into photo from storage.objects where bucket_id='ops-tool-evidence' and split_part(name,'/',3)=unit_id::text limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.ops_tool_assets(contract_id,up3_id,ulp_id,slot_id,equipment_id,equipment_code,equipment_name,equipment_category,equipment_unit,specification,asset_sequence,status,created_by,updated_by)
    values(c,u,unit_id,a.slot_id,a.equipment_id,a.equipment_code,'TEST rollback coordinator',a.equipment_category,a.equipment_unit,a.specification,100000,'ACTIVE',actor,actor) returning * into a;
  result:=public.ops_submit_tool_inspection(a.id,now()-interval '2 minutes','DAMAGED','Rollback test',jsonb_build_array(photo));
  select * into i from public.ops_tool_issues where id=(result->'issue'->>'id')::uuid;
  perform pg_temp.expect_failure(format('select public.ops_resolve_tool_issue(%L,now(),''test'',%L::jsonb,1)',i.id,jsonb_build_array(photo)), 'Menunggu verifikasi');
  perform pg_temp.expect_failure(format('select public.ops_verify_tool_issue_handover(%L,now(),1)',i.id),'Tidak berwenang');
  perform set_config('request.jwt.claim.sub',coordinator::text,true);
  if not public.auth_custom_has_permission(c,u,unit_id,'alat.read') then raise exception 'Coordinator missing cross ULP read'; end if;
  if public.auth_custom_has_permission(c,u,gen_random_uuid(),'alat.read') then raise exception 'Foreign unit read allowed'; end if;
  if public.auth_custom_has_permission(c,gen_random_uuid(),unit_id,'alat.read') then raise exception 'Foreign UP3 allowed'; end if;
  if public.ops_tool_can_inspect_scope(c,u,unit_id) or public.ops_tool_can_resolve_scope(c,u,unit_id) then raise exception 'Coordinator has K3 permission'; end if;
  perform public.ops_list_vehicle_condition_overview(c,u,date_trunc('month',current_date)::date);
  perform public.ops_get_tool_inspection_bundle(c,u,unit_id);
  perform pg_temp.expect_failure(format('select public.ops_verify_tool_issue_handover(%L,now()+interval ''1 day'',1)',i.id),'Verifikasi tidak valid');
  perform pg_temp.expect_failure(format('select public.ops_verify_tool_issue_handover(%L,now()-interval ''1 day'',1)',i.id),'Verifikasi tidak valid');
  perform pg_temp.expect_failure(format('select public.ops_verify_tool_issue_handover(%L,now(),999)',i.id),'Issue berubah');
  result:=public.ops_verify_tool_issue_handover(i.id,verified,1);
  if result->>'status'<>'OPEN' or (result->>'handover_verified_by')::uuid<>coordinator or (result->>'revision')::int<>2 then raise exception 'Invalid verification result'; end if;
  perform pg_temp.expect_failure(format('select public.ops_verify_tool_issue_handover(%L,now(),2)',i.id),'Verifikasi tidak valid');
  perform pg_temp.expect_failure(format('select public.ops_resolve_tool_issue(%L,now(),''test'',%L::jsonb,2)',i.id,jsonb_build_array(photo)), 'Hanya petugas inspeksi');
  if not exists(select 1 from jsonb_array_elements(public.ops_list_open_tool_issues(c,u)) x where x->>'id'=i.id::text and x->>'handover_verified_at' is not null) then raise exception 'Queue lacks verification'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform pg_temp.expect_failure(format('select public.ops_resolve_tool_issue(%L,%L,''test'',%L::jsonb,2)',i.id,verified-interval '10 seconds',jsonb_build_array(photo)), 'sebelum verifikasi');
  result:=public.ops_resolve_tool_issue(i.id,now(),'Rollback replacement',jsonb_build_array(photo),2);
  if result->'issue'->>'status'<>'RESOLVED' then raise exception 'K3 failed to close'; end if;
  perform set_config('request.jwt.claim.sub',coordinator::text,true);
  perform pg_temp.expect_failure(format('select public.ops_verify_tool_issue_handover(%L,now(),3)',i.id),'Closed issues');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  select * into role_row from public.authorization_roles where code='CUSTOM_KOORDINATOR_AREA';
  perform public.save_custom_role(role_row.id,role_row.code,role_row.display_name,'','UP3','{"alat_kendaraan":"read"}',role_row.revision);
  perform set_config('request.jwt.claim.sub',coordinator::text,true);
  if public.auth_custom_has_permission(c,u,unit_id,'alat.issue.verify') then raise exception 'Read-only role still verifies'; end if;
  perform public.ops_list_vehicle_condition_overview(c,u,date_trunc('month',current_date)::date);
  if has_function_privilege('anon','public.ops_verify_tool_issue_handover(uuid,timestamptz,integer)','EXECUTE') then raise exception 'Anonymous access'; end if;
end $$;
select 'coordinator verification, scope, chronology, duplicate, stale revision, K3 closure and ACL checks passed' as result;

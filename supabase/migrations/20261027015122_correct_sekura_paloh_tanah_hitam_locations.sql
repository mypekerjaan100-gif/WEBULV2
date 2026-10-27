-- User-approved one-off correction: swap destinations, not vehicles/templates/plates.
-- No application permission or permanent guard change is introduced.
do $$
declare
  v_r2 uuid := '262fa0f1-d9f3-4483-94fb-5358f3b80aed';
  v_r4 uuid := '10bc105d-281a-4bc7-8fa8-67db948b2e2b';
  v_paloh uuid := '3b15aa96-5245-48f7-89bd-8b483c7bda3c';
  v_tanah uuid := '19c9146f-e76c-47cb-a85f-fcbc2ccb77f5';
  v_ulp uuid := 'b123cb92-a385-4eff-b459-c41e77a58150';
  v_before jsonb; v_reports jsonb; v_history jsonb; v_old jsonb; v_new jsonb;
  v_owner uuid; v_count integer;
begin
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(hashtextextended(
    'ops_prescribed:e1e2c8bc-ed1c-46db-bd39-70757a90863c:3215235c-c194-43a1-84d2-25c767c75d7a:' || v_ulp, 0));
  lock table public.ops_prescribed_vehicles in access exclusive mode;
  lock table public.ops_vehicle_monthly_reports in share mode;
  lock table public.ops_prescribed_vehicle_history in share row exclusive mode;
  perform 1 from public.locations where id in (v_paloh, v_tanah) order by id for share;

  if exists (select 1 from public.ops_vehicle_monthly_reports where ulp_id = v_ulp) then
    raise exception 'Sekura now has saved reports; review snapshots before correction';
  end if;
  select count(*) into v_count from public.locations
    where id in (v_paloh, v_tanah) and unit_id = v_ulp and type = 'KANTOR_JAGA' and own_status = 'Aktif'
      and contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c' and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a';
  if v_count <> 2 then raise exception 'Destination scope/status changed'; end if;
  select count(*) into v_count from public.ops_prescribed_vehicles
    where ulp_id = v_ulp and contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
      and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a' and effective_month = '2026-10-01' and end_month is null
      and ((id = v_r2 and location_id = v_paloh and revision = 2 and plate_display = 'KB 8160 WC'
        and template_id = 'b622aaf3-d84d-45b8-a0c6-373d113ab139')
        or (id = v_r4 and location_id = v_tanah and revision = 1 and plate_display is null
        and template_id = 'd6ae284e-00a2-417c-ac00-5ff7f5f92921'));
  if v_count <> 2 then raise exception 'Expected two original assignments; correction aborted'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.ops_prescribed_vehicles'::regclass
      and tgname in ('ops_prescribed_guard', 'ops_prescribed_audit') and tgenabled = 'O') <> 2 then
    raise exception 'Expected enabled guard and audit triggers';
  end if;

  select jsonb_agg(to_jsonb(s) order by id) into v_before from public.ops_prescribed_vehicles s;
  select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]') into v_reports from public.ops_vehicle_monthly_reports r;
  select jsonb_agg(to_jsonb(h) order by slot_id, revision) into v_history from public.ops_prescribed_vehicle_history h;
  select created_by into v_owner from public.ops_prescribed_vehicles where id = v_r2;
  if v_owner is distinct from (select created_by from public.ops_prescribed_vehicles where id = v_r4)
    or not exists (select 1 from public.system_role_memberships m
      join public.authorization_roles r on r.id = m.role_id
      where m.user_id = v_owner and r.code = 'SUPER_ADMIN' and m.status = 'ACTIVE'
        and m.effective_from <= current_date and (m.effective_to is null or current_date < m.effective_to)) then
    raise exception 'Expected shared Super Admin assignment owner';
  end if;

  -- Exclusive table lock prevents any application write while these two triggers
  -- are suspended. PostgreSQL rolls back trigger state too on any exception.
  alter table public.ops_prescribed_vehicles disable trigger ops_prescribed_guard;
  alter table public.ops_prescribed_vehicles disable trigger ops_prescribed_audit;
  update public.ops_prescribed_vehicles set
    location_id = case when id = v_r2 then v_tanah else v_paloh end,
    revision = revision + 1, updated_at = now(), updated_by = v_owner
    where id in (v_r2, v_r4);
  get diagnostics v_count = row_count;
  if v_count <> 2 then raise exception 'Correction must update exactly two assignments'; end if;

  -- Existing audit columns require an application account. Attribute ownership
  -- to the original assignment owner, but explicitly record that execution was
  -- database maintenance, NOT an authenticated action by that account.
  insert into public.ops_prescribed_vehicle_history(slot_id, revision, snapshot, actor_id, actor_role)
    select s.id, s.revision, to_jsonb(s) || jsonb_build_object('_maintenance', jsonb_build_object(
      'reason', 'User requested correction: KJ PALOH = Roda 4 Carry; KJ TANAH HITAM = Roda 2 Verza KB 8160 WC',
      'executed_by_database_role', current_user, 'authenticated_user_id', auth.uid(),
      'actor_attribution', 'Original assignment owner; executed via approved database maintenance, not an authenticated owner session',
      'previous_location_id', case when s.id = v_r2 then v_paloh else v_tanah end)),
      v_owner, 'SUPER_ADMIN'
    from public.ops_prescribed_vehicles s where s.id in (v_r2, v_r4);
  alter table public.ops_prescribed_vehicles enable trigger ops_prescribed_guard;
  alter table public.ops_prescribed_vehicles enable trigger ops_prescribed_audit;

  for v_old in select value from jsonb_array_elements(v_before) loop
    select to_jsonb(s) into v_new from public.ops_prescribed_vehicles s where id = (v_old ->> 'id')::uuid;
    if (v_old ->> 'id')::uuid in (v_r2, v_r4) then
      if (v_new - array['location_id','revision','updated_at','updated_by']) is distinct from
        (v_old - array['location_id','revision','updated_at','updated_by'])
        or (v_new ->> 'revision')::integer <> (v_old ->> 'revision')::integer + 1 then
        raise exception 'Unrelated target assignment fields changed';
      end if;
    elsif v_new is distinct from v_old then raise exception 'Another assignment changed';
    end if;
  end loop;
  if v_reports is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]') from public.ops_vehicle_monthly_reports r)
    or exists (select 1 from jsonb_array_elements(v_history) old_h
      where not exists (select 1 from public.ops_prescribed_vehicle_history h where to_jsonb(h) = old_h))
    or (select count(*) from public.ops_prescribed_vehicle_history) <> jsonb_array_length(v_history) + 2 then
    raise exception 'Report or historical data preservation failed';
  end if;
  if (select location_id from public.ops_prescribed_vehicles where id = v_r2) <> v_tanah
    or (select location_id from public.ops_prescribed_vehicles where id = v_r4) <> v_paloh then
    raise exception 'Destination swap verification failed';
  end if;
end;
$$;

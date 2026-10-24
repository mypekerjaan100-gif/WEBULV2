-- Independent prescribed fleet and monthly snapshots; existing ops_ulp_* and SLA data are untouched.
create table public.ops_prescribed_vehicles (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null, up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  template_id uuid not null references public.ops_equipment_templates(id) on delete restrict,
  label text not null check (length(btrim(label)) between 1 and 200),
  contract_reference text check (length(contract_reference) <= 500),
  effective_month date not null check (isfinite(effective_month) and extract(day from effective_month) = 1),
  end_month date check (isfinite(end_month) and extract(day from end_month) = 1 and end_month > effective_month),
  plate_display text, plate_normalized text unique,
  legacy_vehicle_id uuid unique references public.ops_vehicles(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null, updated_by uuid not null,
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict,
  check ((plate_display is null and plate_normalized is null and legacy_vehicle_id is null)
    or (plate_display is not null and plate_normalized is not null and length(plate_normalized) between 2 and 12
      and plate_normalized = regexp_replace(upper(plate_display), '[^A-Z0-9]+', '', 'g')))
);
create table public.ops_vehicle_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null, up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null check (isfinite(period_month) and extract(day from period_month) = 1),
  revision integer not null default 1 check (revision > 0),
  vehicles jsonb not null check (jsonb_typeof(vehicles) = 'array' and jsonb_array_length(vehicles) > 0),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  status text not null check (status in ('draft', 'compliant', 'non_compliant')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null, updated_by uuid not null,
  unique (contract_id, up3_id, ulp_id, period_month),
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict
);
create table public.ops_vehicle_monthly_history (
  report_id uuid not null references public.ops_vehicle_monthly_reports(id) on delete restrict,
  revision integer not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null, actor_role text not null check (actor_role in ('SUPER_ADMIN', 'ADMIN_ULP')),
  created_at timestamptz not null default now(), primary key (report_id, revision)
);
create table public.ops_prescribed_vehicle_history (
  slot_id uuid not null references public.ops_prescribed_vehicles(id) on delete restrict,
  revision integer not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null, actor_role text not null check (actor_role in ('SUPER_ADMIN', 'ADMIN_UP3', 'ADMIN_ULP')),
  created_at timestamptz not null default now(), primary key (slot_id, revision)
);
create index ops_prescribed_scope_month on public.ops_prescribed_vehicles(contract_id, up3_id, ulp_id, effective_month);
create index ops_prescribed_template on public.ops_prescribed_vehicles(template_id);
create index ops_prescribed_ulp on public.ops_prescribed_vehicles(ulp_id);
create index ops_vehicle_monthly_ulp on public.ops_vehicle_monthly_reports(ulp_id);
create index ops_vehicle_monthly_scope_month on public.ops_vehicle_monthly_reports(contract_id, up3_id, period_month);
alter table public.ops_prescribed_vehicles enable row level security;
alter table public.ops_vehicle_monthly_reports enable row level security;
alter table public.ops_vehicle_monthly_history enable row level security;
alter table public.ops_prescribed_vehicle_history enable row level security;
-- Deliberately no policies or table grants: all reads and writes go through checked RPCs.
revoke all on table public.ops_prescribed_vehicles, public.ops_vehicle_monthly_reports,
  public.ops_vehicle_monthly_history, public.ops_prescribed_vehicle_history from public, anon, authenticated, service_role;

create function public.ops_prescribed_assert_scope(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if not exists (select 1 from public.contracts c where c.id = p_contract_id and c.status = 'active') then
    raise exception 'Contract must be active';
  end if;
end;
$$;

-- Published fields take precedence. Only legacy templates may fall back to scoped catalog metadata.
create function public.ops_prescribed_template_snapshot(p_template_id uuid, p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  t public.ops_equipment_templates; e record; v_type text; v_assignment text; v_legacy boolean;
  v_items jsonb := '[]'; v_name text; v_unit text; v_category text; v_code text;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  select x.* into t from public.ops_equipment_templates x where x.id = p_template_id
    and x.contract_id = p_contract_id and x.up3_id = p_up3_id and x.status in ('Aktif', 'Diarsipkan');
  if not found then raise exception 'Assigned template is unavailable in this scope'; end if;
  v_legacy := t.published_at is null;
  v_type := nullif(btrim(t.vehicle_type_name), ''); v_assignment := nullif(btrim(t.assignment_name), '');
  if not v_legacy and (t.published_by is null or v_type is null or v_assignment is null) then
    raise exception 'Published template has incomplete header snapshot metadata';
  end if;
  if v_legacy then
    select coalesce(v_type, nullif(btrim(v.name), '')), coalesce(v_assignment, nullif(btrim(a.name), ''))
      into v_type, v_assignment from public.ops_vehicle_types v join public.ops_vehicle_assignments a
        on a.id = t.assignment_id and a.contract_id = p_contract_id and a.up3_id = p_up3_id
      where v.id = t.vehicle_type_id and v.contract_id = p_contract_id and v.up3_id = p_up3_id;
  end if;
  if v_type is null or v_assignment is null or btrim(t.template_name) = '' or btrim(t.template_code) = '' then
    raise exception 'Template header metadata is missing or outside its scope';
  end if;
  for e in select ti.*, i.id as catalog_id, i.code as catalog_code, i.name as catalog_name,
      i.unit as catalog_unit, i.specification, c.id as category_id, c.name as catalog_category
    from public.ops_equipment_template_items ti left join public.ops_equipment_items i
      on i.id = ti.equipment_id and i.contract_id = p_contract_id and i.up3_id = p_up3_id
    left join public.ops_equipment_categories c on c.id = i.category_id
      and c.contract_id = p_contract_id and c.up3_id = p_up3_id
    where ti.template_id = t.id order by ti.sort_order, ti.equipment_id loop
    if e.required_qty <= 0 then raise exception 'Every prescribed tool quantity must be positive'; end if;
    v_name := nullif(btrim(e.equipment_name), ''); v_unit := nullif(btrim(e.equipment_unit), '');
    v_category := nullif(btrim(e.equipment_category_name), ''); v_code := nullif(btrim(e.equipment_code), '');
    if not v_legacy and (v_name is null or v_unit is null or v_category is null or v_code is null) then
      raise exception 'Published template has incomplete equipment snapshot metadata';
    end if;
    if v_legacy then
      if e.catalog_id is null or e.category_id is null then raise exception 'Legacy equipment catalog scope is invalid'; end if;
      v_name := coalesce(v_name, nullif(btrim(e.catalog_name), '')); v_unit := coalesce(v_unit, nullif(btrim(e.catalog_unit), ''));
      v_category := coalesce(v_category, nullif(btrim(e.catalog_category), '')); v_code := coalesce(v_code, nullif(btrim(e.catalog_code), ''));
    end if;
    if v_name is null or v_unit is null or v_category is null or v_code is null then raise exception 'Equipment metadata is missing'; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('kind', 'equipment', 'equipment_id', e.equipment_id,
      'name', v_name, 'category', v_category, 'unit', v_unit, 'equipment_code', v_code, 'required_qty', e.required_qty,
      'specification', case when v_legacy then e.specification else null end, 'legacy_metadata', v_legacy));
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Template requires at least one positive tool quantity'; end if;
  return jsonb_build_object('template_id', t.id, 'template_name', t.template_name, 'template_code', t.template_code,
    'template_revision', t.revision, 'template_version', t.version_number, 'vehicle_type_name', v_type,
    'assignment_name', v_assignment, 'legacy_metadata', v_legacy, 'items', v_items);
end;
$$;

create function public.ops_prescribed_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable text[]; v_old jsonb; v_new jsonb; v_ord bigint; v_slot public.ops_prescribed_vehicles;
  v_registry public.ops_vehicles; v_type uuid; v_assignment uuid; v_lock text;
begin
  if tg_op in ('DELETE', 'TRUNCATE') or tg_table_name in ('ops_vehicle_monthly_history', 'ops_prescribed_vehicle_history') then
    raise exception 'Records cannot be deleted or truncated; history is append-only';
  end if;
  if new.ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(new.contract_id, new.up3_id, new.ulp_id);
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || new.contract_id || ':' || new.up3_id || ':' || new.ulp_id, 0));
  if tg_table_name = 'ops_prescribed_vehicles' then
    v_mutable := array['end_month', 'plate_display', 'plate_normalized', 'legacy_vehicle_id', 'revision', 'updated_at', 'updated_by'];
    if tg_op = 'INSERT' or new.end_month is distinct from old.end_month then
      if not public.ops_can_manage_master(new.contract_id, new.up3_id) then raise exception 'Fleet management denied' using errcode = '42501'; end if;
      if tg_op = 'INSERT' then
        if new.plate_display is not null or new.plate_normalized is not null or new.legacy_vehicle_id is not null then
          raise exception 'New slots must be unplated';
        end if;
        if not exists (select 1 from public.ops_equipment_templates t where t.id = new.template_id
          and t.contract_id = new.contract_id and t.up3_id = new.up3_id and t.status = 'Aktif') then
          raise exception 'An active template in the same scope is required';
        end if;
        if exists (select 1 from public.ops_vehicle_monthly_reports r where r.contract_id = new.contract_id
          and r.up3_id = new.up3_id and r.ulp_id = new.ulp_id and r.period_month >= new.effective_month) then
          raise exception 'Creation would alter an already frozen monthly fleet';
        end if;
      else
        if old.end_month is not null or new.end_month is null then raise exception 'An ended slot cannot be reopened or rescheduled'; end if;
        if (to_jsonb(new) - array['end_month', 'revision', 'updated_at', 'updated_by'])
          is distinct from (to_jsonb(old) - array['end_month', 'revision', 'updated_at', 'updated_by']) then
          raise exception 'Ending a slot cannot also change its plate or identity';
        end if;
        if exists (select 1 from public.ops_vehicle_monthly_reports r where r.contract_id = new.contract_id
          and r.up3_id = new.up3_id and r.ulp_id = new.ulp_id and r.period_month >= new.end_month
          and r.vehicles @> jsonb_build_array(jsonb_build_object('id', new.id))) then
          raise exception 'End month conflicts with an existing report referencing this slot';
        end if;
      end if;
    else
      if not public.ops_vehicle_can_manage(new.contract_id, new.up3_id, new.ulp_id) then raise exception 'Plate write denied' using errcode = '42501'; end if;
      if new.plate_display is null then raise exception 'A plate cannot be cleared'; end if;
      new.plate_display := upper(regexp_replace(btrim(new.plate_display), '\s+', ' ', 'g'));
      new.plate_normalized := regexp_replace(new.plate_display, '[^A-Z0-9]+', '', 'g');
      if length(new.plate_display) > 100 or length(new.plate_normalized) not between 2 and 12 then raise exception 'Plate must normalize to 2..12 characters'; end if;
      -- Scope first, then sorted global plate locks; registry guards use the same keys.
      for v_lock in select distinct x from unnest(array[old.plate_normalized, new.plate_normalized]) a(x) where x is not null order by x loop
        perform pg_advisory_xact_lock(hashtextextended('ops_plate:' || v_lock, 0));
      end loop;
      if old.legacy_vehicle_id is not null and (new.plate_normalized is distinct from old.plate_normalized
        or new.legacy_vehicle_id is distinct from old.legacy_vehicle_id) then
        raise exception 'Linked registry plate cannot be corrected here; an administrator must handle the existing registry link';
      end if;
      if exists (select 1 from public.ops_prescribed_vehicles s where s.plate_normalized = new.plate_normalized and s.id <> new.id) then
        raise exception 'Plate is already reserved by another slot, including retired slots';
      end if;
      -- Legacy RPCs may hold FOR UPDATE before entering their trigger; never wait behind that lock.
      begin
        select v.* into v_registry from public.ops_vehicles v where v.plate_normalized = new.plate_normalized for key share nowait;
      exception when lock_not_available then
        raise exception 'Registry vehicle is busy; reload and retry plate assignment' using errcode = '40001';
      end;
      if found then
        if (v_registry.contract_id, v_registry.up3_id, v_registry.ulp_id) is distinct from (new.contract_id, new.up3_id, new.ulp_id) then
          raise exception 'Plate exists in a different registry scope';
        end if;
        select t.vehicle_type_id, t.assignment_id into v_type, v_assignment from public.ops_vehicle_template_assignments a
          join public.ops_equipment_templates t on t.id = a.template_id and t.contract_id = new.contract_id and t.up3_id = new.up3_id
          where a.vehicle_id = v_registry.id and a.contract_id = new.contract_id and a.up3_id = new.up3_id and a.ulp_id = new.ulp_id
          order by a.effective_from desc, a.created_at desc, a.id desc limit 1;
        if not found then
          select t.vehicle_type_id, t.assignment_id into v_type, v_assignment from public.ops_vehicle_history h
            join public.ops_equipment_templates t on t.id = coalesce(h.detail ->> 'to_template_id', h.detail ->> 'template_id')::uuid
              and t.contract_id = new.contract_id and t.up3_id = new.up3_id
            where h.vehicle_id = v_registry.id and h.action in ('CREATED', 'ASSIGNED') order by h.created_at desc, h.id desc limit 1;
        end if;
        if not exists (select 1 from public.ops_equipment_templates t where t.id = new.template_id
          and t.vehicle_type_id = v_type and t.assignment_id = v_assignment) then
          raise exception 'Existing registry vehicle must have the same verified vehicle type and assignment';
        end if;
        new.legacy_vehicle_id := v_registry.id;
      else
        if old.legacy_vehicle_id is not null then raise exception 'Existing registry link is inconsistent; administrator action required'; end if;
        new.legacy_vehicle_id := null;
      end if;
    end if;
  else
    v_mutable := array['vehicles', 'items', 'status', 'revision', 'updated_at', 'updated_by'];
    if not public.ops_vehicle_can_manage(new.contract_id, new.up3_id, new.ulp_id) then raise exception 'Report write denied' using errcode = '42501'; end if;
    if new.period_month > date_trunc('month', public.ops_business_today())::date then raise exception 'Future reports cannot be saved'; end if;
    if tg_op = 'UPDATE' then
      if jsonb_array_length(new.vehicles) <> jsonb_array_length(old.vehicles) then raise exception 'Report fleet is pinned'; end if;
      for v_old, v_ord in select value, ordinality from jsonb_array_elements(old.vehicles) with ordinality loop
        v_new := new.vehicles -> (v_ord::integer - 1);
        if (v_new - array['revision', 'plate_display', 'plate_normalized']) is distinct from
          (v_old - array['revision', 'plate_display', 'plate_normalized']) then raise exception 'Report vehicle metadata is pinned'; end if;
        if nullif(v_old ->> 'plate_normalized', '') is not null then
          if (v_new -> 'plate_display', v_new -> 'plate_normalized') is distinct from
            (v_old -> 'plate_display', v_old -> 'plate_normalized') then raise exception 'Historical nonempty plates are immutable'; end if;
        else
          select s.* into v_slot from public.ops_prescribed_vehicles s where s.id = (v_old ->> 'id')::uuid
            and s.contract_id = new.contract_id and s.up3_id = new.up3_id and s.ulp_id = new.ulp_id;
          if not found or (v_new ->> 'plate_display', v_new ->> 'plate_normalized') is distinct from
            (v_slot.plate_display, v_slot.plate_normalized) then raise exception 'Only the current slot may enrich an empty plate'; end if;
        end if;
      end loop;
      if (select jsonb_agg(value - array['good_qty', 'bad_qty', 'note', 'status', 'available_qty', 'percentage'] order by ord)
          from jsonb_array_elements(new.items) with ordinality a(value, ord)) is distinct from
        (select jsonb_agg(value - array['good_qty', 'bad_qty', 'note', 'status', 'available_qty', 'percentage'] order by ord)
          from jsonb_array_elements(old.items) with ordinality a(value, ord)) then raise exception 'Report item metadata and keys are pinned'; end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'Identity, scope, source template, start month and creation audit are immutable';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid(); end if;
  return new;
end;
$$;

-- Additive reverse protection: never modify or fabricate a registry vehicle when filling a slot.
create function public.ops_prescribed_registry_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v public.ops_vehicles; v_lock text; v_old jsonb := '{}'; v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' then v_old := to_jsonb(old); end if;
  if tg_table_name = 'ops_vehicle_template_assignments' then
    select x.* into v from public.ops_vehicles x where x.id = new.vehicle_id;
    v_new := to_jsonb(v); v_old := v_new;
  end if;
  for v_lock in select distinct x from unnest(array[
      'ops_prescribed:' || (v_old ->> 'contract_id') || ':' || (v_old ->> 'up3_id') || ':' || (v_old ->> 'ulp_id'),
      'ops_prescribed:' || (v_new ->> 'contract_id') || ':' || (v_new ->> 'up3_id') || ':' || (v_new ->> 'ulp_id')]) a(x)
      where x is not null order by x loop perform pg_advisory_xact_lock(hashtextextended(v_lock, 0)); end loop;
  for v_lock in select distinct regexp_replace(upper(x), '[^A-Z0-9]+', '', 'g') as normalized
      from unnest(array[v_old ->> 'plate_display', v_new ->> 'plate_display']) a(x) where x is not null order by normalized loop
    perform pg_advisory_xact_lock(hashtextextended('ops_plate:' || v_lock, 0));
  end loop;
  if tg_table_name = 'ops_vehicles' then
    if exists (select 1 from public.ops_prescribed_vehicles s where
      (s.plate_normalized = regexp_replace(upper(new.plate_display), '[^A-Z0-9]+', '', 'g') and s.legacy_vehicle_id is distinct from new.id)
      or (s.legacy_vehicle_id = new.id and (s.plate_normalized, s.contract_id, s.up3_id, s.ulp_id) is distinct from
        (new.plate_normalized, new.contract_id, new.up3_id, new.ulp_id))) then
      raise exception 'Plate is reserved by a prescribed slot; linked registry plate and scope cannot change';
    end if;
  elsif exists (select 1 from public.ops_prescribed_vehicles s join public.ops_equipment_templates t on t.id = s.template_id
    left join public.ops_equipment_templates nt on nt.id = new.template_id where s.legacy_vehicle_id = new.vehicle_id
      and (new.contract_id, new.up3_id, new.ulp_id, nt.contract_id, nt.up3_id, nt.vehicle_type_id, nt.assignment_id)
        is distinct from (s.contract_id, s.up3_id, s.ulp_id, s.contract_id, s.up3_id, t.vehicle_type_id, t.assignment_id)) then
    raise exception 'Linked registry template must retain the prescribed scope, type and assignment';
  end if;
  return new;
end;
$$;
create trigger ops_prescribed_registry_guard before insert or update on public.ops_vehicles
  for each row execute function public.ops_prescribed_registry_guard();
create trigger ops_prescribed_registry_assignment_guard before insert or update on public.ops_vehicle_template_assignments
  for each row execute function public.ops_prescribed_registry_guard();

create function public.ops_prescribed_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_table_name = 'ops_prescribed_vehicles' then
    insert into public.ops_prescribed_vehicle_history(slot_id, revision, snapshot, actor_id, actor_role)
      values (new.id, new.revision, to_jsonb(new), auth.uid(), public.ops_vehicle_actor_role(new.contract_id, new.up3_id, new.ulp_id));
  else
    insert into public.ops_vehicle_monthly_history(report_id, revision, snapshot, actor_id, actor_role)
      values (new.id, new.revision, to_jsonb(new), auth.uid(), public.ops_vehicle_actor_role(new.contract_id, new.up3_id, new.ulp_id));
  end if;
  return new;
end;
$$;
create trigger ops_prescribed_guard before insert or update or delete on public.ops_prescribed_vehicles
  for each row execute function public.ops_prescribed_guard();
create trigger ops_vehicle_monthly_guard before insert or update or delete on public.ops_vehicle_monthly_reports
  for each row execute function public.ops_prescribed_guard();
create trigger ops_prescribed_audit after insert or update on public.ops_prescribed_vehicles
  for each row execute function public.ops_prescribed_audit();
create trigger ops_vehicle_monthly_audit after insert or update on public.ops_vehicle_monthly_reports
  for each row execute function public.ops_prescribed_audit();
create trigger ops_prescribed_history_guard before update or delete on public.ops_prescribed_vehicle_history
  for each row execute function public.ops_prescribed_guard();
create trigger ops_vehicle_monthly_history_guard before update or delete on public.ops_vehicle_monthly_history
  for each row execute function public.ops_prescribed_guard();
create trigger ops_prescribed_no_truncate before truncate on public.ops_prescribed_vehicles
  execute function public.ops_prescribed_guard();
create trigger ops_vehicle_monthly_no_truncate before truncate on public.ops_vehicle_monthly_reports
  execute function public.ops_prescribed_guard();
create trigger ops_prescribed_history_no_truncate before truncate on public.ops_prescribed_vehicle_history
  execute function public.ops_prescribed_guard();
create trigger ops_vehicle_monthly_history_no_truncate before truncate on public.ops_vehicle_monthly_history
  execute function public.ops_prescribed_guard();

create function public.ops_create_prescribed_vehicles(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_template_id uuid,
  p_label text, p_contract_reference text, p_count integer, p_effective_month date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare t public.ops_equipment_templates; s public.ops_prescribed_vehicles; v_meta jsonb; v_label text; v_result jsonb := '[]'; n integer;
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then raise exception 'Fleet management denied' using errcode = '42501'; end if;
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_count is null or p_count not between 1 and 50 then raise exception 'Count must be 1..50'; end if;
  if p_effective_month is null or not isfinite(p_effective_month) or extract(day from p_effective_month) <> 1 then raise exception 'Effective month must be finite and month-first'; end if;
  if length(coalesce(p_contract_reference, '')) > 500 then raise exception 'Contract reference is limited to 500 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || p_contract_id || ':' || p_up3_id || ':' || p_ulp_id, 0));
  select x.* into t from public.ops_equipment_templates x where x.id = p_template_id
    and x.contract_id = p_contract_id and x.up3_id = p_up3_id and x.status = 'Aktif' for share;
  if not found then raise exception 'An active template in the same scope is required'; end if;
  v_meta := public.ops_prescribed_template_snapshot(p_template_id, p_contract_id, p_up3_id, p_ulp_id);
  v_label := coalesce(nullif(btrim(p_label), ''), (v_meta ->> 'vehicle_type_name') || ' - ' || (v_meta ->> 'assignment_name'));
  if length(v_label) > 200 - (case when p_count > 1 then length(' #' || p_count) else 0 end) then raise exception 'Label including its count suffix is limited to 200 characters'; end if;
  for n in 1..p_count loop
    insert into public.ops_prescribed_vehicles(contract_id, up3_id, ulp_id, template_id, label, contract_reference, effective_month, created_by, updated_by)
      values (p_contract_id, p_up3_id, p_ulp_id, p_template_id, v_label || case when p_count > 1 then ' #' || n else '' end,
        nullif(btrim(p_contract_reference), ''), p_effective_month, auth.uid(), auth.uid()) returning * into s;
    v_result := v_result || jsonb_build_array(to_jsonb(s) || (v_meta - 'items'));
  end loop;
  return v_result;
end;
$$;

create function public.ops_end_prescribed_vehicle(p_slot_id uuid, p_end_month date, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.ops_prescribed_vehicles;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select x.* into s from public.ops_prescribed_vehicles x where x.id = p_slot_id;
  if not found then raise exception 'Slot not found'; end if;
  if not public.ops_can_manage_master(s.contract_id, s.up3_id) then raise exception 'Fleet management denied' using errcode = '42501'; end if;
  perform public.ops_prescribed_assert_scope(s.contract_id, s.up3_id, s.ulp_id);
  if p_end_month is null or not isfinite(p_end_month) or extract(day from p_end_month) <> 1 or p_end_month <= s.effective_month then
    raise exception 'Exclusive end month must be month-first and after the inclusive start month';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || s.contract_id || ':' || s.up3_id || ':' || s.ulp_id, 0));
  select x.* into s from public.ops_prescribed_vehicles x where x.id = p_slot_id for update;
  if s.revision is distinct from p_expected_revision then raise exception 'Slot revision conflict; reload' using errcode = '40001'; end if;
  if s.end_month is not null then raise exception 'Slot has already ended'; end if;
  update public.ops_prescribed_vehicles x set end_month = p_end_month where x.id = s.id returning x.* into s;
  return to_jsonb(s);
end;
$$;

create function public.ops_list_prescribed_vehicles(p_contract_id uuid, p_up3_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, null);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then raise exception 'Period must be finite and month-first'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('template_name', t.template_name,
    'template_code', t.template_code, 'template_revision', t.revision, 'template_version', t.version_number,
    'vehicle_type_name', coalesce(nullif(btrim(t.vehicle_type_name), ''), vt.name),
    'assignment_name', coalesce(nullif(btrim(t.assignment_name), ''), a.name), 'legacy_metadata', t.published_at is null)
    order by s.ulp_id, s.label, s.id), '[]'::jsonb) from public.ops_prescribed_vehicles s
    join public.ops_equipment_templates t on t.id = s.template_id and t.contract_id = s.contract_id and t.up3_id = s.up3_id
    left join public.ops_vehicle_types vt on vt.id = t.vehicle_type_id and vt.contract_id = s.contract_id and vt.up3_id = s.up3_id
    left join public.ops_vehicle_assignments a on a.id = t.assignment_id and a.contract_id = s.contract_id and a.up3_id = s.up3_id
    where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.effective_month <= p_period_month
      and (s.end_month is null or p_period_month < s.end_month));
end;
$$;

create function public.ops_set_prescribed_vehicle_plate(p_slot_id uuid, p_plate text, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.ops_prescribed_vehicles;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select x.* into s from public.ops_prescribed_vehicles x where x.id = p_slot_id;
  if not found then raise exception 'Slot not found'; end if;
  if not public.ops_vehicle_can_manage(s.contract_id, s.up3_id, s.ulp_id) then raise exception 'Only Super Admin or the exact Admin ULP may fill plates' using errcode = '42501'; end if;
  perform public.ops_prescribed_assert_scope(s.contract_id, s.up3_id, s.ulp_id);
  if p_plate is null then raise exception 'Plate is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || s.contract_id || ':' || s.up3_id || ':' || s.ulp_id, 0));
  select x.* into s from public.ops_prescribed_vehicles x where x.id = p_slot_id for update;
  if s.revision is distinct from p_expected_revision then raise exception 'Slot revision conflict; reload' using errcode = '40001'; end if;
  update public.ops_prescribed_vehicles x set plate_display = p_plate where x.id = s.id returning x.* into s;
  return to_jsonb(s);
end;
$$;

create function public.ops_get_vehicle_condition_report(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_report jsonb; v_vehicles jsonb := '[]'; v_items jsonb := '[]'; v_history jsonb := '[]';
  v_slot public.ops_prescribed_vehicles; v_meta jsonb; v_item jsonb;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then raise exception 'Period must be finite and month-first'; end if;
  select to_jsonb(r) into v_report from public.ops_vehicle_monthly_reports r where r.contract_id = p_contract_id
    and r.up3_id = p_up3_id and r.ulp_id = p_ulp_id and r.period_month = p_period_month;
  if v_report is not null then
    v_items := v_report -> 'items';
    select jsonb_agg(v.value || jsonb_build_object('revision', s.revision) || case
      when nullif(v.value ->> 'plate_normalized', '') is null then jsonb_build_object('plate_display', s.plate_display, 'plate_normalized', s.plate_normalized)
      else '{}'::jsonb end order by v.ord) into v_vehicles
      from jsonb_array_elements(v_report -> 'vehicles') with ordinality v(value, ord)
      join public.ops_prescribed_vehicles s on s.id = (v.value ->> 'id')::uuid
        and s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.ulp_id = p_ulp_id;
    select coalesce(jsonb_agg(to_jsonb(h) order by h.revision desc), '[]'::jsonb) into v_history from
      (select x.* from public.ops_vehicle_monthly_history x where x.report_id = (v_report ->> 'id')::uuid order by x.revision desc limit 20) h;
  else
    for v_slot in select x.* from public.ops_prescribed_vehicles x where x.contract_id = p_contract_id and x.up3_id = p_up3_id
      and x.ulp_id = p_ulp_id and x.effective_month <= p_period_month and (x.end_month is null or p_period_month < x.end_month)
      order by x.label, x.id loop
      v_meta := public.ops_prescribed_template_snapshot(v_slot.template_id, p_contract_id, p_up3_id, p_ulp_id);
      v_vehicles := v_vehicles || jsonb_build_array((v_meta - 'items') || jsonb_build_object('id', v_slot.id, 'label', v_slot.label,
        'plate_display', v_slot.plate_display, 'plate_normalized', v_slot.plate_normalized, 'revision', v_slot.revision, 'contract_reference', v_slot.contract_reference));
      v_items := v_items || jsonb_build_array(jsonb_build_object('key', v_slot.id || ':vehicle', 'kind', 'vehicle', 'vehicle_id', v_slot.id,
        'name', v_slot.label, 'category', 'Kondisi Kendaraan', 'unit', 'unit', 'required_qty', 1));
      for v_item in select value from jsonb_array_elements(v_meta -> 'items') loop
        v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('key', v_slot.id || ':' || (v_item ->> 'equipment_id'), 'vehicle_id', v_slot.id));
      end loop;
    end loop;
    select coalesce(jsonb_agg(value || jsonb_build_object('good_qty', null, 'bad_qty', null, 'note', '',
      'status', 'unfilled', 'available_qty', null, 'percentage', null) order by ord), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_items) with ordinality a(value, ord);
  end if;
  return jsonb_build_object('report', v_report, 'vehicles', coalesce(v_vehicles, '[]'::jsonb), 'items', v_items, 'history', v_history);
end;
$$;

create function public.ops_save_vehicle_condition_report(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date,
  p_expected_revision integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r public.ops_vehicle_monthly_reports; v_bundle jsonb; v_input jsonb := '{}'; v_items jsonb := '[]';
  v_item jsonb; v_spec jsonb; v_field text; v_good bigint; v_bad bigint; v_status text := 'compliant'; v_row_status text;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if auth.uid() is null or not public.ops_vehicle_can_manage(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Only Super Admin or the exact Admin ULP may report' using errcode = '42501';
  end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1
    or p_period_month > date_trunc('month', public.ops_business_today())::date then raise exception 'Period must be month-first and not in the future'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || p_contract_id || ':' || p_up3_id || ':' || p_ulp_id, 0));
  select x.* into r from public.ops_vehicle_monthly_reports x where x.contract_id = p_contract_id and x.up3_id = p_up3_id
    and x.ulp_id = p_ulp_id and x.period_month = p_period_month for update;
  if coalesce(r.revision, 0) is distinct from p_expected_revision then raise exception 'Report revision conflict; reload' using errcode = '40001'; end if;
  v_bundle := public.ops_get_vehicle_condition_report(p_contract_id, p_up3_id, p_ulp_id, p_period_month);
  if jsonb_array_length(v_bundle -> 'vehicles') = 0 then raise exception 'No prescribed vehicles for this month'; end if;
  if jsonb_array_length(p_items) <> jsonb_array_length(v_bundle -> 'items') then raise exception 'Every prescribed report key is required exactly once'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Report entries must be objects'; end if;
    if not (v_item ?& array['key', 'good_qty', 'bad_qty', 'note']) or (v_item - array['key', 'good_qty', 'bad_qty', 'note']) <> '{}'::jsonb
      or jsonb_typeof(v_item -> 'key') is distinct from 'string' or v_input ? (v_item ->> 'key') then
      raise exception 'Each entry requires only key/good_qty/bad_qty/note, with no duplicate keys';
    end if;
    v_input := v_input || jsonb_build_object(v_item ->> 'key', v_item);
  end loop;
  if exists (select 1 from jsonb_array_elements(v_bundle -> 'vehicles') v where nullif(v ->> 'plate_normalized', '') is null) then v_status := 'draft'; end if;
  for v_spec in select value from jsonb_array_elements(v_bundle -> 'items') loop
    v_item := v_input -> (v_spec ->> 'key');
    if v_item is null then raise exception 'Missing prescribed key or out-of-fleet entry'; end if;
    foreach v_field in array array['good_qty', 'bad_qty'] loop
      if v_item -> v_field <> 'null'::jsonb then
        if jsonb_typeof(v_item -> v_field) <> 'number' or (v_item ->> v_field) !~ '^[0-9]{1,10}$' then raise exception 'Quantities must be null or nonnegative integers'; end if;
        if (v_item ->> v_field)::bigint > 2147483647 then raise exception 'Quantity exceeds 2147483647'; end if;
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'note') not in ('string', 'null') or length(coalesce(v_item ->> 'note', '')) > 2000 then raise exception 'Note must be text of at most 2000 characters'; end if;
    v_good := (v_item ->> 'good_qty')::bigint; v_bad := (v_item ->> 'bad_qty')::bigint;
    if v_spec ->> 'kind' = 'vehicle' and ((v_good is null) <> (v_bad is null) or coalesce(v_good + v_bad, 0) > 1) then
      raise exception 'Vehicle counts must be null/null or binary whole counts with sum at most one';
    end if;
    v_row_status := case when v_good is null or v_bad is null then 'unfilled'
      when v_bad > 0 or v_good < (v_spec ->> 'required_qty')::bigint then 'non_compliant' else 'compliant' end;
    if v_row_status = 'unfilled' then v_status := 'draft';
    elsif v_row_status = 'non_compliant' and v_status <> 'draft' then v_status := 'non_compliant'; end if;
    v_items := v_items || jsonb_build_array(v_spec || jsonb_build_object('good_qty', v_good, 'bad_qty', v_bad,
      'note', coalesce(v_item ->> 'note', ''), 'status', v_row_status, 'available_qty', v_good + v_bad,
      'percentage', case when v_row_status <> 'unfilled' then least(100::numeric, v_good::numeric * 100 / (v_spec ->> 'required_qty')::numeric) else null end));
  end loop;
  if r.id is null then
    insert into public.ops_vehicle_monthly_reports(contract_id, up3_id, ulp_id, period_month, vehicles, items, status, created_by, updated_by)
      values (p_contract_id, p_up3_id, p_ulp_id, p_period_month, v_bundle -> 'vehicles', v_items, v_status, auth.uid(), auth.uid());
  else
    update public.ops_vehicle_monthly_reports x set vehicles = v_bundle -> 'vehicles', items = v_items, status = v_status where x.id = r.id;
  end if;
  return public.ops_get_vehicle_condition_report(p_contract_id, p_up3_id, p_ulp_id, p_period_month);
end;
$$;

create function public.ops_list_vehicle_condition_overview(p_contract_id uuid, p_up3_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, null);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then raise exception 'Period must be finite and month-first'; end if;
  return (with tool_counts as (
    select ti.template_id, count(*) as n from public.ops_equipment_template_items ti join public.ops_equipment_templates t on t.id = ti.template_id
      where t.contract_id = p_contract_id and t.up3_id = p_up3_id group by ti.template_id
  ), fleet as (
    select s.ulp_id, count(*) as vehicle_count, count(*) filter (where s.plate_normalized is null) as missing_plates,
      sum(1 + coalesce(tc.n, 0)) as items_count from public.ops_prescribed_vehicles s left join tool_counts tc on tc.template_id = s.template_id
      where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.effective_month <= p_period_month
        and (s.end_month is null or p_period_month < s.end_month) group by s.ulp_id
  ), reports as (
    select r.*, (select count(*) from jsonb_array_elements(r.vehicles) v where nullif(v ->> 'plate_normalized', '') is null) as missing_plates,
      c.filled_count, c.failed_count from public.ops_vehicle_monthly_reports r cross join lateral (
        select count(*) filter (where i ->> 'status' in ('compliant', 'non_compliant')) as filled_count,
          count(*) filter (where i ->> 'status' = 'non_compliant') as failed_count from jsonb_array_elements(r.items) i) c
      where r.contract_id = p_contract_id and r.up3_id = p_up3_id and r.period_month = p_period_month
  ) select coalesce(jsonb_agg(jsonb_build_object('ulp_id', u.id,
      'vehicle_count', case when r.id is not null then jsonb_array_length(r.vehicles) else coalesce(f.vehicle_count, 0) end,
      'missing_plates', coalesce(r.missing_plates, f.missing_plates, 0),
      'items_count', case when r.id is not null then jsonb_array_length(r.items) else coalesce(f.items_count, 0) end,
      'filled_count', coalesce(r.filled_count, 0), 'failed_count', coalesce(r.failed_count, 0),
      'report_status', case when r.id is not null then case when r.status = 'draft' or r.missing_plates > 0
        or r.filled_count < jsonb_array_length(r.items) then 'draft' else r.status end
        when coalesce(f.vehicle_count, 0) = 0 then 'no_assigned_vehicles' else 'draft' end,
      'updated_at', r.updated_at) order by u.sort_order, u.legacy_key, u.id), '[]'::jsonb)
    from public.organization_units u left join fleet f on f.ulp_id = u.id left join reports r on r.ulp_id = u.id
    where u.type = 'ULP' and u.parent_id = p_up3_id);
end;
$$;

revoke all on function public.ops_prescribed_assert_scope(uuid, uuid, uuid),
  public.ops_prescribed_template_snapshot(uuid, uuid, uuid, uuid), public.ops_prescribed_guard(),
  public.ops_prescribed_registry_guard(), public.ops_prescribed_audit(),
  public.ops_create_prescribed_vehicles(uuid, uuid, uuid, uuid, text, text, integer, date),
  public.ops_end_prescribed_vehicle(uuid, date, integer), public.ops_list_prescribed_vehicles(uuid, uuid, date),
  public.ops_set_prescribed_vehicle_plate(uuid, text, integer), public.ops_get_vehicle_condition_report(uuid, uuid, uuid, date),
  public.ops_save_vehicle_condition_report(uuid, uuid, uuid, date, integer, jsonb),
  public.ops_list_vehicle_condition_overview(uuid, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.ops_create_prescribed_vehicles(uuid, uuid, uuid, uuid, text, text, integer, date),
  public.ops_end_prescribed_vehicle(uuid, date, integer), public.ops_list_prescribed_vehicles(uuid, uuid, date),
  public.ops_set_prescribed_vehicle_plate(uuid, text, integer), public.ops_get_vehicle_condition_report(uuid, uuid, uuid, date),
  public.ops_save_vehicle_condition_report(uuid, uuid, uuid, date, integer, jsonb),
  public.ops_list_vehicle_condition_overview(uuid, uuid, date) to authenticated;

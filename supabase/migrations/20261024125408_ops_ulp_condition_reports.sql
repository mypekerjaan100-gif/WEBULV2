-- Independent monthly ULP requirements and condition snapshots. No SLA linkage.
create table public.ops_ulp_templates (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  contract_reference text not null check (length(btrim(contract_reference)) between 1 and 500),
  status text not null default 'Draft' check (status in ('Draft', 'Published')),
  revision integer not null default 1 check (revision > 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null,
  updated_by uuid not null,
  published_at timestamptz,
  published_by uuid,
  unique (id, contract_id, up3_id),
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict,
  check (status <> 'Published' or (jsonb_array_length(items) > 0 and published_at is not null and published_by is not null))
);

create table public.ops_ulp_template_assignments (
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  effective_month date not null check (isfinite(effective_month) and extract(day from effective_month) = 1),
  template_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null,
  updated_by uuid not null,
  primary key (contract_id, up3_id, ulp_id, effective_month),
  foreign key (template_id, contract_id, up3_id) references public.ops_ulp_templates(id, contract_id, up3_id) on delete restrict
);

create table public.ops_ulp_condition_reports (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null check (isfinite(period_month) and extract(day from period_month) = 1),
  template_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 500),
  status text not null check (status in ('draft', 'compliant', 'non_compliant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null,
  updated_by uuid not null,
  unique (contract_id, up3_id, ulp_id, period_month),
  foreign key (template_id, contract_id, up3_id) references public.ops_ulp_templates(id, contract_id, up3_id) on delete restrict
);

create table public.ops_ulp_condition_history (
  report_id uuid not null references public.ops_ulp_condition_reports(id) on delete restrict,
  revision integer not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'
    and jsonb_typeof(snapshot -> 'items') is not distinct from 'array'
    and coalesce(snapshot ->> 'status', '') in ('draft', 'compliant', 'non_compliant')),
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('SUPER_ADMIN', 'ADMIN_ULP')),
  created_at timestamptz not null default now(),
  primary key (report_id, revision)
);

create index ops_ulp_assignments_template on public.ops_ulp_template_assignments(template_id, contract_id, up3_id);
create index ops_ulp_assignments_ulp on public.ops_ulp_template_assignments(ulp_id);
create index ops_ulp_reports_template on public.ops_ulp_condition_reports(template_id, contract_id, up3_id);
create index ops_ulp_reports_ulp on public.ops_ulp_condition_reports(ulp_id);
alter table public.ops_ulp_templates enable row level security;
alter table public.ops_ulp_template_assignments enable row level security;
alter table public.ops_ulp_condition_reports enable row level security;
alter table public.ops_ulp_condition_history enable row level security;
revoke all on table public.ops_ulp_templates, public.ops_ulp_template_assignments,
  public.ops_ulp_condition_reports, public.ops_ulp_condition_history from public, anon, authenticated, service_role;

-- Private scope gate; a null ULP is reserved for template managers.
create function public.ops_ulp_assert_scope(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null or not (case when p_ulp_id is null
    then public.ops_can_manage_master(p_contract_id, p_up3_id)
    else public.ops_vehicle_can_access(p_contract_id, p_up3_id, p_ulp_id) end) then
    raise exception 'Scope access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contract_up3_scopes s
    join public.organization_units u on u.id = s.up3_id and u.type = 'UP3'
    where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.status = 'Aktif') then
    raise exception 'Contract/UP3 scope must be active';
  end if;
  if p_ulp_id is not null and not exists (select 1 from public.organization_units u
    where u.id = p_ulp_id and u.type = 'ULP' and u.parent_id = p_up3_id) then
    raise exception 'ULP must be a direct child of this UP3';
  end if;
end;
$$;

-- Only kind/source_id/required_qty are consumed; all metadata comes from the scoped catalog.
create function public.ops_ulp_resolve_items(p_contract_id uuid, p_up3_id uuid, p_items jsonb, p_publish boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_item jsonb; v_metadata jsonb; v_result jsonb := '[]'; v_seen text[] := '{}';
  v_kind text; v_source uuid; v_key text; v_qty bigint;
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Template management denied' using errcode = '42501';
  end if;
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, null);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;
  if jsonb_array_length(p_items) > 500 or (p_publish and jsonb_array_length(p_items) = 0) then
    raise exception 'Templates allow at most 500 items; publication requires at least one';
  end if;
  for v_item in select a.value from jsonb_array_elements(p_items) a loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'kind', '') not in ('equipment', 'vehicle')
      or jsonb_typeof(v_item -> 'source_id') is distinct from 'string'
      or jsonb_typeof(v_item -> 'required_qty') is distinct from 'number'
      or coalesce(v_item ->> 'required_qty', '') !~ '^[0-9]{1,10}$' then
      raise exception 'Each item requires kind, source_id and an integer required_qty';
    end if;
    v_kind := v_item ->> 'kind'; v_source := (v_item ->> 'source_id')::uuid;
    v_qty := (v_item ->> 'required_qty')::bigint; v_key := v_kind || ':' || v_source::text;
    if v_qty > 2147483647 or (p_publish and v_qty = 0) then
      raise exception 'Required quantity must be 0..2147483647, and positive at publication';
    end if;
    if v_key = any(v_seen) then raise exception 'Duplicate template item: %', v_key; end if;
    v_seen := array_append(v_seen, v_key);
    if v_kind = 'equipment' then
      select jsonb_build_object('name', i.name, 'category', c.name, 'unit', i.unit,
        'specification', coalesce(i.specification, '')) into v_metadata
      from public.ops_equipment_items i join public.ops_equipment_categories c
        on c.id = i.category_id and c.contract_id = i.contract_id and c.up3_id = i.up3_id
      where i.id = v_source and i.contract_id = p_contract_id and i.up3_id = p_up3_id
        and (not p_publish or (i.is_active and c.is_active)) for share of i, c;
    else
      select jsonb_build_object('name', t.name, 'category', 'Kendaraan Operasional', 'unit', 'unit',
        'specification', coalesce(t.description, '')) into v_metadata from public.ops_vehicle_types t
      where t.id = v_source and t.contract_id = p_contract_id and t.up3_id = p_up3_id
        and (not p_publish or t.is_active) for share of t;
    end if;
    if v_metadata is null then raise exception 'Catalog item unavailable in this scope: %', v_key; end if;
    v_result := v_result || jsonb_build_array(v_metadata || jsonb_build_object(
      'key', v_key, 'kind', v_kind, 'source_id', v_source, 'required_qty', v_qty::integer));
  end loop;
  return v_result;
end;
$$;

-- Also protect invariants against direct SQL updates without disabling triggers.
create function public.ops_ulp_guard()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable text[];
begin
  if tg_op = 'DELETE' or tg_table_name = 'ops_ulp_condition_history' then
    raise exception 'ULP records cannot be deleted; history is append-only';
  end if;
  if tg_table_name = 'ops_ulp_templates' then
    perform public.ops_ulp_assert_scope(new.contract_id, new.up3_id, null);
    if tg_op = 'UPDATE' and old.status = 'Published' then raise exception 'Published templates are immutable'; end if;
    v_mutable := array['name', 'contract_reference', 'status', 'items', 'revision', 'updated_at', 'updated_by', 'published_at', 'published_by'];
  else
    if auth.uid() is null or not (case when tg_table_name = 'ops_ulp_template_assignments'
      then public.ops_can_manage_master(new.contract_id, new.up3_id)
      else public.ops_vehicle_can_manage(new.contract_id, new.up3_id, new.ulp_id) end) then
      raise exception 'ULP write denied' using errcode = '42501';
    end if;
    if new.ulp_id is null then raise exception 'ULP is required'; end if;
    perform public.ops_ulp_assert_scope(new.contract_id, new.up3_id, new.ulp_id);
    if not exists (select 1 from public.ops_ulp_templates t where t.id = new.template_id
      and t.contract_id = new.contract_id and t.up3_id = new.up3_id and t.status = 'Published') then
      raise exception 'A published template in the same scope is required';
    end if;
    v_mutable := case when tg_table_name = 'ops_ulp_template_assignments'
      then array['template_id', 'updated_at', 'updated_by'] else array['items', 'status', 'revision', 'updated_at', 'updated_by'] end;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'Record identity, scope, pinned template and creation audit are immutable';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid(); end if;
  if tg_table_name <> 'ops_ulp_template_assignments' then
    new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
  end if;
  return new;
end;
$$;
create trigger ops_ulp_templates_guard before insert or update or delete on public.ops_ulp_templates
  for each row execute function public.ops_ulp_guard();
create trigger ops_ulp_assignments_guard before insert or update or delete on public.ops_ulp_template_assignments
  for each row execute function public.ops_ulp_guard();
create trigger ops_ulp_reports_guard before insert or update or delete on public.ops_ulp_condition_reports
  for each row execute function public.ops_ulp_guard();
create trigger ops_ulp_history_guard before update or delete on public.ops_ulp_condition_history
  for each row execute function public.ops_ulp_guard();

create function public.ops_list_ulp_templates(p_contract_id uuid, p_up3_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Template management denied' using errcode = '42501';
  end if;
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, null);
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc, t.id), '[]'::jsonb)
    from public.ops_ulp_templates t where t.contract_id = p_contract_id and t.up3_id = p_up3_id);
end;
$$;

create function public.ops_save_ulp_template(p_id uuid, p_contract_id uuid, p_up3_id uuid,
  p_expected_revision integer, p_name text, p_contract_reference text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_template public.ops_ulp_templates; v_items jsonb;
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Template management denied' using errcode = '42501';
  end if;
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, null);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 200
    or length(btrim(coalesce(p_contract_reference, ''))) not between 1 and 500 then
    raise exception 'Name (1..200) and contract reference (1..500) are required';
  end if;
  if p_id is not null then
    select t.* into v_template from public.ops_ulp_templates t
      where t.id = p_id and t.contract_id = p_contract_id and t.up3_id = p_up3_id for update;
    if not found or v_template.status <> 'Draft' or v_template.revision is distinct from p_expected_revision then
      raise exception 'Draft not found or revision conflict; reload before saving' using errcode = '40001';
    end if;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'New templates expect revision 0 or null' using errcode = '40001';
  end if;
  v_items := public.ops_ulp_resolve_items(p_contract_id, p_up3_id, p_items, false);
  if p_id is null then
    insert into public.ops_ulp_templates(contract_id, up3_id, name, contract_reference, items, created_by, updated_by)
      values (p_contract_id, p_up3_id, btrim(p_name), btrim(p_contract_reference), v_items, auth.uid(), auth.uid())
      returning * into v_template;
  else
    update public.ops_ulp_templates t set name = btrim(p_name), contract_reference = btrim(p_contract_reference), items = v_items
      where t.id = p_id returning t.* into v_template;
  end if;
  return to_jsonb(v_template);
end;
$$;

create function public.ops_publish_ulp_template(p_template_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_template public.ops_ulp_templates; v_items jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select t.* into v_template from public.ops_ulp_templates t where t.id = p_template_id for update;
  if not found then raise exception 'Template not found'; end if;
  if not public.ops_can_manage_master(v_template.contract_id, v_template.up3_id) then
    raise exception 'Template management denied' using errcode = '42501';
  end if;
  if v_template.status <> 'Draft' or v_template.revision is distinct from p_expected_revision then
    raise exception 'Only the expected Draft revision can be published' using errcode = '40001';
  end if;
  v_items := public.ops_ulp_resolve_items(v_template.contract_id, v_template.up3_id, v_template.items, true);
  update public.ops_ulp_templates t set status = 'Published', items = v_items, published_at = now(), published_by = auth.uid()
    where t.id = p_template_id returning t.* into v_template;
  return to_jsonb(v_template);
end;
$$;

create function public.ops_assign_ulp_template(p_template_id uuid, p_ulp_ids uuid[], p_effective_month date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_template public.ops_ulp_templates; v_ulp uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select t.* into v_template from public.ops_ulp_templates t where t.id = p_template_id;
  if not found then raise exception 'Template not found'; end if;
  if not public.ops_can_manage_master(v_template.contract_id, v_template.up3_id) then
    raise exception 'Template management denied' using errcode = '42501';
  end if;
  if v_template.status <> 'Published' then raise exception 'Only Published templates can be assigned'; end if;
  if p_effective_month is null or not isfinite(p_effective_month) or extract(day from p_effective_month) <> 1 then
    raise exception 'Effective month must be a finite month-first date';
  end if;
  if p_ulp_ids is null or cardinality(p_ulp_ids) not between 1 and 500 then raise exception 'Select 1..500 ULPs'; end if;
  if (select count(distinct u.id) from unnest(p_ulp_ids) u(id)) <> cardinality(p_ulp_ids) then
    raise exception 'Duplicate or null ULP IDs are not allowed';
  end if;
  -- Sorted locks make multi-ULP changes atomic without opposite-order deadlocks.
  for v_ulp in select u.id from unnest(p_ulp_ids) u(id) order by u.id loop
    perform public.ops_ulp_assert_scope(v_template.contract_id, v_template.up3_id, v_ulp);
    perform pg_advisory_xact_lock(hashtextextended('ops_ulp:' || v_template.contract_id::text || ':' || v_template.up3_id::text || ':' || v_ulp::text, 0));
    if exists (select 1 from public.ops_ulp_condition_reports r where r.contract_id = v_template.contract_id
      and r.up3_id = v_template.up3_id and r.ulp_id = v_ulp and r.period_month >= p_effective_month
      and r.template_id <> p_template_id) then raise exception 'Assignment would conflict with an existing report snapshot'; end if;
    insert into public.ops_ulp_template_assignments(contract_id, up3_id, ulp_id, effective_month, template_id, created_by, updated_by)
      values (v_template.contract_id, v_template.up3_id, v_ulp, p_effective_month, p_template_id, auth.uid(), auth.uid())
      on conflict (contract_id, up3_id, ulp_id, effective_month) do update set template_id = excluded.template_id;
  end loop;
  return jsonb_build_object('assigned_count', cardinality(p_ulp_ids));
end;
$$;

create function public.ops_list_ulp_condition_overview(p_contract_id uuid, p_up3_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'ULP overview access denied' using errcode = '42501';
  end if;
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, null);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then
    raise exception 'Period must be a finite month-first date';
  end if;
  return (
    with effective_assignments as (
      select distinct on (a.ulp_id) a.ulp_id, a.template_id
      from public.ops_ulp_template_assignments a
      where a.contract_id = p_contract_id and a.up3_id = p_up3_id and a.effective_month <= p_period_month
      order by a.ulp_id, a.effective_month desc
    )
    select coalesce(jsonb_agg(jsonb_build_object('ulp_id', u.id, 'template_name', t.name,
      'report_status', r.status, 'report_revision', coalesce(r.revision, 0), 'updated_at', r.updated_at,
      'items_count', jsonb_array_length(coalesce(r.items, t.items, '[]'::jsonb)),
      'filled_count', counts.filled_count, 'failed_count', counts.failed_count,
      'has_template', t.id is not null) order by u.id), '[]'::jsonb)
    from public.organization_units u
    left join public.ops_ulp_condition_reports r on r.contract_id = p_contract_id and r.up3_id = p_up3_id
      and r.ulp_id = u.id and r.period_month = p_period_month
    left join effective_assignments a on a.ulp_id = u.id and r.id is null
    left join public.ops_ulp_templates t on t.id = coalesce(r.template_id, a.template_id)
      and t.contract_id = p_contract_id and t.up3_id = p_up3_id and t.status = 'Published'
    left join lateral (
      select count(*) filter (where i.value ->> 'status' in ('compliant', 'non_compliant')) as filled_count,
        count(*) filter (where i.value ->> 'status' = 'non_compliant') as failed_count
      from jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) i(value)
    ) counts on true
    where u.type = 'ULP' and u.parent_id = p_up3_id
  );
end;
$$;

create function public.ops_get_ulp_condition_report(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_template jsonb; v_report jsonb; v_items jsonb; v_history jsonb := '[]';
begin
  if auth.uid() is null or not public.ops_vehicle_can_access(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'ULP read denied' using errcode = '42501';
  end if;
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then
    raise exception 'Period must be a finite month-first date';
  end if;
  select to_jsonb(r) into v_report from public.ops_ulp_condition_reports r
    where r.contract_id = p_contract_id and r.up3_id = p_up3_id and r.ulp_id = p_ulp_id and r.period_month = p_period_month;
  if v_report is not null then
    select to_jsonb(t) into v_template from public.ops_ulp_templates t
      where t.id = (v_report ->> 'template_id')::uuid and t.contract_id = p_contract_id and t.up3_id = p_up3_id;
    v_items := v_report -> 'items';
    select coalesce(jsonb_agg(to_jsonb(h) order by h.revision desc), '[]'::jsonb) into v_history from (
      select x.* from public.ops_ulp_condition_history x where x.report_id = (v_report ->> 'id')::uuid
      order by x.revision desc limit 20) h;
  else
    select to_jsonb(t) into v_template from public.ops_ulp_template_assignments a
      join public.ops_ulp_templates t on t.id = a.template_id and t.contract_id = a.contract_id and t.up3_id = a.up3_id
      where a.contract_id = p_contract_id and a.up3_id = p_up3_id and a.ulp_id = p_ulp_id
        and a.effective_month <= p_period_month and t.status = 'Published' order by a.effective_month desc limit 1;
    select coalesce(jsonb_agg(i.value || jsonb_build_object('good_qty', null, 'bad_qty', null, 'note', '',
      'status', 'unfilled', 'available_qty', null, 'percentage', null) order by i.ord), '[]'::jsonb) into v_items
      from jsonb_array_elements(coalesce(v_template -> 'items', '[]'::jsonb)) with ordinality i(value, ord);
  end if;
  return jsonb_build_object('template', v_template, 'report', v_report, 'items', v_items, 'history', v_history);
end;
$$;

create function public.ops_save_ulp_condition_report(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid,
  p_period_month date, p_template_id uuid, p_expected_revision integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_template public.ops_ulp_templates; v_report public.ops_ulp_condition_reports; v_assigned uuid;
  v_input jsonb := '{}'; v_result jsonb := '[]'; v_item jsonb; v_spec jsonb; v_field text;
  v_good bigint; v_bad bigint; v_status text := 'compliant'; v_row_status text;
begin
  if auth.uid() is null or not public.ops_vehicle_can_manage(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Only Super Admin or the exact Admin ULP may report' using errcode = '42501';
  end if;
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_ulp_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1
    or p_period_month > date_trunc('month', public.ops_business_today())::date then
    raise exception 'Period must be month-first and cannot be in the future';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;
  if jsonb_array_length(p_items) not between 1 and 500 then raise exception 'Reports require 1..500 items'; end if;
  -- Same scope/ULP lock as assignment, before reading either the assignment or report.
  perform pg_advisory_xact_lock(hashtextextended('ops_ulp:' || p_contract_id::text || ':' || p_up3_id::text || ':' || p_ulp_id::text, 0));
  select r.* into v_report from public.ops_ulp_condition_reports r where r.contract_id = p_contract_id
    and r.up3_id = p_up3_id and r.ulp_id = p_ulp_id and r.period_month = p_period_month for update;
  if coalesce(v_report.revision, 0) is distinct from p_expected_revision then
    raise exception 'Report revision conflict; reload before saving' using errcode = '40001';
  end if;
  if v_report.id is not null then
    if v_report.template_id is distinct from p_template_id then raise exception 'Existing report template is pinned'; end if;
  else
    select a.template_id into v_assigned from public.ops_ulp_template_assignments a where a.contract_id = p_contract_id
      and a.up3_id = p_up3_id and a.ulp_id = p_ulp_id and a.effective_month <= p_period_month
      order by a.effective_month desc limit 1;
    if v_assigned is null or v_assigned is distinct from p_template_id then raise exception 'Template must match the effective ULP assignment'; end if;
  end if;
  select t.* into v_template from public.ops_ulp_templates t where t.id = p_template_id
    and t.contract_id = p_contract_id and t.up3_id = p_up3_id and t.status = 'Published';
  if not found then raise exception 'Published template not found in this scope'; end if;
  if jsonb_array_length(p_items) <> jsonb_array_length(v_template.items) then raise exception 'Every template key is required exactly once'; end if;
  for v_item in select i.value from jsonb_array_elements(p_items) i loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'key') is distinct from 'string'
      or v_input ? (v_item ->> 'key') then raise exception 'Invalid or duplicate report key'; end if;
    v_input := v_input || jsonb_build_object(v_item ->> 'key', v_item);
  end loop;
  for v_spec in select i.value from jsonb_array_elements(v_template.items) i loop
    v_item := v_input -> (v_spec ->> 'key');
    if v_item is null then raise exception 'Missing template key or out-of-template entry'; end if;
    foreach v_field in array array['good_qty', 'bad_qty'] loop
      if v_item -> v_field is not null and v_item -> v_field <> 'null'::jsonb then
        if jsonb_typeof(v_item -> v_field) <> 'number' or (v_item ->> v_field) !~ '^[0-9]{1,10}$' then
          raise exception 'Quantities must be null or nonnegative integers';
        end if;
        if (v_item ->> v_field)::bigint > 2147483647 then raise exception 'Quantity exceeds 2147483647'; end if;
      end if;
    end loop;
    if coalesce(jsonb_typeof(v_item -> 'note'), 'null') not in ('string', 'null')
      or length(coalesce(v_item ->> 'note', '')) > 2000 then raise exception 'Note must be text of at most 2000 characters'; end if;
    v_good := (v_item ->> 'good_qty')::bigint; v_bad := (v_item ->> 'bad_qty')::bigint;
    -- A damaged spare fails even if the good quantity meets the requirement.
    v_row_status := case when v_good is null or v_bad is null then 'unfilled'
      when v_bad > 0 or v_good < (v_spec ->> 'required_qty')::bigint then 'non_compliant' else 'compliant' end;
    if v_row_status = 'unfilled' then v_status := 'draft';
    elsif v_row_status = 'non_compliant' and v_status <> 'draft' then v_status := 'non_compliant'; end if;
    v_result := v_result || jsonb_build_array(v_spec || jsonb_build_object('good_qty', v_good, 'bad_qty', v_bad,
      'note', coalesce(v_item ->> 'note', ''), 'status', v_row_status, 'available_qty', v_good + v_bad,
      'percentage', case when v_row_status <> 'unfilled' then least(100::numeric,
        v_good::numeric * 100 / (v_spec ->> 'required_qty')::numeric) else null end));
  end loop;
  if v_report.id is null then
    insert into public.ops_ulp_condition_reports(contract_id, up3_id, ulp_id, period_month, template_id, items, status, created_by, updated_by)
      values (p_contract_id, p_up3_id, p_ulp_id, p_period_month, p_template_id, v_result, v_status, auth.uid(), auth.uid())
      returning * into v_report;
  else
    update public.ops_ulp_condition_reports r set items = v_result, status = v_status
      where r.id = v_report.id returning r.* into v_report;
  end if;
  insert into public.ops_ulp_condition_history(report_id, revision, snapshot, actor_id, actor_role)
    values (v_report.id, v_report.revision, to_jsonb(v_report) || jsonb_build_object('template_name', v_template.name,
      'contract_reference', v_template.contract_reference, 'template_revision', v_template.revision), auth.uid(),
      public.ops_vehicle_actor_role(p_contract_id, p_up3_id, p_ulp_id));
  return public.ops_get_ulp_condition_report(p_contract_id, p_up3_id, p_ulp_id, p_period_month);
end;
$$;

revoke all on function public.ops_ulp_assert_scope(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ops_ulp_resolve_items(uuid, uuid, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.ops_ulp_guard() from public, anon, authenticated, service_role;
revoke all on function public.ops_list_ulp_templates(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ops_save_ulp_template(uuid, uuid, uuid, integer, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ops_publish_ulp_template(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.ops_assign_ulp_template(uuid, uuid[], date) from public, anon, authenticated, service_role;
revoke all on function public.ops_list_ulp_condition_overview(uuid, uuid, date) from public, anon, service_role, authenticated;
revoke all on function public.ops_get_ulp_condition_report(uuid, uuid, uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.ops_save_ulp_condition_report(uuid, uuid, uuid, date, uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ops_list_ulp_templates(uuid, uuid) to authenticated;
grant execute on function public.ops_save_ulp_template(uuid, uuid, uuid, integer, text, text, jsonb) to authenticated;
grant execute on function public.ops_publish_ulp_template(uuid, integer) to authenticated;
grant execute on function public.ops_assign_ulp_template(uuid, uuid[], date) to authenticated;
grant execute on function public.ops_list_ulp_condition_overview(uuid, uuid, date) to authenticated;
grant execute on function public.ops_get_ulp_condition_report(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.ops_save_ulp_condition_report(uuid, uuid, uuid, date, uuid, integer, jsonb) to authenticated;

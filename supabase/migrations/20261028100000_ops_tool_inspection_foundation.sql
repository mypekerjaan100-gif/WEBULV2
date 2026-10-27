-- Inspeksi Alat & Kendaraan per unit fisik.
-- Satu baris mewakili satu alat; penggantian menutup alat lama dan membuat
-- unit baru dengan waktu serah terima sebagai awal masa pakai.

insert into public.authorization_permissions (code, description)
values
  ('alat.inspect', 'Inspect each equipment unit and record findings'),
  ('alat.issue.resolve', 'Resolve equipment issues with replacement handover evidence')
on conflict (code) do nothing;

-- Role custom yang sudah memiliki alat.manage otomatis mendapat izin inspeksi
-- dan penyelesaian issue. Role bawaan tidak diubah.
insert into public.authorization_role_permissions (role_id, permission_id)
select r.id, p.id
from public.authorization_roles r
join public.authorization_permissions p on p.code in ('alat.inspect', 'alat.issue.resolve')
where r.role_namespace = 'CONTRACT'
  and r.is_custom
  and exists (
    select 1
    from public.authorization_role_permissions rp
    join public.authorization_permissions manage on manage.id = rp.permission_id
    where rp.role_id = r.id and manage.code = 'alat.manage'
  )
on conflict do nothing;

create or replace function public.authorization_grant_tool_permissions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manage uuid;
  v_inspect uuid;
  v_resolve uuid;
  v_custom boolean;
begin
  select id into v_manage from public.authorization_permissions where code = 'alat.manage';
  if v_manage is null or new.permission_id <> v_manage then return new; end if;
  select is_custom into v_custom from public.authorization_roles where id = new.role_id;
  if not coalesce(v_custom, false) then return new; end if;
  select id into v_inspect from public.authorization_permissions where code = 'alat.inspect';
  select id into v_resolve from public.authorization_permissions where code = 'alat.issue.resolve';
  insert into public.authorization_role_permissions (role_id, permission_id)
    values (new.role_id, v_inspect) on conflict do nothing;
  insert into public.authorization_role_permissions (role_id, permission_id)
    values (new.role_id, v_resolve) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_authorization_grant_tool_permissions on public.authorization_role_permissions;
create trigger trg_authorization_grant_tool_permissions
  after insert on public.authorization_role_permissions
  for each row execute function public.authorization_grant_tool_permissions();

create table if not exists public.ops_tool_assets (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  slot_id uuid not null references public.ops_prescribed_vehicles(id) on delete restrict,
  equipment_id uuid not null references public.ops_equipment_items(id) on delete restrict,
  equipment_code text not null default '',
  equipment_name text not null,
  equipment_category text not null default '',
  equipment_unit text not null default 'unit',
  specification text not null default '',
  asset_sequence integer not null check (asset_sequence > 0),
  useful_life_months integer check (useful_life_months is null or useful_life_months >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REPLACED')),
  commissioned_at timestamptz,
  commissioned_by uuid references auth.users(id),
  replaced_at timestamptz,
  replaced_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null,
  updated_by uuid not null,
  unique (slot_id, equipment_id, asset_sequence),
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict,
  check (
    (status = 'ACTIVE' and replaced_at is null and replaced_by is null)
    or (status = 'REPLACED' and replaced_at is not null and replaced_by is not null)
  ),
  check (commissioned_at is null or replaced_at is null or replaced_at >= commissioned_at)
);
create index if not exists ops_tool_assets_slot on public.ops_tool_assets(slot_id, equipment_id, asset_sequence);
create index if not exists ops_tool_assets_ulp on public.ops_tool_assets(contract_id, up3_id, ulp_id, status);

create table if not exists public.ops_tool_inspections (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.ops_tool_assets(id) on delete restrict,
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  slot_id uuid not null references public.ops_prescribed_vehicles(id) on delete restrict,
  equipment_id uuid not null references public.ops_equipment_items(id) on delete restrict,
  period_month date not null check (isfinite(period_month) and extract(day from period_month) = 1),
  inspected_at timestamptz not null,
  condition text not null check (condition in ('GOOD', 'DAMAGED')),
  note text not null default '' check (length(note) <= 2000),
  photo_paths jsonb not null check (
    jsonb_typeof(photo_paths) = 'array'
    and jsonb_array_length(photo_paths) between 1 and 5
  ),
  inspected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict
);
create index if not exists ops_tool_inspections_asset on public.ops_tool_inspections(asset_id, inspected_at desc);
create index if not exists ops_tool_inspections_scope on public.ops_tool_inspections(contract_id, up3_id, ulp_id, period_month);

create table if not exists public.ops_tool_issues (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.ops_tool_assets(id) on delete restrict,
  inspection_id uuid not null unique references public.ops_tool_inspections(id) on delete restrict,
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  slot_id uuid not null references public.ops_prescribed_vehicles(id) on delete restrict,
  equipment_id uuid not null references public.ops_equipment_items(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  opened_at timestamptz not null,
  opened_by uuid not null references auth.users(id),
  note text not null default '' check (length(note) <= 2000),
  age_at_failure_months integer check (age_at_failure_months is null or age_at_failure_months >= 0),
  standard_life_months integer check (standard_life_months is null or standard_life_months >= 0),
  damaged_before_life boolean,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  handover_photo_paths jsonb,
  replacement_asset_id uuid references public.ops_tool_assets(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict,
  check (
    (status = 'OPEN' and resolved_at is null and resolved_by is null
      and replacement_asset_id is null and handover_photo_paths is null)
    or (status = 'RESOLVED' and resolved_at is not null and resolved_by is not null
      and replacement_asset_id is not null and handover_photo_paths is not null)
  ),
  check (resolved_at is null or resolved_at >= opened_at),
  check (handover_photo_paths is null or (
    jsonb_typeof(handover_photo_paths) = 'array'
    and jsonb_array_length(handover_photo_paths) between 1 and 5
  ))
);
create index if not exists ops_tool_issues_open on public.ops_tool_issues(contract_id, up3_id, ulp_id, opened_at) where status = 'OPEN';
create unique index if not exists ops_tool_issues_one_open_per_asset
  on public.ops_tool_issues(asset_id) where status = 'OPEN';

alter table public.ops_tool_assets enable row level security;
alter table public.ops_tool_inspections enable row level security;
alter table public.ops_tool_issues enable row level security;
revoke all on table public.ops_tool_assets, public.ops_tool_inspections, public.ops_tool_issues
  from public, anon, authenticated, service_role;

-- Seed satu unit fisik per jumlah kontrak pada template slot.
create or replace function public.ops_seed_tool_assets(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.ops_prescribed_vehicles;
  v_item record;
  v_seq integer;
begin
  select * into s from public.ops_prescribed_vehicles where id = p_slot_id;
  if not found then return; end if;
  if exists (select 1 from public.ops_tool_assets where slot_id = p_slot_id) then return; end if;
  for v_item in
    select ti.equipment_id,
           ti.required_qty,
           coalesce(nullif(btrim(ti.equipment_name), ''), nullif(btrim(i.name), ''), 'Alat') as equipment_name,
           coalesce(nullif(btrim(ti.equipment_code), ''), nullif(btrim(i.code), ''), '') as equipment_code,
           coalesce(nullif(btrim(ti.equipment_category_name), ''), nullif(btrim(c.name), ''), '') as equipment_category,
           coalesce(nullif(btrim(ti.equipment_unit), ''), nullif(btrim(i.unit), ''), 'unit') as equipment_unit,
           coalesce(ti.useful_life_months, i.age_months) as useful_life_months,
           coalesce(i.specification, '') as specification
    from public.ops_equipment_template_items ti
    left join public.ops_equipment_items i
      on i.id = ti.equipment_id and i.contract_id = s.contract_id and i.up3_id = s.up3_id
    left join public.ops_equipment_categories c
      on c.id = i.category_id and c.contract_id = s.contract_id and c.up3_id = s.up3_id
    where ti.template_id = s.template_id
    order by ti.sort_order, ti.equipment_id
  loop
    if v_item.required_qty > 0 then
      for v_seq in 1..v_item.required_qty loop
        insert into public.ops_tool_assets (
          contract_id, up3_id, ulp_id, slot_id, equipment_id,
          equipment_code, equipment_name, equipment_category, equipment_unit,
          specification, asset_sequence, useful_life_months, status,
          created_by, updated_by
        ) values (
          s.contract_id, s.up3_id, s.ulp_id, s.id, v_item.equipment_id,
          v_item.equipment_code, v_item.equipment_name, v_item.equipment_category, v_item.equipment_unit,
          v_item.specification, v_seq, v_item.useful_life_months, 'ACTIVE',
          s.created_by, s.updated_by
        );
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.ops_seed_tool_assets_after_slot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ops_seed_tool_assets(new.id);
  return new;
end;
$$;

drop trigger if exists trg_ops_seed_tool_assets on public.ops_prescribed_vehicles;
create trigger trg_ops_seed_tool_assets
  after insert on public.ops_prescribed_vehicles
  for each row execute function public.ops_seed_tool_assets_after_slot();

revoke all on function public.ops_seed_tool_assets(uuid) from public, anon, authenticated, service_role;

do $$
declare s record;
begin
  for s in select id from public.ops_prescribed_vehicles loop
    perform public.ops_seed_tool_assets(s.id);
  end loop;
end;
$$;

create or replace function public.ops_tool_assets_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Tool assets cannot be deleted; history is append-only';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['status', 'replaced_at', 'replaced_by', 'updated_at', 'updated_by'])
      is distinct from (to_jsonb(old) - array['status', 'replaced_at', 'replaced_by', 'updated_at', 'updated_by']) then
      raise exception 'Tool identity, scope, and commissioning date are immutable';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_ops_tool_assets_guard on public.ops_tool_assets;
create trigger trg_ops_tool_assets_guard
  before update or delete on public.ops_tool_assets
  for each row execute function public.ops_tool_assets_guard();

create or replace function public.ops_tool_inspections_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Tool inspections are append-only';
end;
$$;
drop trigger if exists trg_ops_tool_inspections_guard on public.ops_tool_inspections;
create trigger trg_ops_tool_inspections_guard
  before update or delete on public.ops_tool_inspections
  for each row execute function public.ops_tool_inspections_guard();

create or replace function public.ops_tool_issues_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Tool issues cannot be deleted'; end if;
  if old.status <> 'OPEN' or new.status <> 'RESOLVED' then
    raise exception 'Only an open issue can be resolved';
  end if;
  if (to_jsonb(new) - array['status', 'resolved_at', 'resolved_by', 'resolution_note',
      'handover_photo_paths', 'replacement_asset_id', 'age_at_failure_months',
      'standard_life_months', 'damaged_before_life', 'revision', 'updated_at'])
    is distinct from (to_jsonb(old) - array['status', 'resolved_at', 'resolved_by', 'resolution_note',
      'handover_photo_paths', 'replacement_asset_id', 'age_at_failure_months',
      'standard_life_months', 'damaged_before_life', 'revision', 'updated_at']) then
    raise exception 'Issue identity and opening evidence are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ops_tool_issues_guard on public.ops_tool_issues;
create trigger trg_ops_tool_issues_guard
  before update or delete on public.ops_tool_issues
  for each row execute function public.ops_tool_issues_guard();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ops-tool-evidence', 'ops-tool-evidence', false, 5242880, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

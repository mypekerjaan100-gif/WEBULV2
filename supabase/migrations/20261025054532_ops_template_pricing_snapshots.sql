alter table public.ops_equipment_template_items add column if not exists bpp_amount numeric(18,2);
alter table public.ops_equipment_template_items add column if not exists monthly_cost numeric(18,2);
alter table public.ops_equipment_template_items add column if not exists useful_life_months integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_equipment_template_items'::regclass
      and conname = 'ops_equipment_template_items_bpp_amount_check'
  ) then
    alter table public.ops_equipment_template_items
      add constraint ops_equipment_template_items_bpp_amount_check
      check (bpp_amount is null or bpp_amount >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_equipment_template_items'::regclass
      and conname = 'ops_equipment_template_items_monthly_cost_check'
  ) then
    alter table public.ops_equipment_template_items
      add constraint ops_equipment_template_items_monthly_cost_check
      check (monthly_cost is null or monthly_cost >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_equipment_template_items'::regclass
      and conname = 'ops_equipment_template_items_useful_life_months_check'
  ) then
    alter table public.ops_equipment_template_items
      add constraint ops_equipment_template_items_useful_life_months_check
      check (useful_life_months is null or useful_life_months >= 0);
  end if;
end;
$$;

update public.ops_equipment_template_items ti
set bpp_amount = i.bpp_amount,
    monthly_cost = coalesce(i.monthly_cost, round(i.bpp_amount / nullif(i.age_months, 0), 2)),
    useful_life_months = i.age_months
from public.ops_equipment_items i, public.ops_equipment_templates t
where i.id = ti.equipment_id
  and t.id = ti.template_id
  and i.contract_id = t.contract_id
  and i.up3_id = t.up3_id;

create or replace function public.ops_snapshot_template_item_prices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  select i.bpp_amount,
         coalesce(i.monthly_cost, round(i.bpp_amount / nullif(i.age_months, 0), 2)),
         i.age_months
  into new.bpp_amount, new.monthly_cost, new.useful_life_months
  from public.ops_equipment_items i
  join public.ops_equipment_templates t on t.id = new.template_id
  where i.id = new.equipment_id
    and i.contract_id = t.contract_id
    and i.up3_id = t.up3_id;
  if not found then
    new.bpp_amount := null;
    new.monthly_cost := null;
    new.useful_life_months := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ops_template_items_price_snapshot on public.ops_equipment_template_items;
create trigger trg_ops_template_items_price_snapshot
  before insert or update on public.ops_equipment_template_items
  for each row execute function public.ops_snapshot_template_item_prices();

revoke all on function public.ops_snapshot_template_item_prices() from public, anon, authenticated, service_role;

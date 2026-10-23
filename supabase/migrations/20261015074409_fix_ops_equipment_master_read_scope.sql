-- Mirror migrasi server (20261015074409 fix_ops_equipment_master_read_scope).
-- Direkonstruksi 1:1 dari definisi live pada server agar replai lokal identik:
-- akses baca master memakai predikat ops_can_read_master (kontrak + UP3).
-- Non-destruktif: hanya membuat/mengganti fungsi dan policy SELECT.

create or replace function public.ops_can_read_master(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
    )
  )
$function$;

drop policy if exists ops_master_select on public.ops_vehicle_types;
create policy ops_master_select on public.ops_vehicle_types for select to authenticated
  using (public.ops_can_read_master(ops_vehicle_types.contract_id, ops_vehicle_types.up3_id));

drop policy if exists ops_master_select on public.ops_vehicle_assignments;
create policy ops_master_select on public.ops_vehicle_assignments for select to authenticated
  using (public.ops_can_read_master(ops_vehicle_assignments.contract_id, ops_vehicle_assignments.up3_id));

drop policy if exists ops_master_select on public.ops_equipment_categories;
create policy ops_master_select on public.ops_equipment_categories for select to authenticated
  using (public.ops_can_read_master(ops_equipment_categories.contract_id, ops_equipment_categories.up3_id));

drop policy if exists ops_master_select on public.ops_equipment_items;
create policy ops_master_select on public.ops_equipment_items for select to authenticated
  using (public.ops_can_read_master(ops_equipment_items.contract_id, ops_equipment_items.up3_id));

drop policy if exists ops_master_select on public.ops_equipment_templates;
create policy ops_master_select on public.ops_equipment_templates for select to authenticated
  using (public.ops_can_read_master(ops_equipment_templates.contract_id, ops_equipment_templates.up3_id));

drop policy if exists ops_master_select on public.ops_equipment_template_items;
create policy ops_master_select on public.ops_equipment_template_items for select to authenticated
  using (exists (
    select 1 from public.ops_equipment_templates t
    where t.id = ops_equipment_template_items.template_id
      and public.ops_can_read_master(t.contract_id, t.up3_id)));

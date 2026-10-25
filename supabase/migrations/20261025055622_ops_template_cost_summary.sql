create or replace function public.ops_list_template_costs(p_contract_id uuid, p_up3_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'template_id', t.id,
    'total_monthly_cost', coalesce(c.total_monthly_cost, 0),
    'incomplete_items', coalesce(c.incomplete_items, 0)
  ) order by t.template_name), '[]'::jsonb)
  from public.ops_equipment_templates t
  left join lateral (
    select sum(ti.monthly_cost * ti.required_qty) as total_monthly_cost,
           count(*) filter (where ti.monthly_cost is null) as incomplete_items
    from public.ops_equipment_template_items ti
    where ti.template_id = t.id
  ) c on true
  where t.contract_id = p_contract_id
    and t.up3_id = p_up3_id
    and public.ops_can_read_master(p_contract_id, p_up3_id);
$function$;

revoke all on function public.ops_list_template_costs(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.ops_list_template_costs(uuid, uuid) to authenticated;

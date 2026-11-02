-- Monthly tool conditions are a projection of dated inspections and handovers.
-- Original snapshots and append-only history remain intact for audit.
alter function public.ops_get_vehicle_condition_report(uuid,uuid,uuid,date)
  rename to ops_get_vehicle_condition_report_snapshot;
revoke all on function public.ops_get_vehicle_condition_report_snapshot(uuid,uuid,uuid,date) from public,anon,authenticated,service_role;

create or replace function public.ops_get_vehicle_condition_report(p_contract_id uuid,p_up3_id uuid,p_ulp_id uuid,p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_bundle jsonb; v_items jsonb := '[]'; v_summaries jsonb := '[]'; v_item jsonb; v_vehicle jsonb;
  v_start timestamptz; v_end timestamptz; v_required integer; v_bad integer; v_checked integer;
  v_total integer; v_inspected integer; v_issues integer; v_default boolean; v_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_bundle := public.ops_get_vehicle_condition_report_snapshot(p_contract_id,p_up3_id,p_ulp_id,p_period_month);
  v_start := p_period_month::timestamp at time zone 'Asia/Pontianak';
  v_end := (p_period_month::timestamp + interval '1 month') at time zone 'Asia/Pontianak';
  for v_vehicle in select value from jsonb_array_elements(v_bundle->'vehicles') loop
    v_total:=0; v_inspected:=0; v_issues:=0;
    select bool_and((x->>'good_qty') is null and (x->>'bad_qty') is null) into v_default
    from jsonb_array_elements(v_bundle->'items') x where x->>'vehicle_id'=v_vehicle->>'id';
    for v_item in select value from jsonb_array_elements(v_bundle->'items') where value->>'vehicle_id'=v_vehicle->>'id' loop
      v_required := (v_item->>'required_qty')::integer;
      if v_item->>'kind'='vehicle' then
        if v_default then
          v_item:=v_item||jsonb_build_object('good_qty',1,'bad_qty',0,'available_qty',1,'percentage',100,'status','compliant');
        end if;
      else
        -- Count damage at the end of the selected month, including unresolved carryover.
        select count(*) into v_bad from public.ops_tool_issues i
        where i.contract_id=p_contract_id and i.up3_id=p_up3_id and i.ulp_id=p_ulp_id
          and i.slot_id=(v_vehicle->>'id')::uuid and i.equipment_id=(v_item->>'equipment_id')::uuid
          and i.opened_at<v_end and (i.resolved_at is null or i.resolved_at>=v_end);
        -- Only units still present at period end count toward this month's coverage.
        -- A replacement needs its own inspection; handover is not an inspection.
        select count(*) into v_checked from public.ops_tool_assets a
        where a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.ulp_id=p_ulp_id
          and a.slot_id=(v_vehicle->>'id')::uuid and a.equipment_id=(v_item->>'equipment_id')::uuid
          and (a.commissioned_at is null or a.commissioned_at<v_end)
          and (a.replaced_at is null or a.replaced_at>=v_end)
          and exists(select 1 from public.ops_tool_inspections i where i.asset_id=a.id
            and i.inspected_at>=v_start and i.inspected_at<v_end);
        v_total:=v_total+v_required; v_inspected:=v_inspected+least(v_required,v_checked); v_issues:=v_issues+v_bad;
        v_item:=v_item||jsonb_build_object('good_qty',greatest(0,v_required-v_bad),'bad_qty',v_bad,
          'available_qty',v_required,'percentage',case when v_required>0 then greatest(0,v_required-v_bad)::numeric*100/v_required end,
          'status',case when v_bad>v_required then 'invalid' when v_bad>0 then 'non_compliant' else 'compliant' end);
      end if;
      v_items:=v_items||jsonb_build_array(v_item);
    end loop;
    v_summaries:=v_summaries||jsonb_build_array(jsonb_build_object('vehicle_id',v_vehicle->>'id',
      'total',v_total,'inspected',v_inspected,'uninspected',v_total-v_inspected,'open_issues',v_issues));
  end loop;
  v_status:=case when jsonb_array_length(v_bundle->'vehicles')=0 then 'no_assigned_vehicles'
    when exists(select 1 from jsonb_array_elements(v_bundle->'vehicles') v where nullif(v->>'plate_display','') is null)
      or exists(select 1 from jsonb_array_elements(v_items) i where i->>'good_qty' is null or i->>'bad_qty' is null or i->>'status'='invalid') then 'draft'
    when exists(select 1 from jsonb_array_elements(v_items) i where i->>'status'='non_compliant') then 'non_compliant' else 'compliant' end;
  return v_bundle||jsonb_build_object('items',v_items,'inspection_summary',v_summaries,'effective_status',v_status);
end;
$$;
revoke all on function public.ops_get_vehicle_condition_report(uuid,uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.ops_get_vehicle_condition_report(uuid,uuid,uuid,date) to authenticated;

-- Existing save validation/audit is retained, but tool values are server-derived.
-- A stale client or manual API request cannot overwrite inspection-derived values.
do $$
declare v_source text; v_old text := 'v_good := (v_item ->> ''good_qty'')::bigint; v_bad := (v_item ->> ''bad_qty'')::bigint;';
begin
  v_source:=pg_get_functiondef('public.ops_save_vehicle_condition_report(uuid,uuid,uuid,date,integer,jsonb)'::regprocedure);
  if position(v_old in v_source)=0 then raise exception 'Unexpected monthly save function definition'; end if;
  v_source:=replace(v_source,v_old,v_old||E'\n    if v_spec ->> ''kind'' <> ''vehicle'' then\n      v_good := (v_spec ->> ''good_qty'')::bigint; v_bad := (v_spec ->> ''bad_qty'')::bigint;\n    end if;');
  execute v_source;
end;
$$;

create or replace function public.ops_list_vehicle_condition_overview(p_contract_id uuid,p_up3_id uuid,p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_unit record; v_bundle jsonb; v_result jsonb:='[]'; v_missing integer; v_filled integer; v_failed integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id,p_up3_id,null);
  for v_unit in select id from public.organization_units where type='ULP' and parent_id=p_up3_id order by sort_order,legacy_key,id loop
    v_bundle:=public.ops_get_vehicle_condition_report(p_contract_id,p_up3_id,v_unit.id,p_period_month);
    select count(*) into v_missing from jsonb_array_elements(v_bundle->'vehicles') v where nullif(v->>'plate_display','') is null;
    select count(*) filter(where i->>'status' in ('compliant','non_compliant')),
      count(*) filter(where i->>'status'='non_compliant') into v_filled,v_failed from jsonb_array_elements(v_bundle->'items') i;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('ulp_id',v_unit.id,'vehicle_count',jsonb_array_length(v_bundle->'vehicles'),
      'missing_plates',v_missing,'items_count',jsonb_array_length(v_bundle->'items'),'filled_count',v_filled,'failed_count',v_failed,
      'report_status',v_bundle->>'effective_status','updated_at',v_bundle->'report'->'updated_at'));
  end loop;
  return v_result;
end;
$$;
notify pgrst,'reload schema';

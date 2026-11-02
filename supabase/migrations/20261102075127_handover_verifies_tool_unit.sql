-- Serah Terima alat pengganti dengan bukti foto adalah verifikasi unit.
-- Unit pengganti tidak perlu inspeksi ulang hanya karena nomor unit tetap.

create index if not exists ops_tool_issues_replacement_asset
  on public.ops_tool_issues(replacement_asset_id)
  where replacement_asset_id is not null;

create or replace function public.ops_get_tool_inspection_bundle(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_vehicles jsonb := '[]'::jsonb;
  v_assets jsonb;
  v_slot record;
  v_template_name text;
  v_template_version text;
  v_loc text;
  v_loc_type text;
  v_history jsonb;
  v_open jsonb;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if not public.ops_tool_can_read_scope(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Tidak berwenang melihat alat pada ULP ini' using errcode = '42501';
  end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);

  for v_slot in
    select s.* from public.ops_prescribed_vehicles s
    where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.ulp_id = p_ulp_id
      and (
        (s.effective_month <= public.ops_business_today()
          and (s.end_month is null or public.ops_business_today() < s.end_month))
        or exists (
          select 1 from public.ops_tool_issues i
          where i.slot_id = s.id and i.status = 'OPEN'
        )
      )
    order by s.label, s.id
  loop
    select coalesce(t.template_name, ''), coalesce(t.version_number::text, '')
    into v_template_name, v_template_version
    from public.ops_equipment_templates t
    where t.id = v_slot.template_id;

    select l.type,
      (select h.name from public.location_name_history h
       where h.location_id = l.id and h.effective_from <= public.ops_business_today()
         and (h.effective_to is null or h.effective_to > public.ops_business_today())
       order by h.effective_from desc limit 1)
    into v_loc_type, v_loc
    from public.locations l
    where l.id = v_slot.location_id;

    select coalesce(jsonb_agg(asset_row order by category_name, equipment_name, asset_sequence), '[]'::jsonb)
    into v_assets
    from (
      select jsonb_build_object(
        'id', a.id,
        'equipment_id', a.equipment_id,
        'equipment_code', a.equipment_code,
        'equipment_name', a.equipment_name,
        'equipment_category', a.equipment_category,
        'equipment_unit', a.equipment_unit,
        'specification', a.specification,
        'asset_sequence', a.asset_sequence,
        'status', a.status,
        'commissioned_at', a.commissioned_at,
        'useful_life_months', a.useful_life_months,
        'age_months', cal.age_months,
        'remaining_months', case
          when cal.age_months is null or a.useful_life_months is null then null
          else a.useful_life_months - cal.age_months
        end,
        'latest_inspection', (
          select jsonb_build_object(
            'id', i.id, 'inspected_at', i.inspected_at, 'condition', i.condition,
            'note', i.note, 'photo_paths', i.photo_paths,
            'inspected_by', i.inspected_by, 'inspected_by_name', p.display_name
          )
          from public.ops_tool_inspections i
          left join public.profiles p on p.id = i.inspected_by
          where i.asset_id = a.id
          order by i.inspected_at desc, i.created_at desc
          limit 1
        ),
        'handover', (
          select jsonb_build_object(
            'issue_id', x.id, 'resolved_at', x.resolved_at,
            'note', x.resolution_note, 'photo_paths', x.handover_photo_paths,
            'resolved_by', x.resolved_by, 'resolved_by_name', p.display_name
          )
          from public.ops_tool_issues x
          left join public.profiles p on p.id = x.resolved_by
          where x.replacement_asset_id = a.id and x.status = 'RESOLVED'
          order by x.resolved_at desc
          limit 1
        ),
        'open_issue', (
          select jsonb_build_object(
            'id', x.id, 'opened_at', x.opened_at, 'note', x.note,
            'age_at_failure_months', x.age_at_failure_months,
            'standard_life_months', x.standard_life_months,
            'damaged_before_life', x.damaged_before_life,
            'revision', x.revision
          )
          from public.ops_tool_issues x
          where x.asset_id = a.id and x.status = 'OPEN'
          limit 1
        )
      ) as asset_row,
      a.equipment_category as category_name,
      a.equipment_name,
      a.asset_sequence
      from public.ops_tool_assets a
      cross join lateral (
        select public.ops_tool_age_months(a.commissioned_at, now()) as age_months
      ) cal
      where a.slot_id = v_slot.id and a.status = 'ACTIVE'
    ) rows;

    v_vehicles := v_vehicles || jsonb_build_array(jsonb_build_object(
      'id', v_slot.id,
      'label', v_slot.label,
      'plate_display', v_slot.plate_display,
      'plate_normalized', v_slot.plate_normalized,
      'revision', v_slot.revision,
      'template_name', v_template_name,
      'template_version', v_template_version,
      'location_name', v_loc,
      'location_type', v_loc_type,
      'assets', v_assets
    ));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_id', h.id,
    'asset_id', h.asset_id,
    'vehicle_id', h.slot_id,
    'equipment_name', h.equipment_name,
    'opened_at', h.opened_at,
    'resolved_at', h.resolved_at,
    'age_at_failure_months', h.age_at_failure_months,
    'standard_life_months', h.standard_life_months,
    'damaged_before_life', h.damaged_before_life,
    'inspection_photo_paths', h.inspection_photo_paths,
    'resolution_note', h.resolution_note,
    'handover_photo_paths', h.handover_photo_paths,
    'replacement_asset_id', h.replacement_asset_id,
    'resolved_by_name', h.resolved_by_name
  ) order by h.resolved_at desc), '[]'::jsonb)
  into v_history
  from (
    select i.id, i.asset_id, i.slot_id, a.equipment_name, i.opened_at, i.resolved_at,
      i.age_at_failure_months, i.standard_life_months, i.damaged_before_life,
      ins.photo_paths as inspection_photo_paths,
      i.resolution_note, i.handover_photo_paths, i.replacement_asset_id,
      p.display_name as resolved_by_name
    from public.ops_tool_issues i
    join public.ops_tool_assets a on a.id = i.asset_id
    left join public.ops_tool_inspections ins on ins.id = i.inspection_id
    left join public.profiles p on p.id = i.resolved_by
    where i.contract_id = p_contract_id and i.up3_id = p_up3_id and i.ulp_id = p_ulp_id
      and i.status = 'RESOLVED'
    order by i.resolved_at desc
    limit 50
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'asset_id', i.asset_id,
    'vehicle_id', i.slot_id,
    'vehicle_label', s.label,
    'plate_display', s.plate_display,
    'equipment_name', a.equipment_name,
    'opened_at', i.opened_at,
    'note', i.note,
    'age_at_failure_months', i.age_at_failure_months,
    'standard_life_months', i.standard_life_months,
    'damaged_before_life', i.damaged_before_life,
    'revision', i.revision
  ) order by i.opened_at), '[]'::jsonb)
  into v_open
  from public.ops_tool_issues i
  join public.ops_tool_assets a on a.id = i.asset_id
  join public.ops_prescribed_vehicles s on s.id = i.slot_id
  where i.contract_id = p_contract_id and i.up3_id = p_up3_id
    and i.ulp_id = p_ulp_id and i.status = 'OPEN';

  return jsonb_build_object(
    'vehicles', v_vehicles,
    'history', v_history,
    'open_issues', v_open
  );
end;
$function$;

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
        -- A replacement handed over with evidence is verified in the handover month.
        select count(*) into v_checked from public.ops_tool_assets a
        where a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.ulp_id=p_ulp_id
          and a.slot_id=(v_vehicle->>'id')::uuid and a.equipment_id=(v_item->>'equipment_id')::uuid
          and (a.commissioned_at is null or a.commissioned_at<v_end)
          and (a.replaced_at is null or a.replaced_at>=v_end)
          and (
            exists(select 1 from public.ops_tool_inspections i where i.asset_id=a.id
              and i.inspected_at>=v_start and i.inspected_at<v_end)
            or exists(select 1 from public.ops_tool_issues h where h.replacement_asset_id=a.id
              and h.status='RESOLVED' and h.resolved_at>=v_start and h.resolved_at<v_end)
          );
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

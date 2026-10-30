-- Run through a privileged SQL connection only. All test writes are rolled back.
-- Actors, units, and indicators are discovered from active memberships, never created or imported.
begin;
do $$
declare
  v_scope record; v_other_unit uuid; v_up3_actor uuid; v_indicator uuid;
  v_values jsonb; v_saved integer; v_revision integer; v_target numeric; v_achievement numeric;
  v_month date:='2026-10-01'; v_expected numeric; v_financial jsonb; v_trend jsonb;
  v_legacy_entries text; v_legacy_wo text; v_audit_before integer;
begin
  select v.id version_id,v.contract_id,v.up3_id,m.operational_unit_id unit_id,m.user_id actor_id
  into strict v_scope
  from public.sla_versions v
  join public.contract_memberships m on m.contract_id=v.contract_id and m.operational_up3_id=v.up3_id
    and m.contract_role='ADMIN_ULP' and m.status='ACTIVE' and m.effective_from<=current_date and (m.effective_to is null or current_date<m.effective_to)
  join public.organization_units u on u.id=m.operational_unit_id and u.parent_id=v.up3_id and u.type='ULP' and u.own_status='Aktif'
  where v.status='ACTIVE' and v_month between v.period_start and v.period_end order by m.user_id limit 1;
  select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) into v_legacy_entries from public.variable_cost_entries e;
  select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id)::text,'')) into v_legacy_wo from public.variable_cost_manual_wo w;
  select count(*) into v_audit_before from public.variable_cost_monthly_history where contract_id=v_scope.contract_id and up3_id=v_scope.up3_id and unit_id=v_scope.unit_id and period_month=v_month;
  perform set_config('request.jwt.claim.sub',v_scope.actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_scope.actor_id,'role','authenticated')::text,true);
  with codes(code) as (values('2.1a'),('2.1b'),('2.1c'),('2.1d'),('3.1a'),('3.1b'),('3.2a'),('3.2b'),('TEBANG_20_40_CM'),('TEBANG_40_60_CM'))
  select jsonb_agg(jsonb_build_object('indicator_code',c.code,'work_order',coalesce(a.work_order,0)+1,'realization',coalesce(a.realization,0)+2,'expected_revision',coalesce(a.revision,0)))
  into v_values from codes c left join public.variable_cost_monthly_actuals a on a.contract_id=v_scope.contract_id and a.up3_id=v_scope.up3_id and a.unit_id=v_scope.unit_id and a.period_month=v_month and a.indicator_code=c.code;
  v_saved:=public.save_variable_monthly_actuals(v_scope.contract_id,v_scope.up3_id,v_scope.unit_id,v_scope.version_id,v_month,v_values);
  assert v_saved=10,'All ten monthly indicators must save atomically';
  assert (select count(*)=10 from public.variable_cost_monthly_actuals where contract_id=v_scope.contract_id and up3_id=v_scope.up3_id and unit_id=v_scope.unit_id and period_month=v_month),'Ten monthly rows';
  assert (select count(*)=v_audit_before+10 from public.variable_cost_monthly_history where contract_id=v_scope.contract_id and up3_id=v_scope.up3_id and unit_id=v_scope.unit_id and period_month=v_month),'Every changed value is audited';
  assert (select count(*)=8 from public.sla_entries e join public.sla_indicators i on i.id=e.indicator_id where e.contract_id=v_scope.contract_id and e.up3_id=v_scope.up3_id and e.unit_id=v_scope.unit_id and e.period_month=v_month and e.sla_version_id=v_scope.version_id and e.source_type='VARIABLE_COST_AGGREGATE' and i.variable_cost_profile='STANDARD'),'Exactly eight SLA aggregates';
  assert not exists(select 1 from public.sla_entries where unit_id=v_scope.unit_id and period_month=v_month and indicator_id in ('7e5b0214-f394-4f1e-86ad-2040d1972040','b612e8c7-68b6-4ed7-9bba-4060d1974060')),'Tebang must never enter SLA';
  select i.id into strict v_indicator from public.sla_indicators i where i.sla_version_id=v_scope.version_id and i.point_code='2.1a';
  select t.target_value into v_target from public.sla_targets t where t.contract_id=v_scope.contract_id and t.up3_id=v_scope.up3_id and t.unit_id=v_scope.unit_id and t.period_month=v_month and t.indicator_id=v_indicator and t.target_scope='ULP';
  select case when v_target>0 and a.work_order>0 then round(a.realization/least(v_target,a.work_order)*100,4) end into v_achievement
  from public.variable_cost_monthly_actuals a where a.contract_id=v_scope.contract_id and a.up3_id=v_scope.up3_id and a.unit_id=v_scope.unit_id and a.period_month=v_month and a.indicator_code='2.1a';
  assert (select achievement is not distinct from v_achievement from public.sla_entries where unit_id=v_scope.unit_id and sla_version_id=v_scope.version_id and indicator_id=v_indicator and period_month=v_month),'Canonical SLA calculation';
  begin
    perform public.save_variable_monthly_actuals(v_scope.contract_id,v_scope.up3_id,v_scope.unit_id,v_scope.version_id,v_month,v_values);
    raise exception 'Expected revision conflict was not raised';
  exception when serialization_failure then null; end;
  select u.id into v_other_unit from public.organization_units u where u.parent_id=v_scope.up3_id and u.type='ULP' and u.own_status='Aktif' and u.id<>v_scope.unit_id
    and not exists(select 1 from public.contract_memberships m where m.user_id=v_scope.actor_id and m.operational_unit_id=u.id and m.contract_role='ADMIN_ULP' and m.status='ACTIVE') limit 1;
  assert v_other_unit is not null,'Need another ULP to test isolation';
  begin
    perform public.save_variable_monthly_actuals(v_scope.contract_id,v_scope.up3_id,v_other_unit,v_scope.version_id,v_month,jsonb_build_array(v_values->0));
    raise exception 'Expected cross-ULP denial was not raised';
  exception when insufficient_privilege then null; end;
  set local role authenticated;
  assert not exists(select 1 from public.variable_cost_monthly_actuals where unit_id<>v_scope.unit_id),'RLS: ULP cannot see other units';
  assert not exists(select 1 from public.variable_cost_monthly_history where unit_id<>v_scope.unit_id),'History RLS: ULP cannot see other units';
  reset role;
  select revision into v_revision from public.variable_cost_monthly_actuals where contract_id=v_scope.contract_id and up3_id=v_scope.up3_id and unit_id=v_scope.unit_id and period_month=v_month and indicator_code='2.1a';
  perform public.save_variable_monthly_actuals(v_scope.contract_id,v_scope.up3_id,v_scope.unit_id,v_scope.version_id,v_month,jsonb_build_array(jsonb_build_object('indicator_code','2.1a','work_order',0,'realization',0,'expected_revision',v_revision)));
  assert (select work_order=0 and realization=0 from public.sla_entries where unit_id=v_scope.unit_id and indicator_id=v_indicator and period_month=v_month),'Explicit zero is preserved in SLA';
  perform public.save_variable_monthly_actuals(v_scope.contract_id,v_scope.up3_id,v_scope.unit_id,v_scope.version_id,v_month,jsonb_build_array(jsonb_build_object('indicator_code','2.1a','work_order',null,'realization',null,'expected_revision',v_revision+1)));
  assert not exists(select 1 from public.sla_entries where unit_id=v_scope.unit_id and indicator_id=v_indicator and period_month=v_month and source_type='VARIABLE_COST_AGGREGATE'),'Clearing values clears only derived SLA';
  select m.user_id into strict v_up3_actor from public.contract_memberships m where m.contract_id=v_scope.contract_id and m.operational_up3_id=v_scope.up3_id and m.contract_role='ADMIN_UP3' and m.status='ACTIVE' and m.effective_from<=current_date and (m.effective_to is null or current_date<m.effective_to) order by m.user_id limit 1;
  perform set_config('request.jwt.claim.sub',v_up3_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_up3_actor,'role','authenticated')::text,true);
  begin
    perform public.save_variable_monthly_actuals(v_scope.contract_id,v_scope.up3_id,v_scope.unit_id,v_scope.version_id,v_month,v_values);
    raise exception 'Expected UP3 write denial was not raised';
  exception when insufficient_privilege then null; end;
  select coalesce(sum(r.revenue_amount),0) into v_expected from public.list_variable_actual_revenue(v_scope.contract_id,v_scope.up3_id,v_month,v_scope.unit_id) r;
  assert not exists(select 1 from public.list_variable_actual_revenue(v_scope.contract_id,v_scope.up3_id,v_month,v_scope.unit_id) r join public.sla_indicators i on i.id=r.indicator_id where i.point_code='3.1a'),'ROW Fix is not billable';
  assert not exists(select 1 from public.list_variable_actual_revenue(v_scope.contract_id,v_scope.up3_id,v_month,v_scope.unit_id) r where r.source_type='UNIT_RATE' and r.realization is not null and r.unit_price is not null and r.revenue_amount<>r.realization*r.unit_price),'Monthly revenue formula';
  v_financial:=public.get_variable_financial_dashboard(v_scope.contract_id,v_scope.up3_id,v_month,v_scope.unit_id);
  assert (v_financial->'summary'->>'actual_amount')::numeric=v_expected,'Financial Dashboard reconciles exactly to canonical revenue';
  assert (v_financial->'summary'->>'missing_actual_count')::integer>0,'Blank remains missing, not zero';
  assert v_financial->'summary'->>'difference_amount' is null,'Incomplete actuals cannot produce a final difference';
  v_trend:=public.get_variable_financial_trend(v_scope.contract_id,v_scope.up3_id,v_month,v_scope.unit_id,6);
  assert (v_trend->'months'->-1->>'actual_amount')::numeric=v_expected,'Trend reconciles with recap and snapshot';
  assert (select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,''))=v_legacy_entries from public.variable_cost_entries e),'Legacy entries are unchanged';
  assert (select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id)::text,''))=v_legacy_wo from public.variable_cost_manual_wo w),'Legacy WO is unchanged';
end;
$$;
rollback;
select 'Live monthly input smoke tests passed; all test writes rolled back' as result;

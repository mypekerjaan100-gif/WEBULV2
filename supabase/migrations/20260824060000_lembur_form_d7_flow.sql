-- Lembur form flow: enforce the existing initial D+7 deadline on Draft,
-- submission, and evidence persistence without changing revision D+3 rules.

create or replace function public.enforce_overtime_initial_deadline_l6()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deadline timestamptz;
begin
  if tg_op = 'UPDATE'
     and old.status = 'DRAFT'
     and coalesce(old.submission_count, 0) = 0
     and new.status <> 'CLOSED'
     and clock_timestamp() > (
       old.submission_deadline + time '23:59:59.999999'
     ) at time zone 'Asia/Pontianak' then
    raise exception 'Batas pengajuan telah lewat. Draft Lembur sudah kedaluwarsa.';
  end if;

  if new.status = 'DRAFT' and coalesce(new.submission_count, 0) = 0 then
    v_deadline := (
      new.submission_deadline + time '23:59:59.999999'
    ) at time zone 'Asia/Pontianak';
    if clock_timestamp() > v_deadline then
      raise exception 'Batas pengajuan telah lewat. Pilih tanggal lembur yang masih berada dalam batas pengajuan 7 hari.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_overtime_activity_initial_deadline_l6
  on public.overtime_activities;
create trigger trg_overtime_activity_initial_deadline_l6
  before insert or update of status, started_at, submission_count
  on public.overtime_activities
  for each row execute function public.enforce_overtime_initial_deadline_l6();

create or replace function public.enforce_overtime_evidence_initial_deadline_l6()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
begin
  select * into v_activity
  from public.overtime_activities
  where id = new.activity_id;

  if v_activity.status = 'DRAFT'
     and coalesce(v_activity.submission_count, 0) = 0
     and clock_timestamp() > (
       v_activity.submission_deadline + time '23:59:59.999999'
     ) at time zone 'Asia/Pontianak' then
    raise exception 'Batas pengajuan telah lewat. Evidence tidak dapat disimpan untuk Draft yang kedaluwarsa.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_overtime_evidence_initial_deadline_l6
  on public.overtime_evidence;
create trigger trg_overtime_evidence_initial_deadline_l6
  before insert on public.overtime_evidence
  for each row execute function public.enforce_overtime_evidence_initial_deadline_l6();

create or replace function public.expire_overtime_initial_drafts_l6(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with expired as (
    update public.overtime_activities activity
    set status = 'CLOSED',
        closure_reason = 'EXPIRED',
        closed_at = clock_timestamp(),
        closed_by = auth.uid(),
        updated_by = auth.uid()
    where activity.contract_id = p_contract_id
      and activity.up3_id = p_up3_id
      and (p_unit_id is null or activity.unit_id = p_unit_id)
      and activity.status = 'DRAFT'
      and coalesce(activity.submission_count, 0) = 0
      and clock_timestamp() > (
        activity.submission_deadline + time '23:59:59.999999'
      ) at time zone 'Asia/Pontianak'
      and public.auth_can_read_overtime_evidence_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
    returning activity.id
  ), history as (
    insert into public.overtime_activity_history (
      activity_id,
      event,
      actor_user_id,
      previous_status,
      new_status,
      reason
    )
    select id, 'CLOSED', auth.uid(), 'DRAFT', 'CLOSED',
      'Batas pengajuan awal D+7 telah lewat'
    from expired
    returning 1
  )
  select count(*) into v_count from history;

  return v_count;
end;
$$;

revoke all on function public.enforce_overtime_initial_deadline_l6()
  from public, anon, authenticated;
revoke all on function public.enforce_overtime_evidence_initial_deadline_l6()
  from public, anon, authenticated;
revoke all on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  to authenticated;

comment on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  is 'Closes never-submitted DRAFT overtime after D+7 23:59 Asia/Pontianak in the caller read scope.';

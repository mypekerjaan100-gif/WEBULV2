-- Pemulihan data finansial yang terhapus oleh approval pengajuan Admin ULP
-- berisi snapshot kosong (kasus: edit foto/tgl lahir). Idempotent, berbasis NIP
-- dan snapshot approved terakhir yang masih memiliki data finansial valid.

do $$
declare
  v_emp uuid;
  v_prior_bank text;
  v_prior_acct text;
  v_prior_rate numeric;
  v_zero_from date;
begin
  select id into v_emp from public.employees where nip = '00220716PTK';
  if v_emp is null then return; end if;

  select proposed_snapshot->>'bank',
         proposed_snapshot->>'account_number',
         nullif(proposed_snapshot->>'hourly_rate','')::numeric
    into v_prior_bank, v_prior_acct, v_prior_rate
  from public.employee_change_requests
  where employee_id = v_emp
    and status = 'Approved'
    and (coalesce(proposed_snapshot->>'account_number','') <> ''
      or coalesce(proposed_snapshot->>'bank','') <> ''
      or coalesce(nullif(proposed_snapshot->>'hourly_rate','')::numeric, 0) <> 0)
  order by created_at desc
  limit 1;

  if v_prior_bank is null and v_prior_acct is null and v_prior_rate is null then return; end if;

  -- Pulihkan bank/rekening hanya bila saat ini kosong.
  update public.employees
  set bank = case when coalesce(bank,'') = '' then coalesce(v_prior_bank, bank) else bank end,
      account_number = case when coalesce(account_number,'') = '' then coalesce(v_prior_acct, account_number) else account_number end
  where id = v_emp
    and (coalesce(bank,'') = '' or coalesce(account_number,'') = '');

  -- Hapus baris tarif 0 yang terbuka dan buka kembali tarif valid sebelumnya.
  select effective_from into v_zero_from
  from public.employee_hourly_rate_history
  where employee_id = v_emp and hourly_rate = 0 and effective_to is null
  order by effective_from desc limit 1;

  if v_zero_from is not null and v_prior_rate is not null and v_prior_rate <> 0 then
    delete from public.employee_hourly_rate_history
    where employee_id = v_emp and hourly_rate = 0 and effective_to is null;

    update public.employee_hourly_rate_history
    set effective_to = null
    where employee_id = v_emp
      and hourly_rate = v_prior_rate
      and effective_to is not null
      and not exists (
        select 1 from public.employee_hourly_rate_history h
        where h.employee_id = v_emp and h.effective_to is null
      );
  end if;
end;
$$;

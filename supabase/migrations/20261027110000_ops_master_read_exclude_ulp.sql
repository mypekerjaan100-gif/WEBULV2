-- Admin ULP tidak boleh membaca master alat & kendaraan.
-- Policy SELECT tabel master dan RPC ringkasan biaya memakai predikat ini,
-- sehingga pembatasan berlaku sampai lapisan API, bukan hanya menu.
-- Pemeriksaan kondisi kendaraan ULP memakai RPC security definer
-- (ops_get_vehicle_condition_report dan kawan-kawan) yang tidak bergantung
-- pada policy ini, jadi alur Alat & Kendaraan ULP tetap berjalan.

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
        and cm.contract_role <> 'ADMIN_ULP'
    )
  )
$function$;

-- Align soft-delete guard with soft_delete_overtime_activity policy.
-- Previously the trigger only allowed SUPER_ADMIN, while the RPC already
-- allowed ADMIN_ULP to delete own ULP data in DRAFT/SUBMITTED/CORRECTION_REQUIRED
-- when no participant was APPROVED. That mismatch caused:
-- "Only SUPER_ADMIN may delete overtime data" for valid ULP draft deletes.

create or replace function public.guard_soft_deleted_overtime_activity()
returns trigger
language plpgsql
set search_path to public, pg_temp
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;

  if (new.deleted_at, new.deleted_by, new.delete_reason)
       is distinct from (old.deleted_at, old.deleted_by, old.delete_reason) then
    -- Soft-delete transition: validate actor and policy.
    if auth.uid() is null then
      raise exception 'Authentication required' using errcode = '42501';
    end if;

    if new.deleted_at is null then
      raise exception 'Overtime activity is not available';
    end if;

    if new.deleted_by is null or btrim(coalesce(new.delete_reason, '')) = '' then
      raise exception 'Alasan hapus wajib diisi';
    end if;

    if (new.contract_id, new.up3_id, new.unit_id)
         is distinct from (old.contract_id, old.up3_id, old.unit_id) then
      raise exception 'Data lembur tidak dapat dipindahkan saat dihapus';
    end if;

    if public.auth_is_super_admin() then
      return new;
    end if;

    if not (
      public.auth_can_mutate_overtime_replacement_l2(old.contract_id, old.up3_id, old.unit_id)
      or public.auth_can_mutate_overtime_work_l3(old.contract_id, old.up3_id, old.unit_id)
    ) then
      raise exception 'Hanya pemilik data pada ULP sendiri yang dapat menghapus' using errcode = '42501';
    end if;

    if old.status not in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED') then
      raise exception 'Hanya lembur yang belum disetujui yang dapat dihapus';
    end if;

    if exists (
      select 1 from public.overtime_entries
      where activity_id = old.id
        and approval_status = 'APPROVED'
    ) then
      raise exception 'Sebagian peserta sudah disetujui sehingga data tidak dapat dihapus';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_soft_deleted_overtime_activity()
  is 'Soft-delete guard aligned with soft_delete_overtime_activity: SUPER_ADMIN full access; ADMIN_ULP own ULP data in DRAFT/SUBMITTED/CORRECTION_REQUIRED with no APPROVED participant.';

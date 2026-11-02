-- Nomor unit menandai posisi alat pada kendaraan, bukan generasi penggantian.
-- Mengganti Unit 1 tidak boleh membuat Unit 3 pada kontrak dua alat.

alter table public.ops_tool_assets
  drop constraint if exists ops_tool_assets_slot_id_equipment_id_asset_sequence_key;

-- Rapikan data lama: unit aktif diberi nomor posisi 1..N per slot dan alat.
-- Riwayat unit yang sudah diganti tetap menyimpan nomor saat penggantian.
alter table public.ops_tool_assets disable trigger trg_ops_tool_assets_guard;

with numbered as (
  select id,
    row_number() over (
      partition by slot_id, equipment_id
      order by asset_sequence, commissioned_at nulls first, id
    ) as position
  from public.ops_tool_assets
  where status = 'ACTIVE'
)
update public.ops_tool_assets a
set asset_sequence = numbered.position
from numbered
where a.id = numbered.id
  and a.asset_sequence <> numbered.position;

alter table public.ops_tool_assets enable trigger trg_ops_tool_assets_guard;

-- Hanya unit aktif yang harus unik per posisi; unit lama boleh berbagi nomor
-- karena merupakan generasi sebelumnya pada posisi yang sama.
create unique index if not exists ops_tool_assets_active_position
  on public.ops_tool_assets(slot_id, equipment_id, asset_sequence)
  where status = 'ACTIVE';

comment on column public.ops_tool_assets.asset_sequence is
  'Stable unit position within a vehicle/equipment; replacement keeps the same number.';

create or replace function public.ops_resolve_tool_issue(
  p_issue_id uuid,
  p_resolved_at timestamptz,
  p_note text,
  p_photo_paths jsonb,
  p_expected_revision integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  i public.ops_tool_issues;
  a public.ops_tool_assets;
  v_replacement public.ops_tool_assets;
  v_note text := btrim(coalesce(p_note, ''));
  v_age integer;
  v_life integer;
  v_before_life boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_resolved_at is null then raise exception 'Tanggal dan waktu serah terima wajib diisi'; end if;
  if p_resolved_at > now() then raise exception 'Waktu serah terima tidak boleh melewati waktu sekarang'; end if;
  if length(v_note) > 2000 then raise exception 'Catatan penyelesaian maksimal 2000 karakter'; end if;

  select * into i from public.ops_tool_issues where id = p_issue_id for update;
  if not found then raise exception 'Issue tidak ditemukan'; end if;
  if i.status <> 'OPEN' then raise exception 'Issue ini sudah diselesaikan'; end if;
  if i.revision is distinct from p_expected_revision then
    raise exception 'Issue telah berubah; muat ulang data' using errcode = '40001';
  end if;
  if not public.ops_tool_can_resolve_scope(i.contract_id, i.up3_id, i.ulp_id) then
    raise exception 'Hanya petugas inspeksi pada ULP ini yang dapat menyelesaikan issue' using errcode = '42501';
  end if;
  if p_resolved_at < i.opened_at then
    raise exception 'Waktu serah terima tidak boleh sebelum issue dibuka';
  end if;
  perform public.ops_validate_tool_photo_paths(i.contract_id, i.up3_id, i.ulp_id, p_photo_paths);

  select * into a from public.ops_tool_assets where id = i.asset_id for update;
  if not found or a.status <> 'ACTIVE' then raise exception 'Alat yang rusak sudah tidak aktif'; end if;
  v_age := i.age_at_failure_months;
  v_life := coalesce(a.useful_life_months, i.standard_life_months);
  v_before_life := case
    when v_age is null or v_life is null then null
    else v_age < v_life
  end;

  -- Tutup unit lama lebih dulu agar posisinya bebas untuk alat pengganti.
  update public.ops_tool_assets
    set status = 'REPLACED', replaced_at = p_resolved_at, replaced_by = auth.uid()
    where id = a.id;

  -- Alat pengganti menempati posisi unit yang sama, bukan nomor urut baru.
  insert into public.ops_tool_assets (
    contract_id, up3_id, ulp_id, slot_id, equipment_id,
    equipment_code, equipment_name, equipment_category, equipment_unit,
    specification, asset_sequence, useful_life_months, status,
    commissioned_at, commissioned_by, created_by, updated_by
  ) values (
    a.contract_id, a.up3_id, a.ulp_id, a.slot_id, a.equipment_id,
    a.equipment_code, a.equipment_name, a.equipment_category, a.equipment_unit,
    a.specification, a.asset_sequence, v_life, 'ACTIVE',
    p_resolved_at, auth.uid(), auth.uid(), auth.uid()
  ) returning * into v_replacement;

  update public.ops_tool_issues
    set status = 'RESOLVED', resolved_at = p_resolved_at, resolved_by = auth.uid(),
        resolution_note = v_note, handover_photo_paths = p_photo_paths,
        replacement_asset_id = v_replacement.id,
        age_at_failure_months = v_age, standard_life_months = v_life,
        damaged_before_life = v_before_life, revision = revision + 1
    where id = i.id
    returning * into i;

  return jsonb_build_object('issue', to_jsonb(i), 'replacement_asset', to_jsonb(v_replacement));
end;
$$;

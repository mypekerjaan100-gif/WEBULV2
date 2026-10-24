import { supabase } from '../lib/supabaseClient.js'

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42P01') throw new Error('Fitur pemeriksaan kendaraan belum tersedia di database. Hubungi administrator.')
    if (error.code === '42501') throw new Error('Anda tidak memiliki izin untuk tindakan ini pada ULP tersebut.')
    if (error.code === '40001') throw new Error('Data telah berubah atau sedang digunakan. Muat ulang data terbaru sebelum menyimpan; isian tetap dipertahankan.')
    if (error.code === '23505' || error.code === '23P01' || /plate.*(already|another|unique|registered|duplicate)/i.test(error.message || '')) throw new Error('Nomor polisi sudah digunakan pada periode yang bertumpang tindih. Periksa nopol dan masa berlaku penetapannya.')
    if (/report.*(already|exist)|existing.*report|frozen monthly fleet/i.test(error.message || '')) throw new Error('Periode tersebut sudah memiliki laporan. Gunakan bulan mulai/akhir yang belum dilaporkan agar riwayat tidak berubah.')
    if (/active template/i.test(error.message || '')) throw new Error('Pilih template kendaraan berstatus Aktif yang sudah diterbitkan.')
    if (/location is required for new prescribed vehicles/i.test(error.message || '')) throw new Error('Pilih lokasi tujuan untuk setiap kendaraan baru.')
    if (/UNIT_OFFICE or KANTOR_JAGA/i.test(error.message || '')) throw new Error('Lokasi tujuan harus kantor ULP atau kantor jaga aktif pada ULP yang dipilih.')
    if (/Duplicate template_id and location_id/i.test(error.message || '')) throw new Error('Kombinasi template dan lokasi tujuan tidak boleh duplikat.')
    if (/Good \+ damaged quantity must equal required quantity/i.test(error.message || '')) throw new Error('Jumlah Baik + Rusak harus sama dengan jumlah kontrak.')
    if (/legacy.*(scope|plate)|linked.*registry|registry.*(scope|type|assignment|link)/i.test(error.message || '')) throw new Error('Nopol berkaitan dengan data kendaraan lama. Hubungi admin untuk memeriksa ULP, jenis kendaraan, dan penugasannya.')
    throw new Error(error.message || 'Permintaan tidak berhasil. Silakan coba lagi.')
  }
  return data
}

const scope = ({ contractId, up3Id }) => ({ p_contract_id: contractId, p_up3_id: up3Id })
const period = (month) => `${month.slice(0, 7)}-01`

export function listPrescribedVehicles(context) {
  return rpc('ops_list_prescribed_vehicles', { ...scope(context), p_period_month: period(context.month) })
}

export function createPrescribedVehiclesBatch(context, form) {
  return rpc('ops_create_prescribed_vehicles_batch_v2', {
    ...scope(context), p_ulp_id: form.ulpId,
    p_effective_month: period(form.month),
    p_contract_reference: form.contractReference.trim(),
    p_rows: form.rows.map((row) => ({
      template_id: row.templateId,
      count: Number(row.count),
      location_id: row.locationId,
    })),
  })
}

export function listAffectedVehicleReports(context) {
  return rpc('ops_list_affected_vehicle_reports', {
    ...scope(context), p_ulp_id: context.ulpId, p_from_month: period(context.month),
  })
}

export function endPrescribedVehicle(slot, month) {
  return rpc('ops_end_prescribed_vehicle', { p_slot_id: slot.id, p_end_month: period(month), p_expected_revision: slot.revision })
}

export function setPrescribedVehiclePlate(slot, plate) {
  return rpc('ops_set_prescribed_vehicle_plate', { p_slot_id: slot.id, p_plate: plate.trim(), p_expected_revision: slot.revision })
}

export function getUlpConditionReport(context) {
  return rpc('ops_get_vehicle_condition_report', {
    ...scope(context), p_ulp_id: context.ulpId, p_period_month: period(context.month),
  })
}

export function listUlpConditionOverview(context) {
  return rpc('ops_list_vehicle_condition_overview', { ...scope(context), p_period_month: period(context.month) })
}

export function saveUlpConditionReport(context, bundle, items) {
  return rpc('ops_save_vehicle_condition_report', {
    ...scope(context), p_ulp_id: context.ulpId, p_period_month: period(context.month),
    p_expected_revision: bundle.report?.revision || 0,
    p_items: items.map(({ key, good_qty, bad_qty, note }) => ({
      key,
      good_qty: good_qty == null || String(good_qty).trim() === '' ? null : Number(good_qty),
      bad_qty: bad_qty == null || String(bad_qty).trim() === '' ? null : Number(bad_qty),
      note: note || '',
    })),
  })
}

export function saveUlpVehicleCondition(context, bundle, vehicleId, items) {
  return rpc('ops_save_vehicle_condition_subset', {
    ...scope(context), p_ulp_id: context.ulpId, p_period_month: period(context.month),
    p_vehicle_id: vehicleId,
    p_expected_revision: bundle.report?.revision || 0,
    p_items: items.map(({ key, good_qty, bad_qty, note }) => ({
      key,
      good_qty: good_qty == null || String(good_qty).trim() === '' ? null : Number(good_qty),
      bad_qty: bad_qty == null || String(bad_qty).trim() === '' ? null : Number(bad_qty),
      note: note || '',
    })),
  })
}

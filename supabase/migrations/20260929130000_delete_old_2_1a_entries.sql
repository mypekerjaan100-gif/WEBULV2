-- Hapus data lama workflow 2.1a (Inspeksi SUTM Tier 1).
-- Realisasi 2.1a sekarang dibaca live dari spreadsheet; WO manual di variable_cost_manual_wo.
-- Target operasional (sla_targets) TIDAK dihapus.

DELETE FROM public.variable_cost_entry_personnel
WHERE variable_cost_entry_id IN (
  SELECT id FROM public.variable_cost_entries WHERE indicator_id = 'fb4ed2df-8eb8-45a9-873b-3c0e74a611fa'
);

DELETE FROM public.variable_cost_evidence
WHERE variable_cost_entry_id IN (
  SELECT id FROM public.variable_cost_entries WHERE indicator_id = 'fb4ed2df-8eb8-45a9-873b-3c0e74a611fa'
);

DELETE FROM public.variable_cost_status_history
WHERE variable_cost_entry_id IN (
  SELECT id FROM public.variable_cost_entries WHERE indicator_id = 'fb4ed2df-8eb8-45a9-873b-3c0e74a611fa'
);

DELETE FROM public.variable_cost_entries
WHERE indicator_id = 'fb4ed2df-8eb8-45a9-873b-3c0e74a611fa';

-- Agregat turunan yang sudah basi (dibentuk saat approve dulu)
DELETE FROM public.sla_entries
WHERE indicator_id = 'fb4ed2df-8eb8-45a9-873b-3c0e74a611fa'
  AND source_type = 'VARIABLE_COST_AGGREGATE';

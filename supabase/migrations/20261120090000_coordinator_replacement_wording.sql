-- Alat yang diserahkan ke K3 adalah alat pengganti, bukan alat rusak.
-- Perbaiki deskripsi izin tanpa mengubah perilaku atau hak akses.
update public.authorization_permissions
set description = 'Verify replacement equipment handover to K3'
where code = 'alat.issue.verify';

notify pgrst, 'reload schema';

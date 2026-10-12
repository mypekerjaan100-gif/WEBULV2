-- Correct ULP transfer effective date to 2026-10-01 for swapped employees.
-- Sepriwendi (8319005SKW): Sambas -> Singkawang.
-- MOH KHAI RONI (7519004SKW): Singkawang -> Sambas.
-- No overtime entries exist for either employee in 2026-10-01..2026-10-11,
-- so retroactive correction does not conflict with stored transactions.

-- Unit history: close old assignment at 2026-10-01.
update public.employee_unit_history h
set effective_to = date '2026-10-01'
from public.employees e
where h.employee_id = e.id
  and upper(e.nip) in ('8319005SKW', '7519004SKW')
  and h.effective_to = date '2026-10-12';

-- Unit history: start new assignment at 2026-10-01.
update public.employee_unit_history h
set effective_from = date '2026-10-01'
from public.employees e
where h.employee_id = e.id
  and upper(e.nip) in ('8319005SKW', '7519004SKW')
  and h.effective_from = date '2026-10-12'
  and h.effective_to is null;

-- Work location history follows the same unit move.
update public.employee_work_location_history h
set effective_to = date '2026-10-01'
from public.employees e
where h.employee_id = e.id
  and upper(e.nip) in ('8319005SKW', '7519004SKW')
  and h.effective_to = date '2026-10-12';

update public.employee_work_location_history h
set effective_from = date '2026-10-01'
from public.employees e
where h.employee_id = e.id
  and upper(e.nip) in ('8319005SKW', '7519004SKW')
  and h.effective_from = date '2026-10-12'
  and h.effective_to is null;

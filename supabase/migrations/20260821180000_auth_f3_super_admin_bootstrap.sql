-- AUTH-F3: Super Admin bootstrap
-- Link auth user to profile, assign SYSTEM/SUPER_ADMIN role

-- 1. Create profile for SUPER_ADMIN user
insert into public.profiles (id, display_name, status)
values (
  '3e39f0ef-990a-4cdd-b76b-c1739b6941ef',
  'Super Admin',
  'active'
)
on conflict (id) do nothing;

-- 2. Assign SYSTEM/SUPER_ADMIN role
-- SUPER_ADMIN is system-level: no organization/contract membership needed
insert into public.system_role_memberships (
  user_id,
  role_id,
  status,
  effective_from,
  created_by
)
values (
  '3e39f0ef-990a-4cdd-b76b-c1739b6941ef',
  '76d638ea-7495-4743-8b22-3466d4a44f2f',
  'ACTIVE',
  current_date,
  '3e39f0ef-990a-4cdd-b76b-c1739b6941ef'
)
on conflict do nothing;

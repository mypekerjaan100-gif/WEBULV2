create index idx_overtime_activities_deleted_by
  on public.overtime_activities(deleted_by)
  where deleted_by is not null;

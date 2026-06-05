create extension if not exists pgcrypto;

create table if not exists public.conversion_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  modes text[] not null default array['archive-pdf'],
  source_prefix text not null,
  result_path text,
  report jsonb,
  error_message text,
  original_file_count integer not null default 0,
  pub_file_count integer not null default 0,
  delete_after timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversion_job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.conversion_jobs(id) on delete cascade,
  relative_path text not null,
  storage_path text not null,
  size_bytes bigint,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists conversion_jobs_status_created_idx
  on public.conversion_jobs(status, created_at);

create index if not exists conversion_job_files_job_idx
  on public.conversion_job_files(job_id);

alter table public.conversion_jobs enable row level security;
alter table public.conversion_job_files enable row level security;

create policy "service role manages conversion jobs"
  on public.conversion_jobs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages conversion job files"
  on public.conversion_job_files
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into storage.buckets (id, name, public)
values
  ('publisher-sources', 'publisher-sources', false),
  ('publisher-results', 'publisher-results', false)
on conflict (id) do nothing;

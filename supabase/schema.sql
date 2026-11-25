-- Run once in Supabase SQL Editor. Each authenticated account owns an
-- independent sync namespace. The browser never receives the service_role key.

create sequence if not exists public.vazhyar_sync_revision_seq;

create table if not exists public.vazhyar_sync_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in ('notes', 'reviewCards', 'reviewLogs')),
  id text not null,
  updated_at timestamptz not null,
  revision bigint not null default nextval('public.vazhyar_sync_revision_seq'),
  payload jsonb not null,
  primary key (user_id, entity, id)
);

create index if not exists vazhyar_sync_user_entity_revision_idx
  on public.vazhyar_sync_records(user_id, entity, revision);

alter table public.vazhyar_sync_records enable row level security;

drop policy if exists "Users can read their own Vazhyar sync records" on public.vazhyar_sync_records;
drop policy if exists "Users can insert their own Vazhyar sync records" on public.vazhyar_sync_records;
drop policy if exists "Users can update their own Vazhyar sync records" on public.vazhyar_sync_records;

create policy "Users can read their own Vazhyar sync records"
  on public.vazhyar_sync_records for select to authenticated
  using (auth.uid() = user_id);

-- Browser clients have SELECT only. Inserts/updates are accepted only via
-- the SECURITY DEFINER RPC below, which hard-scopes writes to auth.uid().

create or replace function public.merge_vazhyar_sync_records(p_records jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Serialize per-user writers with the snapshot watermark RPC. PostgreSQL
  -- sequence values alone are not commit-ordered under concurrent transactions.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'Invalid or oversized batch';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_records) as incoming(entity text, id text, updated_at timestamptz, payload jsonb)
    where incoming.entity is null
       or incoming.entity not in ('notes', 'reviewCards', 'reviewLogs')
       or incoming.id is null or incoming.id = ''
       or incoming.updated_at is null or incoming.payload is null
       or jsonb_typeof(incoming.payload) <> 'object'
       or incoming.payload->>'id' is distinct from incoming.id
  ) then
    raise exception 'Invalid sync record';
  end if;

  insert into public.vazhyar_sync_records as current_row
    (user_id, entity, id, updated_at, payload)
  select
    auth.uid(), incoming.entity, incoming.id, incoming.updated_at, incoming.payload
  from jsonb_to_recordset(p_records) as incoming(
    entity text,
    id text,
    updated_at timestamptz,
    payload jsonb
  )
  where incoming.entity in ('notes', 'reviewCards', 'reviewLogs')
    and incoming.id is not null
    and incoming.id <> ''
    and incoming.payload is not null
    and incoming.updated_at is not null
  on conflict (user_id, entity, id) do update
    set updated_at = excluded.updated_at,
        payload = excluded.payload,
        revision = nextval('public.vazhyar_sync_revision_seq')
    where excluded.entity <> 'reviewLogs'
      and excluded.updated_at > current_row.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.vazhyar_sync_snapshot_revision()
returns bigint
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  snapshot_revision bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Wait for every earlier merge to commit before reading the high-water mark.
  -- The transaction-scoped shared lock prevents a writer from allocating a
  -- revision and committing it after this snapshot has already been read.
  perform pg_advisory_xact_lock_shared(hashtextextended(auth.uid()::text, 0));

  select coalesce(max(revision), 0)::bigint
    into snapshot_revision
    from public.vazhyar_sync_records
    where user_id = auth.uid();
  return snapshot_revision;
end;
$$;

grant select on public.vazhyar_sync_records to authenticated;
revoke all on function public.merge_vazhyar_sync_records(jsonb) from public;
revoke all on function public.vazhyar_sync_snapshot_revision() from public;
grant execute on function public.merge_vazhyar_sync_records(jsonb) to authenticated;
grant execute on function public.vazhyar_sync_snapshot_revision() to authenticated;

-- Authoritative schema for the server-authoritative rewrite.
-- Operator decision: create a fresh database; the RxDB-era legacy data model
-- (cards/srs_state/review_logs/settings/card_snapshots) is dropped here and no
-- data is carried forward.

-- =============================================================================
-- Removal of the legacy RxDB-era model
-- =============================================================================

-- The legacy signup trigger writes a settings row; drop it before settings goes.
drop trigger if exists on_user_created on auth.users;
drop function if exists public.create_default_settings();

-- Legacy tables are dropped below; DROP TABLE removes them from
-- supabase_realtime automatically.

drop policy if exists "Users can read own card_snapshots" on public.card_snapshots;
drop policy if exists "Users can insert own card_snapshots" on public.card_snapshots;
drop table if exists public.card_snapshots;

drop policy if exists "Users can read own review_logs" on public.review_logs;
drop policy if exists "Users can insert own review_logs" on public.review_logs;
drop policy if exists "Users can update own review_logs" on public.review_logs;
drop policy if exists "Users can delete own review_logs" on public.review_logs;
drop table if exists public.review_logs;

drop policy if exists "Users can read own srs_state" on public.srs_state;
drop policy if exists "Users can insert own srs_state" on public.srs_state;
drop policy if exists "Users can update own srs_state" on public.srs_state;
drop policy if exists "Users can delete own srs_state" on public.srs_state;
drop table if exists public.srs_state;

drop policy if exists "Users can read own cards" on public.cards;
drop policy if exists "Users can insert own cards" on public.cards;
drop policy if exists "Users can update own cards" on public.cards;
drop policy if exists "Users can delete own cards" on public.cards;
drop table if exists public.cards;

drop policy if exists "Users can read own settings" on public.settings;
drop policy if exists "Users can insert own settings" on public.settings;
drop policy if exists "Users can update own settings" on public.settings;
drop policy if exists "Users can delete own settings" on public.settings;
drop table if exists public.settings;

drop function if exists public.snapshot_card();
drop function if exists public.update_modified_column();

-- =============================================================================
-- New schema
-- =============================================================================

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  default_speech_locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  unique (user_id, name)
);

create index decks_user_id_idx on public.decks (user_id);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  front_markdown text not null,
  back_markdown text not null,
  speech_text text,
  speech_locale text,
  tags text[] not null default '{}',
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Null cadence fields mean the card is new; studied cards have all populated.
  cadence_phase text check (cadence_phase in ('learning', 'review')),
  next_review_at timestamptz,
  interval_days double precision check (interval_days is null or interval_days > 0),
  review_count integer not null default 0 check (review_count >= 0),
  lapse_count integer not null default 0 check (lapse_count >= 0),
  scheduler_version integer check (scheduler_version is null or scheduler_version > 0),
  version integer not null default 0 check (version >= 0),
  constraint cadence_fields_all_or_none check (
    (cadence_phase is null and next_review_at is null and interval_days is null and scheduler_version is null)
    or
    (cadence_phase is not null and next_review_at is not null and interval_days is not null and scheduler_version is not null)
  )
);

-- Tenant-scoped deck lookup plus new-card and reviewed-card working-set order.
create index cards_deck_id_idx on public.cards (deck_id);
create index cards_new_order_idx on public.cards (deck_id, created_at, id)
  where next_review_at is null and not suspended;
create index cards_review_order_idx on public.cards (deck_id, next_review_at, id)
  where next_review_at is not null and not suspended;

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null,
  before_state jsonb,
  after_state jsonb not null,
  request_id uuid not null,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (card_id, request_id)
);

-- History pagination order: newest first by review time, then id.
create index review_events_card_reviewed_idx on public.review_events (card_id, reviewed_at desc, id);

create table public.card_revisions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  event_type text not null check (event_type in ('created', 'edited', 'restored', 'ai_generated')),
  before_content jsonb,
  after_content jsonb not null,
  created_at timestamptz not null default now()
);

-- Revision pagination order: newest first by creation time, then id.
create index card_revisions_card_created_idx on public.card_revisions (card_id, created_at desc, id);

-- =============================================================================
-- Row level security (defense in depth; server SQL is always user-scoped)
-- =============================================================================

alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.review_events enable row level security;
alter table public.card_revisions enable row level security;

create policy "decks select own" on public.decks for select
  using (user_id = auth.uid());
create policy "decks insert own" on public.decks for insert
  with check (user_id = auth.uid());
create policy "decks update own" on public.decks for update
  using (user_id = auth.uid());
create policy "decks delete own" on public.decks for delete
  using (user_id = auth.uid());

create policy "cards select own" on public.cards for select
  using (exists (
    select 1 from public.decks where decks.id = cards.deck_id and decks.user_id = auth.uid()
  ));
create policy "cards insert own" on public.cards for insert
  with check (exists (
    select 1 from public.decks where decks.id = cards.deck_id and decks.user_id = auth.uid()
  ));
create policy "cards update own" on public.cards for update
  using (exists (
    select 1 from public.decks where decks.id = cards.deck_id and decks.user_id = auth.uid()
  ));
create policy "cards delete own" on public.cards for delete
  using (exists (
    select 1 from public.decks where decks.id = cards.deck_id and decks.user_id = auth.uid()
  ));

create policy "review_events select own" on public.review_events for select
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = review_events.card_id
  ));
create policy "review_events insert own" on public.review_events for insert
  with check (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = review_events.card_id
  ));
create policy "review_events update own" on public.review_events for update
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = review_events.card_id
  ));
create policy "review_events delete own" on public.review_events for delete
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = review_events.card_id
  ));

create policy "card_revisions select own" on public.card_revisions for select
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_revisions.card_id
  ));
create policy "card_revisions insert own" on public.card_revisions for insert
  with check (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_revisions.card_id
  ));
create policy "card_revisions update own" on public.card_revisions for update
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_revisions.card_id
  ));
create policy "card_revisions delete own" on public.card_revisions for delete
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_revisions.card_id
  ));
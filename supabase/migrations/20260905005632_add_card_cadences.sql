-- A card owns immutable study directions; each direction owns its cadence.
alter table public.cards
  add column reversible boolean not null default false;

create table public.card_cadences (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  direction text not null check (direction in ('forward', 'reverse')),
  next_review_at timestamptz,
  interval_days double precision check (interval_days is null or interval_days > 0),
  review_count integer not null default 0 check (review_count >= 0),
  lapse_count integer not null default 0 check (lapse_count >= 0),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_cadences_scheduling_fields_all_or_none check (
    (next_review_at is null and interval_days is null)
    or
    (next_review_at is not null and interval_days is not null)
  ),
  unique (card_id, direction)
);

-- Existing one-direction cards become forward cadences without changing state.
insert into public.card_cadences (
  card_id, direction, next_review_at, interval_days, review_count, lapse_count,
  version, created_at, updated_at
)
select
  id, 'forward', next_review_at, interval_days, review_count, lapse_count,
  version, created_at, updated_at
from public.cards;

create index card_cadences_new_order_idx
  on public.card_cadences (card_id, direction, id)
  where next_review_at is null;
create index card_cadences_review_order_idx
  on public.card_cadences (next_review_at, id)
  where next_review_at is not null;

alter table public.card_cadences enable row level security;
create policy "card_cadences select own" on public.card_cadences for select
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_cadences.card_id
  ));
create policy "card_cadences insert own" on public.card_cadences for insert
  with check (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_cadences.card_id
  ));
create policy "card_cadences update own" on public.card_cadences for update
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_cadences.card_id
  ));
create policy "card_cadences delete own" on public.card_cadences for delete
  using (exists (
    select 1 from public.cards
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where cards.id = card_cadences.card_id
  ));

-- Review history follows a cadence rather than the root card. All legacy reviews
-- belonged to the only existing forward direction.
alter table public.review_events add column cadence_id uuid references public.card_cadences (id) on delete cascade;
update public.review_events event
set cadence_id = cadence.id
from public.card_cadences cadence
where cadence.card_id = event.card_id and cadence.direction = 'forward';
alter table public.review_events alter column cadence_id set not null;

alter table public.review_events drop constraint if exists review_events_card_id_request_id_key;
drop index if exists public.review_events_card_reviewed_idx;
create unique index review_events_cadence_id_request_id_key on public.review_events (cadence_id, request_id);
create index review_events_cadence_reviewed_idx on public.review_events (cadence_id, reviewed_at desc, id);

drop policy if exists "review_events select own" on public.review_events;
drop policy if exists "review_events insert own" on public.review_events;
drop policy if exists "review_events update own" on public.review_events;
drop policy if exists "review_events delete own" on public.review_events;
create policy "review_events select own" on public.review_events for select
  using (exists (
    select 1 from public.card_cadences
    join public.cards on cards.id = card_cadences.card_id
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where card_cadences.id = review_events.cadence_id
  ));
create policy "review_events insert own" on public.review_events for insert
  with check (exists (
    select 1 from public.card_cadences
    join public.cards on cards.id = card_cadences.card_id
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where card_cadences.id = review_events.cadence_id
  ));
create policy "review_events update own" on public.review_events for update
  using (exists (
    select 1 from public.card_cadences
    join public.cards on cards.id = card_cadences.card_id
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where card_cadences.id = review_events.cadence_id
  ));
create policy "review_events delete own" on public.review_events for delete
  using (exists (
    select 1 from public.card_cadences
    join public.cards on cards.id = card_cadences.card_id
    join public.decks on decks.id = cards.deck_id and decks.user_id = auth.uid()
    where card_cadences.id = review_events.cadence_id
  ));

alter table public.review_events drop constraint if exists review_events_card_id_fkey;
alter table public.review_events drop column card_id;

-- Card revisions now include the aggregate's reversible setting.
update public.card_revisions
set before_content = jsonb_set(before_content, '{reversible}', 'false'::jsonb)
where before_content is not null and not before_content ? 'reversible';
update public.card_revisions
set after_content = jsonb_set(after_content, '{reversible}', 'false'::jsonb)
where not after_content ? 'reversible';

drop index if exists public.cards_new_order_idx;
drop index if exists public.cards_review_order_idx;
alter table public.cards drop constraint if exists scheduling_fields_all_or_none;
alter table public.cards drop constraint if exists cards_interval_days_check;
alter table public.cards drop constraint if exists cards_review_count_check;
alter table public.cards drop constraint if exists cards_lapse_count_check;
alter table public.cards
  drop column next_review_at,
  drop column interval_days,
  drop column review_count,
  drop column lapse_count;

-- Cards: content only (SRS state lives in srs_state table)
create table cards (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  deck_name text not null,
  term text not null,
  front text,
  back text not null,
  tags text[] default '{}',
  created timestamptz not null,
  reversible boolean not null default false,
  "order" integer not null default 0,
  suspended boolean not null default false,
  approved boolean not null default true,
  _modified timestamptz not null default now(),
  _deleted boolean not null default false
);

create index cards_user_id_idx on cards (user_id);
create index cards_deck_name_idx on cards (user_id, deck_name);

-- SRS state: one row per card direction (forward/reverse)
create table srs_state (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  card_id text not null references cards on delete cascade,
  direction text not null check (direction in ('forward', 'reverse')),
  due timestamptz,
  stability double precision,
  difficulty double precision,
  elapsed_days double precision,
  scheduled_days double precision,
  reps integer,
  lapses integer,
  state integer,
  last_review timestamptz,
  _modified timestamptz not null default now()
);

create index srs_state_user_id_idx on srs_state (user_id);
create index srs_state_card_id_idx on srs_state (card_id);

-- Review logs: append-only audit trail
create table review_logs (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  card_id text not null references cards on delete cascade,
  is_reverse boolean not null default false,
  rating integer not null,
  state integer not null,
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days double precision not null,
  last_elapsed_days double precision not null,
  scheduled_days double precision not null,
  review timestamptz not null,
  _modified timestamptz not null default now(),
  _deleted boolean not null default false
);

create index review_logs_user_id_idx on review_logs (user_id);
create index review_logs_card_id_idx on review_logs (card_id);

-- Settings: per-user preferences
create table settings (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  new_cards_per_day integer not null default 10,
  review_order text not null default 'random',
  theme text not null default 'system',
  _modified timestamptz not null default now()
);

create index settings_user_id_idx on settings (user_id);

-- Card snapshots: event history for AI rollback (Postgres-only)
create table card_snapshots (
  id uuid primary key default gen_random_uuid(),
  card_id text not null references cards on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  event_type text not null check (event_type in ('created', 'ai_generated', 'approved', 'edited', 'rolled_back')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index card_snapshots_card_id_idx on card_snapshots (card_id);
create index card_snapshots_user_id_idx on card_snapshots (user_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table cards enable row level security;
alter table srs_state enable row level security;
alter table review_logs enable row level security;
alter table settings enable row level security;
alter table card_snapshots enable row level security;

-- Cards
create policy "Users can read own cards"
  on cards for select using (auth.uid() = user_id);
create policy "Users can insert own cards"
  on cards for insert with check (auth.uid() = user_id);
create policy "Users can update own cards"
  on cards for update using (auth.uid() = user_id);
create policy "Users can delete own cards"
  on cards for delete using (auth.uid() = user_id);

-- SRS state
create policy "Users can read own srs_state"
  on srs_state for select using (auth.uid() = user_id);
create policy "Users can insert own srs_state"
  on srs_state for insert with check (auth.uid() = user_id);
create policy "Users can update own srs_state"
  on srs_state for update using (auth.uid() = user_id);
create policy "Users can delete own srs_state"
  on srs_state for delete using (auth.uid() = user_id);

-- Review logs
create policy "Users can read own review_logs"
  on review_logs for select using (auth.uid() = user_id);
create policy "Users can insert own review_logs"
  on review_logs for insert with check (auth.uid() = user_id);
create policy "Users can update own review_logs"
  on review_logs for update using (auth.uid() = user_id);
create policy "Users can delete own review_logs"
  on review_logs for delete using (auth.uid() = user_id);

-- Settings
create policy "Users can read own settings"
  on settings for select using (auth.uid() = user_id);
create policy "Users can insert own settings"
  on settings for insert with check (auth.uid() = user_id);
create policy "Users can update own settings"
  on settings for update using (auth.uid() = user_id);
create policy "Users can delete own settings"
  on settings for delete using (auth.uid() = user_id);

-- Card snapshots
create policy "Users can read own card_snapshots"
  on card_snapshots for select using (auth.uid() = user_id);
create policy "Users can insert own card_snapshots"
  on card_snapshots for insert with check (auth.uid() = user_id);

-- =============================================================================
-- Snapshot trigger: auto-capture card content on INSERT/UPDATE
-- =============================================================================

create or replace function snapshot_card()
returns trigger as $$
begin
  -- Only snapshot on content changes (not _modified/_deleted updates)
  if tg_op = 'UPDATE' and
     NEW.term = OLD.term and
     NEW.front is not distinct from OLD.front and
     NEW.back = OLD.back and
     NEW.tags = OLD.tags and
     NEW.reversible = OLD.reversible and
     NEW.suspended = OLD.suspended and
     NEW.approved = OLD.approved then
    return NEW;
  end if;

  insert into card_snapshots (card_id, user_id, event_type, snapshot)
  values (
    NEW.id,
    NEW.user_id,
    case
      when tg_op = 'INSERT' and NEW.approved = false then 'ai_generated'
      when tg_op = 'INSERT' then 'created'
      else 'edited'
    end,
    jsonb_build_object(
      'term', NEW.term,
      'front', NEW.front,
      'back', NEW.back,
      'tags', NEW.tags,
      'reversible', NEW.reversible,
      'suspended', NEW.suspended,
      'approved', NEW.approved,
      'deck_name', NEW.deck_name
    )
  );

  -- Retention: keep max 5 snapshots per card
  delete from card_snapshots
  where card_id = NEW.id
    and id not in (
      select id from card_snapshots
      where card_id = NEW.id
      order by created_at desc
      limit 5
    );

  -- Retention: delete snapshots older than 30 days
  delete from card_snapshots
  where card_id = NEW.id
    and created_at < now() - interval '30 days';

  return NEW;
end;
$$ language plpgsql security definer;

create trigger snapshot_card_trigger
  after insert or update on cards
  for each row execute function snapshot_card();


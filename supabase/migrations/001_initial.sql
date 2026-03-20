-- Cards: content only (SRS state lives in srs_state table)
create table cards (
  id text primary key,
  "userId" uuid not null references auth.users on delete cascade,
  "deckName" text not null,
  term text not null,
  front text,
  back text not null,
  tags text default '[]',
  created timestamptz not null,
  reversible boolean not null default false,
  "order" integer not null default 0,
  suspended boolean not null default false,
  approved boolean not null default true,
  _modified timestamptz not null default now(),
  _deleted boolean not null default false
);

create index cards_user_id_idx on cards ("userId");
create index cards_deck_name_idx on cards ("userId", "deckName");

-- SRS state: one row per card direction (forward/reverse)
create table srs_state (
  id text primary key,
  "userId" uuid not null references auth.users on delete cascade,
  "cardId" text not null references cards on delete cascade,
  direction text not null check (direction in ('forward', 'reverse')),
  due timestamptz,
  stability double precision,
  difficulty double precision,
  "elapsedDays" double precision,
  "scheduledDays" double precision,
  reps integer,
  lapses integer,
  state integer,
  "lastReview" timestamptz,
  _modified timestamptz not null default now(),
  _deleted boolean not null default false
);

create index srs_state_user_id_idx on srs_state ("userId");
create index srs_state_card_id_idx on srs_state ("cardId");

-- Review logs: append-only audit trail
create table review_logs (
  id text primary key,
  "userId" uuid not null references auth.users on delete cascade,
  "cardId" text not null references cards on delete cascade,
  "isReverse" boolean not null default false,
  rating integer not null,
  state integer not null,
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  "elapsedDays" double precision not null,
  "lastElapsedDays" double precision not null,
  "scheduledDays" double precision not null,
  review timestamptz not null,
  _modified timestamptz not null default now(),
  _deleted boolean not null default false
);

create index review_logs_user_id_idx on review_logs ("userId");
create index review_logs_card_id_idx on review_logs ("cardId");

-- Settings: per-user preferences
create table settings (
  id text primary key,
  "userId" uuid not null references auth.users on delete cascade,
  "newCardsPerDay" integer not null default 10,
  "reviewOrder" text not null default 'random',
  theme text not null default 'system',
  _modified timestamptz not null default now(),
  _deleted boolean not null default false
);

create index settings_user_id_idx on settings ("userId");

-- Card snapshots: event history for AI rollback (Postgres-only)
create table card_snapshots (
  id uuid primary key default gen_random_uuid(),
  "cardId" text not null references cards on delete cascade,
  "userId" uuid not null references auth.users on delete cascade,
  "eventType" text not null check ("eventType" in ('created', 'ai_generated', 'approved', 'edited', 'rolled_back')),
  snapshot jsonb not null,
  "createdAt" timestamptz not null default now()
);

create index card_snapshots_card_id_idx on card_snapshots ("cardId");
create index card_snapshots_user_id_idx on card_snapshots ("userId");

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table cards enable row level security;
alter table srs_state enable row level security;
alter table review_logs enable row level security;
alter table settings enable row level security;
alter table card_snapshots enable row level security;

create policy "Users can read own cards" on cards for select using (auth.uid() = "userId");
create policy "Users can insert own cards" on cards for insert with check (auth.uid() = "userId");
create policy "Users can update own cards" on cards for update using (auth.uid() = "userId");
create policy "Users can delete own cards" on cards for delete using (auth.uid() = "userId");

create policy "Users can read own srs_state" on srs_state for select using (auth.uid() = "userId");
create policy "Users can insert own srs_state" on srs_state for insert with check (auth.uid() = "userId");
create policy "Users can update own srs_state" on srs_state for update using (auth.uid() = "userId");
create policy "Users can delete own srs_state" on srs_state for delete using (auth.uid() = "userId");

create policy "Users can read own review_logs" on review_logs for select using (auth.uid() = "userId");
create policy "Users can insert own review_logs" on review_logs for insert with check (auth.uid() = "userId");
create policy "Users can update own review_logs" on review_logs for update using (auth.uid() = "userId");
create policy "Users can delete own review_logs" on review_logs for delete using (auth.uid() = "userId");

create policy "Users can read own settings" on settings for select using (auth.uid() = "userId");
create policy "Users can insert own settings" on settings for insert with check (auth.uid() = "userId");
create policy "Users can update own settings" on settings for update using (auth.uid() = "userId");
create policy "Users can delete own settings" on settings for delete using (auth.uid() = "userId");

create policy "Users can read own card_snapshots" on card_snapshots for select using (auth.uid() = "userId");
create policy "Users can insert own card_snapshots" on card_snapshots for insert with check (auth.uid() = "userId");

-- =============================================================================
-- Snapshot trigger
-- =============================================================================

create or replace function snapshot_card()
returns trigger as $$
begin
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

  insert into card_snapshots ("cardId", "userId", "eventType", snapshot)
  values (
    NEW.id,
    NEW."userId",
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
      'deckName', NEW."deckName"
    )
  );

  delete from card_snapshots
  where "cardId" = NEW.id
    and id not in (
      select id from card_snapshots
      where "cardId" = NEW.id
      order by "createdAt" desc
      limit 5
    );

  delete from card_snapshots
  where "cardId" = NEW.id
    and "createdAt" < now() - interval '30 days';

  return NEW;
end;
$$ language plpgsql security definer;

create trigger snapshot_card_trigger
  after insert or update on cards
  for each row execute function snapshot_card();

-- =============================================================================
-- Auto-update _modified + Realtime
-- =============================================================================

create or replace function update_modified_column()
returns trigger as $$
begin
  NEW._modified = now();
  return NEW;
end;
$$ language plpgsql;

create trigger update_cards_modified before update on cards for each row execute function update_modified_column();
create trigger update_srs_state_modified before update on srs_state for each row execute function update_modified_column();
create trigger update_review_logs_modified before update on review_logs for each row execute function update_modified_column();
create trigger update_settings_modified before update on settings for each row execute function update_modified_column();

alter publication supabase_realtime add table cards, srs_state, review_logs, settings;

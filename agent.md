# Flash Card App

## Schema Changes

Postgres is the durable source of truth; `src/db/schema.ts` defines the typed
schema used to generate current forward migrations:

```bash
# 1. Edit src/db/schema.ts

# 2. Generate a forward migration
npm run db:generate -- --name=my-change

# 3. Inspect the generated SQL under supabase/drizzle/

# 4. Apply it locally
DATABASE_URL=... npm run db:migrate
```

Because production starts from the current schema, `supabase/drizzle/0000_production-baseline.sql`
is the single baseline migration. Never edit it after the first production deployment;
generate forward-only migrations from then on.

Server procedures live in `supabase/functions/api/routers/`; shared domain schemas and scheduling rules live in `src/domain/`.

## Testing

- Unit tests: `npm run test:unit` — domain behavior in `src/domain/`.
- Integration tests: `DATABASE_URL=... npm run test:integration` — authoritative schema and migration behavior.
- Backend acceptance: `npm run test:acceptance` — real Auth, JWT, Edge Function, tRPC, and Postgres journeys on an isolated local stack.
- Repository checks: `npm run check`.
- Web build: `npm run build` — Expo static export; exercise the actual UI once frontend reconstruction begins.
- CLI unit/integration tests: `npm run test:cli`; bundle/package smoke: `npm run build:cli && npm run test:cli:package`.

### CLI boundaries

CLI source is in `src/cli/`; `src/api/client.ts#createApiClient` remains its only application transport. Build the private executable with `npm run build:cli`; its OS-keyring and explicit file-store sessions are isolated per Supabase URL and must never be substituted with frontend storage. CLI tests inject a fake authenticated client and assert the exact router operation/input boundary. Backend acceptance tests retain real-stack composition and all scheduling, queue-ordering, concurrency, and rollback policy coverage.

### Test Boundaries

Domain objects are trusted components at higher test layers. Unit tests own their
exact rules, edge cases, and invariants. Acceptance tests assume those domain
objects are correct and verify application composition: authentication, input
selection, server time, persistence, history, queues, idempotency, concurrency,
and undo.

An acceptance test may use the production domain object as its expected-value
oracle. It must not duplicate or hardcode that object's policy values. This use
does not independently test the domain algorithm; the corresponding unit tests
provide that coverage. When a domain rule changes, update its unit contract.
Change acceptance coverage only when the externally observable application
workflow or the way the application selects and invokes the domain object
changes.

Local integration tests require the Supabase stack:

```bash
supabase start
```

## Deployment

On merge to master, GitHub Actions applies database migrations and exports the static web bundle to GitHub Pages.

Required GitHub secrets:

- `DATABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`

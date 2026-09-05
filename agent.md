# Flash Card App

## Schema Changes

Postgres is the single source of truth. To change the schema:

```bash
# 1. Create a new migration
npx supabase migration new my_change

# 2. Edit the SQL file in supabase/migrations/

# 3. Apply locally
npx supabase migration up

# 4. Update src/db/schema.ts to mirror the migration
```

Server procedures live in `supabase/functions/api/routers/`; shared domain schemas and scheduling rules live in `src/domain/`.

## Testing

- Unit tests: `npm run test:unit` — domain behavior in `src/domain/`.
- Integration tests: `DATABASE_URL=... npm run test:integration` — authoritative schema and migration behavior.
- Backend acceptance: `npm run test:acceptance` — real Auth, JWT, Edge Function, tRPC, and Postgres journeys on an isolated local stack.
- Repository checks: `npm run check`.
- Web build: `npm run build` — Expo static export; exercise the actual UI once frontend reconstruction begins.

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

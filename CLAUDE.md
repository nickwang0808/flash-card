# Flash Card App

## Schema Changes

Postgres is the single source of truth. To change the schema:

```bash
# 1. Create a new migration
npx supabase migration new my_change_name

# 2. Edit the SQL file in supabase/migrations/

# 3. Apply locally
npx supabase migration up

# 4. Regenerate types + RxDB schemas
npm run gen

# 5. Code against the new schema — types are auto-generated
```

## Pre-push Checklist

Before every push, run the full test suite:

```bash
npm run test:unit && npm run test:e2e
```

Both unit tests and e2e tests must pass before pushing.

## Testing

- **Unit tests**: `npm run test:unit` — Vitest, tests in `tests/unit/`
- **E2E tests**: `npm run test:e2e` — Playwright, tests in `tests/e2e/`
  - Requires local Supabase running (`npx supabase start`)
  - Seeds test data directly into local Supabase; resets between tests
  - Test data: 30 spanish-vocab cards (all reversible), default limit 10 = 5 fwd + 5 rev = 10 study items

## Deployment

On merge to master, GitHub Actions:
1. Runs `supabase db push` to apply new migrations to production
2. Builds and deploys static files to GitHub Pages

Requires these GitHub secrets:
- `SUPABASE_PROJECT_REF` — project reference ID
- `SUPABASE_ACCESS_TOKEN` — CLI access token
- `VITE_SUPABASE_URL` — project URL
- `VITE_SUPABASE_ANON_KEY` — publishable key

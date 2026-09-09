# Flash Card

Flash Card is an Expo application with a private, one-shot `flashcard` CLI for deck, card, and review operations.

## CLI installation

Requires Node.js 22.12 or newer. From this repository, run `npm install && npm run build:cli && npm link`; private consumers can install the generated tarball with `npm pack` and `npm install <tarball>`.

Set only the public client configuration:

```sh
export FLASHCARD_SUPABASE_URL=https://project.supabase.co
export FLASHCARD_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
export FLASHCARD_API_URL=https://project.supabase.co/functions/v1/api
export FLASHCARD_OAUTH_CLIENT_ID=your-public-cli-oauth-client-id
```

Do not provide a service-role key, database URL, JWT/deployment secret, acceptance secret, password, or OAuth client secret through command-line arguments or environment variables.

Log in through a browser:

```sh
flashcard auth login
```

The CLI uses OAuth 2.1 Authorization Code with PKCE and a fixed loopback callback at `http://127.0.0.1:43821/oauth/callback`. Register a separate public OAuth client for each Supabase environment with that exact callback URI. Use `--no-open` to print the authorization URL instead of opening it automatically.

The default credential store is the OS keyring. The `file` fallback is explicit because it stores bearer credentials on disk with owner-only permissions.

## Web authentication

Local web builds require `EXPO_PUBLIC_AUTH_MODE=password` and `EXPO_PUBLIC_SITE_URL=http://localhost:8081/`. They use the local Supabase email/password provider and the local OAuth 2.1 authorization server configured in `supabase/config.toml`.
After changing `supabase/config.toml`, restart the local Supabase stack and run `npm run auth:register-local-cli`; evaluate the emitted `FLASHCARD_OAUTH_CLIENT_ID` export before `flashcard auth login`.


The production workflow supplies `EXPO_PUBLIC_AUTH_MODE=github` and the GitHub Pages site URL. In hosted Supabase, set that same Site URL, enable GitHub with an OAuth App whose callback is `https://<project-ref>.supabase.co/auth/v1/callback`, disable email/password sign-in, enable the OAuth 2.1 server with authorization path `/oauth/consent`, and register the production CLI public OAuth client. None of the GitHub or OAuth client secrets belong in this repository or static build.

Every operational command writes one JSON document to stdout on success and one JSON error document to stderr on failure. `--help` and `--version` use conventional text. See [the CLI reference](docs/cli.md) for commands, JSON input, security, versioning, pagination, and recovery guidance.

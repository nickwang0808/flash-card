# Flash Card

Flash Card is an Expo application with a private, one-shot `flashcard` CLI for deck, card, and review operations.

## CLI installation

Requires Node.js 22.12 or newer. From this repository, run `npm install && npm run build:cli && npm link`; private consumers can install the generated tarball with `npm pack` and `npm install <tarball>`.

Set only the public client configuration:

```sh
export FLASHCARD_SUPABASE_URL=https://project.supabase.co
export FLASHCARD_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
export FLASHCARD_API_URL=https://project.supabase.co/functions/v1/api
```

Do not provide a service-role key, database URL, JWT/deployment secret, acceptance secret, or password through command-line arguments or environment variables.

Log in with a password supplied through standard input rather than shell history:

```sh
flashcard auth login --email you@example.com --password-stdin < secure-password-input
```

The default credential store is the OS keyring. The `file` fallback is explicit because it stores encrypted-session-equivalent bearer tokens on disk with owner-only permissions.

Every operational command writes one JSON document to stdout on success and one JSON error document to stderr on failure. `--help` and `--version` use conventional text. See [the CLI reference](docs/cli.md) for commands, JSON input, security, versioning, pagination, and recovery guidance.

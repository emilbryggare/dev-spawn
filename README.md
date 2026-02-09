# dev-prism

<p align="center">
  <img src="banner.png" alt="dev-prism - One codebase, many parallel sessions" width="600">
</p>

A port allocator, env injector, and worktree manager for parallel development sessions. Enables multiple Claude Code (or human developer) sessions to work on the same repo simultaneously with complete isolation.

## Philosophy

**Allocate ports. Inject env. Get out of the way.**

dev-prism does three things:
1. Allocates unique ports via SQLite (UNIQUE constraints prevent conflicts)
2. Injects those ports into any command via `with-env`
3. Optionally manages git worktrees for isolated working directories

Docker is the user's responsibility. dev-prism just hands ports to whatever you run.

## Features

- **SQLite-backed port allocation** with UNIQUE constraints (zero conflicts)
- **`with-env` pass-through** — injects env vars into any command, no-op outside sessions
- **Git worktrees** for isolated working directories (or in-place mode)
- **App-specific env** — different env vars for different apps in a monorepo
- **Claude Code integration** built-in (`dev-prism claude`)
- **Portable**: Works with any project, any runtime, any Docker setup

## Installation

```bash
npm install -g dev-prism
# or
pnpm add -D dev-prism
```

## Quick Start

```bash
# Create a session (allocates ports + creates worktree)
dev-prism create --branch feature/auth

# Or create in current directory
dev-prism create --in-place

# Start Docker services with allocated ports
dev-prism with-env -- docker compose up -d

# Run app with session env injected
dev-prism with-env my-app -- pnpm dev

# Show allocated ports and env vars
dev-prism info

# Print env vars (for eval or piping)
dev-prism env

# Write .env file for IDE
dev-prism env --write .env

# Destroy session
dev-prism destroy
```

## Usage

### Create a session

```bash
# Create with worktree (generates timestamp-based branch)
dev-prism create

# Custom branch name
dev-prism create --branch feature/my-feature

# In-place mode — use current directory instead of creating worktree
dev-prism create --in-place
```

### Inject env and run commands

```bash
# Inject session env into any command
dev-prism with-env -- docker compose up -d
dev-prism with-env -- pnpm dev
dev-prism with-env -- cargo run

# Inject app-specific env (merges global + app config)
dev-prism with-env convas-app -- pnpm --filter convas-app dev
dev-prism with-env convas-web -- pnpm --filter convas-web dev
```

`with-env` is a no-op outside sessions — safe to use unconditionally in scripts and Makefiles.

### View env vars

```bash
# Print all env vars to stdout
dev-prism env

# Write to file (for IDE/GUI tools)
dev-prism env --write .env

# Include app-specific vars
dev-prism env --app convas-app
```

### List sessions

```bash
dev-prism list
```

### Session info

```bash
dev-prism info
```

### Cleanup

```bash
# Destroy session in current directory
dev-prism destroy

# Destroy all sessions
dev-prism destroy --all

# Remove orphaned sessions from database
dev-prism prune
dev-prism prune -y  # Skip confirmation
```

### Claude Code integration

```bash
dev-prism claude          # Install Claude Code skill + CLAUDE.md
dev-prism claude --force  # Overwrite existing files
```

## Configuration

### prism.config.mjs

```javascript
export default {
  ports: ['postgres', 'mailpit_http', 'mailpit_smtp', 'app', 'web'],

  env: {
    POSTGRES_PORT:     '${postgres}',
    MAILPIT_HTTP_PORT: '${mailpit_http}',
    MAILPIT_SMTP_PORT: '${mailpit_smtp}',
    DATABASE_URL:      'postgresql://postgres:postgres@localhost:${postgres}/postgres',
  },

  apps: {
    'convas-app': {
      PORT:         '${app}',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:${postgres}/postgres',
    },
    'convas-web': { PORT: '${web}' },
  },

  setup: ['pnpm install'],
};
```

### docker-compose.yml (user-managed)

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres-data:/var/lib/postgresql/data

  mailpit:
    image: axllent/mailpit
    ports:
      - "${MAILPIT_HTTP_PORT:-8025}:8025"
      - "${MAILPIT_SMTP_PORT:-1025}:1025"

volumes:
  postgres-data:
```

The `:-` defaults mean it works without dev-prism too (solo dev, standard ports).

## How It Works

1. **`dev-prism create`** allocates ports via `get-port` + SQLite UNIQUE constraints
2. **`dev-prism with-env -- <cmd>`** reads ports from SQLite, renders env templates, injects into command
3. **Docker Compose** uses `${VAR:-default}` substitution — standard, no dev-prism dependency

### Typical workflow

```bash
dev-prism create --branch feature/auth
cd ../sessions/feature/auth

dev-prism with-env -- docker compose up -d     # infra on allocated ports
dev-prism with-env convas-app -- pnpm dev      # app with PORT + DATABASE_URL

# Or in package.json scripts:
# "dev": "dev-prism with-env -- turbo dev"
# "docker:up": "dev-prism with-env -- docker compose up -d"
```

## Architecture

### SQLite as Source of Truth

Location: `<project-root>/.dev-prism/sessions.db`

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,  -- working directory path
  branch     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE port_allocations (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  service    TEXT NOT NULL,
  port       INTEGER NOT NULL UNIQUE,  -- prevents cross-session conflicts
  PRIMARY KEY (session_id, service)
);
```

### Port Allocation Strategy

Two-phase: `get-port` finds free TCP ports, SQLite UNIQUE prevents cross-session conflicts.

1. Query all existing allocated + reserved ports
2. Use `get-port` to find free ports (excluding existing)
3. INSERT all in a single transaction
4. Retry once on UNIQUE violation (race condition)

### `with-env` Pass-Through

```
No project root found → exec command as-is
No session in DB      → exec command as-is
Session found         → render env templates → merge with process.env → exec
```

This makes `with-env` safe to use unconditionally in scripts, Makefiles, and CI.

## Portability

To use in another project:

1. Install: `pnpm add -D dev-prism`
2. Create `prism.config.mjs` with your ports and env templates
3. Write your own `docker-compose.yml` using `${VAR:-default}` for ports
4. Run `dev-prism create --in-place`

dev-prism doesn't generate any Docker files — you own your Docker setup entirely.

## FAQ

### How do I use `with-env` with Turborepo / `pnpm dev`?

When running all apps at once (e.g. `turbo dev`), every subprocess inherits the same flat environment. This means two apps can't both use a generic `PORT` variable with different values.

The solution: use **unique variable names** in the global `env` block for the all-apps case, and use the `apps` section for single-app invocation where generic names like `PORT` work fine.

```javascript
// prism.config.mjs
export default {
  ports: ['postgres', 'app', 'api'],

  env: {
    // Shared — used by docker compose and all apps
    POSTGRES_PORT: '${postgres}',
    DATABASE_URL:  'postgresql://localhost:${postgres}/mydb',
    // App-specific with unique names — used by turbo dev
    APP_PORT: '${app}',
    API_PORT: '${api}',
  },

  apps: {
    // Convenience for single-app dev — generic names
    'my-app': { PORT: '${app}' },
    'my-api': { PORT: '${api}' },
  },
};
```

Then all three workflows work:

```bash
dev-prism with-env -- docker compose up -d          # global env → POSTGRES_PORT
dev-prism with-env -- pnpm dev                      # global env → APP_PORT, API_PORT (each app reads its own)
dev-prism with-env my-app -- pnpm --filter my-app dev  # global + app env → PORT=<app port>
```

The `apps` section is a convenience for single-app invocation. The global `env` block handles the run-everything-at-once case.

## Migration from v0.6.x

v0.7.0 is a breaking change that removes Docker orchestration:

**What changed:**
- Port allocation: Docker random → `get-port` + SQLite
- State storage: Docker labels → SQLite database
- Docker management: Removed (user's responsibility)
- New commands: `with-env`, `env`
- Removed commands: `start`, `stop`, `stop-all`, `logs`

**Migration steps:**
1. Stop all v0.6 sessions: `dev-prism stop-all` (on v0.6.x)
2. Upgrade: `pnpm add -g dev-prism@0.7`
3. Update config to `prism.config.mjs` with new format (ports array, env templates)
4. Write your own `docker-compose.yml` with `${VAR:-default}` port substitution
5. Recreate sessions

## License

MIT

# Chat-PPC Client (Active Runtime)

This folder now contains the active Chat-PPC application:

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Prisma + Neon PostgreSQL
- REST + SSE realtime transport

Legacy CRA files were moved to `legacy-cra/` for reference only.

## Prerequisites

- Node.js 20+
- pnpm 10+
- Neon Postgres database (or any PostgreSQL instance)

## Environment

Create `client/.env` from `client/.env.example`:

```bash
cp .env.example .env
```

Required values:

- `DATABASE_URL` PostgreSQL connection string
- `BLOB_READ_WRITE_TOKEN` required for profile image uploads
- `OPENAI_API_KEY` optional, needed for real `!ai` model responses
- `OPENAI_MODEL` optional, defaults to `gpt-4o-mini`

## Install

From the repository root:

```bash
pnpm install
```

## Database Setup

Generate Prisma client and apply migrations:

```bash
pnpm -C client prisma:generate
pnpm -C client prisma:migrate
```

Import legacy JSON data from `../server` into PostgreSQL:

```bash
pnpm -C client import:legacy
```

The import is idempotent and safe to rerun.

## Run

```bash
pnpm -C client dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

```bash
pnpm -C client dev
pnpm -C client build
pnpm -C client start
pnpm -C client lint
pnpm -C client typecheck
pnpm -C client test
```

## API Surface

Implemented route handlers:

- `POST /api/auth/login`
- `PATCH /api/users/me`
- `POST /api/presence/ping`
- `POST /api/presence/typing`
- `POST /api/presence/logout`
- `GET /api/messages`
- `POST /api/messages`
- `POST /api/polls/vote`
- `GET /api/stream` (SSE)
- `POST /api/uploads/profile`

## Notes

- Typing state, online presence, poll voting, question/answer threading, and `!ai` message trigger are preserved from the legacy app behavior.
- Poll voting is now enforced server-side (one vote per user per poll).
- If `OPENAI_API_KEY` is not set, the app still responds with a deterministic fallback AI message.
- Login creates a system message in chat: `"username joined the chat"`.
- Going offline creates a system message in chat: `"username left the chat"`.
- If `BLOB_READ_WRITE_TOKEN` is missing, avatar uploads still work for small files via inline data URLs.

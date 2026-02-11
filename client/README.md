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

Create or edit `client/.env` directly.

Required values:

- `DATABASE_URL` PostgreSQL connection string
- `BLOB_READ_WRITE_TOKEN` required for image uploads (profiles, chat, AI-generated images). `BLOB` is also accepted as an alias.
- `OPENAI_API_KEY` optional, needed for real `@chatgpt` model responses
- `ALLOW_INLINE_UPLOADS` optional dev-only escape hatch (`true|false`, default `false`)

OpenAI runtime configuration (all optional, defaults can be kept as shown in your current `client/.env`):

- `OPENAI_MODEL` fallback model when no prompt id is used
- `OPENAI_PROMPT_ID` reusable prompt id for `responses.create`
- `OPENAI_PROMPT_VERSION` prompt version (update this when you publish a new prompt version)
- `OPENAI_LOW_LATENCY_MODE` `true|false` (default `true`, enables faster tool selection for normal chat)
- `OPENAI_STORE_RESPONSES` `true|false`
- `OPENAI_INCLUDE_REASONING_ENCRYPTED` `true|false`
- `OPENAI_INCLUDE_WEB_SOURCES` `true|false`
- `OPENAI_ENABLE_WEB_SEARCH` `true|false`
- `OPENAI_WEB_SEARCH_COUNTRY`, `OPENAI_WEB_SEARCH_REGION`, `OPENAI_WEB_SEARCH_CITY`
- `OPENAI_WEB_SEARCH_CONTEXT_SIZE` `low|medium|high`
- `OPENAI_ENABLE_IMAGE_GENERATION` `true|false`
- `OPENAI_IMAGE_MODEL` (example: `gpt-image-1-mini`)
- `OPENAI_IMAGE_BACKGROUND` `auto|opaque|transparent`
- `OPENAI_IMAGE_MODERATION` `low|auto`
- `OPENAI_IMAGE_OUTPUT_COMPRESSION` `0-100`
- `OPENAI_IMAGE_OUTPUT_FORMAT` `png|jpeg|webp`
- `OPENAI_IMAGE_QUALITY` `auto|low|medium|high`
- `OPENAI_IMAGE_SIZE` `auto|1024x1024|1024x1536|1536x1024`

Developer mode configuration (optional):

- `CHAT_DEV_UNLOCK_CODE` private 16-digit value; typing this as username activates dev mode
- `CHAT_DEV_TOKEN_SECRET` signing secret for dev-mode admin APIs (recommended)

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
pnpm -C client deploy:vercel
```

## Vercel Settings

For Vercel, this app must be deployed with `client` as project root:

- `Root Directory`: `client`
- `Framework Preset`: `Next.js`
- `Install Command`: `pnpm install --frozen-lockfile`
- `Build Command`: `pnpm deploy:vercel`

If Vercel is pointed to repo root, deployment can fail with:
`Error: No Next.js version detected ...`

## API Surface

Implemented route handlers:

- `POST /api/auth/login`
- `PATCH /api/users/me`
- `POST /api/presence/ping`
- `POST /api/presence/typing`
- `POST /api/presence/logout`
- `GET /api/presence`
- `GET /api/messages`
- `POST /api/messages`
- `POST /api/polls/vote`
- `GET /api/link-preview`
- `GET /api/admin`
- `POST /api/admin`
- `POST /api/uploads/profile`
- `POST /api/uploads/chat`
- `GET /api/stream`
- `GET /api/ai/worker`
- `POST /api/ai/worker`

## Notes

- Typing state, online presence, poll voting, question/answer threading, and `@chatgpt` message trigger are preserved from the legacy app behavior.
- Poll voting is now enforced server-side (one vote per user per poll).
- Login creates a system message in chat: `"username joined the chat"`.
- Going offline creates a system message in chat: `"username left the chat"`.
- In production, uploads require `BLOB_READ_WRITE_TOKEN`; inline data URL uploads are blocked.
- Inline uploads can be temporarily enabled only outside production by setting `ALLOW_INLINE_UPLOADS=true`.

## Legacy Inline Media Migration

If you previously stored inline `data:image/...` URLs in the DB, migrate them to Blob:

```bash
pnpm -C client media:migrate-inline -- --dry-run
pnpm -C client media:migrate-inline -- --write
```

The migration updates:

- `User.profilePicture` (including the global background row)
- `Message.authorProfilePicture`
- Inline markdown image URLs inside `Message.content`

Quick verification queries:

```sql
SELECT COUNT(*) FROM "User" WHERE "profilePicture" LIKE 'data:image/%';
SELECT COUNT(*) FROM "Message" WHERE "authorProfilePicture" LIKE 'data:image/%';
SELECT COUNT(*) FROM "Message" WHERE "content" LIKE '%data:image/%';
```

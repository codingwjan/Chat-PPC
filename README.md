# Chat-PPC

Chat-PPC is modernized to a single active runtime in `client/`:

- Next.js App Router + TypeScript
- Tailwind CSS
- Neon PostgreSQL via Prisma
- REST + SSE realtime updates

The old Node/Socket.IO server is archived in `server/` for legacy data import only.

## Workspace

This repository uses `pnpm` workspaces.

From repo root:

```bash
pnpm install
```

## Setup and Run

```bash
# Create client/.env with DATABASE_URL, OPENAI_*, BLOB_READ_WRITE_TOKEN, NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE
pnpm -C client prisma:generate
pnpm -C client prisma:migrate
pnpm -C client import:legacy
pnpm -C client dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
pnpm -C client lint
pnpm -C client typecheck
pnpm -C client test
pnpm -C client build
```

## Deploy to Vercel

This is a monorepo. In Vercel Project Settings set:

- `Root Directory`: `client`
- `Framework Preset`: `Next.js`
- `Install Command`: `pnpm install --frozen-lockfile`
- `Build Command`: `pnpm deploy:vercel`

If `Root Directory` is left as repo root, Vercel can fail with:
`Error: No Next.js version detected ...`

Set these project environment variables in Vercel:

- `DATABASE_URL` Neon pooled connection string (`sslmode=require`)
- `BLOB_READ_WRITE_TOKEN` for profile image uploads
- `OPENAI_API_KEY` (optional)
- `OPENAI_MODEL` (optional fallback model)
- `OPENAI_PROMPT_ID` and `OPENAI_PROMPT_VERSION` (for pinned prompt releases)
- `OPENAI_ENABLE_WEB_SEARCH`, `OPENAI_WEB_SEARCH_*` (optional)
- `OPENAI_ENABLE_IMAGE_GENERATION`, `OPENAI_IMAGE_*` (optional)
- `OPENAI_STORE_RESPONSES`, `OPENAI_INCLUDE_REASONING_ENCRYPTED`, `OPENAI_INCLUDE_WEB_SOURCES` (optional)
- `CHAT_DEV_UNLOCK_CODE` 16-digit username unlock for developer mode (optional)
- `CHAT_DEV_TOKEN_SECRET` signing secret for dev-mode admin token (optional, recommended)
- `NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE` (optional)

Use `client/.env` as the canonical list of OpenAI runtime variables.

Deploy command:

```bash
pnpm -C client deploy:vercel
```

## Folder Roles

- `client/` active app and API runtime
- `server/` legacy archive and JSON migration source

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
cp client/.env.example client/.env
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

Set these project environment variables in Vercel:

- `DATABASE_URL` Neon pooled connection string (`sslmode=require`)
- `BLOB_READ_WRITE_TOKEN` for profile image uploads
- `OPENAI_API_KEY` (optional)
- `OPENAI_MODEL` (optional)
- `NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE` (optional)

## Folder Roles

- `client/` active app and API runtime
- `server/` legacy archive and JSON migration source

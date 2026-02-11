# Legacy Server Archive

This folder is kept as a legacy archive and is no longer the active runtime.

## Status

- `server/server.js` is historical reference code (Socket.IO + JSON file storage).
- Runtime moved to `../client` (Next.js + Tailwind + PostgreSQL + Prisma).
- Do not use this folder to run the app.

## Why It Is Kept

These files are retained for migration context and data import:

- `users.json`
- `chat.json`
- `blacklist.json`

The active import command in `client` reads these files:

```bash
pnpm -C ../client import:legacy
```

## Notes

- Dependencies and lockfiles in this folder are intentionally preserved as archive state.
- Any new development should happen in `../client`.

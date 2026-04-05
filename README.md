This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Production database & deployment notes

- This project uses Prisma. The local `DATABASE_URL` in `.env` points to `prisma/dev.db` (SQLite) for development. SQLite is not suitable for production on Vercel — the filesystem is ephemeral.
- Provision a hosted database (examples: Vercel Postgres, Supabase, Neon, Railway, PlanetScale) and set `DATABASE_URL` in your Vercel project environment variables.
- Ensure you add `AUTH_SECRET` and any other required env vars (e.g. `NEXTAUTH_URL` for explicit production origin) in Vercel.

Recommended deployment steps:

1. In Vercel project settings, set `DATABASE_URL` to your production DB connection string and `AUTH_SECRET`.
2. Run migrations and generate Prisma client on the production DB:

```bash
# Locally or in CI (must have DATABASE_URL set to the production DB):
npx prisma migrate deploy
npx prisma generate
```

3. If you want to copy data from your local SQLite `prisma/dev.db` to production, run the included migration script locally (set `DATABASE_URL` to the production DB first):

```bash
# install dependency for the migration script (native module)
npm install --save better-sqlite3

# set DATABASE_URL then run
#$env:DATABASE_URL="postgresql://user:pass@host:5432/dbname"    # PowerShell
node scripts/migrate-dev-to-prod.js
```

Notes:

- The migration script preserves ids and timestamps where possible. Review it in `scripts/migrate-dev-to-prod.js` and test on a non-production target first.
- For serverless deployments, consider using Prisma Data Proxy or a serverless-friendly DB provider to avoid connection exhaustion.
- This repository includes `server.mjs` (a long-running Socket.IO server). Vercel does not support long-running servers — host that separately (Render, Railway, Fly, etc.) if you need WebSockets.

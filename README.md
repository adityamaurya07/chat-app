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

- The app uses **MongoDB** via **Mongoose**. Set `DATABASE_URL` to a MongoDB connection string (for example MongoDB Atlas, Railway, or self-hosted).
- Add `AUTH_SECRET` and any other required env vars (for example `NEXTAUTH_URL` for an explicit production origin) in your host’s environment.

Recommended deployment steps:

1. Provision MongoDB and set `DATABASE_URL` and `AUTH_SECRET` in your project environment.
2. If you have an old **SQLite** export (tables `users`, `friendships`, `messages`), copy it to `dev.db` in the project root (or set `SQLITE_PATH`), then run locally with `DATABASE_URL` pointing at your MongoDB:

```bash
npm install
# PowerShell example:
# $env:DATABASE_URL="mongodb://..."
# $env:SQLITE_PATH="C:\path\to\legacy.db"   # optional
npm run migrate:dev-to-mongo
# or: node scripts/migrate-dev-to-prod.js
```

Notes:

- Migration scripts preserve ids and timestamps where possible. Test on a non-production database first.
- Mongoose opens one connection per Node process; use a connection pool limit appropriate for your host.
- This repository includes `server.mjs` (a long-running Socket.IO server). Vercel does not support long-running servers — host that separately (Render, Railway, Fly, etc.) if you need WebSockets.

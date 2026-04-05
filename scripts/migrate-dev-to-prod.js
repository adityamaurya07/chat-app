#!/usr/bin/env node
/**
 * scripts/migrate-dev-to-prod.js
 *
 * Copies data from the local SQLite `prisma/dev.db` to the production database
 * pointed to by `process.env.DATABASE_URL`.
 *
 * Usage:
 *   On Windows PowerShell:
 *     $env:DATABASE_URL="postgresql://..."
 *     node scripts/migrate-dev-to-prod.js
 *
 * Install dependency: `npm install better-sqlite3` (native module)
 */

const path = require("path");
const BetterSqlite3 = require("better-sqlite3");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const devDbPath = path.join(__dirname, "..", "prisma", "dev.db");
  const sqlite = new BetterSqlite3(devDbPath, { readonly: true });

  if (!process.env.DATABASE_URL) {
    console.error(
      "Please set DATABASE_URL to the production database before running.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    console.log("Reading users from dev.db...");
    const users = sqlite
      .prepare(
        `SELECT id, name, email, password_hash AS passwordHash, created_at AS createdAt FROM users`,
      )
      .all();

    for (const u of users) {
      try {
        await prisma.user.upsert({
          where: { email: u.email },
          update: {
            name: u.name,
            passwordHash: u.passwordHash,
            createdAt: new Date(u.createdAt),
          },
          create: {
            id: u.id,
            name: u.name,
            email: u.email,
            passwordHash: u.passwordHash,
            createdAt: new Date(u.createdAt),
          },
        });
      } catch (e) {
        console.error("User upsert failed", u.email, e.message || e);
      }
    }

    console.log("Reading friendships from dev.db...");
    const friendships = sqlite
      .prepare(
        `SELECT id, requester_id AS requesterId, addressee_id AS addresseeId, status, created_at AS createdAt, updated_at AS updatedAt FROM friendships`,
      )
      .all();

    for (const f of friendships) {
      try {
        // Skip if friendship already exists by id
        const exists = await prisma.friendship.findUnique({
          where: { id: f.id },
        });
        if (exists) continue;
        await prisma.friendship.create({
          data: {
            id: f.id,
            requesterId: f.requesterId,
            addresseeId: f.addresseeId,
            status: f.status,
            createdAt: new Date(f.createdAt),
            updatedAt: f.updatedAt ? new Date(f.updatedAt) : undefined,
          },
        });
      } catch (e) {
        console.error("Friendship create failed", f.id, e.message || e);
      }
    }

    console.log("Reading messages from dev.db...");
    const messages = sqlite
      .prepare(
        `SELECT id, room_id AS roomId, user_id AS userId, user_name AS userName, content, created_at AS createdAt FROM messages`,
      )
      .all();

    for (const m of messages) {
      try {
        const exists = await prisma.message.findUnique({ where: { id: m.id } });
        if (exists) continue;
        await prisma.message.create({
          data: {
            id: m.id,
            roomId: m.roomId,
            userId: m.userId,
            userName: m.userName,
            content: m.content,
            createdAt: new Date(m.createdAt),
          },
        });
      } catch (e) {
        console.error("Message create failed", m.id, e.message || e);
      }
    }

    console.log("Data migration finished.");
  } finally {
    await prisma.$disconnect();
    sqlite.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

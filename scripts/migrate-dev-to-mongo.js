#!/usr/bin/env node
/**
 * scripts/migrate-dev-to-mongo.js
 * Copy data from a local SQLite file into MongoDB using mongoose.
 * Usage:
 *   set DATABASE_URL=mongodb://user:pass@host:27017/dbname
 *   node scripts/migrate-dev-to-mongo.js
 *
 * Optional: SQLITE_PATH overrides the SQLite file (default: <project>/dev.db)
 */

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const mongoose = require("mongoose");

function allRows(db, sql) {
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function main() {
  const devDbPath =
    process.env.SQLITE_PATH ||
    path.join(__dirname, "..", "dev.db");

  if (!fs.existsSync(devDbPath)) {
    console.error("SQLite file not found:", devDbPath);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(devDbPath);
  const sqlite = new SQL.Database(new Uint8Array(fileBuffer));

  const mongoUri =
    process.env.DATABASE_URL || "mongodb://localhost:27017/chat-app";
  await mongoose.connect(mongoUri, { dbName: undefined }).catch((e) => {
    console.error("Mongo connect error", e);
    process.exit(1);
  });

  const userSchema = new mongoose.Schema(
    {
      _id: String,
      name: String,
      email: String,
      passwordHash: String,
      createdAt: Date,
    },
    { collection: "users", timestamps: false },
  );
  const friendshipSchema = new mongoose.Schema(
    {
      _id: String,
      requesterId: String,
      addresseeId: String,
      status: String,
      createdAt: Date,
      updatedAt: Date,
    },
    { collection: "friendships", timestamps: false },
  );
  const messageSchema = new mongoose.Schema(
    {
      _id: String,
      roomId: String,
      userId: String,
      userName: String,
      content: String,
      createdAt: Date,
    },
    { collection: "messages", timestamps: false },
  );

  const User = mongoose.model("User", userSchema);
  const Friendship = mongoose.model("Friendship", friendshipSchema);
  const Message = mongoose.model("Message", messageSchema);

  try {
    console.log("Importing users...");
    const users = allRows(
      sqlite,
      "SELECT id, name, email, password_hash AS passwordHash, created_at AS createdAt FROM users",
    );
    for (const u of users) {
      try {
        await User.updateOne(
          { _id: u.id },
          {
            $set: {
              name: u.name,
              email: u.email,
              passwordHash: u.passwordHash,
              createdAt: new Date(u.createdAt),
            },
          },
          { upsert: true },
        );
      } catch (e) {
        console.error("User error", u.id, e);
      }
    }

    console.log("Importing friendships...");
    const friendships = allRows(
      sqlite,
      "SELECT id, requester_id AS requesterId, addressee_id AS addresseeId, status, created_at AS createdAt, updated_at AS updatedAt FROM friendships",
    );
    for (const f of friendships) {
      try {
        await Friendship.updateOne(
          { _id: f.id },
          {
            $set: {
              requesterId: f.requesterId,
              addresseeId: f.addresseeId,
              status: f.status,
              createdAt: new Date(f.createdAt),
              updatedAt: f.updatedAt ? new Date(f.updatedAt) : new Date(),
            },
          },
          { upsert: true },
        );
      } catch (e) {
        console.error("Friendship error", f.id, e);
      }
    }

    console.log("Importing messages...");
    const messages = allRows(
      sqlite,
      "SELECT id, room_id AS roomId, user_id AS userId, user_name AS userName, content, created_at AS createdAt FROM messages",
    );
    for (const m of messages) {
      try {
        await Message.updateOne(
          { _id: m.id },
          {
            $set: {
              roomId: m.roomId,
              userId: m.userId,
              userName: m.userName,
              content: m.content,
              createdAt: new Date(m.createdAt),
            },
          },
          { upsert: true },
        );
      } catch (e) {
        console.error("Message error", m.id, e);
      }
    }

    console.log("Migration complete");
  } finally {
    sqlite.close();
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

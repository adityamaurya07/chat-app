import "server-only";

import mongoose from "mongoose";

/** Reuse one connection across hot reloads and Vercel serverless invocations. */
const globalForMongoose = globalThis as unknown as {
  __mongooseConn?: Promise<typeof mongoose>;
};

function normalizeDatabaseUrl(value: string | undefined): string {
  if (value == null) return "";
  let v = value.trim().replace(/^\uFEFF/, "");
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function getMongoUri(): string {
  const raw = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set. Use a MongoDB URI, e.g. mongodb://127.0.0.1:27017/chat-app or mongodb+srv://user:pass@cluster.mongodb.net/dbname",
    );
  }
  if (!raw.startsWith("mongodb://") && !raw.startsWith("mongodb+srv://")) {
    const hint =
      raw.startsWith("file:") || raw.includes("dev.db")
        ? " This value looks like an old SQLite/Prisma URL. Update DATABASE_URL to MongoDB, and remove any duplicate DATABASE_URL from .env.local or Windows “Environment variables” (they override .env)."
        : " Use mongodb:// or mongodb+srv:// only.";
    throw new Error(
      "DATABASE_URL must be a MongoDB connection string (mongodb:// or mongodb+srv://). " +
        "SQLite/file URLs are not supported with Mongoose." +
        hint,
    );
  }
  return raw;
}

export async function connectDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (!globalForMongoose.__mongooseConn) {
    mongoose.set("strictQuery", false);
    const uri = getMongoUri();
    const opts: mongoose.ConnectOptions = { serverSelectionTimeoutMS: 15_000 };
    if (/mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(uri)) {
      opts.family = 4;
    }
    globalForMongoose.__mongooseConn = mongoose
      .connect(uri, opts)
      .then(() => {
        if (process.env.NODE_ENV !== "production") {
          console.log("MongoDB connected");
        }
        return mongoose;
      })
      .catch((err) => {
        globalForMongoose.__mongooseConn = undefined;
        console.error("MongoDB connection failed:", err);
        throw err;
      });
  }
  return globalForMongoose.__mongooseConn;
}

/** 503 JSON when MongoDB cannot be reached (includes `details` in non-production). */
export function jsonDbUnavailable(err: unknown) {
  const details = err instanceof Error ? err.message : String(err);
  return Response.json(
    {
      error: "Database unavailable",
      hint: "MongoDB must be running and DATABASE_URL must point to it. Local: run `docker compose up -d` in this project, or install MongoDB. Cloud: use Atlas and set DATABASE_URL to your mongodb+srv:// connection string.",
      ...(process.env.NODE_ENV !== "production" ? { details } : {}),
    },
    { status: 503 },
  );
}

const { Schema, model, models } = mongoose;

const UserSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: String,
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "users", timestamps: false },
);

const FriendshipSchema = new Schema(
  {
    _id: { type: String, required: true },
    requesterId: { type: String, required: true },
    addresseeId: { type: String, required: true },
    status: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "friendships", timestamps: false },
);

const MessageSchema = new Schema(
  {
    _id: { type: String, required: true },
    roomId: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "messages", timestamps: false },
);

export const User = models.User ?? model("User", UserSchema);
export const Friendship =
  models.Friendship ?? model("Friendship", FriendshipSchema);
export const Message = models.Message ?? model("Message", MessageSchema);

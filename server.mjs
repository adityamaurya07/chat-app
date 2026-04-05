import "dotenv/config";
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";

const mongoUri =
  process.env.DBURL?.trim() || "mongodb://127.0.0.1:27017/chat-app";
if (
  !mongoUri.startsWith("mongodb://") &&
  !mongoUri.startsWith("mongodb+srv://")
) {
  console.error(
    "DBURL must be a MongoDB URI (mongodb:// or mongodb+srv://). SQLite file URLs are not supported.",
  );
  process.exit(1);
}
mongoose.set("strictQuery", false);
await mongoose
  .connect(mongoUri)
  .catch((e) => console.error("Mongoose connect error", e));

const { Schema, model } = mongoose;

const FriendshipSchema = new Schema(
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

const MessageSchema = new Schema(
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

const Friendship = model("Friendship", FriendshipSchema);
const Message = model("Message", MessageSchema);
const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

function dmRoom(a, b) {
  return a < b ? `dm:${a}_${b}` : `dm:${b}_${a}`;
}

async function areFriends(userIdA, userIdB) {
  const f = await Friendship.findOne({
    status: "ACCEPTED",
    $or: [
      { requesterId: userIdA, addresseeId: userIdB },
      { requesterId: userIdB, addresseeId: userIdA },
    ],
  }).lean();
  return !!f;
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  try {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  } catch (err) {
    console.error("Request error", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: {
    origin: "*",
    credentials: true,
  },
});

globalThis.__io = io;

/** @type {Map<string, string>} userId -> socket.id */
const userSockets = new Map();

io.use(async (socket, next) => {
  try {
    const cookie = socket.handshake.headers.cookie || "";
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      console.error("AUTH_SECRET is not set");
      return next(new Error("Server misconfigured"));
    }
    const token = await getToken({
      req: { headers: { cookie } },
      secret,
    });
    if (!token?.sub) return next(new Error("Unauthorized"));
    socket.data.userId = token.sub;
    socket.data.userName = String(token.name || "User").slice(0, 64);
    socket.data.inVc = false;
    socket.data.vcPeerId = null;
    socket.data.dmRoom = null;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const uid = socket.data.userId;
  userSockets.set(uid, socket.id);
  socket.join(`user:${uid}`);

  socket.on("dm:join", async (payload) => {
    const peerId = payload?.peerId;
    if (!peerId || typeof peerId !== "string" || peerId === uid) return;
    if (!(await areFriends(uid, peerId))) return;
    const room = dmRoom(uid, peerId);
    if (socket.data.dmRoom && socket.data.dmRoom !== room) {
      socket.leave(socket.data.dmRoom);
    }
    socket.join(room);
    socket.data.dmRoom = room;
    socket.data.dmPeerId = peerId;
  });

  socket.on("dm:leave", () => {
    if (socket.data.dmRoom) {
      socket.leave(socket.data.dmRoom);
      socket.data.dmRoom = null;
      socket.data.dmPeerId = null;
    }
  });

  socket.on("chat:send", async (payload) => {
    const peerId = payload?.peerId;
    const content = String(payload?.content ?? "")
      .trim()
      .slice(0, 2000);
    if (!peerId || !content) return;
    if (!(await areFriends(uid, peerId))) return;
    const roomId = dmRoom(uid, peerId);
    try {
      const created = await Message.create({
        _id: undefined,
        roomId: roomId,
        userId: uid,
        userName: socket.data.userName,
        content,
        createdAt: new Date(),
      });
      io.to(roomId).emit("chat:message", {
        id: created._id?.toString(),
        userId: created.userId,
        userName: created.userName,
        content: created.content,
        createdAt: new Date(created.createdAt).getTime(),
        peerId: uid,
      });
    } catch (e) {
      console.error("chat:send", e);
    }
  });

  socket.on("typing", async (payload) => {
    const peerId = payload?.peerId;
    const active = !!payload?.active;
    if (!peerId || typeof peerId !== "string") return;
    if (!(await areFriends(uid, peerId))) return;
    io.to(`user:${peerId}`).emit("peer:typing", {
      fromUserId: uid,
      fromUserName: socket.data.userName,
      active,
    });
  });

  socket.on("vc:join", async (payload) => {
    const peerId = payload?.peerId;
    if (!peerId || typeof peerId !== "string" || peerId === uid) return;
    if (!(await areFriends(uid, peerId))) return;
    if (socket.data.inVc) return;
    socket.data.inVc = true;
    socket.data.vcPeerId = peerId;

    const otherSid = userSockets.get(peerId);
    let matched = false;
    if (otherSid) {
      const other = io.sockets.sockets.get(otherSid);
      if (other?.data?.inVc && other?.data?.vcPeerId === uid) {
        matched = true;
        socket.emit("vc:roster", { userIds: [peerId] });
        io.to(otherSid).emit("vc:roster", { userIds: [uid] });
      }
    }
    if (!matched) {
      socket.emit("vc:roster", { userIds: [] });
      if (otherSid) {
        io.to(otherSid).emit("vc:partner-ready", {
          userId: uid,
          userName: socket.data.userName,
        });
      }
    }
  });

  socket.on("vc:leave", () => {
    if (!socket.data.inVc) return;
    const peerId = socket.data.vcPeerId;
    socket.data.inVc = false;
    socket.data.vcPeerId = null;
    if (peerId) {
      const otherSid = userSockets.get(peerId);
      if (otherSid) {
        io.to(otherSid).emit("vc:peer-left", { userId: uid });
      }
    }
  });

  socket.on("webrtc:signal", async (payload) => {
    const toUserId = payload?.toUserId;
    const data = payload?.data;
    if (!toUserId || data == null) return;
    if (!(await areFriends(uid, toUserId))) return;
    const targetSid = userSockets.get(toUserId);
    if (!targetSid) return;
    io.to(targetSid).emit("webrtc:signal", {
      fromUserId: uid,
      data,
    });
  });

  socket.on("disconnect", () => {
    if (userSockets.get(uid) === socket.id) userSockets.delete(uid);
    if (socket.data.inVc && socket.data.vcPeerId) {
      const otherSid = userSockets.get(socket.data.vcPeerId);
      if (otherSid) {
        io.to(otherSid).emit("vc:peer-left", { userId: uid });
      }
      socket.data.inVc = false;
      socket.data.vcPeerId = null;
    }
    if (socket.data.dmRoom) {
      socket.leave(socket.data.dmRoom);
    }
  });
});

httpServer
  .once("error", (err) => {
    console.error(err);
    process.exit(1);
  })
  .listen(port, () => {
    console.log(`Ready on http://${hostname}:${port}`);
  });

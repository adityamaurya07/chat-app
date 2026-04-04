"use client";

import { signOut } from "next-auth/react";
import { io, type Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: number;
};

type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  relation: "none" | "friends" | "outgoing" | "incoming";
  friendshipId?: string;
};

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function RemoteVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700 bg-black">
      <video ref={ref} autoPlay playsInline className="aspect-video w-full max-h-40 object-cover" />
      <p className="truncate px-2 py-1 text-xs text-zinc-400">{label}</p>
    </div>
  );
}

export function ChatRoom({ userId, userName }: { userId: string; userName: string }) {
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const selectedPeer = directory.find((u) => u.id === selectedPeerId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [inVc, setInVc] = useState(false);
  const [vcError, setVcError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peerTyping, setPeerTyping] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [friendActionId, setFriendActionId] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingPeerStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedPeerIdRef = useRef<string | null>(null);
  selectedPeerIdRef.current = selectedPeerId;

  const sendSignal = useCallback((toUserId: string, data: unknown) => {
    socketRef.current?.emit("webrtc:signal", { toUserId, data });
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const [, pc] of peersRef.current) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.close();
    }
    peersRef.current.clear();
    setRemoteStreams(new Map());
  }, []);

  const stopLocalMedia = useCallback(() => {
    const s = localStreamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  const loadDirectory = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = (await res.json()) as DirectoryUser[];
        setDirectory(data);
      }
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const makePc = useCallback(
    (remoteUserId: string) => {
      const pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal(remoteUserId, { type: "ice", candidate: e.candidate.toJSON() });
        }
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (stream) {
          setRemoteStreams((prev) => new Map(prev).set(remoteUserId, stream));
        }
      };
      return pc;
    },
    [sendSignal],
  );

  const startOffer = useCallback(
    async (remoteUserId: string) => {
      const stream = localStreamRef.current;
      if (!stream || peersRef.current.has(remoteUserId)) return;
      const pc = makePc(remoteUserId);
      peersRef.current.set(remoteUserId, pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(remoteUserId, { type: "offer", sdp: pc.localDescription });
    },
    [makePc, sendSignal],
  );

  const handleSignal = useCallback(
    async (fromUserId: string, data: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      if (data.type === "offer" && data.sdp) {
        let pc = peersRef.current.get(fromUserId);
        if (!pc) {
          pc = makePc(fromUserId);
          peersRef.current.set(fromUserId, pc);
          const stream = localStreamRef.current;
          if (stream) {
            stream.getTracks().forEach((t) => pc!.addTrack(t, stream));
          }
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(fromUserId, { type: "answer", sdp: pc.localDescription });
        } catch {
          /* ignore */
        }
        return;
      }
      if (data.type === "answer" && data.sdp) {
        const pc = peersRef.current.get(fromUserId);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch {
          /* ignore */
        }
        return;
      }
      if (data.type === "ice" && data.candidate) {
        const pc = peersRef.current.get(fromUserId);
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {
          /* ignore */
        }
      }
    },
    [makePc, sendSignal],
  );

  const handleSignalRef = useRef(handleSignal);
  const startOfferRef = useRef(startOffer);
  const loadDirectoryRef = useRef(loadDirectory);
  handleSignalRef.current = handleSignal;
  startOfferRef.current = startOffer;
  loadDirectoryRef.current = loadDirectory;

  useEffect(() => {
    if (!selectedPeerId || selectedPeer?.relation !== "friends") {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/messages?peerId=${encodeURIComponent(selectedPeerId)}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = (await res.json()) as ChatMessage[];
      if (!cancelled) setMessages(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPeerId, selectedPeer?.relation]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, peerTyping]);

  useEffect(() => {
    const socket = io({
      path: "/socket.io/",
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("directory:changed", () => {
      void loadDirectoryRef.current();
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      setMessages((m) => [...m, msg]);
    });

    socket.on("vc:roster", (p: { userIds: string[] }) => {
      for (const id of p.userIds) {
        void startOfferRef.current(id);
      }
    });

    socket.on("vc:peer-left", (p: { userId: string }) => {
      const pc = peersRef.current.get(p.userId);
      if (pc) {
        pc.close();
        peersRef.current.delete(p.userId);
      }
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(p.userId);
        return next;
      });
    });

    socket.on("webrtc:signal", (p: { fromUserId: string; data: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      void handleSignalRef.current(p.fromUserId, p.data);
    });

    socket.on("peer:typing", (p: { fromUserId: string; active: boolean }) => {
      if (p.fromUserId !== selectedPeerIdRef.current) return;
      if (typingPeerStopRef.current) clearTimeout(typingPeerStopRef.current);
      setPeerTyping(p.active);
      if (p.active) {
        typingPeerStopRef.current = setTimeout(() => setPeerTyping(false), 3000);
      }
    });

    return () => {
      socket.emit("dm:leave");
      socket.emit("vc:leave");
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    if (selectedPeerId && selectedPeer?.relation === "friends") {
      socket.emit("dm:join", { peerId: selectedPeerId });
      return () => {
        socket.emit("dm:leave");
      };
    }
    socket.emit("dm:leave");
  }, [selectedPeerId, selectedPeer?.relation, connected]);

  useEffect(() => {
    return () => {
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      if (typingPeerStopRef.current) clearTimeout(typingPeerStopRef.current);
      stopLocalMedia();
      closeAllPeers();
    };
  }, [closeAllPeers, stopLocalMedia]);

  function emitTyping(active: boolean) {
    if (!selectedPeerId || selectedPeer?.relation !== "friends") return;
    socketRef.current?.emit("typing", { peerId: selectedPeerId, active });
  }

  function onInputChange(value: string) {
    setInput(value);
    if (!selectedPeerId || selectedPeer?.relation !== "friends") return;
    emitTyping(true);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => emitTyping(false), 2000);
  }

  async function addOrAcceptFriend(targetId: string) {
    setFriendActionId(targetId);
    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresseeId: targetId }),
      });
      if (res.ok) {
        await loadDirectory();
      }
    } finally {
      setFriendActionId(null);
    }
  }

  async function declineFriend(requesterId: string) {
    setFriendActionId(requesterId);
    try {
      const res = await fetch("/api/friends/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterId }),
      });
      if (res.ok) {
        await loadDirectory();
      }
    } finally {
      setFriendActionId(null);
    }
  }

  async function joinVc() {
    if (!selectedPeerId) return;
    setVcError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setInVc(true);
      socketRef.current?.emit("vc:join", { peerId: selectedPeerId });
    } catch {
      setVcError("Camera/microphone permission denied or unavailable.");
    }
  }

  function leaveVc() {
    socketRef.current?.emit("vc:leave");
    stopLocalMedia();
    closeAllPeers();
    setInVc(false);
    setVcError(null);
  }

  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t || !socketRef.current || !selectedPeerId) return;
    emitTyping(false);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    socketRef.current.emit("chat:send", { peerId: selectedPeerId, content: t });
    setInput("");
  }

  function selectUser(u: DirectoryUser) {
    if (u.relation !== "friends") return;
    setSelectedPeerId(u.id);
    setPeerTyping(false);
    if (inVc) leaveVc();
  }

  const canChat = selectedPeer?.relation === "friends";

  const incomingRequests = directory.filter((u) => u.relation === "incoming");
  const peopleList = directory.filter((u) => u.relation !== "incoming");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Friends chat</h1>
          <p className="text-xs text-zinc-500">
            Signed in as <span className="font-medium text-zinc-700 dark:text-zinc-300">{userName}</span>
            {" · "}
            <span className={connected ? "text-emerald-600" : "text-amber-600"}>
              {connected ? "Live" : "Connecting…"}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Sign out
        </button>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-0 lg:flex-row">
        <aside className="flex w-full flex-col border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="border-b border-amber-200 bg-amber-50/80 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
              Friend requests
              {incomingRequests.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums dark:bg-amber-500">
                  {incomingRequests.length}
                </span>
              ) : null}
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto border-b border-zinc-100 p-2 dark:border-zinc-800">
            {directoryLoading ? (
              <p className="px-2 py-2 text-sm text-zinc-500">Loading…</p>
            ) : incomingRequests.length === 0 ? (
              <p className="px-2 py-3 text-sm text-zinc-500">No pending requests.</p>
            ) : (
              <ul className="space-y-2">
                {incomingRequests.map((u) => (
                  <li
                    key={u.id}
                    className="rounded-lg border border-amber-200 bg-white p-2 shadow-sm dark:border-amber-900/40 dark:bg-zinc-900"
                  >
                    <p className="text-xs font-medium text-amber-900 dark:text-amber-200">Wants to connect</p>
                    <div className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{u.name}</div>
                    <div className="truncate text-xs text-zinc-500">{u.email}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={friendActionId === u.id}
                        onClick={() => void addOrAcceptFriend(u.id)}
                        className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={friendActionId === u.id}
                        onClick={() => void declineFriend(u.id)}
                        className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            People
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {directoryLoading ? (
              <p className="px-2 py-4 text-sm text-zinc-500">Loading…</p>
            ) : directory.length === 0 ? (
              <p className="px-2 py-4 text-sm text-zinc-500">No other users yet.</p>
            ) : peopleList.length === 0 ? (
              <p className="px-2 py-4 text-sm text-zinc-500">Everyone is listed under requests above.</p>
            ) : (
              <ul className="space-y-2">
                {peopleList.map((u) => (
                  <li
                    key={u.id}
                    className={`rounded-lg border px-2 py-2 text-sm ${
                      selectedPeerId === u.id
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                        : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        disabled={u.relation !== "friends"}
                        onClick={() => selectUser(u)}
                        className={`min-w-0 flex-1 text-left ${u.relation === "friends" ? "cursor-pointer hover:opacity-80" : "cursor-default opacity-80"}`}
                      >
                        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{u.name}</div>
                        <div className="truncate text-xs text-zinc-500">{u.email}</div>
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {u.relation === "none" && (
                        <button
                          type="button"
                          disabled={friendActionId === u.id}
                          onClick={() => void addOrAcceptFriend(u.id)}
                          className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          Add friend
                        </button>
                      )}
                      {u.relation === "outgoing" && (
                        <span className="rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                          Requested
                        </span>
                      )}
                      {u.relation === "friends" && (
                        <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                          Friends
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-[320px] flex-1 flex-col overflow-hidden border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:border-b-0">
          <div className="border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
            {selectedPeer ? (
              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {selectedPeer.name}
                {!canChat && (
                  <span className="ml-2 font-normal text-zinc-500">— add each other as friends to chat</span>
                )}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">Select a friend to chat</div>
            )}
            {peerTyping && canChat ? (
              <p className="mt-1 text-xs italic text-zinc-500">{selectedPeer?.name} is typing…</p>
            ) : null}
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto p-4">
            {!canChat ? (
              <p className="m-auto max-w-xs text-center text-sm text-zinc-500">
                Choose someone you are friends with to see messages. New users appear in the list automatically.
              </p>
            ) : (
              <ul className="space-y-3">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.userId === userId
                        ? "ml-auto bg-emerald-600 text-white"
                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    <div className="mb-0.5 text-xs opacity-80">{m.userName}</div>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={listEndRef} />
          </div>
          <form
            onSubmit={sendChat}
            className="flex gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800"
          >
            <input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={canChat ? "Type a message…" : "Select a friend first"}
              maxLength={2000}
              disabled={!canChat}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={!connected || !canChat}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:w-80 lg:border-l lg:border-t-0 xl:w-96">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Voice / video</h2>
          <p className="text-xs text-zinc-500">1:1 call with your selected friend (WebRTC + STUN).</p>
          {!canChat ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">Select a friend to enable calls.</p>
          ) : null}
          {vcError ? (
            <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
              {vcError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!inVc ? (
              <button
                type="button"
                onClick={() => void joinVc()}
                disabled={!connected || !canChat}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Join call
              </button>
            ) : (
              <button
                type="button"
                onClick={leaveVc}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
              >
                Leave call
              </button>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-500">You</p>
            <div className="overflow-hidden rounded-lg border border-zinc-700 bg-black">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full max-h-36 object-cover"
              />
            </div>
          </div>
          {remoteStreams.size > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500">Friend</p>
              <div className="grid gap-2">
                {Array.from(remoteStreams.entries()).map(([id, stream]) => (
                  <RemoteVideo key={id} stream={stream} label={selectedPeer?.name ?? id.slice(0, 8)} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

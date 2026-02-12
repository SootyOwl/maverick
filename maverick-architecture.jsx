import { useState } from "react";

const C = {
  bg: "#0a0e17",
  surface: "#111827",
  border: "#1e2d3d",
  text: "#e2e8f0",
  muted: "#64748b",
  dim: "#475569",
  accent: "#3b82f6",
  accentGlow: "rgba(59, 130, 246, 0.12)",
  xmtp: "#f97316",
  xmtpGlow: "rgba(249, 115, 22, 0.10)",
  atproto: "#06b6d4",
  atprotoGlow: "rgba(6, 182, 212, 0.10)",
  local: "#a78bfa",
  localGlow: "rgba(167, 139, 250, 0.10)",
  tui: "#10b981",
  tuiGlow: "rgba(16, 185, 129, 0.10)",
  meta: "#eab308",
  metaGlow: "rgba(234, 179, 8, 0.10)",
  green: "#22c55e",
  red: "#ef4444",
};

const mono = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
const sans = "'Inter', -apple-system, system-ui, sans-serif";

const Badge = ({ color, children }) => (
  <span style={{
    fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
    color, background: `${color}18`, padding: "2px 7px",
    borderRadius: 4, border: `1px solid ${color}30`, fontFamily: mono,
  }}>{children}</span>
);

const Card = ({ children, active, color, onClick, style }) => (
  <div onClick={onClick} style={{
    background: active ? `${color}08` : C.surface,
    border: `1px solid ${active ? color : C.border}`,
    borderRadius: 10, padding: "14px 18px", cursor: onClick ? "pointer" : "default",
    transition: "all 0.15s", ...style,
  }}>{children}</div>
);

const ThreadDemo = () => {
  const msgs = [
    { id: "a", user: "alice", text: "Has anyone tried the new API?", parents: [], color: C.atproto },
    { id: "b", user: "bob", text: "Yes! The auth flow is solid.", parents: ["a"], color: C.xmtp },
    { id: "c", user: "carol", text: "The docs are lacking though.", parents: ["a"], color: C.tui },
    { id: "d", user: "dan", text: "Agreed on both — auth works, docs need help.", parents: ["b", "c"], color: C.accent },
    { id: "e", user: "eve", text: "I can help write docs if someone explains auth.", parents: ["c", "d"], color: C.local },
  ];
  return (
    <div style={{ fontFamily: mono, fontSize: 13, lineHeight: 1.6 }}>
      {msgs.map(m => (
        <div key={m.id} style={{
          display: "flex", gap: 8, padding: "5px 10px", borderRadius: 6, marginBottom: 2,
          background: m.parents.length > 1 ? C.accentGlow : "transparent",
          borderLeft: `2px solid ${m.parents.length > 1 ? C.accent : "transparent"}`,
        }}>
          <span style={{ color: C.dim, width: 16, flexShrink: 0 }}>
            {m.parents.length === 0 ? "○" : m.parents.length === 1 ? "├" : "⊕"}
          </span>
          <span style={{ color: m.color, fontWeight: 600, width: 48, flexShrink: 0 }}>{m.user}</span>
          <span style={{ color: C.text }}>{m.text}</span>
          {m.parents.length > 0 && (
            <span style={{ color: C.dim, fontSize: 11, marginLeft: "auto", flexShrink: 0 }}>↩ {m.parents.join(", ")}</span>
          )}
        </div>
      ))}
      <div style={{ marginTop: 10, display: "flex", gap: 16, fontSize: 11, color: C.dim }}>
        <span>○ top-level</span><span>├ reply</span><span style={{ color: C.accent }}>⊕ multi-parent</span>
      </div>
    </div>
  );
};

const metaTypes = [
  { type: "community.config", desc: "Name, description, settings", who: "owner / admin", phase: "MVP" },
  { type: "channel.created", desc: "New channel + XMTP group ID", who: "owner / admin", phase: "MVP" },
  { type: "channel.updated", desc: "Rename, reconfigure channel", who: "owner / admin", phase: "MVP" },
  { type: "channel.archived", desc: "Archive / hide a channel", who: "owner / admin", phase: "Future" },
  { type: "community.role", desc: "Assign owner / admin / mod / member", who: "owner / admin", phase: "Future" },
  { type: "community.announcement", desc: "Pinned community-wide message", who: "admin+", phase: "Future" },
  { type: "moderation.action", desc: "Redact, ban, unban, mute", who: "moderator+", phase: "Future" },
];

const phases = [
  { num: 1, title: "Identity + XMTP Plumbing", time: "Week 1", color: C.atproto,
    items: ["Bluesky auth (app password)", "XMTP keypair + client creation", "org.xmtp.inbox identity bridge", "Handle ↔ Inbox ID resolution", "Encrypted key storage"],
    deliverable: "CLI: login, bridge identity, resolve handles" },
  { num: 2, title: "Meta Channel + Community", time: "Week 2", color: C.meta,
    items: ["Meta channel content type codec", "Create community (meta group + config)", "Create channels (XMTP group + meta event)", "Invite flow (token gen, add to groups)", "State reconstruction from meta replay"],
    deliverable: "CLI: create community, add channels, invite members" },
  { num: 3, title: "Channel Messaging", time: "Week 3", color: C.xmtp,
    items: ["Maverick message content type codec", "Send/receive in XMTP group channels", "Real-time message streaming", "Message persistence in SQLite", "Basic single-parent replies"],
    deliverable: "Two-terminal chat with replies" },
  { num: 4, title: "TUI Client", time: "Weeks 4–5", color: C.tui,
    items: ["Ink (React for terminals) setup", "Three-panel layout", "Channel sidebar + unread counts", "Message rendering + reply indicators", "Vim-style keyboard nav"],
    deliverable: "Beautiful, functional TUI client" },
];

const EditDeleteSection = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: 0 }}>
      XMTP doesn't yet support message editing (on roadmap) or deletion (XIP-76, draft).
      Maverick bridges these gaps at the <span style={{ color: C.accent }}>application layer</span> — compliant
      clients respect the intent while the encrypted bytes persist on-network.
      Same model as Signal and WhatsApp. Upgrades to native protocol support when XMTP ships it.
    </p>
    {[
      { label: "Edit", mechanism: "New message with editOf → clients replace displayed text", color: C.accent },
      { label: "Self-delete", mechanism: "Message with deleteOf → clients hide original", color: C.muted },
      { label: "Mod delete", mechanism: "ModerationAction on meta channel → hide across all clients", color: C.meta },
      { label: "Ban", mechanism: "ModerationAction ban → remove from groups, clients enforce ban list", color: C.red },
    ].map(r => (
      <div key={r.label} style={{
        display: "flex", gap: 10, alignItems: "center", padding: "8px 12px",
        background: C.bg, borderRadius: 6, fontSize: 12,
      }}>
        <span style={{ color: r.color, fontWeight: 600, width: 80, flexShrink: 0, fontFamily: mono }}>{r.label}</span>
        <span style={{ color: C.muted }}>{r.mechanism}</span>
      </div>
    ))}
  </div>
);

export default function MaverickPlan() {
  const [tab, setTab] = useState("arch");
  const [expandedLayer, setExpandedLayer] = useState(null);
  const [expandedPhase, setExpandedPhase] = useState(null);

  const tabs = [
    { id: "arch", label: "Architecture" },
    { id: "meta", label: "Meta Channel" },
    { id: "threading", label: "Threading" },
    { id: "editdel", label: "Edit / Delete" },
    { id: "phases", label: "Phases" },
    { id: "stack", label: "Stack" },
  ];

  const archLayers = [
    { id: "public", label: "Public Layer", sublabel: "ATProto (identity only)", color: C.atproto, glow: C.atprotoGlow,
      details: ["org.xmtp.inbox record on each user's PDS", "Links Bluesky handle / DID → XMTP Inbox ID", "Verified with cryptographic signature (both directions)", "This is the ONLY public data in the entire system"] },
    { id: "meta", label: "Meta Channel", sublabel: "XMTP group (encrypted control plane)", color: C.meta, glow: C.metaGlow,
      details: ["Community config, channel definitions, role assignments", "Append-only event log → free audit trail", "super_admin = owners, admin = community admins, member = everyone", "State = fold over all meta messages in order", "Extensible: new message types add features without breaking clients"] },
    { id: "channels", label: "Chat Channels", sublabel: "XMTP groups (one per channel)", color: C.xmtp, glow: C.xmtpGlow,
      details: ["E2E encrypted messaging via MLS protocol", "Up to 250 members per channel", "Real-time streaming + message history on reconnect", "Custom content type carries multi-parent threading metadata", "Per-channel permissions (open / moderated / read-only)"] },
    { id: "local", label: "Local State", sublabel: "SQLite (better-sqlite3)", color: C.local, glow: C.localGlow,
      details: ["Community state cache (replayed from meta channel)", "Message DAG (messages + message_parents tables)", "Channel ↔ XMTP group ID mapping", "Profile cache + encrypted key storage"] },
  ];

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: sans, padding: "24px 28px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h1 style={{
            fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.02em",
            background: `linear-gradient(135deg, ${C.text}, ${C.accent})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>maverick</h1>
          <Badge color={C.green}>PRIVATE-FIRST</Badge>
          <Badge color={C.muted}>MVP PLAN v2</Badge>
        </div>
        <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>
          ATProto identity · XMTP encrypted everything · Meta channel control plane · Multi-parent threading
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 2, marginBottom: 24, background: C.surface,
        borderRadius: 8, padding: 3, width: "fit-content", border: `1px solid ${C.border}`,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setExpandedLayer(null); setExpandedPhase(null); }} style={{
            padding: "7px 13px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 500, transition: "all 0.15s",
            background: tab === t.id ? C.accentGlow : "transparent",
            color: tab === t.id ? C.accent : C.muted,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Architecture */}
      {tab === "arch" && (
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            {archLayers.map((layer) => (
              <Card key={layer.id} active={expandedLayer === layer.id} color={layer.color}
                onClick={() => setExpandedLayer(expandedLayer === layer.id ? null : layer.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ color: layer.color, fontWeight: 600, fontSize: 15 }}>{layer.label}</span>
                    <span style={{ color: C.dim, fontSize: 12, marginLeft: 10, fontFamily: mono }}>{layer.sublabel}</span>
                  </div>
                  <span style={{ color: C.dim, fontSize: 16 }}>{expandedLayer === layer.id ? "−" : "+"}</span>
                </div>
                {expandedLayer === layer.id && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                    {layer.details.map((d, j) => (
                      <div key={j} style={{
                        fontSize: 13, color: C.muted, padding: "3px 0 3px 12px",
                        borderLeft: `2px solid ${layer.color}30`, marginBottom: 4,
                      }}>{d}</div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
            <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 12, fontSize: 11, color: C.dim }}>
              <span>▲ public (only identity)</span>
              <span>■ encrypted (community + messages)</span>
              <span>▼ local persistence</span>
            </div>
          </div>

          <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 12 }}>
            <Card color={C.accent} style={{ borderColor: C.border }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.accent, marginBottom: 8, letterSpacing: "0.05em" }}>
                PRIVATE-FIRST PRINCIPLE
              </div>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                The only public data is <span style={{ color: C.atproto }}>org.xmtp.inbox</span> on
                each user's PDS. Community structure, membership, channels, and all messages
                are <span style={{ color: C.xmtp }}>fully encrypted</span> inside XMTP groups.
                Outsiders see nothing.
              </p>
            </Card>
            <Card color={C.meta} style={{ borderColor: C.border }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.meta, marginBottom: 8, letterSpacing: "0.05em" }}>
                FREE AUDIT TRAIL
              </div>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                Every config change, role assignment, and channel creation is a timestamped,
                cryptographically signed message on the meta channel.
                The event log <em>is</em> the audit log — no extra work needed.
              </p>
            </Card>
            <Card color={C.xmtp} style={{ borderColor: C.border }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.xmtp, marginBottom: 8, letterSpacing: "0.05em" }}>
                EXTENSIBLE
              </div>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                New meta message types add features (moderation, announcements, reactions)
                without breaking existing clients. Unknown types are safely ignored.
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* Meta Channel */}
      {tab === "meta" && (
        <div style={{ maxWidth: 720 }}>
          <Card color={C.meta} style={{ marginBottom: 16, borderColor: C.border }}>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: 0 }}>
              The meta channel is an XMTP group where all members are participants, but it's not for chatting.
              It's the community's <span style={{ color: C.meta }}>encrypted control plane</span>.
              Admins send structured config messages; clients replay the history to reconstruct current state.
              Current state = <code style={{ color: C.accent, background: C.accentGlow, padding: "1px 4px", borderRadius: 3, fontFamily: mono, fontSize: 12 }}>fold()</code> over all events.
            </p>
          </Card>

          <div style={{ fontSize: 12, fontWeight: 600, color: C.dim, marginBottom: 10, letterSpacing: "0.04em" }}>
            META MESSAGE TYPES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {metaTypes.map(m => (
              <div key={m.type} style={{
                display: "flex", gap: 10, alignItems: "center", padding: "9px 14px",
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              }}>
                <code style={{ fontSize: 12, color: C.meta, fontFamily: mono, width: 190, flexShrink: 0 }}>{m.type}</code>
                <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{m.desc}</span>
                <Badge color={C.dim}>{m.who}</Badge>
                <Badge color={m.phase === "MVP" ? C.green : C.dim}>{m.phase}</Badge>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, fontSize: 12, fontWeight: 600, color: C.dim, marginBottom: 10, letterSpacing: "0.04em" }}>
            ROLE → XMTP PERMISSION MAPPING
          </div>
          <Card color={C.meta} style={{ borderColor: C.border }}>
            <div style={{ fontFamily: mono, fontSize: 12, lineHeight: 1.8 }}>
              {[
                { role: "Owner", meta: "super_admin", chat: "super_admin", color: C.red },
                { role: "Admin", meta: "admin", chat: "admin", color: C.xmtp },
                { role: "Moderator", meta: "member", chat: "admin", color: C.meta },
                { role: "Member", meta: "member", chat: "member", color: C.muted },
              ].map(r => (
                <div key={r.role} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: r.color, width: 90, fontWeight: 600 }}>{r.role}</span>
                  <span style={{ color: C.dim, width: 20 }}>→</span>
                  <span style={{ color: C.muted, width: 140 }}>meta: {r.meta}</span>
                  <span style={{ color: C.muted }}>channels: {r.chat}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: C.dim, marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
              XMTP enforces these cryptographically via MLS — even a malicious client can't
              send config to the meta channel if the sender isn't admin/super_admin on that group.
            </p>
          </Card>
        </div>
      )}

      {/* Threading */}
      {tab === "threading" && (
        <div style={{ maxWidth: 700 }}>
          <Card color={C.accent} style={{ marginBottom: 16, borderColor: C.border }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Multi-Parent Threading</div>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: 0 }}>
              Traditional chat forces linear threading — reply to one message. Maverick lets you reply to
              <span style={{ color: C.accent }}> multiple messages simultaneously</span>, creating conversation
              webs. Like old forum culture, but in real-time encrypted chat. Designed into the architecture now,
              full UI built post-MVP.
            </p>
          </Card>

          <Card color={C.border} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.dim, marginBottom: 8, letterSpacing: "0.04em" }}>
              EXAMPLE CONVERSATION
            </div>
            <ThreadDemo />
          </Card>

          <Card color={C.border} style={{}}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.dim, marginBottom: 10, letterSpacing: "0.04em" }}>
              MESSAGE FORMAT (XMTP CONTENT TYPE)
            </div>
            <pre style={{ fontSize: 12, fontFamily: mono, lineHeight: 1.6, margin: 0, color: C.muted, whiteSpace: "pre-wrap" }}>
{`{
  text: "Agreed on both — auth works, docs need help.",
  `}<span style={{ color: C.accent }}>{`replyTo: ["msg_bob_1", "msg_carol_1"]`}</span>{`,  // ← multi-parent!
  quotes: [
    { parentMessageId: "msg_bob_1", quotedText: "auth flow is solid" },
    { parentMessageId: "msg_carol_1", quotedText: "docs are lacking" }
  ]
}`}
            </pre>
          </Card>
        </div>
      )}

      {/* Edit / Delete */}
      {tab === "editdel" && (
        <div style={{ maxWidth: 700 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Bridging Protocol Gaps</div>
          <Card color={C.border} style={{}}>
            <EditDeleteSection />
          </Card>
          <div style={{
            marginTop: 14, padding: "12px 14px", background: C.accentGlow,
            border: `1px solid ${C.accent}30`, borderRadius: 8, fontSize: 12,
            color: C.muted, lineHeight: 1.6,
          }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>Upgrade path:</span> When XMTP ships native editing (roadmap)
            and deletion (XIP-76), Maverick adopts protocol-level support alongside app-level. Clients that
            haven't upgraded yet still work via the app-level mechanism.
          </div>
        </div>
      )}

      {/* Phases */}
      {tab === "phases" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {phases.map(p => (
            <Card key={p.num} active={expandedPhase === p.num} color={p.color}
              onClick={() => setExpandedPhase(expandedPhase === p.num ? null : p.num)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <span style={{
                    display: "inline-block", width: 22, height: 22, borderRadius: "50%",
                    background: `${p.color}20`, color: p.color, fontSize: 12, fontWeight: 700,
                    textAlign: "center", lineHeight: "22px", marginRight: 8,
                  }}>{p.num}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</span>
                </div>
                <Badge color={C.dim}>{p.time}</Badge>
              </div>
              {expandedPhase === p.num ? (
                <>
                  <div style={{ marginBottom: 10 }}>
                    {p.items.map((item, j) => (
                      <div key={j} style={{
                        fontSize: 13, color: C.muted, padding: "3px 0 3px 10px",
                        borderLeft: `2px solid ${p.color}30`, marginBottom: 3,
                      }}>{item}</div>
                    ))}
                  </div>
                  <div style={{
                    fontSize: 12, color: p.color, padding: "8px 10px",
                    background: C.bg, borderRadius: 6, fontFamily: mono,
                  }}>→ {p.deliverable}</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: C.dim }}>{p.deliverable}</div>
              )}
            </Card>
          ))}

          <div style={{ gridColumn: "1 / -1" }}>
            <Card color={C.border} style={{}}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.dim, marginBottom: 8, letterSpacing: "0.04em" }}>POST-MVP</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {["Multi-parent threading UI", "Moderation (ban/mute/redact)", "Message editing",
                  "Channel categories", "Announcements", "Reactions (XMTP native)",
                  "Disappearing messages", "Read-only channels", "Per-member display names",
                  "Invite links + QR codes"].map(f => (
                  <Badge key={f} color={C.dim}>{f}</Badge>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Stack */}
      {tab === "stack" && (
        <div style={{ maxWidth: 620 }}>
          <Card color={C.border} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Why TypeScript</div>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: 0 }}>
              XMTP's official SDKs are TypeScript only. The Rust core (<code style={{ color: C.xmtp, fontFamily: mono, fontSize: 12 }}>libxmtp</code>)
              is internal — undocumented, unstable, for SDK teams not app devs. Go has no XMTP SDK.
              TypeScript is the only language with first-class support for both XMTP and ATProto.
              The <code style={{ color: C.muted, fontFamily: mono, fontSize: 12 }}>bluesky-chat</code> reference app
              provides direct code to port.
            </p>
          </Card>

          {[
            { label: "Messaging", pkg: "@xmtp/node-sdk", desc: "Official XMTP SDK — E2E encrypted groups", color: C.xmtp },
            { label: "Identity", pkg: "@atproto/api", desc: "Canonical ATProto SDK from Bluesky", color: C.atproto },
            { label: "TUI", pkg: "ink", desc: "React renderer for terminals (flexbox, components)", color: C.tui },
            { label: "Database", pkg: "better-sqlite3", desc: "Sync SQLite — message DAG, community cache", color: C.local },
            { label: "Crypto", pkg: "viem", desc: "Ethereum key gen for XMTP (same as bluesky-chat)", color: C.accent },
            { label: "Validation", pkg: "zod", desc: "Runtime schema validation — messages + meta events", color: C.meta },
            { label: "Keys", pkg: "keytar", desc: "OS keychain for XMTP private key storage", color: C.green },
          ].map(d => (
            <div key={d.pkg} style={{
              display: "flex", gap: 12, alignItems: "center", padding: "10px 14px",
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 5,
            }}>
              <span style={{ width: 72, fontSize: 11, fontWeight: 600, color: d.color, letterSpacing: "0.03em", flexShrink: 0 }}>{d.label}</span>
              <code style={{ fontSize: 12, color: C.text, background: C.bg, padding: "2px 6px", borderRadius: 4, fontFamily: mono, flexShrink: 0 }}>{d.pkg}</code>
              <span style={{ fontSize: 12, color: C.dim }}>{d.desc}</span>
            </div>
          ))}

          <div style={{
            marginTop: 14, padding: "12px 14px", background: C.accentGlow,
            border: `1px solid ${C.accent}30`, borderRadius: 8, fontSize: 12,
            color: C.muted, lineHeight: 1.6,
          }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>Rust later?</span> Lexicons, message format, DAG design,
            and meta channel protocol all carry over. Watch XMTP's XIP-66 for a Rust-facing API.
          </div>
        </div>
      )}
    </div>
  );
}

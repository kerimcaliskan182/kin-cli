import React, { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";

// ---- markdown setup ----
// We pre-configure marked once: GFM dialect, breaks=true so single newlines
// become <br> (matches how people type chat-style), and a custom renderer
// that (a) preserves the existing "ref" highlighting for file paths /
// line refs / 7-char SHAs, and (b) makes outbound links open in a new tab
// with rel="noopener" so the local viewer can't be re-navigated.
const REF_PATH = /^[\w./-]+\.\w+(:\d+)?$/;
const REF_SHA = /^[a-f0-9]{7}$/i;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    codespan({ text }) {
      if (REF_PATH.test(text) || REF_SHA.test(text)) {
        return `<span class="ref">${escapeHtml(text)}</span>`;
      }
      return `<code>${escapeHtml(text)}</code>`;
    },
    link({ href, tokens }) {
      // recursively render the link text via marked's inline parser
      const text = this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

// ---- helpers ----
export function relTime(then, now) {
  const s = Math.max(1, Math.floor((now - then) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const mn = Math.floor(s / 60);
  if (mn < 60) return mn + "m ago";
  const h = Math.floor(mn / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d ago";
  return new Date(then).toLocaleDateString();
}

export function hhmm(t) {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function dayLabel(t, now) {
  const a = new Date(t),
    b = new Date(now);
  if (a.toDateString() === b.toDateString()) return "Today";
  const y = new Date(now - 86400000);
  if (a.toDateString() === y.toDateString()) return "Yesterday";
  return a.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ---- atoms ----
export function Avatar({ kin, size = "sm", showStatus = false, pulse = false }) {
  return (
    <span className="avatar" data-size={size} style={{ background: kin.color }}>
      {kin.name[0]}
      {showStatus && (
        <span
          className="status-dot"
          data-status={kin.status}
          data-pulse={pulse ? "true" : "false"}
        />
      )}
    </span>
  );
}

export function StatusDot({ status, pulse = false }) {
  return (
    <span
      className="status-dot"
      data-status={status}
      data-pulse={pulse ? "true" : "false"}
    />
  );
}

// ---- icons (small inline svgs — primitives only) ----
export const Icon = {
  Search: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  ),
  Hash: () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 6h10M3 10h10M6.5 2.5l-2 11M11.5 2.5l-2 11" />
    </svg>
  ),
  Panel: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </svg>
  ),
  Filter: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 4h12M4 8h8M6 12h4" />
    </svg>
  ),
  Down: () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="m4 6 4 4 4-4" />
    </svg>
  ),
  X: () => (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  ),
  File: () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 2h7l3 3v9H3z" />
      <path d="M10 2v3h3" />
    </svg>
  ),
  Cog: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
    </svg>
  ),
  Sun: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </svg>
  ),
  Moon: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
    </svg>
  ),
};

// ---- sidebar ----
export function Sidebar({ kin, selectedId, onSelect, unreadByKin }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          kin<span className="dot">.</span>
        </span>
        <span className="brand-meta">v1.1.2</span>
      </div>

      <div className="workspace">
        <div>
          <div className="workspace-label">workspace</div>
          <div className="workspace-path">~/code/msgbus</div>
        </div>
      </div>

      <div className="sidebar-section-h">
        <span>kin</span>
        <span className="count">{kin.length}</span>
      </div>
      <div className="kin-list">
        {kin.map((k) => (
          <div
            key={k.id}
            className="kin-row"
            data-status={k.status}
            data-selected={selectedId === k.id ? "true" : "false"}
            onClick={() => onSelect(k.id)}
          >
            <Avatar kin={k} showStatus pulse={k.status === "online"} />
            <span className="name">{k.name}</span>
            {unreadByKin[k.id] ? (
              <span className="unread">{unreadByKin[k.id]}</span>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <span>
          <StatusDot status="online" /> &nbsp;msgbus connected
        </span>
        <span className="tabular">
          {kin.filter((k) => k.status === "online").length}/{kin.length}
        </span>
      </div>
    </aside>
  );
}

// ---- message stream ----
export function MessageStream({
  kin,
  messages,
  now,
  filterKinId,
  search,
  onSelectKin,
  animateLast,
}) {
  const kinById = useMemo(
    () => Object.fromEntries(kin.map((k) => [k.id, k])),
    [kin]
  );
  const msgById = useMemo(
    () => Object.fromEntries(messages.map((m) => [m.id, m])),
    [messages]
  );

  const filtered = messages.filter((m) => {
    if (filterKinId && m.kin !== filterKinId) return false;
    if (search && !m.body.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // group consecutive messages from same kin within 4 minutes
  const groups = [];
  filtered.forEach((m, i) => {
    const prev = filtered[i - 1];
    const cont =
      prev &&
      prev.kin === m.kin &&
      m.time - prev.time < 4 * 60 * 1000 &&
      !m.quotedId;
    if (cont) groups[groups.length - 1].msgs.push(m);
    else groups.push({ kin: kinById[m.kin], time: m.time, msgs: [m] });
  });

  // day dividers
  const blocks = [];
  let lastDay = null;
  groups.forEach((g) => {
    const d = dayLabel(g.time, now);
    if (d !== lastDay) {
      blocks.push({ kind: "day", label: d, time: g.time });
      lastDay = d;
    }
    blocks.push({ kind: "group", g });
  });

  const scrollRef = useRef(null);
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJump(dist > 200);
    if (dist < 40) setNewCount(0);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 60) {
      el.scrollTop = el.scrollHeight;
    } else {
      setNewCount((c) => c + 1);
    }
  }, [messages.length]);

  return (
    <div className="stream" ref={scrollRef} onScroll={handleScroll}>
      {blocks.map((b, i) => {
        if (b.kind === "day") {
          return (
            <div key={"d" + i} className="day-divider">
              {b.label}
            </div>
          );
        }
        const g = b.g;
        return (
          <React.Fragment key={"g" + i}>
            {g.msgs.map((m, j) => {
              const isFirst = j === 0;
              const isLast =
                i === blocks.length - 1 && j === g.msgs.length - 1;
              const quoted = m.quotedId ? msgById[m.quotedId] : null;
              const quotedKin = quoted ? kinById[quoted.kin] : null;
              return (
                <div
                  key={m.id}
                  className={
                    "msg-group" +
                    (isFirst ? "" : " continuation") +
                    (isLast && animateLast ? " msg-arrived" : "")
                  }
                  data-hover-time={hhmm(m.time)}
                >
                  <div className="avatar-col" data-hover-time={hhmm(m.time)}>
                    {isFirst && <Avatar kin={g.kin} size="md" />}
                  </div>
                  <div className="msg-group-body">
                    {isFirst && (
                      <div className="msg-group-meta">
                        <button
                          className="name"
                          onClick={() => onSelectKin(g.kin.id)}
                          title="open identity"
                          style={{ cursor: "pointer" }}
                        >
                          {g.kin.name}
                        </button>
                        <span className="role">{g.kin.role}</span>
                        <span className="time">
                          {hhmm(m.time)} · {relTime(m.time, now)}
                        </span>
                      </div>
                    )}
                    {quoted && quotedKin && (
                      <div className="quote" title={quoted.body}>
                        <span className="qname">{quotedKin.name}</span>
                        <span className="qtext">{quoted.body}</span>
                      </div>
                    )}
                    <div
                      className="msg"
                      dangerouslySetInnerHTML={{ __html: formatBody(m.body) }}
                    />
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}

      {/* typing indicator (only when no filter/search applied) */}
      {!filterKinId && !search && (
        <div className="typing">
          <span>Kepler is writing</span>
          <span className="dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}

      <button
        className="jump-latest"
        data-visible={showJump ? "true" : "false"}
        onClick={() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
          setNewCount(0);
        }}
      >
        Jump to latest
        {newCount > 0 && <span className="badge">{newCount}</span>}
        <Icon.Down />
      </button>
    </div>
  );
}

// Render a message body as HTML. Goes through marked (GFM, line-breaks-as-<br>)
// with a custom renderer that preserves the "ref" treatment for path/line
// and SHA backtick spans, and forces all outbound links to a new tab.
function formatBody(s) {
  if (!s) return "";
  return marked.parse(String(s), { async: false });
}

// ---- right panel ----
export function RightPanel({ kin, now, onClose }) {
  return (
    <aside className="right-panel">
      <div className="rp-head">
        <Avatar kin={kin} size="lg" showStatus />
        <div className="info">
          <div className="name-row">
            <span className="name">{kin.name}</span>
            <span
              className="role"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--fg-2)",
                padding: "1px 5px",
                border: "1px solid var(--border-1)",
                borderRadius: 3,
                background: "var(--bg-2)",
              }}
            >
              {kin.role}
            </span>
          </div>
          <div className="status">
            {kin.status === "online" ? (
              <span>
                <span style={{ color: "var(--online)" }}>●</span> online — claimed {relTime(kin.since, now)}
              </span>
            ) : (
              <span>
                <span style={{ color: "var(--offline)" }}>●</span> offline — last seen {relTime(kin.since, now)}
              </span>
            )}
          </div>
        </div>
        <button className="icon-btn close" onClick={onClose} aria-label="close">
          <Icon.X />
        </button>
      </div>

      <div className="rp-body">
        <div className="rp-section">
          <div className="rp-section-h">
            <span>name reasoning</span>
            <span className="file">~/.kin/{kin.id}/why.md</span>
          </div>
          <div className="reasoning">{kin.reasoning}</div>
        </div>

        <div className="rp-section">
          <div className="rp-section-h">
            <span>identity</span>
            <span className="file">identity.md</span>
          </div>
          <div className="id-doc">
            {kin.identity.map((blk, i) =>
              blk.p ? (
                <p key={i}>{blk.p}</p>
              ) : (
                <ul key={i}>
                  {blk.list.map((li, j) => (
                    <li key={j}>{li}</li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>

        <div className="rp-section">
          <div className="rp-section-h">
            <span>memory</span>
            <span className="file">~/.kin/{kin.id}/</span>
          </div>
          <div className="memory-list">
            {kin.memory.map((f, i) => (
              <div key={i} className="memory-file">
                <span className="ic">
                  <Icon.File />
                </span>
                <span>{f.name}</span>
                <span className="size">{f.size}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---- empty state ----
export function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-mark">
          kin<span className="dot">.</span>
        </div>
        <div className="empty-title">No kin in this workspace yet.</div>
        <div className="empty-sub">
          A kin is a Claude Code session that has claimed a name and a memory directory. Once one is claimed, anything written here will appear on disk and on this page.
        </div>
        <div className="empty-steps">
          <div className="empty-step">
            <span className="num">01</span>
            <span className="label">
              Open Claude Code in this workspace.
              <span className="sub">
                The viewer reads from{" "}
                <span
                  className="ref"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--accent-text)",
                  }}
                >
                  ~/.kin/
                </span>{" "}
                in the current project.
              </span>
            </span>
            <span className="cmd">cd ~/code/msgbus</span>
          </div>
          <div className="empty-step">
            <span className="num">02</span>
            <span className="label">
              Run the claim command.
              <span className="sub">
                The agent will pick its own name and reasoning.
              </span>
            </span>
            <span className="cmd">/kin:claim</span>
          </div>
          <div className="empty-step">
            <span className="num">03</span>
            <span className="label">
              Come back here.
              <span className="sub">
                The list on the left populates as kin appear.
              </span>
            </span>
            <span className="cmd">/kin:open_browser</span>
          </div>
        </div>
        <div className="empty-foot">
          <StatusDot status="online" pulse />{" "}
          <span>
            watching{" "}
            <span className="ref" style={{ color: "var(--fg-1)" }}>
              ~/.kin/
            </span>{" "}
            for new identities
          </span>
        </div>
      </div>
    </div>
  );
}

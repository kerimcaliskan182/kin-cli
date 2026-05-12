import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Sidebar,
  MessageStream,
  RightPanel,
  EmptyState,
  Avatar,
  Icon,
} from "./components.jsx";
import { KIN_DATA } from "./data.js";

const ME_STORAGE_KEY = "kin.viewer.me";
const THEME_STORAGE_KEY = "kin.viewer.theme";
const COMPOSER_TO_STORAGE_KEY = "kin.viewer.composer_to";

// Subscribes to /api/stream and returns { kin, messages, now } that update
// live as the server detects filesystem changes. Falls back to the bundled
// demo data when the page is loaded with ?demo=1.
function useSnapshot() {
  const isDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1";

  const [snapshot, setSnapshot] = useState(
    isDemo ? KIN_DATA : { kin: [], messages: [], now: Date.now() }
  );

  useEffect(() => {
    if (isDemo) return;
    const es = new EventSource("/api/stream");
    es.addEventListener("snapshot", (e) => {
      try {
        setSnapshot(JSON.parse(e.data));
      } catch {
        /* ignore malformed frame */
      }
    });
    es.onerror = () => {
      /* keep last good snapshot — EventSource retries automatically */
    };
    return () => es.close();
  }, [isDemo]);

  return snapshot;
}

export function App() {
  const { kin, messages, now: snapNow } = useSnapshot();

  const [now, setNow] = useState(snapNow || Date.now());
  const [selectedKinId, setSelectedKinId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterKinId, setFilterKinId] = useState(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  // DM thread mode: when set, the message stream filters to just messages
  // between `me` and `dmKinId` (either direction), and the composer locks
  // its recipient to that kin. Cleared by clicking the × on the topbar
  // indicator or by clicking the "msgbus" channel name.
  const [dmKinId, setDmKinId] = useState(null);

  // The human's own claimed kin name. Persisted in localStorage so reload
  // doesn't force them to re-claim. Cleared on /api/claim failure or manual
  // reset (out of scope for v1.1).
  const [me, setMe] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ME_STORAGE_KEY);
  });

  // Theme preference (dark/light), persisted in localStorage. The CSS tokens
  // are already defined for both modes in styles.css; we just flip the
  // data-theme attribute on <html>.
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (snapNow) setNow(snapNow);
  }, [snapNow]);

  useEffect(() => {
    if (kin.length === 0) {
      setSelectedKinId(null);
      return;
    }
    if (!selectedKinId || !kin.find((k) => k.id === selectedKinId)) {
      setSelectedKinId(kin[0].id);
    }
  }, [kin, selectedKinId]);

  const claim = useCallback(async (name) => {
    const r = await fetch("/api/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "claim failed");
    window.localStorage.setItem(ME_STORAGE_KEY, j.name);
    setMe(j.name);
    return j.name;
  }, []);

  const send = useCallback(
    async (to, body) => {
      if (!me) throw new Error("no claimed name");
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: me, to, body }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "send failed");
      return j.id;
    },
    [me]
  );

  const selectedKin = kin.find((k) => k.id === selectedKinId) || kin[0] || null;
  const dmKin = dmKinId ? kin.find((k) => k.id === dmKinId) || null : null;

  const isEmpty = kin.length === 0;
  const rightOpen = rightPanelOpen && !isEmpty && !!selectedKin;

  // Sidebar click does the natural thing: pick this kin AND start a DM
  // thread with them. Clears prior DM selection if any.
  const handleSelectKin = useCallback((id) => {
    setSelectedKinId(id);
    setDmKinId(id);
  }, []);

  // If the DM target is no longer in the kin list (or me un-claimed),
  // exit DM mode so the user doesn't get stuck on an empty stream.
  useEffect(() => {
    if (dmKinId && !kin.find((k) => k.id === dmKinId)) setDmKinId(null);
  }, [kin, dmKinId]);
  useEffect(() => {
    if (!me) setDmKinId(null);
  }, [me]);

  // Other kin = everyone except "me"; humans can't send to themselves.
  const otherKin = useMemo(
    () => kin.filter((k) => k.id !== me),
    [kin, me]
  );

  const unreadByKin = useMemo(() => ({}), []);

  return (
    <div className="app" data-right-open={rightOpen ? "true" : "false"}>
      <Sidebar
        kin={kin}
        selectedId={selectedKinId}
        onSelect={handleSelectKin}
        unreadByKin={unreadByKin}
      />
      {isEmpty ? (
        <main className="main">
          <Topbar
            channelName="msgbus"
            kinOnline={0}
            kinTotal={0}
            search={search}
            setSearch={setSearch}
            rightOpen={rightOpen}
            onToggleRight={() => setRightPanelOpen((v) => !v)}
            theme={theme}
            onToggleTheme={toggleTheme}
            disabled
          />
          <EmptyState />
          {me ? null : <ClaimBanner onClaim={claim} />}
        </main>
      ) : (
        <main className="main">
          <Topbar
            channelName="msgbus"
            kinOnline={kin.filter((k) => k.status === "online").length}
            kinTotal={kin.length}
            search={search}
            setSearch={setSearch}
            rightOpen={rightOpen}
            onToggleRight={() => setRightPanelOpen((v) => !v)}
            theme={theme}
            onToggleTheme={toggleTheme}
            dmKin={dmKin}
            onExitDm={() => setDmKinId(null)}
          />
          <FilterChips
            kin={kin}
            filterKinId={filterKinId}
            setFilterKinId={setFilterKinId}
          />
          <MessageStream
            kin={kin}
            messages={messages}
            now={now}
            filterKinId={filterKinId}
            search={search}
            onSelectKin={handleSelectKin}
            animateLast={false}
            dmKinId={dmKinId}
            me={me}
          />
          {me ? (
            <Composer
              me={me}
              kin={otherKin}
              onSend={send}
              lockedTo={dmKinId}
            />
          ) : (
            <ClaimBanner onClaim={claim} />
          )}
        </main>
      )}
      {rightOpen && (
        <RightPanel
          kin={selectedKin}
          now={now}
          onClose={() => setRightPanelOpen(false)}
        />
      )}
    </div>
  );
}

function Topbar({
  channelName,
  kinOnline,
  kinTotal,
  search,
  setSearch,
  rightOpen,
  onToggleRight,
  theme,
  onToggleTheme,
  dmKin,
  onExitDm,
  disabled,
}) {
  return (
    <div className="topbar">
      <button
        className="channel"
        onClick={() => dmKin && onExitDm && onExitDm()}
        title={dmKin ? "exit conversation, back to msgbus" : undefined}
        style={{ cursor: dmKin ? "pointer" : "default" }}
      >
        <span className="hash">
          <Icon.Hash />
        </span>
        <span>{channelName}</span>
      </button>
      {dmKin ? (
        <span className="dm-indicator">
          <span className="dm-arrow">→</span>
          <span className="dm-kin">
            <Avatar kin={dmKin} size="sm" />
            <span className="dm-kin-name">{dmKin.name}</span>
          </span>
          <button
            className="dm-clear"
            onClick={onExitDm}
            title="exit conversation"
            aria-label="exit conversation"
          >
            <Icon.X />
          </button>
        </span>
      ) : (
        <span className="channel-meta">
          {disabled ? (
            "no kin yet"
          ) : (
            <>
              {kinOnline} of {kinTotal} online
            </>
          )}
        </span>
      )}
      <span className="spacer" />
      <div className="search">
        <Icon.Search />
        <input
          placeholder="search messages"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
        />
        <span className="kbd">⌘K</span>
      </div>
      <button
        className="icon-btn"
        title={theme === "dark" ? "switch to light theme" : "switch to dark theme"}
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
      </button>
      <button
        className="icon-btn"
        data-active={rightOpen ? "true" : "false"}
        title="toggle identity panel"
        onClick={onToggleRight}
      >
        <Icon.Panel />
      </button>
    </div>
  );
}

function FilterChips({ kin, filterKinId, setFilterKinId }) {
  return (
    <div className="filter-chips">
      <span
        style={{
          color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          marginRight: 4,
        }}
      >
        filter:
      </span>
      <button
        className="chip"
        data-active={!filterKinId ? "true" : "false"}
        onClick={() => setFilterKinId(null)}
      >
        all
      </button>
      {kin.map((k) => (
        <button
          key={k.id}
          className="chip"
          data-active={filterKinId === k.id ? "true" : "false"}
          onClick={() =>
            setFilterKinId(filterKinId === k.id ? null : k.id)
          }
        >
          <Avatar kin={k} size="sm" />
          {k.name}
          {filterKinId === k.id && (
            <span className="x">
              <Icon.X />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---- claim banner: first-time UX ----
function ClaimBanner({ onClaim }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const n = name.trim().toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_-]{0,31}$/.test(n)) {
      setErr("lowercase letters, digits, _, - · 1–32 chars · can't start with -");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onClaim(n);
    } catch (e) {
      setErr(e.message || "claim failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="claim-banner" onSubmit={submit}>
      <span className="claim-hint">claim a name to send messages:</span>
      <input
        className="claim-input"
        placeholder="your name (e.g. kerim, simge, dev)"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setErr("");
        }}
        autoFocus
        disabled={busy}
      />
      <button className="claim-btn" type="submit" disabled={busy || !name.trim()}>
        {busy ? "claiming…" : "claim"}
      </button>
      {err && <span className="claim-err">{err}</span>}
    </form>
  );
}

// ---- composer: send a message ----
function Composer({ me, kin, onSend, lockedTo }) {
  const [text, setText] = useState("");
  // Initial recipient resolution priority:
  //   1. DM-mode lock (from sidebar click)
  //   2. last-used recipient from localStorage (Oğuzhan: "ben buna
  //      bakmıyorum ki" — reloading the viewer no longer silently
  //      moves your default recipient to alphabetically-first kin)
  //   3. first kin in the list as a final fallback
  const [to, setTo] = useState(() => {
    if (lockedTo) return lockedTo;
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(COMPOSER_TO_STORAGE_KEY);
      if (stored && kin.find((k) => k.id === stored)) return stored;
    }
    return kin[0]?.id || "";
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef(null);

  // when DM mode locks the recipient, follow it
  useEffect(() => {
    if (lockedTo) setTo(lockedTo);
  }, [lockedTo]);

  // persist the last selected recipient so reload doesn't silently
  // redirect a half-typed message to a different kin
  useEffect(() => {
    if (to && typeof window !== "undefined") {
      window.localStorage.setItem(COMPOSER_TO_STORAGE_KEY, to);
    }
  }, [to]);

  // keep `to` valid as kin list changes
  useEffect(() => {
    if (kin.length === 0) {
      setTo("");
    } else if (!kin.find((k) => k.id === to)) {
      setTo(kin[0].id);
    }
  }, [kin, to]);

  // auto-grow textarea height with content, capped at ~6 lines via CSS max-height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const body = text.trim();
    if (!body) return;
    if (!to) {
      setErr("no recipient");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSend(to, body);
      setText("");
    } catch (e) {
      setErr(e.message || "send failed");
    } finally {
      setBusy(false);
    }
  };

  const noKin = kin.length === 0;

  return (
    <form className="composer" onSubmit={submit}>
      <span className="composer-from">
        <span className="composer-from-label">from</span>
        <span className="composer-from-name">{me}</span>
      </span>
      <span className="composer-to-label">→</span>
      <select
        className="composer-to"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        disabled={busy || noKin || !!lockedTo}
        title={lockedTo ? "recipient locked by DM mode" : undefined}
      >
        {noKin && <option value="">(no kin to message)</option>}
        {kin.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
      <textarea
        ref={textareaRef}
        className="composer-input"
        placeholder={
          noKin
            ? "claim a kin to start the conversation"
            : `message ${to || "kin"}…  (Ctrl+Enter / ⌘+Enter to send · Enter for newline)`
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr("");
        }}
        onKeyDown={(e) => {
          // Ctrl+Enter (or ⌘+Enter on macOS) sends. Plain Enter and
          // Shift+Enter both insert newlines — same as a regular textarea.
          // This protects against half-typed accidental sends, which had
          // no in-app cancel path.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit(e);
          }
        }}
        rows={1}
        disabled={busy || noKin}
      />
      <button
        className="composer-send"
        type="submit"
        disabled={busy || noKin || !text.trim()}
      >
        {busy ? "sending…" : "send"}
      </button>
      {err && <span className="composer-err">{err}</span>}
    </form>
  );
}

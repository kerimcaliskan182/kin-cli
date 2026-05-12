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

  // The human's own claimed kin name. Persisted in localStorage so reload
  // doesn't force them to re-claim. Cleared on /api/claim failure or manual
  // reset (out of scope for v1.1).
  const [me, setMe] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ME_STORAGE_KEY);
  });

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

  const isEmpty = kin.length === 0;
  const rightOpen = rightPanelOpen && !isEmpty && !!selectedKin;

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
        onSelect={setSelectedKinId}
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
            onSelectKin={setSelectedKinId}
            animateLast={false}
          />
          {me ? (
            <Composer me={me} kin={otherKin} onSend={send} />
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
  disabled,
}) {
  return (
    <div className="topbar">
      <div className="channel">
        <span className="hash">
          <Icon.Hash />
        </span>
        <span>{channelName}</span>
      </div>
      <span className="channel-meta">
        {disabled ? (
          "no kin yet"
        ) : (
          <>
            {kinOnline} of {kinTotal} online
          </>
        )}
      </span>
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
function Composer({ me, kin, onSend }) {
  const [text, setText] = useState("");
  const [to, setTo] = useState(kin[0]?.id || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // keep `to` valid as kin list changes
  useEffect(() => {
    if (kin.length === 0) {
      setTo("");
    } else if (!kin.find((k) => k.id === to)) {
      setTo(kin[0].id);
    }
  }, [kin, to]);

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
        disabled={busy || noKin}
      >
        {noKin && <option value="">(no kin to message)</option>}
        {kin.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
      <input
        className="composer-input"
        placeholder={noKin ? "claim a kin to start the conversation" : `message ${to || "kin"}…`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr("");
        }}
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

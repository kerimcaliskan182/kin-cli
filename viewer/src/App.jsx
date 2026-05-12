import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Sidebar,
  MessageStream,
  RightPanel,
  EmptyState,
  Avatar,
  Icon,
} from "./components.jsx";
import { KIN_DATA } from "./data.js";

// Subscribes to /api/stream and returns { kin, messages, now } that update
// live as the server detects filesystem changes. Falls back to the bundled
// demo data when the page is loaded with ?demo=1 (useful for screenshots
// or sharing the viewer with people who haven't claimed any kin yet).
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
      /* keep the last good snapshot — EventSource retries automatically */
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

  // tick "now" each 30s for rolling relative timestamps
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // sync now whenever the server snapshot ticks
  useEffect(() => {
    if (snapNow) setNow(snapNow);
  }, [snapNow]);

  // auto-select the first kin once data arrives, or whenever the current
  // selection disappears (e.g. that kin was removed from the workspace)
  useEffect(() => {
    if (kin.length === 0) {
      setSelectedKinId(null);
      return;
    }
    if (!selectedKinId || !kin.find((k) => k.id === selectedKinId)) {
      setSelectedKinId(kin[0].id);
    }
  }, [kin, selectedKinId]);

  const selectedKin = kin.find((k) => k.id === selectedKinId) || kin[0] || null;

  const isEmpty = kin.length === 0;
  const rightOpen = rightPanelOpen && !isEmpty && !!selectedKin;

  // Unread counts: messages a kin would see in their own inbox that haven't
  // been moved to archive yet. The server doesn't currently distinguish, so
  // leave this empty for now — wire up in v1.2 when we have a real signal.
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
            {kinOnline} of {kinTotal} online · read-only
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

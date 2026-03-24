import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./Leaderboard.module.css";

const DATA_URL = "https://oc-leaderboard-data.s3.us-east-2.amazonaws.com/leaderboard_data.json";
const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_DISPLAY_ENTRIES = 18;
const MIN_DISPLAY_ENTRIES = 1;
const MAX_DISPLAY_ENTRIES = 100;

/** Reads store id from `?store=30023` or `?id=30023` (must match digits in location parentheses). */
function readHighlightStoreIdFromSearch() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("store") ?? q.get("id");
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed === "" ? null : trimmed;
}

/** Reads display row count from `?entries=20` with safe bounds. */
function readDisplayEntriesFromSearch() {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_ENTRIES;
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("entries");
  if (raw == null) return DEFAULT_DISPLAY_ENTRIES;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DISPLAY_ENTRIES;
  return Math.min(MAX_DISPLAY_ENTRIES, Math.max(MIN_DISPLAY_ENTRIES, parsed));
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractStoreId(location) {
  const s = String(location || "");
  const match = s.match(/\((\d+)\)/);
  return match ? match[1] : null;
}

function formatScore(n) {
  if (n == null) return "—";
  return n.toFixed(1);
}

function formatUpdatedAt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return null;
  }
}

function parsePayload(data, lastModifiedHeader) {
  let rows = [];
  let updatedAt = null;
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && Array.isArray(data.rows)) {
    rows = data.rows;
    updatedAt = data.updatedAt ?? null;
  }
  if (!updatedAt && lastModifiedHeader) {
    const d = new Date(lastModifiedHeader);
    if (!Number.isNaN(d.getTime())) updatedAt = d.toISOString();
  }
  return { rows, updatedAt };
}

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightStoreId, setHighlightStoreId] = useState(readHighlightStoreIdFromSearch);
  const [displayEntries, setDisplayEntries] = useState(readDisplayEntriesFromSearch);

  useEffect(() => {
    const sync = () => {
      setHighlightStoreId(readHighlightStoreIdFromSearch());
      setDisplayEntries(readDisplayEntriesFromSearch());
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load data (${res.status})`);
      const data = await res.json();
      const { rows: nextRows, updatedAt: nextUpdated } = parsePayload(
        data,
        res.headers.get("Last-Modified")
      );
      setRows(nextRows);
      setUpdatedAt(nextUpdated);
    } catch (e) {
      setError(e.message || "Failed to load");
      setRows([]);
      setUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const standings = useMemo(() => {
    const allWeek = rows.filter((r) => String(r.week) === "All");
    const base = allWeek.length ? allWeek : rows;
    const copy = [...base];
    copy.sort((a, b) => {
      const ta = num(a.avgTotalPoints);
      const tb = num(b.avgTotalPoints);
      if (ta != null && tb != null && tb !== ta) return tb - ta;
      const ra = num(a.trendingRank);
      const rb = num(b.trendingRank);
      if (ra != null && rb != null && ra !== rb) return ra - rb;
      return String(a.location || "").localeCompare(String(b.location || ""));
    });
    return copy;
  }, [rows]);

  const updatedLabel = formatUpdatedAt(updatedAt);
  const highlightIndex = useMemo(() => {
    if (!highlightStoreId) return -1;
    return standings.findIndex((r) => extractStoreId(r.location) === highlightStoreId);
  }, [standings, highlightStoreId]);
  const highlightPosition = highlightIndex >= 0 ? highlightIndex + 1 : null;
  const displayedStandings = useMemo(
    () => standings.slice(0, displayEntries),
    [standings, displayEntries]
  );
  const placeholderRows = Math.max(0, displayEntries - displayedStandings.length);

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <h1 className={styles.title}>Contest Leaderboard (Canada)</h1>
        {updatedLabel ? (
          <p className={styles.updated}>Last updated {updatedLabel}</p>
        ) : null}
      </header>

      <main className={styles.main}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {loading && !rows.length ? (
          <p className={styles.loading}>Loading…</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Location</th>
                  <th scope="col">Pts</th>
                  <th scope="col">Avg. Cookie</th>
                  <th scope="col">Avg. Strawberry Hibiscus</th>
                </tr>
              </thead>
              <tbody>
                {displayedStandings.map((row, idx) => (
                  <tr
                    key={`${row.location}-${idx}`}
                    className={[
                      idx === highlightIndex ? styles.highlightRow : null,
                      idx < 3 && idx !== highlightIndex ? styles.leaderRow : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className={styles.rankCol}>{idx + 1}</td>
                    <td className={styles.locCol}>{row.location}</td>
                    <td className={styles.ptsCol}>{formatScore(num(row.avgTotalPoints))}</td>
                    <td>{formatScore(num(row.avgCookie))}</td>
                    <td>{formatScore(num(row.avgStrawberryHibiscusPlatform))}</td>
                  </tr>
                ))}
                {Array.from({ length: placeholderRows }).map((_, i) => (
                  <tr key={`placeholder-${i}`}>
                    <td className={styles.rankCol}>{displayedStandings.length + i + 1}</td>
                    <td className={styles.locCol}>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

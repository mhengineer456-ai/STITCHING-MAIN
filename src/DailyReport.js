// src/DailyReport.js
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";

/** ====== CONFIG ====== */
const SHEETS = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA",
  RANGE: "Index!A:Z", // kept for reference; we now fetch targeted columns
};

const DETAILS = {
  API_KEY: SHEETS.API_KEY,
  SPREADSHEET_ID: "1fKSwGBIpzWEFk566WRQ4bzQ0anJlmasoY8TwrTLQHXI",
  RANGE: "JobOrder!A:ZZZ", // kept for reference; we now fetch targeted columns
};

/** ====== Utils ====== */
const normalize = (s) =>
  (s || "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");

function findHeader(headers, candidates) {
  const norm = headers.map(normalize);
  const idx = candidates
    .map(normalize)
    .map((c) => norm.indexOf(c))
    .find((i) => i !== -1);
  return idx != null && idx !== -1 ? headers[idx] : null;
}

const DETAILS_FIELDS = [
  { label: "Fabric", candidates: ["fabric", "cloth", "material"], icon: "🧵", color: "#8B5CF6" },
  { label: "Brand", candidates: ["brand", "brand name"], icon: "🏷️", color: "#06B6D4" },
  { label: "Party Name", candidates: ["party name", "party", "customer", "client"], icon: "👥", color: "#10B981" },
  { label: "Garment Type", candidates: ["garment type", "garment", "style type", "product type"], icon: "👕", color: "#F59E0B" },
  { label: "Section", candidates: ["section", "dept", "department"], icon: "🏢", color: "#EF4444" },
  { label: "Season", candidates: ["season", "collection"], icon: "🌤️", color: "#EC4899" },
];

/** ====== EXTRA: Image URL support ====== */
const IMAGE_URL_CANDIDATES = [
  "image url", "image", "image link", "photo url", "photo", "imageurl", "image_url"
];

// Turn any Google Drive link (download/file/view/share) into a preview-able URL for <iframe>
function toDrivePreview(url = "") {
  if (!url) return "";
  try {
    // Accept common forms:
    // 1) https://drive.google.com/uc?export=download&id=FILEID
    // 2) https://drive.google.com/file/d/FILEID/view?usp=sharing
    // 3) https://drive.google.com/open?id=FILEID
    // 4) Raw image URLs or other hosts -> return as-is
    const u = new URL(url);
    if (u.hostname.includes("drive.google.com")) {
      const idParam = u.searchParams.get("id");
      if (idParam) return `https://drive.google.com/file/d/${idParam}/preview`;
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (m && m[1]) return `https://drive.google.com/file/d/${m[1]}/preview`;
    }
  } catch { /* ignore parse errors */ }
  return url; // Fallback
}

/** ====== Export utilities (work on currently displayed rows only) ====== */
const exportToExcel = (data, headers, filename = "daily-report") => {
  const csvContent = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((header) => `"${(row[header] || "").toString().replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `${filename}-${new Date().toISOString().split("T")[0]}.csv`
  );
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/** ====== NEW: Direct-download PDF (no print dialog) using jsPDF + autoTable ====== */
async function ensureJsPDF() {
  // Lazy-load jsPDF and autotable exactly once
  if (!window.jspdf) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Failed to load jsPDF");
  if (!window.jspdfAutoTable && !window.jsPDFInvoiceTemplate) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";
      s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
}

const exportToPDF = async (data, headers, filename = "daily-report") => {
  try {
    await ensureJsPDF();
    const { jsPDF } = window.jspdf;

    // Use landscape if many columns
    const isWide = headers.length > 8;
    const doc = new jsPDF({
      orientation: isWide ? "landscape" : "portrait",
      unit: "pt",
      format: "A4",
    });

    // Header
    const margin = 36; // 0.5 inch
    const title = filename;
    const dateStr = new Date().toLocaleDateString();
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(title, margin, 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Generated on: ${dateStr}`, margin, 58);
    doc.text(`Total Records: ${data.length}`, margin, 72);

    // Build table body
    const body = data.map(row => headers.map(h => (row[h] ?? "").toString()));

    // AutoTable
    doc.autoTable({
      head: [headers],
      body,
      startY: 88,
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 }, // indigo header
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: () => {
        // Footer with page numbers
        const pageSize = doc.internal.pageSize;
        const pageWidth = pageSize.getWidth();
        const pageHeight = pageSize.getHeight();
        doc.setFontSize(9);
        doc.text(
          `Page ${doc.internal.getNumberOfPages()}`,
          pageWidth - margin,
          pageHeight - 18,
          { align: "right" }
        );
      }
    });

    const stamp = new Date().toISOString().split("T")[0];
    doc.save(`${filename}-${stamp}.pdf`); // triggers direct download
  } catch (e) {
    console.error(e);
    alert("Failed to generate PDF. Please check your internet and try again.");
  }
};

/** ====== Small hooks ====== */
function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** ====== Abort-aware backoff & fetch (handles 429s and AbortError cleanly) ====== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const id = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithRetry(url, { retries = 5, baseDelay = 500, signal } = {}) {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let res;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      if (attempt >= retries) throw e;
      const jitter = Math.random() * 250;
      const delay = Math.min(5000, baseDelay * 2 ** attempt) + jitter;
      await waitWithAbort(delay, signal);
      attempt += 1;
      continue;
    }

    if (res.ok) return res;

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt >= retries) throw new Error(`Sheets API error: ${res.status}`);
      const jitter = Math.random() * 250;
      const delay = Math.min(5000, baseDelay * 2 ** attempt) + jitter;
      await waitWithAbort(delay, signal);
      attempt += 1;
      continue;
    }

    throw new Error(`Sheets API error: ${res.status}`);
  }
}

/** ====== Targeted column fetching + cache ====== */
const A_CODE = "A".charCodeAt(0);
function toColLetter(n) {
  // 0-based index -> A, B ... Z, AA, AB ...
  let s = "";
  n += 1; // 1-based
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(A_CODE + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes
function cacheKey(spreadsheetId, key) {
  return `gs-cache:${spreadsheetId}:${key}`;
}
function readCache(spreadsheetId, key) {
  try {
    const raw = localStorage.getItem(cacheKey(spreadsheetId, key));
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}
function writeCache(spreadsheetId, key, data) {
  try {
    localStorage.setItem(cacheKey(spreadsheetId, key), JSON.stringify({ t: Date.now(), data }));
  } catch {}
}

/** Fetch just the first row (headers) */
async function gsGetHeaders({ spreadsheetId, sheetName, apiKey, signal }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    `${sheetName}!1:1`
  )}?key=${apiKey}&fields=values`;
  const res = await fetchWithRetry(url, { signal });
  const json = await res.json();
  const headers = (json?.values?.[0] ?? []).map((h) => (h ?? "").toString());
  return headers;
}

/** Batch-get only specific columns by header names */
async function gsBatchGetColumnsByHeader({
  spreadsheetId,
  sheetName,
  apiKey,
  wantedHeaders, // array of exact labels from the sheet
  signal,
}) {
  const headers = await gsGetHeaders({ spreadsheetId, sheetName, apiKey, signal });

  const headerToIndex = new Map(headers.map((h, i) => [normalize(h), i]));
  const selected = wantedHeaders
    .map((h) => ({ label: h, idx: headerToIndex.get(normalize(h)) ?? -1 }))
    .filter((x) => x.idx >= 0);

  if (selected.length === 0) return { headers, rows: [] };

  const ranges = selected.map(({ idx }) => `${sheetName}!${toColLetter(idx)}:${toColLetter(idx)}`);

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?` +
    `key=${apiKey}&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&` +
    ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&") +
    `&fields=valueRanges(values)`;

  const res = await fetchWithRetry(url, { signal });
  const json = await res.json();

  // Rebuild row objects from column vectors
  const cols = (json?.valueRanges ?? []).map((vr) => vr.values?.map((r) => r[0]) ?? []);
  const bodyCols = cols.map((c) => c.slice(1)); // skip header row
  const maxLen = Math.max(0, ...bodyCols.map((c) => c.length));

  const rows = new Array(maxLen).fill(0).map((_, r) => {
    const obj = {};
    for (let c = 0; c < selected.length; c++) {
      const headerLabel = selected[c].label;
      obj[headerLabel] = bodyCols[c][r] ?? "";
    }
    return obj;
  });

  return { headers, rows };
}

/** High-level cached fetch for the Index sheet */
async function loadIndexOptimized({ spreadsheetId, apiKey, signal, bypassCache = false }) {
  const cacheId = "index:min";
  if (!bypassCache) {
    const cached = readCache(spreadsheetId, cacheId);
    if (cached) return cached;
  }

  const hdrs = await gsGetHeaders({ spreadsheetId, sheetName: "Index", apiKey, signal });

  const lotH =
    findHeader(hdrs, ["lot number", "lot no", "lotno", "lot_no", "lot#", "lot"]) || "";
  const supH = findHeader(hdrs, ["supervisor", "supervisor name", "username", "user"]) || "";
  const doiH =
    findHeader(hdrs, [
      "date of issue",
      "issue date",
      "date",
      "issuedate",
      "doi",
      "timestamp",
      "created at",
    ]) || "";

  // small set of extra columns to help search without downloading the entire sheet
  const searchExtras = [
    findHeader(hdrs, ["party", "party name", "customer", "client"]),
    findHeader(hdrs, ["garment", "garment type"]),
    findHeader(hdrs, ["section", "department"]),
  ].filter(Boolean);

  const wanted = [lotH, supH, doiH, ...searchExtras].filter(Boolean);

  const { rows } = await gsBatchGetColumnsByHeader({
    spreadsheetId,
    sheetName: "Index",
    apiKey,
    wantedHeaders: wanted,
    signal,
  });

  const data = { headers: wanted, rows };
  writeCache(spreadsheetId, cacheId, data);
  return data;
}

/** High-level cached fetch for the Details sheet: only lot + 6 details */
async function loadDetailsOptimized({ spreadsheetId, apiKey, signal, bypassCache = false }) {
  const cacheId = "details:min";
  if (!bypassCache) {
    const cached = readCache(spreadsheetId, cacheId);
    if (cached) return cached;
  }

  const hdrs = await gsGetHeaders({ spreadsheetId, sheetName: "JobOrder", apiKey, signal });
  const lotH =
    findHeader(hdrs, ["lot number", "lot no", "lotno", "lot_no", "lot#", "lot"]) || "";

  const resolved = DETAILS_FIELDS.map((f) => findHeader(hdrs, f.candidates)).filter(Boolean);

  // >>> Include Image URL column if present <<<
  const imageH = findHeader(hdrs, IMAGE_URL_CANDIDATES);

  const wanted = [lotH, ...resolved, imageH].filter(Boolean);

  const { rows } = await gsBatchGetColumnsByHeader({
    spreadsheetId,
    sheetName: "JobOrder",
    apiKey,
    wantedHeaders: wanted,
    signal,
  });

  const data = { headers: wanted, rows };
  writeCache(spreadsheetId, cacheId, data);
  return data;
}

/** ====== Virtualized table (no external deps) ====== */
function VirtualizedTable({
  rows,
  headers,
  rowHeight = 48,
  overscan = 8,
  renderCell,
  containerStyle,
  tableStyle,
  trStyle,
}) {
  const containerRef = useRef(null);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => setViewportHeight(el.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = rows.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + 2 * overscan;
  const endIndex = Math.min(total - 1, startIndex + visibleCount - 1);
  const topSpacer = startIndex * rowHeight;
  const bottomSpacer = Math.max(0, (total - endIndex - 1) * rowHeight);

  return (
    <div
      ref={containerRef}
      style={{ ...tableContainer, ...containerStyle }}
      onScroll={onScroll}
      className="table-container"
    >
      <table style={{ ...table, ...tableStyle }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={DETAILS_FIELDS.some((f) => f.label === h) ? detailTh : th}>
                <div style={thContent}>
                  <div
                    style={{
                      ...thIcon,
                      color: DETAILS_FIELDS.find((f) => f.label === h)?.color,
                    }}
                  >
                    {DETAILS_FIELDS.find((f) => f.label === h)?.icon || (h === "Image" ? "🖼️" : "📑")}
                  </div>
                  <div style={thText}>
                    {h}
                    {DETAILS_FIELDS.some((f) => f.label === h) && (
                      <div style={thSubtitle}>Details</div>
                    )}
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
      </table>

      <div style={{ position: "relative" }}>
        <div style={{ height: topSpacer }} />
        <table style={{ ...table, ...tableStyle }}>
          <tbody>
            {rows.slice(startIndex, endIndex + 1).map((row, i) => {
              const key = startIndex + i;
              return (
                <tr key={key} style={{ ...tableRow, ...trStyle, height: rowHeight }}>
                  {headers.map((h) => (
                    <td key={h} style={DETAILS_FIELDS.some((f) => f.label === h) ? detailTd : td}>
                      {renderCell(row, h)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ height: bottomSpacer }} />
      </div>
    </div>
  );
}

export default function DailyReport({ user, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  // details sheet structures
  const [detailsHeaders, setDetailsHeaders] = useState([]);
  const [lotDetailsIndex, setLotDetailsIndex] = useState(new Map());

  // Image preview modal state
  const [imagePreview, setImagePreview] = useState({ open: false, src: "", title: "" });
  const openImage = useCallback((src, title = "Image") => {
    setImagePreview({ open: true, src, title });
  }, []);
  const closeImage = useCallback(() => setImagePreview({ open: false, src: "", title: "" }), []);

  const searchDebounced = useDebouncedValue(searchTerm, 300);

  /** ====== Load (targeted columns + cache) ====== */
  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr("");
      try {
        const [indexMin, detailsMin] = await Promise.all([
          loadIndexOptimized({
            spreadsheetId: SHEETS.SPREADSHEET_ID,
            apiKey: SHEETS.API_KEY,
            signal,
          }),
          loadDetailsOptimized({
            spreadsheetId: DETAILS.SPREADSHEET_ID,
            apiKey: DETAILS.API_KEY,
            signal,
          }),
        ]);

        if (cancelled) return;

        // Index rows are already reduced to wanted headers
        const idxHeaders = indexMin.headers;
        const idxRows = indexMin.rows.map((r) => r);

        // Details: build lot -> details row map
        const detHeaders = detailsMin.headers;
        const lotKeyInDetails =
          findHeader(detHeaders, ["lot number", "lot no", "lotno", "lot_no", "lot#", "lot"]) ||
          null;

        const index = new Map();
        for (let i = 0; i < detailsMin.rows.length; i++) {
          const row = detailsMin.rows[i];
          const lot = normalize(row[lotKeyInDetails]);
          if (!lot) continue;
          if (!index.has(lot)) index.set(lot, row); // keep first occurrence
        }

        setHeaders(idxHeaders);
        setRows(idxRows);
        setDetailsHeaders(detHeaders);
        setLotDetailsIndex(index);
      } catch (e) {
        if (e?.name !== "AbortError") setErr(e?.message || "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  /** Detect columns ONCE the headers are known */
  const idHeaderKey = useMemo(
    () =>
      findHeader(headers, [
        "username",
        "user",
        "supervisor",
        "supervisor name",
        "enteredby",
        "entered by",
        "owner",
        "addedby",
      ]) || null,
    [headers]
  );

  const lotHeaderKey = useMemo(
    () =>
      findHeader(headers, ["lot number", "lot no", "lotno", "lot_no", "lot#", "lot"]) || null,
    [headers]
  );

  const supervisorHeaderKey = useMemo(
    () => findHeader(headers, ["supervisor", "supervisor name", "username", "user"]) || null,
    [headers]
  );

  const issueDateHeaderKey = useMemo(
    () =>
      findHeader(headers, [
        "date of issue",
        "issue date",
        "date",
        "issuedate",
        "doi",
        "timestamp",
        "created at",
      ]) || null,
    [headers]
  );

  /** Resolve which columns in details sheet correspond to our display fields */
  const resolvedDetailHeaders = useMemo(() => {
    return DETAILS_FIELDS.map(({ candidates }) => findHeader(detailsHeaders, candidates) || null);
  }, [detailsHeaders]);

  /** Resolve "Image URL" header in details sheet */
  const imageUrlHeaderKey = useMemo(
    () => findHeader(detailsHeaders, IMAGE_URL_CANDIDATES) || null,
    [detailsHeaders]
  );

  /** ====== Pre-index (cheap) ====== */
  const indexedRows = useMemo(() => {
    if (!rows.length) return [];
    return rows.map((row) => {
      const lotRaw = lotHeaderKey ? row[lotHeaderKey] : "";
      const lotKey = normalize(lotRaw);
      const detailsRow = lotKey ? lotDetailsIndex.get(lotKey) : undefined;

      let ts = 0;
      if (issueDateHeaderKey) {
        const d = new Date(row[issueDateHeaderKey]);
        ts = isNaN(d) ? 0 : d.getTime();
      }

      return {
        base: row,
        detailsRow,
        ts,
      };
    });
  }, [rows, lotHeaderKey, lotDetailsIndex, issueDateHeaderKey]);

  /** Filter by current supervisor (username or name) */
  const filteredByUser = useMemo(() => {
    if (!user || !idHeaderKey) return indexedRows;
    const me1 = normalize(user.username);
    const me2 = normalize(user.name);
    return indexedRows.filter(({ base }) => {
      const cell = normalize(base[idHeaderKey]);
      return cell === me1 || cell === me2;
    });
  }, [indexedRows, idHeaderKey, user]);

  /** Lazy searchable cache */
  const searchableCacheRef = useRef(new WeakMap());

  /** Apply search + date (debounced search) */
  const filteredRows = useMemo(() => {
    let arr = filteredByUser;

    if (searchDebounced) {
      const term = searchDebounced.toLowerCase();
      arr = arr.filter((r) => {
        let cached = searchableCacheRef.current.get(r);
        if (!cached) {
          const baseStr = Object.values(r.base).join(" | ").toLowerCase();
          const detailVals = resolvedDetailHeaders.map((h) => (h && r.detailsRow ? r.detailsRow[h] : ""));
          cached = baseStr + " | " + detailVals.join(" | ").toLowerCase();
          searchableCacheRef.current.set(r, cached);
        }
        return cached.includes(term);
      });
    }

    if (dateFilter && issueDateHeaderKey) {
      arr = arr.filter(({ base }) => {
        const cell = (base[issueDateHeaderKey] || "").toString();
        return cell.includes(dateFilter);
      });
    }

    return arr;
  }, [filteredByUser, searchDebounced, dateFilter, issueDateHeaderKey, resolvedDetailHeaders]);

  /** Sort by Date (desc) using precomputed ts */
  const sortedRows = useMemo(() => {
    if (!issueDateHeaderKey) return filteredRows;
    const cp = filteredRows.slice();
    cp.sort((a, b) => b.ts - a.ts);
    return cp;
  }, [filteredRows, issueDateHeaderKey]);

  /** Build enhanced row objects for rendering/export (cheap projection) */
  const allDisplayHeaders = useMemo(() => {
    const base = [lotHeaderKey, supervisorHeaderKey, issueDateHeaderKey].filter(Boolean);
    const detailLabels = DETAILS_FIELDS.map((f) => f.label);
    // Add an action column for Image at the end
    return [...base, ...detailLabels, "Image"];
  }, [lotHeaderKey, supervisorHeaderKey, issueDateHeaderKey]);

  const enhancedRows = useMemo(() => {
    return sortedRows.map(({ base, detailsRow }) => {
      const o = { ...base };
      DETAILS_FIELDS.forEach((f, i) => {
        const key = resolvedDetailHeaders[i];
        o[f.label] = key && detailsRow ? detailsRow[key] || "" : "";
      });
      // Attach the raw Image URL (used by the "Image" action column)
      o["Image URL"] = imageUrlHeaderKey && detailsRow ? (detailsRow[imageUrlHeaderKey] || "") : "";
      return o;
    });
  }, [sortedRows, resolvedDetailHeaders, imageUrlHeaderKey]);

  /** Stats */
  const totalRecords = enhancedRows.length;
  const activeLotsCount = useMemo(() => {
    if (!lotHeaderKey) return 0;
    const s = new Set();
    for (const r of enhancedRows) {
      const v = r[lotHeaderKey];
      if (v) s.add(v);
    }
    return s.size;
  }, [enhancedRows, lotHeaderKey]);

  /** Render cell (stable function for virtualization) */
  const renderCell = useCallback((row, header) => {
    if (header === "Image") {
      const rawUrl = row["Image URL"];
      if (!rawUrl) return <span style={emptyCell}>—</span>;
      return (
        <button
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            background: "white",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600
          }}
          onClick={(e) => {
            e.stopPropagation();
            const src = toDrivePreview(rawUrl);
            const title = row[lotHeaderKey] ? `Lot ${row[lotHeaderKey]}` : "Image";
            openImage(src, title);
          }}
          title="View Image"
        >
          View
        </button>
      );
    }

    const value = row[header] || "";
    return value ? <div style={cellContent}>{value}</div> : <span style={emptyCell}>—</span>;
  }, [lotHeaderKey, openImage]);

  /** Refresh handler (bypass cache) */
  const handleRefresh = useCallback(async () => {
    const ac = new AbortController();
    const { signal } = ac;
    setLoading(true);
    setErr("");
    try {
      const [indexMin, detailsMin] = await Promise.all([
        loadIndexOptimized({
          spreadsheetId: SHEETS.SPREADSHEET_ID,
          apiKey: SHEETS.API_KEY,
          signal,
          bypassCache: true,
        }),
        loadDetailsOptimized({
          spreadsheetId: DETAILS.SPREADSHEET_ID,
          apiKey: DETAILS.API_KEY,
          signal,
          bypassCache: true,
        }),
      ]);

      const idxHeaders = indexMin.headers;
      const idxRows = indexMin.rows.map((r) => r);

      const detHeaders = detailsMin.headers;
      const lotKeyInDetails =
        findHeader(detHeaders, ["lot number", "lot no", "lotno", "lot_no", "lot#", "lot"]) ||
        null;

      const index = new Map();
      for (let i = 0; i < detailsMin.rows.length; i++) {
        const row = detailsMin.rows[i];
        const lot = normalize(row[lotKeyInDetails]);
        if (!lot) continue;
        if (!index.has(lot)) index.set(lot, row);
      }

      // Clear searchable cache since the data changed
      searchableCacheRef.current = new WeakMap();

      setHeaders(idxHeaders);
      setRows(idxRows);
      setDetailsHeaders(detHeaders);
      setLotDetailsIndex(index);
    } catch (e) {
      if (e?.name !== "AbortError") setErr(e?.message || "Failed to refresh");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <PageWrap title=" Production Report" user={user} onBack={() => onNavigate("Welcome", user)}>
      {/* Enhanced Header Section */}
      <div style={headerSection}>
        <div style={headerLeft}>
          <div style={statsGrid}>
            <div style={statCard}>
              <div style={{ ...statIcon }} className="stat-primary">📊</div>
              <div style={statContent}>
                <div style={statLabel}>Total Records</div>
                <div style={statValue}>{totalRecords}</div>
              </div>
            </div>
            <div style={statCard}>
              <div style={{ ...statIcon }} className="stat-success">✅</div>
              <div style={statContent}>
                <div style={statLabel}>Active Lots</div>
                <div style={statValue}>{activeLotsCount}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={headerRight}>
          <div style={filterSection}>
            <div style={searchBox}>
              <div style={searchIcon}>🔍</div>
              <input
                type="text"
                placeholder="Search records..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={searchInput}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm("")} style={clearButton}>✕</button>
              )}
            </div>

            <div style={dateFilterBox}>
              <div style={dateIcon}>📅</div>
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                style={dateInput}
              />
            </div>
          </div>

          <div style={actionButtons}>
            <button
              onClick={handleRefresh}
              style={iconButton}
              title="Refresh Data"
            >
              <span style={buttonIcon}>🔄</span>
            </button>

            <button
              onClick={() => exportToExcel(enhancedRows, allDisplayHeaders, "daily-report")}
              style={iconButton}
              disabled={enhancedRows.length === 0}
              title="Export to Excel"
            >
              <span style={buttonIcon}>📊</span>
            </button>

            <button
              onClick={() => exportToPDF(enhancedRows, allDisplayHeaders, "daily-report")}
              style={iconButton}
              disabled={enhancedRows.length === 0}
              title="Export to PDF"
            >
              <span style={buttonIcon}>📄</span>
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div style={errorAlert}>
          <div style={alertIcon}>⚠️</div>
          <div style={alertContent}>
            <div style={alertTitle}>Error Loading Data</div>
            <div style={alertMessage}>{err}</div>
          </div>
        </div>
      )}

      {!loading && !err && (
        <>
          {!lotHeaderKey && (
            <div style={warningAlert}>
              <div style={alertIcon}>💡</div>
              <div style={alertContent}>
                <div style={alertTitle}>Configuration Required</div>
                <div style={alertMessage}>
                  Please ensure your sheet contains columns for <b>Lot Number</b>, <b>Supervisor</b>, and <b>Date of Issue</b>
                </div>
              </div>
            </div>
          )}

          {enhancedRows.length === 0 ? (
            <div style={emptyState}>
              <div style={emptyIllustration}>📭</div>
              <div style={emptyContent}>
                <h3 style={emptyTitle}>No Records Found</h3>
                <p style={emptyMessage}>
                  {searchTerm || dateFilter
                    ? "No records match your current filters. Try adjusting your search criteria."
                    : `No records found for ${user?.name || user?.username}.`}
                </p>
                {(searchTerm || dateFilter) && (
                  <button
                    onClick={() => {
                      setSearchTerm("");
                      setDateFilter("");
                    }}
                    style={secondaryButton}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={tableWrapper}>
              <div style={tableHeader}>
                <div style={tableTitle}>
                  Production Records
                  <span style={tableBadge}>{enhancedRows.length}</span>
                </div>
                <div style={tableSummary}>Last updated: {new Date().toLocaleTimeString()}</div>
              </div>

              {/* Virtualized table */}
              <VirtualizedTable
                rows={enhancedRows}
                headers={allDisplayHeaders}
                rowHeight={52}
                overscan={10}
                renderCell={renderCell}
                containerStyle={{ height: "calc(100vh - 300px)" }}
                tableStyle={{}}
                trStyle={{}}
              />
            </div>
          )}
        </>
      )}

      {loading && (
        <div style={loadingState}>
          <div style={loadingSpinner}></div>
          <div style={loadingContent}>
            <h3 style={loadingTitle}>Loading Production Data</h3>
            <p style={loadingMessage}>Fetching your daily reports...</p>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {imagePreview.open && (
        <div
          onClick={closeImage}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(900px, 96vw)",
              height: "min(80vh, 96vh)",
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc"
            }}>
              <div style={{ fontWeight: 600, color: "#0f172a" }}>{imagePreview.title}</div>
              <button
                onClick={closeImage}
                style={{
                  border: "1px solid #e2e8f0", background: "white", borderRadius: "8px",
                  padding: "6px 10px", cursor: "pointer", fontWeight: 600
                }}
              >
                ✕
              </button>
            </div>

            <iframe
              title="Image Preview"
              src={imagePreview.src}
              style={{ width: "100%", height: "100%", border: "0" }}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </PageWrap>
  );
}

function PageWrap({ title, user, onBack, children }) {
  // inject global styles once
  useEffect(() => {
    const styles = `
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.stat-primary { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; }
.stat-success { background: linear-gradient(135deg, #10b981, #047857); color: white; }
input:focus { outline: none; border-color: #3b82f6 !important; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
button:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
tr:hover { background: #f8fafc !important; }
.nav-back-button:hover { background: #f8fafc; border-color: #cbd5e1; }
.icon-button:hover { background: #f8fafc; border-color: #cbd5e1; }
.secondary-button:hover { background: #f8fafc; border-color: #cbd5e1; }
.table-container::-webkit-scrollbar { width: 8px; height: 8px; }
.table-container::-webkit-scrollbar-track { background: #f1f5f9; }
.table-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.table-container::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
`;
    const styleTag = document.createElement("style");
    styleTag.innerText = styles;
    document.head.appendChild(styleTag);
    return () => {
      try {
        document.head.removeChild(styleTag);
      } catch {}
    };
  }, []);

  return (
    <div style={pageContainer}>
      {/* Navigation Header */}
      <div style={navHeader}>
        <div style={navLeft}>
          <button onClick={onBack} style={navBackButton}>
            <span style={navBackIcon}>←</span>
            Dashboard
          </button>
          <div style={navTitle}>
            <span style={navTitleIcon}>📋</span>
            {title}
          </div>
        </div>

        <div style={navUser}>
          <div style={userInfo}>
            <div style={userAvatar}>
              {user?.name?.charAt(0) || user?.username?.charAt(0) || "U"}
            </div>
            <div style={userDetails}>
              <div style={userName}>{user?.name}</div>
              <div style={userRole}>Supervisor</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={mainContent}>{children}</div>
    </div>
  );
}

/** ====== Modern Professional Styles ====== */
const pageContainer = {
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  background: "white",
  minHeight: "100vh",
  padding: 0,
  margin: 0,
  overflow: "hidden",
};

const navHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px 24px",
  background: "white",
  borderBottom: "1px solid #e2e8f0",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
};

const navLeft = {
  display: "flex",
  alignItems: "center",
  gap: "24px",
};

const navBackButton = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#64748b",
  cursor: "pointer",
  fontWeight: "500",
  fontSize: "14px",
  transition: "all 0.2s ease",
};

const navBackIcon = {
  fontSize: "16px",
  fontWeight: "600",
};

const navTitle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "20px",
  fontWeight: "600",
  color: "#1e293b",
};

const navTitleIcon = {
  fontSize: "24px",
};

const navUser = {
  display: "flex",
  alignItems: "center",
};

const userInfo = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const userAvatar = {
  width: "40px",
  height: "40px",
  borderRadius: "50%",
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "white",
  fontWeight: "600",
  fontSize: "16px",
};

const userDetails = {
  display: "flex",
  flexDirection: "column",
};

const userName = {
  fontWeight: "600",
  fontSize: "14px",
  color: "#1e293b",
};

const userRole = {
  fontSize: "12px",
  color: "#64748b",
};

const mainContent = {
  padding: "24px",
  height: "calc(100vh - 80px)",
  overflow: "auto",
};

const headerSection = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "24px",
  alignItems: "start",
  marginBottom: "24px",
};

const headerLeft = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const statsGrid = {
  display: "flex",
  gap: "16px",
};

const statCard = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "16px 20px",
  background: "white",
  borderRadius: "12px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
  minWidth: "180px",
};

const statIcon = {
  width: "48px",
  height: "48px",
  borderRadius: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "20px",
};

const statContent = {
  display: "flex",
  flexDirection: "column",
};

const statLabel = {
  fontSize: "14px",
  color: "#64748b",
  fontWeight: "500",
  marginBottom: "4px",
};

const statValue = {
  fontSize: "24px",
  fontWeight: "700",
  color: "#1e293b",
};

const headerRight = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  alignItems: "flex-end",
};

const filterSection = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
};

const searchBox = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  minWidth: "250px",
};

const searchIcon = {
  position: "absolute",
  left: "12px",
  zIndex: "2",
  fontSize: "16px",
  color: "#64748b",
};

const searchInput = {
  padding: "12px 40px 12px 40px",
  borderRadius: "10px",
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#1e293b",
  fontSize: "14px",
  width: "90%",
  transition: "all 0.2s ease",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
};

const clearButton = {
  position: "absolute",
  right: "12px",
  background: "none",
  border: "none",
  color: "#64748b",
  cursor: "pointer",
  fontSize: "14px",
  padding: "4px",
};

const dateFilterBox = {
  position: "relative",
  display: "flex",
  alignItems: "center",
};

const dateIcon = {
  position: "absolute",
  left: "12px",
  zIndex: "2",
  fontSize: "16px",
  color: "#64748b",
};

const dateInput = {
  padding: "12px 12px 12px 40px",
  borderRadius: "10px",
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#1e293b",
  fontSize: "14px",
  minWidth: "160px",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
};

const actionButtons = {
  display: "flex",
  gap: "8px",
};

const iconButton = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #e2e8f0",
  background: "white",
  cursor: "pointer",
  transition: "all 0.2s ease",
  width: "44px",
  height: "44px",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
};

const buttonIcon = {
  fontSize: "16px",
};

const secondaryButton = {
  padding: "10px 20px",
  borderRadius: "8px",
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#64748b",
  cursor: "pointer",
  fontWeight: "500",
  fontSize: "14px",
  transition: "all 0.2s ease",
};

const tableWrapper = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  overflow: "hidden",
  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.05)",
  height: "calc(100vh - 240px)",
  display: "flex",
  flexDirection: "column",
};

const tableHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "20px 24px",
  borderBottom: "1px solid #e2e8f0",
  background: "#f8fafc",
};

const tableTitle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: "18px",
  fontWeight: "600",
  color: "#1e293b",
};

const tableBadge = {
  background: "#3b82f6",
  color: "white",
  padding: "4px 12px",
  borderRadius: "20px",
  fontSize: "12px",
  fontWeight: "600",
};

const tableSummary = {
  fontSize: "14px",
  color: "#64748b",
};

const tableContainer = {
  flex: "1",
  overflow: "auto",
};

const table = {
  borderCollapse: "collapse",
  width: "100%",
  background: "white",
  tableLayout: "fixed",
};

const th = {
  padding: "16px 20px",
  background: "#f8fafc",
  color: "#475569",
  fontWeight: "600",
  fontSize: "13px",
  textAlign: "left",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const detailTh = {
  ...th,
  background: "#f1f5f9",
  borderLeft: "1px solid #e2e8f0",
};

const thContent = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const thIcon = {
  fontSize: "16px",
  width: "20px",
  textAlign: "center",
};

const thText = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const thSubtitle = {
  fontSize: "11px",
  color: "#94a3b8",
  fontWeight: "400",
  textTransform: "none",
  letterSpacing: "0",
};

const td = {
  padding: "16px 20px",
  borderBottom: "1px solid #f1f5f9",
  color: "#1e293b",
  fontSize: "14px",
  whiteSpace: "nowrap",
  fontWeight: "500",
};

const detailTd = {
  ...td,
  background: "#fafafa",
  borderLeft: "1px solid #f1f5f9",
  color: "#475569",
  fontWeight: "400",
};

const tableRow = {
  transition: "all 0.2s ease",
  cursor: "pointer",
};

const cellContent = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const emptyCell = {
  color: "#cbd5e1",
  fontStyle: "italic",
};

const errorAlert = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "16px 20px",
  borderRadius: "12px",
  border: "1px solid #fecaca",
  background: "#fef2f2",
  marginBottom: "16px",
};

const warningAlert = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "16px 20px",
  borderRadius: "12px",
  border: "1px solid #fed7aa",
  background: "#fffbeb",
  marginBottom: "16px",
};

const alertIcon = {
  fontSize: "20px",
  flexShrink: "0",
};

const alertContent = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const alertTitle = {
  fontWeight: "600",
  fontSize: "14px",
  color: "#1e293b",
};

const alertMessage = {
  fontSize: "14px",
  color: "#64748b",
};

const emptyState = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "80px 20px",
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  textAlign: "center",
  height: "calc(100vh - 240px)",
};

const emptyIllustration = {
  fontSize: "4rem",
  marginBottom: "24px",
  opacity: "0.5",
};

const emptyContent = {
  maxWidth: "400px",
};

const emptyTitle = {
  fontSize: "20px",
  fontWeight: "600",
  color: "#1e293b",
  marginBottom: "8px",
};

const emptyMessage = {
  fontSize: "16px",
  color: "#64748b",
  lineHeight: "1.5",
  marginBottom: "20px",
};

const loadingState = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "80px 20px",
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  textAlign: "center",
  height: "calc(100vh - 240px)",
};

const loadingSpinner = {
  width: "48px",
  height: "48px",
  border: "3px solid #f1f5f9",
  borderTop: "3px solid #3b82f6",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
  marginBottom: "20px",
};

const loadingContent = {
  maxWidth: "300px",
};

const loadingTitle = {
  fontSize: "18px",
  fontWeight: "600",
  color: "#1e293b",
  marginBottom: "8px",
};

const loadingMessage = {
  fontSize: "14px",
  color: "#64748b",
};

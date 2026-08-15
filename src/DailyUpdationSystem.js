// src/components/DailyUpdationSystem.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './DailyUpdationSystem.css';

const GOOGLE_SHEETS_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA",
  RANGE: "Index!A:X",
  CUTTING_RANGE: "Cutting!A1:ZZ200000"
};

// Enhanced utility functions
const norm = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeKey = (s = "") => norm(s);
const clean = (v) => (v == null ? "" : String(v).trim());

// Enhanced lot number matching
const normalizeLotNumber = (lot) => {
  if (!lot) return '';
  return String(lot).trim().toUpperCase().replace(/\s+/g, '');
};

// Data fetching with cache
const dataCache = {
  timestamp: null,
  data: null
};

async function fetchSheet({ sheetId, range, apiKey, signal }, { retries = 3, baseDelayMs = 400 } = {}) {
  const cacheKey = `${sheetId}-${range}`;
  
  if (dataCache[cacheKey] && Date.now() - dataCache.timestamp < 300000) {
    return dataCache[cacheKey];
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = await res.json();
        dataCache[cacheKey] = data;
        dataCache.timestamp = Date.now();
        return data;
      }
      
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw new Error(`Sheets API error: ${res.status} ${text}`);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw error;
    }
  }
}

// Enhanced Index Sheet Parser
function parseIndexRow(header, row) {
  if (!row || !Array.isArray(row)) return null;
  
  const hmap = {};
  header.forEach((h, i) => {
    if (h) hmap[normalizeKey(h)] = i;
  });
  
  const get = (key) => {
    const i = hmap[key];
    return i == null || i < 0 ? "" : (row[i] ?? "");
  };

  const lot = normalizeLotNumber(
    get("lotnumber") || 
    get("lot number") || 
    get("lotno") ||
    get("lot") ||
    get("lot no") ||
    get("lot#")
  );
  
  const supervisor = get("supervisor");
  const dateOfIssue = get("dateofissue") || get("date of issue");

  if (!lot) return null;

  const startRow = parseInt(get("startrow") || get("start row") || "0", 10);
  const numRows = parseInt(get("numrows") || get("num rows") || get("totalrows") || "0", 10);
  const fabric = get("fabric");
  const garmentType = get("garmenttype") || get("garment") || get("garment type");
  const style = get("style");

  const sizes = String(get("sizes") || get("size") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { 
    lot, 
    startRow, 
    numRows, 
    fabric, 
    garmentType, 
    style, 
    sizes, 
    supervisor,
    dateOfIssue,
    sourceType: "Index"
  };
}

// Enhanced Cutting Matrix PCS Calculation
function sliceCuttingMatrix(bigValues, startRow, numRows) {
  if (!Array.isArray(bigValues) || bigValues.length === 0) return [];
  if (!(startRow > 0 && numRows > 0)) return [];
  
  const r0 = Math.max(0, startRow - 1);
  const r1 = Math.min(bigValues.length - 1, r0 + numRows - 1);
  
  if (r0 >= bigValues.length) return [];
  
  return bigValues.slice(r0, r1 + 1);
}

function findHeaderRowIndex(windowValues, expectedSizesNorm) {
  if (!windowValues || windowValues.length === 0) return 0;

  const hasSizeToken = (rowSet) => expectedSizesNorm.some((sz) => rowSet.has(sz));
  
  for (let i = 0; i < Math.min(windowValues.length, 10); i++) {
    const row = windowValues[i] || [];
    const set = new Set(row.map((c) => norm(c)));
    const hasShadeHeader = set.has("color") || set.has("shade") || set.has("shades");
    if (hasShadeHeader && hasSizeToken(set)) return i;
  }
  
  for (let i = 0; i < Math.min(windowValues.length, 10); i++) {
    const row = windowValues[i] || [];
    const set = new Set(row.map((c) => norm(c)));
    let matches = 0;
    expectedSizesNorm.forEach((sz) => {
      if (set.has(sz)) matches++;
    });
    if (matches >= 2) return i;
  }
  
  for (let i = 0; i < Math.min(windowValues.length, 20); i++) {
    const row = windowValues[i] || [];
    const hasNumbers = row.some(cell => {
      const num = parseFloat(String(cell).replace(/,/g, ""));
      return !isNaN(num) && num > 0;
    });
    if (hasNumbers) return Math.max(0, i - 1);
  }
  
  return 0;
}

function calculateTotalPCS(windowValues, sizes = []) {
  if (!windowValues || windowValues.length === 0) return 0;

  const normalizedSizes = Array.from(new Set((sizes || []).map(norm).filter(Boolean)));
  const headerRowIdx = findHeaderRowIndex(windowValues, normalizedSizes);
  const header = windowValues[headerRowIdx] || [];

  const hIdx = {};
  header.forEach((h, i) => {
    const k = norm(h);
    if (k && !(k in hIdx)) hIdx[k] = i;
  });

  const nonSizeColumns = new Set([
    "color", "shade", "shades", "cuttingtable", "cutting", "table", 
    "total", "totalpcs", "totals", "grandtotal", "sum", "lot", "style",
    "fabric", "garment", "partyname", "brand", "section", "season", "description",
    "remark", "comments", "date", "issued", "qty", "quantity"
  ]);

  let sizeColIndices = [];
  
  header.forEach((h, i) => {
    const normalizedHeader = norm(h);
    if (normalizedHeader && !nonSizeColumns.has(normalizedHeader)) {
      if (/^(xs|s|m|l|xl|xxl|xxxl|[0-9]+)$/.test(normalizedHeader)) {
        sizeColIndices.push(i);
      }
    }
  });

  if (sizeColIndices.length === 0) {
    normalizedSizes.forEach((ns) => {
      if (ns in hIdx) sizeColIndices.push(hIdx[ns]);
    });
  }

  if (sizeColIndices.length === 0) {
    const ct = hIdx["cuttingtable"] || hIdx["table"] || hIdx["cutting"];
    if (ct != null && ct >= 0) {
      const guessStart = ct + 1;
      const guessed = [];
      for (let k = 0; k < Math.max(normalizedSizes.length, 8); k++) {
        guessed.push(guessStart + k);
      }
      sizeColIndices = Array.from(new Set(guessed.filter((g) => g < header.length)));
    }
  }

  if (sizeColIndices.length === 0) {
    const shadeCol = hIdx["color"] || hIdx["shade"] || 0;
    for (let i = shadeCol + 1; i < header.length; i++) {
      const cell = header[i];
      if (cell && /^\s*\d+\s*$/.test(cell)) {
        sizeColIndices.push(i);
      }
    }
  }

  if (sizeColIndices.length === 0) return 0;

  let totalQty = 0;

  for (let r = headerRowIdx + 1; r < windowValues.length; r++) {
    const row = windowValues[r] || [];
    if (row.length === 0) continue;

    const rawShade = String(row[hIdx["color"] || hIdx["shade"] || 0] || "").trim();
    const shadeKey = norm(rawShade);

    if (!shadeKey || shadeKey === "total" || shadeKey === "totals" || shadeKey === "grandtotal" || shadeKey === "subtotal") {
      continue;
    }

    let rowTotal = 0;
    let hasValidData = false;
    
    sizeColIndices.forEach((c) => {
      if (c < row.length) {
        const raw = row[c];
        if (raw != null && raw !== "") {
          const n = parseFloat(String(raw).replace(/,/g, ""));
          if (!isNaN(n) && n > 0) {
            rowTotal += n;
            hasValidData = true;
          }
        }
      }
    });

    if (hasValidData) {
      totalQty += rowTotal;
    }
  }

  return totalQty;
}

// Dynamic Status Color System
const getStatusColor = (status) => {
  if (!status) return '#6b7280';
  
  const statusLower = status.toLowerCase();
  const statusHash = statusLower.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const colorPalette = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#84cc16', '#eab308', '#a855f7', '#dc2626'
  ];
  
  return colorPalette[Math.abs(statusHash) % colorPalette.length];
};

const getStatusBackground = (status) => {
  const color = getStatusColor(status);
  return `${color}15`;
};

// PDF Export Utilities
async function ensureJsPDF() {
  if (!window.jspdf) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = resolve; 
      s.onerror = reject; 
      document.head.appendChild(s);
    });
  }
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Failed to load jsPDF");
  
  if (!window.jspdfAutoTable && !window.jsPDFInvoiceTemplate) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";
      s.onload = resolve; 
      s.onerror = reject; 
      document.head.appendChild(s);
    });
  }
}

// Export to Excel function
const exportToExcel = (data, headers, filename = "daily-updation") => {
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

// Utility Functions
const normalizeSupervisor = (name) => {
  if (!name) return '';
  return name.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
};

const findHeader = (headers, candidates) => {
  const normalizedHeaders = headers.map(h => normalizeSupervisor(h));
  const normalizedCandidates = candidates.map(c => normalizeSupervisor(c));
  
  const index = normalizedCandidates
    .map(candidate => normalizedHeaders.indexOf(candidate))
    .find(idx => idx !== -1);
  
  return index !== undefined && index !== -1 ? headers[index] : null;
};

const parseStatusData = (data) => {
  if (!data) return [];
  try {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Error parsing status data:', e);
    return [];
  }
};

const parseChallanData = (data) => {
  if (!data) return [];
  try {
    if (typeof data === 'string') {
      // Remove any extra quotes or escape characters
      const cleanedData = data.trim();
      if (cleanedData.startsWith('"') && cleanedData.endsWith('"')) {
        // Remove surrounding quotes
        return JSON.parse(cleanedData.slice(1, -1));
      }
      return JSON.parse(cleanedData);
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Error parsing challan data:', e, 'Data:', data);
    return [];
  }
};
// Enhanced Date Parsing
const parseDateSafe = (input) => {
  if (!input) return null;
  if (input instanceof Date && !isNaN(input)) return input;
  const s = String(input).trim();
  if (!s) return null;

  const d1 = new Date(s);
  if (!isNaN(d1)) return d1;

  const m1 = s.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{2,4})$/);
  if (m1) {
    const [_, dd, mm, yyyy] = m1;
    const y = Number(yyyy.length === 2 ? (Number(yyyy) + 2000) : yyyy);
    const d = new Date(y, Number(mm) - 1, Number(dd));
    return isNaN(d) ? null : d;
  }

  const m2 = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/);
  if (m2) {
    const monMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const dd = Number(m2[1]);
    const mon = monMap[m2[2].toLowerCase()];
    let y = Number(m2[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, mon, dd);
    return isNaN(d) ? null : d;
  }

  return null;
};

const daysBetween = (startDate, endDate) => {
  const start = parseDateSafe(startDate);
  const end = parseDateSafe(endDate);
  if (!start || !end) return 0;
  const ms = end.setHours(0,0,0,0) - start.setHours(0,0,0,0);
  const days = Math.ceil(ms / 86400000);
  return Math.max(0, days);
};

const calculateDaysSinceIssue = (dateOfIssue) => {
  if (!dateOfIssue) return 0;
  return daysBetween(dateOfIssue, new Date());
};

const calculateEmbPrintDays = (challanData) => {
  if (!challanData || !Array.isArray(challanData) || challanData.length === 0) {
    return { days: 0, status: 'No Challan' };
  }

  let earliestDate = null;
  let latestEmbUpdate = null;
  let hasAnyEmbCompleted = false;

  challanData.forEach((challan) => {
    if (challan.date) {
      const date = parseDateSafe(challan.date);
      if (date && (!earliestDate || date < earliestDate)) {
        earliestDate = date;
      }
    }

    if (challan.embUpdatedAt) {
      const embDate = parseDateSafe(challan.embUpdatedAt);
      if (embDate && (!latestEmbUpdate || embDate > latestEmbUpdate)) {
        latestEmbUpdate = embDate;
      }
    }

    if (challan.embCompleted) {
      hasAnyEmbCompleted = true;
    }
  });

  if (!earliestDate) {
    return { days: 0, status: 'No Valid Dates' };
  }

  let endDate, status;

  if (latestEmbUpdate) {
    endDate = latestEmbUpdate;
    status = 'Completed';
  } else {
    endDate = new Date();
    status = hasAnyEmbCompleted ? 'Partial Complete' : 'Pending';
  }

  const diffDays = daysBetween(earliestDate, endDate);

  return { 
    days: diffDays, 
    status,
    firstDate: earliestDate,
    lastUpdate: endDate
  };
};

const isStatusUpdatedToday = (wipData) => {
  if (!wipData || wipData.length === 0) return false;
  
  const today = new Date().toDateString();
  return wipData.some(status => {
    if (!status.timestamp) return false;
    const statusDate = new Date(status.timestamp).toDateString();
    return statusDate === today;
  });
};

const getLatestStatus = (statusData) => {
  if (!statusData || statusData.length === 0) return { status: '', timestamp: null };
  return statusData[statusData.length - 1];
};

const getLatestCompleteStatus = (completeData) => {
  if (!completeData || !Array.isArray(completeData) || completeData.length === 0) {
    return { status: '', timestamp: null };
  }
  
  // Get the latest completion status
  const latest = completeData[completeData.length - 1];
  
  // Check if there's a "Complete Lot" status
  const completeLotStatus = completeData.find(item => item.status === 'Complete Lot');
  
  return completeLotStatus || latest;
};

const groupStatusUpdates = (wipData) => {
  const statuses = parseStatusData(wipData);
  if (statuses.length === 0) return [];
  
  const grouped = [];
  let currentGroup = {
    status: statuses[0].status,
    count: 1,
    firstTimestamp: statuses[0].timestamp,
    lastTimestamp: statuses[0].timestamp,
    isToday: new Date(statuses[0].timestamp).toDateString() === new Date().toDateString()
  };
  
  for (let i = 1; i < statuses.length; i++) {
    const isToday = new Date(statuses[i].timestamp).toDateString() === new Date().toDateString();
    
    if (statuses[i].status === currentGroup.status) {
      currentGroup.count++;
      currentGroup.lastTimestamp = statuses[i].timestamp;
      if (isToday) currentGroup.isToday = true;
    } else {
      grouped.push(currentGroup);
      currentGroup = {
        status: statuses[i].status,
        count: 1,
        firstTimestamp: statuses[i].timestamp,
        lastTimestamp: statuses[i].timestamp,
        isToday: isToday
      };
    }
  }
  
  grouped.push(currentGroup);
  return grouped.reverse();
};

// Enhanced Components
const StatusTimeline = ({ wipData }) => {
  const groupedStatuses = groupStatusUpdates(wipData);
  const recentStatuses = groupedStatuses.slice(0, 3);

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <div className="timeline-icon">📊</div>
        <h4 className="timeline-title">Recent WIP Updates</h4>
      </div>
      <div className="timeline-content">
        {recentStatuses.map((statusGroup, index) => (
          <div key={index} className="timeline-item">
            <div 
              className="timeline-dot"
              style={{ backgroundColor: getStatusColor(statusGroup.status) }}
            ></div>
            <div className="timeline-content">
              <div className="timeline-status">
                {statusGroup.status} 
                {statusGroup.count > 1 && (
                  <span className="status-count"> ×{statusGroup.count}</span>
                )}
                {statusGroup.isToday && (
                  <span className="today-indicator"> • Today</span>
                )}
              </div>
              <div className="timeline-date">
                Last: {new Date(statusGroup.lastTimestamp).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
        {recentStatuses.length === 0 && (
          <div className="no-status">No WIP updates recorded</div>
        )}
      </div>
    </div>
  );
};

const UpdateIndicator = ({ wipData, dateOfIssue, challanData, totalPCS, completeStatus }) => {
  const wipStatuses = parseStatusData(wipData);
  const daysSinceIssue = calculateDaysSinceIssue(dateOfIssue);
  const isUpdatedToday = isStatusUpdatedToday(wipStatuses);
  const latestWipStatus = getLatestStatus(wipStatuses);
  const embPrintInfo = calculateEmbPrintDays(challanData);

  // Hide today's update badge if lot is completed
  const showUpdateBadge = !(completeStatus && (completeStatus.status === 'Complete Lot'));

  return (
    <div className="indicator-container">
      <div className="indicator-grid">
        <div className="indicator-card">
          <div className="indicator-icon">📅</div>
          <div className="indicator-content">
            <div className="indicator-label">Stitching Days</div>
            <div 
              className="days-badge"
              style={{
                backgroundColor: daysSinceIssue > 7 ? '#fee2e2' : 
                              daysSinceIssue > 3 ? '#fef3c7' : '#d1fae5',
                color: daysSinceIssue > 7 ? '#dc2626' : 
                      daysSinceIssue > 3 ? '#d97706' : '#059669'
              }}
            >
              {daysSinceIssue} days
            </div>
          </div>
        </div>
        
        {showUpdateBadge && (
          <div className="indicator-card">
            <div className="indicator-icon">🔄</div>
            <div className="indicator-content">
              <div className="indicator-label">Today's Update</div>
              <div 
                className="update-badge"
                style={{
                  backgroundColor: isUpdatedToday ? '#d1fae5' : '#fee2e2',
                  color: isUpdatedToday ? '#059669' : '#dc2626'
                }}
              >
                {isUpdatedToday ? '✅ Updated' : '⏳ Pending'}
              </div>
            </div>
          </div>
        )}
        
        <div className="indicator-card">
          <div className="indicator-icon">📝</div>
          <div className="indicator-content">
            <div className="indicator-label">Current Status</div>
            <div 
              className="status-badge"
              style={{
                backgroundColor: getStatusBackground(latestWipStatus.status),
                color: getStatusColor(latestWipStatus.status),
                border: `1px solid ${getStatusColor(latestWipStatus.status)}25`
              }}
            >
              {latestWipStatus.status || 'Not Started'}
            </div>
          </div>
        </div>

        <div className="indicator-card">
          <div className="indicator-icon">🏷️</div>
          <div className="indicator-content">
            <div className="indicator-label">Emb/Print Days</div>
            <div 
              className="emb-badge"
              style={{
                backgroundColor: embPrintInfo.status === 'Pending' ? '#fef3c7' : 
                               embPrintInfo.status === 'Partial Complete' ? '#dbeafe' :
                               embPrintInfo.status === 'Completed' ? '#d1fae5' : '#e0e7ff',
                color: embPrintInfo.status === 'Pending' ? '#d97706' : 
                      embPrintInfo.status === 'Partial Complete' ? '#1e40af' :
                      embPrintInfo.status === 'Completed' ? '#059669' : '#3b82f6'
              }}
            >
              {embPrintInfo.days} days ({embPrintInfo.status})
            </div>
          </div>
        </div>

        <div className="indicator-card">
          <div className="indicator-icon">🔢</div>
          <div className="indicator-content">
            <div className="indicator-label">Total PCS</div>
            <div 
              className="pcs-badge"
              style={{
                backgroundColor: totalPCS > 0 ? '#d1fae5' : '#f3f4f6',
                color: totalPCS > 0 ? '#059669' : '#6b7280',
              }}
            >
              {totalPCS > 0 ? totalPCS.toLocaleString() : 'N/A'}
            </div>
          </div>
        </div>

        {completeStatus && completeStatus.status && (
          <div className="indicator-card">
            <div className="indicator-icon">✅</div>
            <div className="indicator-content">
              <div className="indicator-label">Completion Status</div>
              <div 
                className="complete-badge"
                style={{
                  backgroundColor: completeStatus.status === 'Complete Lot' ? '#d1fae5' : '#fef3c7',
                  color: completeStatus.status === 'Complete Lot' ? '#059669' : '#d97706',
                  fontWeight: '600'
                }}
              >
                {completeStatus.status}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Dynamic Filter Components
const StatusFilter = ({ statusFilter, setStatusFilter, enhancedRows }) => {
  const uniqueStatuses = useMemo(() => {
    const statuses = enhancedRows
      .map(row => row.latestWipStatus)
      .filter(status => status && status.trim() !== '');
    
    return [...new Set(statuses)].sort();
  }, [enhancedRows]);

  return (
    <div className="filter-group">
      <label className="filter-label">WIP Status</label>
      <select 
        value={statusFilter} 
        onChange={(e) => setStatusFilter(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Status ({uniqueStatuses.length})</option>
        {uniqueStatuses.map(status => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </div>
  );
};

const GarmentTypeFilter = ({ garmentTypeFilter, setGarmentTypeFilter, enhancedRows }) => {
  const uniqueGarmentTypes = useMemo(() => {
    const types = enhancedRows
      .map(row => row['Garment Type'])
      .filter(type => type && type.trim() !== '');
    
    return [...new Set(types)].sort();
  }, [enhancedRows]);

  return (
    <div className="filter-group">
      <label className="filter-label">Garment Type</label>
      <select 
        value={garmentTypeFilter} 
        onChange={(e) => setGarmentTypeFilter(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Types ({uniqueGarmentTypes.length})</option>
        {uniqueGarmentTypes.map(type => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </div>
  );
};

const CategoryFilter = ({ categoryFilter, setCategoryFilter, enhancedRows }) => {
  const uniqueCategories = useMemo(() => {
    const categories = enhancedRows
      .map(row => row.category)
      .filter(cat => cat && cat.trim() !== '' && cat !== 'N/A');
    
    return [...new Set(categories)].sort();
  }, [enhancedRows]);

  return (
    <div className="filter-group">
      <label className="filter-label">Category</label>
      <select 
        value={categoryFilter} 
        onChange={(e) => setCategoryFilter(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Categories ({uniqueCategories.length})</option>
        {uniqueCategories.map(cat => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
    </div>
  );
};

const BrandFilter = ({ brandFilter, setBrandFilter, enhancedRows }) => {
  const uniqueBrands = useMemo(() => {
    const brands = enhancedRows
      .map(row => row['BRAND'])
      .filter(brand => brand && brand.trim() !== '');
    
    return [...new Set(brands)].sort();
  }, [enhancedRows]);

  return (
    <div className="filter-group">
      <label className="filter-label">Brand</label>
      <select 
        value={brandFilter} 
        onChange={(e) => setBrandFilter(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Brands ({uniqueBrands.length})</option>
        {uniqueBrands.map(brand => (
          <option key={brand} value={brand}>
            {brand}
          </option>
        ))}
      </select>
    </div>
  );
};

const FabricFilter = ({ fabricFilter, setFabricFilter, enhancedRows }) => {
  const uniqueFabrics = useMemo(() => {
    const fabrics = enhancedRows
      .map(row => row['Fabric'])
      .filter(fabric => fabric && fabric.trim() !== '');
    
    return [...new Set(fabrics)].sort();
  }, [enhancedRows]);

  return (
    <div className="filter-group">
      <label className="filter-label">Fabric</label>
      <select 
        value={fabricFilter} 
        onChange={(e) => setFabricFilter(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Fabrics ({uniqueFabrics.length})</option>
        {uniqueFabrics.map(fabric => (
          <option key={fabric} value={fabric}>
            {fabric}
          </option>
        ))}
      </select>
    </div>
  );
};

const CompletionFilter = ({ completionFilter, setCompletionFilter, enhancedRows }) => {
  const uniqueCompletionStatuses = useMemo(() => {
    const statuses = enhancedRows
      .map(row => row.completionStatus)
      .filter(status => status && status.trim() !== '');
    
    return [...new Set(statuses)].sort();
  }, [enhancedRows]);

  return (
    <div className="filter-group">
      <label className="filter-label">Completion Status</label>
      <select 
        value={completionFilter} 
        onChange={(e) => setCompletionFilter(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Status</option>
        <option value="partial">Partial Pending</option>
        <option value="complete">Complete Lot</option>
        <option value="pending">Pending (Blank)</option>
      </select>
    </div>
  );
};

function DailyUpdationSystem({ supervisor, onNavigate }) {
  const [sheetData, setSheetData] = useState([]);
  const [cuttingData, setCuttingData] = useState([]);
  const [indexData, setIndexData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [headers, setHeaders] = useState([]);
  
  // Dynamic Filter states
  const [statusFilter, setStatusFilter] = useState('all');
  const [garmentTypeFilter, setGarmentTypeFilter] = useState('all');
  const [updateFilter, setUpdateFilter] = useState('all');
  const [dateRangeFilter, setDateRangeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [fabricFilter, setFabricFilter] = useState('all');
  const [completionFilter, setCompletionFilter] = useState('pending'); // Default to Partial Pending
// Add back button handler
const handleBackClick = () => {
  // Navigate to /#/welcome path
  window.location.href = '/#/Welcome';
};


  // Fetch data from Google Sheets
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const [indexResponse, cuttingResponse, mainDataResponse] = await Promise.allSettled([
          fetchSheet({
            sheetId: GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID,
            range: "Index!A:L",
            apiKey: GOOGLE_SHEETS_CONFIG.API_KEY
          }),
          fetchSheet({
            sheetId: GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID, 
            range: GOOGLE_SHEETS_CONFIG.CUTTING_RANGE,
            apiKey: GOOGLE_SHEETS_CONFIG.API_KEY
          }),
          fetchSheet({
            sheetId: GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID,
            range: GOOGLE_SHEETS_CONFIG.RANGE,
            apiKey: GOOGLE_SHEETS_CONFIG.API_KEY
          })
        ]);

        let indexValues = [];
        let cuttingValues = [];
        let mainValues = [];

        if (indexResponse.status === 'fulfilled' && indexResponse.value.values) {
          indexValues = indexResponse.value.values;
        }

        if (cuttingResponse.status === 'fulfilled' && cuttingResponse.value.values) {
          cuttingValues = cuttingResponse.value.values;
        }

        if (mainDataResponse.status === 'fulfilled' && mainDataResponse.value.values) {
          mainValues = mainDataResponse.value.values;
          
          const sheetHeaders = mainValues[0];
          const rows = mainValues.slice(1).map((row, index) => {
            const rowData = {};
            sheetHeaders.forEach((header, colIndex) => {
              rowData[header] = row[colIndex] || '';
            });
            return {
              id: index,
              ...rowData
            };
          });

          setHeaders(sheetHeaders);
          setSheetData(rows);
        } else {
          throw new Error('Failed to fetch main data');
        }

        setIndexData(indexValues);
        setCuttingData(cuttingValues);
        
      } catch (err) {
        console.error('Error fetching sheet data:', err);
        setError(err.message);
        const mockData = getMockData();
        setSheetData(mockData);
        setHeaders(mockData.length > 0 ? Object.keys(mockData[0]) : []);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Parse index data to get lot information for PCS calculation
  const indexMap = useMemo(() => {
    const map = new Map();
    if (!indexData || indexData.length === 0) return map;

    const idxHeader = indexData[0] || [];
    for (let i = 1; i < indexData.length; i++) {
      const entry = parseIndexRow(idxHeader, indexData[i]);
      if (entry) {
        map.set(entry.lot, entry);
      }
    }
    return map;
  }, [indexData]);

  // Calculate PCS for each lot
  const calculatePCSForLot = useCallback((lotNumber) => {
    if (!lotNumber) return 0;

    const normalizedLot = normalizeLotNumber(lotNumber);
    const indexEntry = indexMap.get(normalizedLot);
    if (!indexEntry || !cuttingData.length) return 0;

    const window = sliceCuttingMatrix(cuttingData, indexEntry.startRow, indexEntry.numRows);
    return calculateTotalPCS(window, indexEntry.sizes);
  }, [indexMap, cuttingData]);

  // Find supervisor header
  const supervisorHeaderKey = useMemo(() => {
    return findHeader(headers, ["supervisor", "supervisor name", "username", "user", "enteredby"]);
  }, [headers]);

  // Filter data based on current supervisor
  const supervisorData = useMemo(() => {
    if (!supervisor || !supervisorHeaderKey) return sheetData;
    
    const currentSupervisorNormalized = normalizeSupervisor(supervisor.name || supervisor.username);
    
    return sheetData.filter(row => {
      const rowSupervisor = row[supervisorHeaderKey];
      if (!rowSupervisor) return false;
      
      const rowSupervisorNormalized = normalizeSupervisor(rowSupervisor);
      return rowSupervisorNormalized === currentSupervisorNormalized;
    });
  }, [sheetData, supervisor, supervisorHeaderKey]);

  const calculateDaysMoreThanPlanned = (stitchingDays) => {
    const plannedDays = 15;
    return Math.max(0, stitchingDays - plannedDays);
  };

  const calculateTotalDays = (stitchingDays, embPrintDays) => {
    return stitchingDays + embPrintDays;
  };

  // Enhanced row data with status calculations and PCS
  const enhancedRows = useMemo(() => {
    const getChallanData = (row) => {
      const challanKeys = Object.keys(row).filter(key => 
        key.toLowerCase().trim() === 'challan history'
      );
      return challanKeys.length > 0 ? row[challanKeys[0]] : undefined;
    };

    return supervisorData.map(row => {
      const wipData = parseStatusData(row['WIP Status']);
      const completeData = parseStatusData(row['Completed Status']);
      const challanRawData = getChallanData(row);
      const challanParsedData = parseChallanData(challanRawData);
      const latestWipStatus = getLatestStatus(wipData);
      const latestCompleteStatus = getLatestCompleteStatus(completeData);
      const daysSinceIssue = calculateDaysSinceIssue(row['Date of Issue']);
      const isUpdatedToday = isStatusUpdatedToday(wipData);
      const embPrintInfo = calculateEmbPrintDays(challanParsedData);
      const category = row['M/W/K'] || 'N/A';
      const totalPCS = calculatePCSForLot(row['Lot Number']);
      
      // New calculations
      const daysMoreThanPlanned = calculateDaysMoreThanPlanned(daysSinceIssue);
      const totalDays = calculateTotalDays(daysSinceIssue, embPrintInfo.days);

      // Get complete date
      let completeDate = '';
      let completionStatus = '';
      if (completeData && Array.isArray(completeData) && completeData.length > 0) {
        const latestComplete = completeData[completeData.length - 1];
        completionStatus = latestComplete.status || '';
        
        // Find if there's a "Complete Lot" status
        const completeLotStatus = completeData.find(item => item.status === 'Complete Lot');
        if (completeLotStatus && completeLotStatus.timestamp) {
          const date = new Date(completeLotStatus.timestamp);
          completeDate = date.toLocaleDateString('en-GB'); // Format: DD/MM/YYYY
        }
      }

      // Determine if we should show today's update badge
      const showUpdateBadge = !(latestCompleteStatus && latestCompleteStatus.status === 'Complete Lot');

      return {
        ...row,
        wipData,
        completeData,
        challanData: challanParsedData,
        latestWipStatus: latestWipStatus.status,
        latestCompleteStatus: latestCompleteStatus.status,
        completionStatus, // Store completion status for filtering
        daysSinceIssue,
        isUpdatedToday: showUpdateBadge ? isUpdatedToday : false, // Hide badge for completed lots
        embPrintDays: embPrintInfo.days,
        embPrintStatus: embPrintInfo.status,
        category,
        totalPCS,
        daysMoreThanPlanned,
        totalDays,
        completeDate: completeDate || (completionStatus === 'Complete Lot' ? 'Completed' : 'Pending'),
        showUpdateBadge,
        statusColor: getStatusColor(latestWipStatus.status),
        statusBackground: getStatusBackground(latestWipStatus.status)
      };
    });
  }, [supervisorData, calculatePCSForLot]);

  // Apply all filters
  useEffect(() => {
    let filtered = enhancedRows;

    // Search filter
    if (searchTerm.trim()) {
      filtered = filtered.filter(row => 
        Object.values(row).some(value => 
          value && value.toString().toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(row => 
        row.latestWipStatus.toLowerCase().includes(statusFilter.toLowerCase())
      );
    }

    // Update filter - skip for completed lots
    if (updateFilter !== 'all') {
      filtered = filtered.filter(row => {
        if (!row.showUpdateBadge) return false; // Hide completed lots from update filter
        
        if (updateFilter === 'updated') return row.isUpdatedToday;
        if (updateFilter === 'pending') return !row.isUpdatedToday;
        return true;
      });
    }

    // Garment type filter
    if (garmentTypeFilter !== 'all') {
      filtered = filtered.filter(row => 
        row['Garment Type']?.toLowerCase().includes(garmentTypeFilter.toLowerCase())
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(row => 
        row.category?.toLowerCase().includes(categoryFilter.toLowerCase())
      );
    }

    // Brand filter
    if (brandFilter !== 'all') {
      filtered = filtered.filter(row => 
        row['BRAND']?.toLowerCase().includes(brandFilter.toLowerCase())
      );
    }

    // Fabric filter
    if (fabricFilter !== 'all') {
      filtered = filtered.filter(row => 
        row['Fabric']?.toLowerCase().includes(fabricFilter.toLowerCase())
      );
    }

    // Completion Status filter
    if (completionFilter !== 'all') {
      filtered = filtered.filter(row => {
        const completionStatus = row.completionStatus || '';
        
        switch (completionFilter) {
          case 'partial':
            return completionStatus === 'Partially Pending' || completionStatus === 'Partial Pending';
          case 'complete':
            return completionStatus === 'Complete Lot';
          case 'pending':
            return !completionStatus || completionStatus.trim() === '';
          default:
            return true;
        }
      });
    }

    // Date range filter
    if (dateRangeFilter !== 'all') {
      const today = new Date();
      filtered = filtered.filter(row => {
        const issueDate = parseDateSafe(row['Date of Issue']);
        if (!issueDate) return false;
        
        const diffDays = daysBetween(issueDate, today);
        
        switch (dateRangeFilter) {
          case 'today':
            return diffDays === 0;
          case 'week':
            return diffDays <= 7;
          case 'month':
            return diffDays <= 30;
          default:
            return true;
        }
      });
    }

    setFilteredData(filtered);
  }, [
    searchTerm, enhancedRows, statusFilter, updateFilter, 
    garmentTypeFilter, dateRangeFilter, categoryFilter, 
    brandFilter, fabricFilter, completionFilter
  ]);

  // Stats calculations with PCS
  const stats = useMemo(() => {
    const totalLots = enhancedRows.length;
    const updatedToday = enhancedRows.filter(row => row.isUpdatedToday).length;
    const pendingUpdate = enhancedRows.filter(row => !row.isUpdatedToday && row.showUpdateBadge).length;
    const averageDays = enhancedRows.length > 0 
      ? Math.round(enhancedRows.reduce((sum, row) => sum + row.daysSinceIssue, 0) / enhancedRows.length)
      : 0;
    const totalPCS = enhancedRows.reduce((sum, row) => sum + (row.totalPCS || 0), 0);
    const lotsWithPCS = enhancedRows.filter(row => row.totalPCS > 0).length;
    
    // Completion stats
    const completedLots = enhancedRows.filter(row => row.completionStatus === 'Complete Lot').length;
    const partialPendingLots = enhancedRows.filter(row => 
      row.completionStatus === 'Partially Pending' || row.completionStatus === 'Partial Pending'
    ).length;
    const pendingLots = enhancedRows.filter(row => !row.completionStatus || row.completionStatus.trim() === '').length;

    // Status distribution
    const statusDistribution = enhancedRows.reduce((acc, row) => {
      const status = row.latestWipStatus || 'Not Started';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return {
      totalLots,
      updatedToday,
      pendingUpdate,
      averageDays,
      totalPCS,
      lotsWithPCS,
      completedLots,
      partialPendingLots,
      pendingLots,
      statusDistribution
    };
  }, [enhancedRows]);

  const handleRowClick = (row) => {
    setSelectedRow(selectedRow?.id === row.id ? null : row);
  };

  const refreshData = () => {
    window.location.reload();
  };

  const downloadAllPDF = async () => {
    // Updated headers with Complete Lot column
    const headers = [
      'Lot Number', 'Garment Type', 'Category', 'Brand', 'Fabric', 'Total PCS', 
      'Stitching Days', 'Emb/Print Days', 'Total Days', 'Days More Than Planned', 
      'Current Status', 'Complete Lot Date'  // New column added
    ];
    
    // Map the data according to the new header order
    const data = filteredData.map(row => {
      // Find the completion date from Completed Status
      let completeDate = '';
      if (row.completeData && Array.isArray(row.completeData) && row.completeData.length > 0) {
        // Find "Complete Lot" status
        const completeLotStatus = row.completeData.find(item => item.status === 'Complete Lot');
        if (completeLotStatus && completeLotStatus.timestamp) {
          // Format the date
          const date = new Date(completeLotStatus.timestamp);
          completeDate = date.toLocaleDateString('en-GB'); // Format: DD/MM/YYYY
        } else {
          // If no "Complete Lot" but has other status, show the latest status
          const latestComplete = row.completeData[row.completeData.length - 1];
          completeDate = latestComplete.status || 'Pending';
        }
      } else {
        completeDate = 'Pending';
      }
      
      return {
        'Lot Number': row['Lot Number'] || 'N/A',
        'Garment Type': row['Garment Type'] || 'N/A',
        'Category': row.category || 'N/A',
        'Brand': row['BRAND'] || 'N/A',
        'Fabric': row['Fabric'] || 'N/A',
        'Total PCS': row.totalPCS > 0 ? row.totalPCS.toLocaleString() : 'N/A',
        'Stitching Days': row.daysSinceIssue,
        'Emb/Print Days': row.embPrintDays,
        'Total Days': row.totalDays,
        'Days More Than Planned': row.daysMoreThanPlanned > 0 ? `+${row.daysMoreThanPlanned}` : '-',
        'Current Status': row.latestWipStatus === 'Not Started' ? '' : row.latestWipStatus,
        'Complete Lot Date': completeDate || 'Pending'
      };
    });

    // Calculate total PCS for display at top
    const totalPCS = filteredData.reduce((sum, row) => sum + (row.totalPCS || 0), 0);
    
    await exportToPDF(data, headers, 'supervisor-report', totalPCS, supervisor);
  };

  const downloadCompleteLotPDF = async () => {
    // Filter only Complete Lot rows
    const completeRows = enhancedRows.filter(row => row.completionStatus === 'Complete Lot');
    
    const headers = [
      'Lot Number', 'Garment Type', 'Category', 'Brand', 'Fabric', 'Total PCS', 
      'Stitching Days', 'Emb/Print Days', 'Total Days', 'Days More Than Planned', 
      'Current Status', 'Complete Date'
    ];
    
    const data = completeRows.map(row => {
      let completeDate = '';
      if (row.completeData && Array.isArray(row.completeData) && row.completeData.length > 0) {
        const completeLotStatus = row.completeData.find(item => item.status === 'Complete Lot');
        if (completeLotStatus && completeLotStatus.timestamp) {
          const date = new Date(completeLotStatus.timestamp);
          completeDate = date.toLocaleDateString('en-GB');
        }
      }
      
      return {
        'Lot Number': row['Lot Number'] || 'N/A',
        'Garment Type': row['Garment Type'] || 'N/A',
        'Category': row.category || 'N/A',
        'Brand': row['BRAND'] || 'N/A',
        'Fabric': row['Fabric'] || 'N/A',
        'Total PCS': row.totalPCS > 0 ? row.totalPCS.toLocaleString() : 'N/A',
        'Stitching Days': row.daysSinceIssue,
        'Emb/Print Days': row.embPrintDays,
        'Total Days': row.totalDays,
        'Days More Than Planned': row.daysMoreThanPlanned > 0 ? `+${row.daysMoreThanPlanned}` : '-',
        'Current Status': row.latestWipStatus === 'Not Started' ? '' : row.latestWipStatus,
        'Complete Date': completeDate || 'Completed'
      };
    });

    const totalPCS = completeRows.reduce((sum, row) => sum + (row.totalPCS || 0), 0);
    
    await exportToPDF(data, headers, 'complete-lot-report', totalPCS, supervisor);
  };

  const downloadPartialPendingPDF = async () => {
    // Filter only Partial Pending rows
    const partialRows = enhancedRows.filter(row => 
      row.completionStatus === 'Partially Pending' || row.completionStatus === 'Partial Pending'
    );
    
    const headers = [
      'Lot Number', 'Garment Type', 'Category', 'Brand', 'Fabric', 'Total PCS', 
      'Stitching Days', 'Emb/Print Days', 'Total Days', 'Days More Than Planned', 
      'Current Status', 'Completion Status'
    ];
    
    const data = partialRows.map(row => ({
      'Lot Number': row['Lot Number'] || 'N/A',
      'Garment Type': row['Garment Type'] || 'N/A',
      'Category': row.category || 'N/A',
      'Brand': row['BRAND'] || 'N/A',
      'Fabric': row['Fabric'] || 'N/A',
      'Total PCS': row.totalPCS > 0 ? row.totalPCS.toLocaleString() : 'N/A',
      'Stitching Days': row.daysSinceIssue,
      'Emb/Print Days': row.embPrintDays,
      'Total Days': row.totalDays,
      'Days More Than Planned': row.daysMoreThanPlanned > 0 ? `+${row.daysMoreThanPlanned}` : '-',
      'Current Status': row.latestWipStatus === 'Not Started' ? '' : row.latestWipStatus,
      'Completion Status': row.completionStatus || 'Pending'
    }));

    const totalPCS = partialRows.reduce((sum, row) => sum + (row.totalPCS || 0), 0);
    
    await exportToPDF(data, headers, 'partial-pending-report', totalPCS, supervisor);
  };

  const exportToPDF = async (data, headers, filename = "supervisor-report", totalPCS = 0, supervisor = null) => {
    try {
      await ensureJsPDF();
      const { jsPDF } = window.jspdf;

      const isWide = headers.length > 8;
      const doc = new jsPDF({
        orientation: isWide ? "landscape" : "portrait",
        unit: "pt",
        format: "A4",
      });

      // Company/Report Header
      const margin = 36;
      const pageWidth = doc.internal.pageSize.getWidth();
      
      // Header with gradient background
      const headerHeight = 80;
      doc.setFillColor(41, 128, 185);
      doc.rect(0, 0, pageWidth, headerHeight, 'F');
      
      // Report Title with Supervisor Name
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(255, 255, 255);
      doc.text("SUPERVISOR REPORT", pageWidth / 2, 30, { align: "center" });
      
      // Supervisor Name
      doc.setFont("helvetica", "normal");
      doc.setFontSize(16);
      doc.text(supervisor?.name || 'Supervisor', pageWidth / 2, 50, { align: "center" });
      
      // Report Details
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, headerHeight + 10, pageWidth - (margin * 2), 60, 'F');
      
      doc.setFontSize(10);
      doc.setTextColor(51, 51, 51);
      let yPos = headerHeight + 30;
      
      // Line 1: Generated date and Total PCS
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`, margin + 10, yPos);
      
      doc.text(`Total PCS: ${totalPCS.toLocaleString()}`, pageWidth - margin - 150, yPos);
      
      yPos += 15;
      // Line 2: Report ID and Total Records
      doc.text(`Report ID: PD-${new Date().getTime().toString().slice(-8)}`, margin + 10, yPos);
      doc.text(`Total Records: ${data.length}`, pageWidth - margin - 150, yPos);
      
      yPos += 15;
      // Line 3: Generated By
      doc.text(`Generated By: ${supervisor?.name || 'System'}`, margin + 10, yPos);

      // Table with professional styling and BLACK BORDERS - Your Original Design
      const tableHeaders = [headers];
      const tableData = data.map(row => headers.map(h => (row[h] ?? "").toString()));

      doc.autoTable({
        head: tableHeaders,
        body: tableData,
        startY: headerHeight + 80,
        margin: { left: margin, right: margin },
        styles: { 
          font: "helvetica", 
          fontSize: 9, 
          cellPadding: 8,
          overflow: "linebreak",
          lineColor: [0, 0, 0], // BLACK BORDERS
          lineWidth: 0.5, // Slightly thicker black borders
          textColor: [0, 0, 0] // Default black text for all cells
        },
        headStyles: { 
          fillColor: [52, 73, 94],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 10,
          cellPadding: 10,
          lineColor: [0, 0, 0], // BLACK BORDERS for header
          lineWidth: 0.5
        },
        alternateRowStyles: { 
          fillColor: [248, 248, 248],
          lineColor: [0, 0, 0], // BLACK BORDERS for rows
          lineWidth: 0.5
        },
        columnStyles: {
          0: { // Lot Number
            fontStyle: 'bold',
            cellWidth: 'auto',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          1: { 
            cellWidth: 'auto',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          2: { 
            cellWidth: 'auto',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          3: { 
            cellWidth: 'auto',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          4: { 
            cellWidth: 'auto',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          5: { // Total PCS
            halign: 'right',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          6: { // Stitching Days
            halign: 'center',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          7: { // Emb/Print Days
            halign: 'center',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          8: { // Total Days
            halign: 'center',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          9: { // Days More Than Planned
            halign: 'center',
            fontStyle: 'bold',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          10: { // Current Status
            fontStyle: 'bold',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          },
          11: { // Complete Lot Date
            halign: 'center',
            lineColor: [0, 0, 0],
            lineWidth: 0.5
          }
        },
        theme: 'grid',
        didParseCell: (data) => {
          // Set BLACK BORDERS for all cells
          data.cell.styles.lineColor = [0, 0, 0];
          data.cell.styles.lineWidth = 0.5;
          
          if (data.section === 'head') {
            // Reduce font size specifically for "Days More Than Planned" header
            if (data.cell.raw === 'Days More Than Planned') {
              data.cell.styles.fontSize = 8;
            }
          }
          
          if (data.section === 'body') {
            // Add subtle row striping
            if (data.row.index % 2 === 0) {
              data.cell.styles.fillColor = [248, 248, 248];
            } else {
              data.cell.styles.fillColor = [255, 255, 255];
            }
            
            // Apply conditional formatting for Stitching Days (column index 6)
            if (data.column.index === 6) {
              const days = parseInt(data.cell.raw);
              if (!isNaN(days)) {
                // Set background colors based on days
                if (days >= 1 && days <= 6) {
                  data.cell.styles.fillColor = [220, 252, 231]; // Light green
                } else if (days >= 7 && days <= 15) {
                  data.cell.styles.fillColor = [254, 252, 232]; // Light yellow
                } else if (days > 15) {
                  data.cell.styles.fillColor = [254, 226, 226]; // Light red
                }
                // Keep text black for stitching days
                data.cell.styles.textColor = [0, 0, 0];
              }
            }
            
            // Apply red text for specific columns
            if (data.column.index === 0 || data.column.index === 9 || data.column.index === 10) {
              data.cell.styles.textColor = [220, 38, 38]; // Red-600
              data.cell.styles.fontStyle = 'bold';
            }
            
            // Reduce font size for "Days More Than Planned" content
            if (data.column.index === 9) {
              data.cell.styles.fontSize = 8;
            }
            
            // Format for Complete Lot Date column (index 11)
            if (data.column.index === 11) {
              const cellValue = data.cell.raw;
              if (cellValue && cellValue !== 'Pending' && cellValue !== 'Completed') {
                // It's a date, show in green
                data.cell.styles.textColor = [34, 197, 94]; // Green-500 for dates
                data.cell.styles.fontStyle = 'bold';
              } else if (cellValue === 'Completed') {
                data.cell.styles.textColor = [34, 197, 94]; // Green
                data.cell.styles.fontStyle = 'bold';
              } else {
                data.cell.styles.textColor = [107, 114, 128]; // Gray-500 for pending
              }
            }
          }
        },
        didDrawPage: (data) => {
          const pageSize = doc.internal.pageSize;
          const pageWidth = pageSize.getWidth();
          const pageHeight = pageSize.getHeight();
          
          // Footer
          doc.setFontSize(8);
          doc.setTextColor(128, 128, 128);
          
          // Footer border in black
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(0.5);
          doc.line(margin, pageHeight - 30, pageWidth - margin, pageHeight - 30);
          
          // Footer content
          const footerY = pageHeight - 15;
          doc.text(`Supervisor Report | ${supervisor?.name || 'System'}`, margin, footerY);
          doc.text(`Page ${doc.internal.getNumberOfPages()} of ${data.totalPages}`, pageWidth - margin, footerY, { align: "right" });
        }
      });

      // Add summary page for large reports
      if (data.length > 50) {
        doc.addPage();
        doc.setFontSize(16);
        doc.setTextColor(41, 128, 185);
        doc.text("REPORT SUMMARY", margin, 50);
        
        doc.setFontSize(10);
        doc.setTextColor(51, 51, 51);
        
        let summaryY = 80;
        const stats = {
          'Supervisor': supervisor?.name || 'N/A',
          'Total Lots': data.length,
          'Total PCS': totalPCS.toLocaleString(),
          'Generated Date': new Date().toLocaleDateString(),
          'Report ID': `PD-${new Date().getTime().toString().slice(-8)}`
        };
        
        Object.entries(stats).forEach(([key, value]) => {
          doc.text(`${key}:`, margin + 10, summaryY);
          doc.text(`${value}`, margin + 150, summaryY);
          summaryY += 15;
        });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const supervisorName = supervisor?.name?.replace(/\s+/g, '-') || 'supervisor';
      doc.save(`${filename}-${timestamp}-${supervisorName}.pdf`);
    } catch (e) {
      console.error('PDF Generation Error:', e);
      alert("Failed to generate PDF. Please try again.");
    }
  };
const downloadIndividualPDF = async (row) => {
  try {
    await ensureJsPDF();
    const { jsPDF } = window.jspdf;
    
    // Extract data
    const lotNumber = row['Lot Number'] || 'N/A';
    const jobOrderDate = row['JobOrder Date'] ? new Date(row['JobOrder Date']).toLocaleDateString('en-GB') : 'N/A';
    const dateOfIssue = row['Date of Issue'] ? new Date(row['Date of Issue']).toLocaleDateString('en-GB') : 'Not Issued';
    const savedAt = row['Saved At'] ? new Date(row['Saved At']).toLocaleDateString('en-GB') : 'Not Started';
    const supervisor = row['Supervisor'] || 'N/A';
    const fabric = row['Fabric'] || 'N/A';
    const garmentType = row['Garment Type'] || 'N/A';
    const style = row['Style'] || 'N/A';
    const brand = row['BRAND'] || 'N/A';
    const partyName = row['PARTY NAME'] || 'N/A';
    const season = row['SEASON'] || 'N/A';
    const category = row['M/W/K'] || 'N/A';
    const sizes = row['Sizes'] || 'N/A';
    const directStitching = row['DIRECT STITCHING'] || 'no';
    const zipOrderDate = row['ZIP ORDER DATE'] ? new Date(row['ZIP ORDER DATE']).toLocaleDateString('en-GB') : 'Not Ordered';
    const zipReceivedDate = row['ZIP RECEIVED DATE'] ? new Date(row['ZIP RECEIVED DATE']).toLocaleDateString('en-GB') : 'Not Received';
    
    // Parse data
    const wipData = parseStatusData(row['WIP Status']);
    const completeData = parseStatusData(row['Completed Status']);
    const challanData = parseChallanData(row['CHALLAN HISTORY']);
    
    // Group WIP status by status and count consecutive days
    const groupedWipStatus = groupWipStatusByDays(wipData);
    
    // Get completion date from Complete Lot status
    const completionDate = getCompletionDate(completeData, savedAt);
    
    // Get cutting date (from Saved At column)
    const cuttingDate = savedAt !== 'Not Started' ? savedAt : 'Not Started';
    
    // Get stitching date from WIP status
    const stitchingDate = getStitchingDate(wipData, completeData);
    
    // Get embroidery/print dates from challans
    const embPrintInfo = getEmbPrintInfo(challanData);
    
    // Get last WIP status
    const latestWipStatus = groupedWipStatus.length > 0 ? groupedWipStatus[groupedWipStatus.length - 1] : null;

    // Create PDF
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "A4",
    });

    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - (margin * 2);
    
    let yPos = 50;

    // ============ HEADER ============
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("LOT PRODUCTION REPORT", pageWidth / 2, yPos, { align: "center" });
    
    doc.setFontSize(16);
    doc.text(`Lot Number: ${lotNumber}`, pageWidth / 2, yPos + 25, { align: "center" });
    
    // Header separator line
    doc.setLineWidth(1);
    doc.line(margin, yPos + 40, pageWidth - margin, yPos + 40);
    
    yPos += 60;

    // ============ BASIC INFORMATION IN BOX ============
    // Calculate box height based on content
    const basicInfoRows = 7; // Reduced from 8 since we removed Shades
    const boxHeight = (basicInfoRows * 18) + 40; // 40 for header and padding
    
    // Draw box
    doc.setLineWidth(1);
    doc.rect(margin, yPos, contentWidth, boxHeight, 'S');
    
    // Box header
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("BASIC INFORMATION", margin + 10, yPos + 20);
    
    // Box content - arranged in two columns
    const col1X = margin + 20;
    const col2X = margin + contentWidth / 2 + 10;
    
    const basicInfoLeft = [
      { label: 'Job Order Date', value: jobOrderDate },
      { label: 'Party Name', value: partyName },
      { label: 'Brand', value: brand },
      { label: 'Season', value: season },
      { label: 'Category', value: category },
      { label: 'Garment Type', value: garmentType },
      { label: 'Style', value: style }
    ];
    
    const basicInfoRight = [
      { label: 'Cutting Date', value: cuttingDate },
      { label: 'Supervisor', value: supervisor },
      { label: 'Date of Issue', value: dateOfIssue },
      { label: 'Direct Stitching', value: directStitching },
      { label: 'Sizes', value: sizes },
      { label: 'Fabric', value: fabric },
      { label: 'ZIP Status', value: `${zipOrderDate} / ${zipReceivedDate}` }
    ];
    
    doc.setFontSize(10);
    
    // Draw left column
    basicInfoLeft.forEach((item, index) => {
      const itemY = yPos + 40 + (index * 18);
      
      // Label
      doc.setFont("helvetica", "bold");
      doc.text(`${item.label}:`, col1X, itemY);
      
      // Value
      doc.setFont("helvetica", "normal");
      doc.text(item.value, col1X + 100, itemY);
    });
    
    // Draw right column
    basicInfoRight.forEach((item, index) => {
      const itemY = yPos + 40 + (index * 18);
      
      // Label
      doc.setFont("helvetica", "bold");
      doc.text(`${item.label}:`, col2X, itemY);
      
      // Value
      doc.setFont("helvetica", "normal");
      doc.text(item.value, col2X + 100, itemY);
    });
    
    yPos += boxHeight + 30;

    // ============ PRODUCTION TIMELINE ============
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("PRODUCTION TIMELINE", margin, yPos);
    
    yPos += 25;
    
    const timelineSteps = [
      { step: 'JOB ORDER', date: jobOrderDate },
      { step: 'CUTTING DATE', date: cuttingDate },
      { step: 'EMB/PRINT', date: embPrintInfo.summary || 'Pending' },
      { step: 'STITCHING ISSUE', date: dateOfIssue },
      // { step: 'STITCHING', date: stitchingDate },
      { step: 'COMPLETION', date: completionDate !== 'Not Completed' ? completionDate : 'Pending' }
    ];
    
    const timelineWidth = contentWidth;
    const stepWidth = timelineWidth / timelineSteps.length;
    const timelineY = yPos;
    
    // Draw timeline line
    doc.setLineWidth(1);
    doc.line(margin, timelineY + 15, margin + timelineWidth, timelineY + 15);
    
    // Draw timeline steps
    timelineSteps.forEach((step, index) => {
      const stepX = margin + (stepWidth * index) + (stepWidth / 2);
      const isCompleted = step.date !== 'N/A' && step.date !== 'Not Started' && step.date !== 'Pending';
      
      // Draw step circle
      doc.setLineWidth(1);
      if (isCompleted) {
        doc.setFillColor(0, 0, 0);
        doc.circle(stepX, timelineY + 15, 6, 'F');
      } else {
        doc.circle(stepX, timelineY + 15, 6, 'S');
      }
      
      // Draw step label
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(step.step, stepX, timelineY + 5, { align: "center" });
      
      // Draw date
      doc.setFontSize(8);
      doc.setFont("helvetica", isCompleted ? "bold" : "normal");
      let dateText = step.date;
      if (step.step === 'EMB/PRINT' && embPrintInfo.count > 0) {
        dateText = `${step.date}\n(${embPrintInfo.count} challans)`;
      }
      
      const dateLines = doc.splitTextToSize(dateText, stepWidth - 20);
      doc.text(dateLines, stepX, timelineY + 30, { align: "center" });
    });
    
    yPos += 60;

    // ============ WIP STATUS HISTORY ============
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("STITCHING WIP STATUS", margin, yPos);
    
    yPos += 20;
    
    if (groupedWipStatus.length > 0) {
      const wipTableData = groupedWipStatus.map((status) => {
        const date = new Date(status.firstTimestamp);
        const startDate = date.toLocaleDateString('en-GB');
        const duration = status.days > 1 ? `${status.days} days` : '1 day';
        
        return [
          startDate,
          status.status || 'N/A',
          duration,
          status.remarks || '-'
        ];
      });
      
      doc.autoTable({
        head: [['Start Date', 'Status', 'Duration', 'Remarks']],
        body: wipTableData,
        startY: yPos,
        margin: { left: margin, right: margin },
        styles: { 
          font: "helvetica", 
          fontSize: 9, 
          cellPadding: 5,
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          textColor: [0, 0, 0]
        },
        headStyles: { 
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          fontSize: 10,
          cellPadding: 6,
          lineColor: [0, 0, 0],
          lineWidth: 0.5,
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 80, halign: 'center' },
          1: { cellWidth: 100, halign: 'center' },
          2: { cellWidth: 60, halign: 'center' },
          3: { cellWidth: 'auto', halign: 'left' }
        },
        theme: 'grid'
      });
      
      yPos = doc.lastAutoTable.finalY + 20;
    } else {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("No WIP status updates recorded", margin + 10, yPos);
      yPos += 25;
    }

    // ============ COMPLETION STATUS ============
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("STITCHING COMPLETION STATUS", margin, yPos);
    
    yPos += 20;
    
    if (completeData.length > 0) {
      const completeTableData = completeData.map(status => {
        const date = new Date(status.timestamp);
        return [
          date.toLocaleDateString('en-GB'),
          date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          status.status || 'N/A',
          status.remarks || '-'
        ];
      });
      
      doc.autoTable({
        head: [['Date', 'Time', 'Status', 'Remarks']],
        body: completeTableData,
        startY: yPos,
        margin: { left: margin, right: margin },
        styles: { 
          font: "helvetica", 
          fontSize: 9, 
          cellPadding: 5,
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          textColor: [0, 0, 0]
        },
        headStyles: { 
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          fontSize: 10,
          cellPadding: 6,
          lineColor: [0, 0, 0],
          lineWidth: 0.5,
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 80, halign: 'center' },
          1: { cellWidth: 60, halign: 'center' },
          2: { cellWidth: 90, halign: 'center' },
          3: { cellWidth: 'auto', halign: 'left' }
        },
        theme: 'grid'
      });
      
      yPos = doc.lastAutoTable.finalY + 20;
    } else {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("No completion status updates recorded", margin + 10, yPos);
      yPos += 25;
    }

    // ============ CHALLAN HISTORY ============
    if (challanData.length > 0) {
      // Check if we need new page
      if (yPos > pageHeight - 200) {
        doc.addPage();
        yPos = 50;
        
        // Page header for continuation
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("CHALLAN HISTORY (Continued)", margin, yPos);
        yPos += 20;
      } else {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(`CHALLAN HISTORY (${challanData.length} Challans)`, margin, yPos);
        yPos += 20;
      }
      
      challanData.forEach((challan, index) => {
        // Check if we need new page for this challan
        if (yPos > pageHeight - 150) {
          doc.addPage();
          yPos = 50;
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text("CHALLAN HISTORY (Continued)", margin, yPos);
          yPos += 20;
        }
        
        // Challan number header
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(`Challan ${index + 1}: ${challan.number || 'N/A'}`, margin, yPos);
        
        // Status indicator
        const statusText = challan.embCompleted ? 'COMPLETED' : 'PENDING';
        doc.setFontSize(9);
        doc.text(`Status: ${statusText}`, pageWidth - margin - 60, yPos);
        
        yPos += 15;
        
        // Challan details
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        
        // First row of details
        doc.text(`Challan Date: ${challan.date || 'N/A'}`, margin, yPos);
        doc.text(`Received Date: ${challan.receivedDate ? new Date(challan.receivedDate).toLocaleDateString('en-GB') : 'N/A'}`, margin + 180, yPos);
        doc.text(`Total Qty: ${challan.totalQty || 0}`, margin + 360, yPos);
        yPos += 15;
        
        // Second row of details
        doc.text(`Completed Date: ${challan.embUpdatedAt ? new Date(challan.embUpdatedAt).toLocaleDateString('en-GB') : 'N/A'}`, margin, yPos);
        doc.text(`Completed Time: ${challan.embUpdatedAt ? new Date(challan.embUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}`, margin + 180, yPos);
        yPos += 15;
        
        // Items/Colors section
        if (challan.items && challan.items.length > 0) {
          doc.setFont("helvetica", "bold");
          doc.text("Items / Colors:", margin, yPos);
          yPos += 12;
          
          let itemsText = "";
          challan.items.forEach((item, itemIndex) => {
            const shade = item.shade || 'N/A';
            const qty = item.qty || 0;
            itemsText += `${shade}: ${qty}`;
            
            if (itemIndex < challan.items.length - 1) {
              if ((itemIndex + 1) % 3 === 0) {
                itemsText += "\n";
              } else {
                itemsText += "   |   ";
              }
            }
          });
          
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          const itemsLines = doc.splitTextToSize(itemsText, contentWidth);
          itemsLines.forEach(line => {
            doc.text(line, margin + 10, yPos);
            yPos += 12;
          });
        }
        
        // Separator line between challans
        if (index < challanData.length - 1) {
          doc.setLineWidth(0.5);
          doc.line(margin, yPos + 5, pageWidth - margin, yPos + 5);
          yPos += 20;
        } else {
          yPos += 10;
        }
      });
    }

    // ============ SUMMARY SECTION ============
    if (yPos > pageHeight - 80) {
      doc.addPage();
      yPos = 50;
    }
    
    // Summary box
    doc.setLineWidth(1);
    doc.rect(margin, yPos, contentWidth, 60, 'S');
    
    const isCompletedStatus = completionDate !== 'Not Completed';
    const currentStatus = isCompletedStatus ? 'COMPLETED' : (latestWipStatus ? latestWipStatus.status : 'NOT STARTED');
    
    // Current status
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("CURRENT STATUS:", margin + 10, yPos + 20);
    doc.text(currentStatus, margin + 100, yPos + 20);
    
    if (isCompletedStatus) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Completed on: ${completionDate}`, margin + 10, yPos + 40);
    } else if (latestWipStatus) {
      const daysText = latestWipStatus.days > 1 ? `${latestWipStatus.days} days` : '1 day';
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`In current status for: ${daysText}`, margin + 10, yPos + 40);
    }
    
    // Statistics
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("STATISTICS:", pageWidth - margin - 150, yPos + 20);
    
    doc.setFont("helvetica", "normal");
    doc.text(`WIP Updates: ${wipData.length}`, pageWidth - margin - 150, yPos + 35);
    doc.text(`Challans: ${challanData.length}`, pageWidth - margin - 150, yPos + 50);
    
    yPos += 80;

    // ============ FOOTER ============
    const footerY = pageHeight - 30;
    
    doc.setLineWidth(0.5);
    doc.line(margin, footerY - 10, pageWidth - margin, footerY - 10);
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    
    const generatedDate = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    doc.text(`Generated: ${generatedDate}`, margin, footerY);
    doc.text(`Supervisor: ${supervisor}`, pageWidth / 2, footerY, { align: "center" });
    doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${doc.internal.getNumberOfPages()}`, pageWidth - margin, footerY, { align: "right" });

    // Save PDF
    const timestamp = new Date().toISOString().split('T')[0];
    const safeLotNumber = String(lotNumber).replace(/[\/\\]/g, '-');
    doc.save(`lot-${safeLotNumber}-production-report-${timestamp}.pdf`);
  } catch (e) {
    console.error('PDF Generation Error:', e);
    alert("Failed to generate PDF. Please try again.");
  }
};
// Helper function to group WIP status by consecutive days
const groupWipStatusByDays = (wipData) => {
  if (!wipData || !Array.isArray(wipData) || wipData.length === 0) {
    return [];
  }
  
  // Sort by timestamp
  const sortedData = [...wipData].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  const grouped = [];
  let currentGroup = null;
  
  sortedData.forEach((status, index) => {
    const statusDate = new Date(status.timestamp);
    const statusDay = statusDate.toDateString();
    
    if (!currentGroup || currentGroup.status !== status.status) {
      if (currentGroup) {
        grouped.push(currentGroup);
      }
      currentGroup = {
        status: status.status,
        firstTimestamp: status.timestamp,
        lastTimestamp: status.timestamp,
        days: 1,
        remarks: status.remarks || '-'
      };
    } else {
      const prevDay = new Date(currentGroup.lastTimestamp).toDateString();
      if (statusDay !== prevDay) {
        currentGroup.days++;
      }
      currentGroup.lastTimestamp = status.timestamp;
    }
    
    // Add last group
    if (index === sortedData.length - 1) {
      grouped.push(currentGroup);
    }
  });
  
  return grouped;
};

// Helper function to get completion date
const getCompletionDate = (completeData, savedAt) => {
  // First check for Complete Lot status
  const completeLotStatus = completeData.find(s => s.status === 'Complete Lot');
  if (completeLotStatus && completeLotStatus.timestamp) {
    return new Date(completeLotStatus.timestamp).toLocaleDateString('en-GB');
  }
  
  // If no Complete Lot status, use Saved At date if it's not "Not Started"
  if (savedAt !== 'Not Started') {
    return savedAt;
  }
  
  return 'Not Completed';
};

// Helper function to get stitching date
const getStitchingDate = (wipData, completeData) => {
  // First check for stitching status in WIP
  const stitchingStatus = wipData.find(s => 
    s.status && s.status.toLowerCase().includes('stitch')
  );
  
  if (stitchingStatus && stitchingStatus.timestamp) {
    return new Date(stitchingStatus.timestamp).toLocaleDateString('en-GB');
  }
  
  // If no stitching status, check completion data
  if (completeData.length > 0) {
    return new Date(completeData[0].timestamp).toLocaleDateString('en-GB');
  }
  
  return 'Pending';
};

// Enhanced function to get embroidery/print information from multiple challans
const getEmbPrintInfo = (challanData) => {
  if (!challanData || !Array.isArray(challanData) || challanData.length === 0) {
    return { 
      summary: 'Not Required', 
      count: 0, 
      completedCount: 0,
      firstDate: null,
      lastDate: null
    };
  }
  
  // Get all challans with embUpdatedAt dates
  const completedChallans = challanData.filter(c => c.embUpdatedAt);
  const completedCount = completedChallans.length;
  
  if (completedCount === 0) {
    return { 
      summary: 'In Progress', 
      count: challanData.length, 
      completedCount: 0,
      firstDate: null,
      lastDate: null
    };
  }
  
  // Get dates for completed challans
  const embDates = completedChallans
    .map(c => new Date(c.embUpdatedAt))
    .sort((a, b) => a - b);
  
  const firstDate = embDates[0];
  const lastDate = embDates[embDates.length - 1];
  
  // Get challan creation dates
  const challanDates = challanData
    .filter(c => c.date)
    .map(c => {
      // Parse date string like "20 Sept 2025"
      const dateParts = c.date.split(' ');
      const monthMap = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sept': 8, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      };
      const month = monthMap[dateParts[1].substring(0, 3)];
      const day = parseInt(dateParts[0]);
      const year = parseInt(dateParts[2]);
      return new Date(year, month, day);
    })
    .sort((a, b) => a - b);
  
  const firstChallanDate = challanDates.length > 0 ? challanDates[0] : null;
  const lastChallanDate = challanDates.length > 0 ? challanDates[challanDates.length - 1] : null;
  
  // Create summary text
  let summary = '';
  if (completedCount === challanData.length) {
    // All challans completed
    if (firstDate.toDateString() === lastDate.toDateString()) {
      summary = firstDate.toLocaleDateString('en-GB');
    } else {
      summary = `${firstDate.toLocaleDateString('en-GB')} - ${lastDate.toLocaleDateString('en-GB')}`;
    }
  } else {
    // Some challans pending
    summary = `${completedCount}/${challanData.length} Completed`;
    if (firstDate) {
      summary += ` (Last: ${lastDate.toLocaleDateString('en-GB')})`;
    }
  }
  
  return { 
    summary, 
    count: challanData.length, 
    completedCount,
    firstDate: firstDate ? firstDate.toLocaleDateString('en-GB') : null,
    lastDate: lastDate ? lastDate.toLocaleDateString('en-GB') : null,
    firstChallanDate: firstChallanDate ? firstChallanDate.toLocaleDateString('en-GB') : null,
    lastChallanDate: lastChallanDate ? lastChallanDate.toLocaleDateString('en-GB') : null
  };
};
  const downloadAllExcel = () => {
    const headers = [
      'Lot Number', 'Category', 'Garment Type', 'Brand', 'Fabric', 'Total PCS', 
      'Stitching Days', 'Emb/Print Days', 'Total Days', 'Days More Than Planned', 
      'Current Status', 'Complete Date', 'Completion Status'
    ];
    const data = filteredData.map(row => ({
      'Lot Number': row['Lot Number'] || 'N/A',
      'Category': row.category || 'N/A',
      'Garment Type': row['Garment Type'] || 'N/A',
      'Brand': row['BRAND'] || 'N/A',
      'Fabric': row['Fabric'] || 'N/A',
      'Total PCS': row.totalPCS > 0 ? row.totalPCS : 0,
      'Stitching Days': row.daysSinceIssue,
      'Emb/Print Days': row.embPrintDays,
      'Total Days': row.totalDays,
      'Days More Than Planned': row.daysMoreThanPlanned,
      'Current Status': row.latestWipStatus || 'Not Started',
      'Complete Date': row.completeDate || 'Pending',
      'Completion Status': row.completionStatus || ''
    }));
    
    exportToExcel(data, headers, 'daily-updation-report');
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setUpdateFilter('all');
    setGarmentTypeFilter('all');
    setCategoryFilter('all');
    setBrandFilter('all');
    setFabricFilter('all');
    setCompletionFilter('partial'); // Reset to default
    setDateRangeFilter('all');
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading production data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <div className="header-content">
          <div className="title-section">
            <h1 className="title">Production Dashboard</h1>
            <p className="subtitle">
              Production tracking for <strong>{supervisor?.name || 'Supervisor'}</strong>
            </p>
          </div>
          <div className="actions">
            <button 
              className={`primary-button ${filteredData.length === 0 ? 'disabled-button' : ''}`}
              onClick={downloadAllPDF}
              disabled={filteredData.length === 0}
              title="Download Full PDF Report"
            >
              <span className="button-icon">📄</span>
              Export All PDF
            </button>
            <button 
              className="primary-button"
              onClick={downloadCompleteLotPDF}
              disabled={stats.completedLots === 0}
              title="Download Complete Lots Report"
              style={{ backgroundColor: '#10b981' }}
            >
              <span className="button-icon">✅</span>
              Complete Lots ({stats.completedLots})
            </button>
            <button 
              className="primary-button"
              onClick={downloadPartialPendingPDF}
              disabled={stats.partialPendingLots === 0}
              title="Download Partial Pending Report"
              style={{ backgroundColor: '#f59e0b' }}
            >
              <span className="button-icon">⏳</span>
              Partial ({stats.partialPendingLots})
            </button>
            <button 
              className="secondary-button"
              onClick={downloadAllExcel}
              disabled={filteredData.length === 0}
              title="Download Excel Report"
            >
              <span className="button-icon">📊</span>
              Excel
            </button>
            <button 
              className="outline-button"
              onClick={refreshData}
              title="Refresh data"
            >
              <span className="button-icon">🔄</span>
              Refresh
            </button>
             <button 
              className="outline-button"
              onClick={handleBackClick}
              title="Go back"
            >
              <span className="button-icon">←</span>
              Back
            </button>
          </div>
          
        </div>
      </div>

      {/* Stats Overview - Updated with PCS */}
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon gradient-1">
              📋
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.totalLots}</span>
            <span className="stat-label">Total Lots</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon gradient-2">
              ✅
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.updatedToday}</span>
            <span className="stat-label">Updated Today</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon gradient-3">
              ⏳
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.pendingUpdate}</span>
            <span className="stat-label">Pending Update</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon gradient-4">
              📅
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.averageDays}</span>
            <span className="stat-label">Avg Days</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon gradient-5">
              🔢
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.totalPCS.toLocaleString()}</span>
            <span className="stat-label">Total PCS</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon gradient-6">
              📊
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.lotsWithPCS}</span>
            <span className="stat-label">Lots with PCS</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
              ✅
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.completedLots}</span>
            <span className="stat-label">Completed</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <div className="stat-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
              ⏳
            </div>
          </div>
          <div className="stat-content">
            <span className="stat-value">{stats.partialPendingLots}</span>
            <span className="stat-label">Partial Pending</span>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="filters-section">
        <div className="search-container">
          <div className="search-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search by lot number, style, brand, fabric..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="clear-button"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="filter-row">
          <StatusFilter 
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            enhancedRows={enhancedRows}
          />

          <GarmentTypeFilter 
            garmentTypeFilter={garmentTypeFilter}
            setGarmentTypeFilter={setGarmentTypeFilter}
            enhancedRows={enhancedRows}
          />

          <CategoryFilter 
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            enhancedRows={enhancedRows}
          />

          <BrandFilter 
            brandFilter={brandFilter}
            setBrandFilter={setBrandFilter}
            enhancedRows={enhancedRows}
          />

          <FabricFilter 
            fabricFilter={fabricFilter}
            setFabricFilter={setFabricFilter}
            enhancedRows={enhancedRows}
          />

          <CompletionFilter 
            completionFilter={completionFilter}
            setCompletionFilter={setCompletionFilter}
            enhancedRows={enhancedRows}
          />

          <div className="filter-group">
            <label className="filter-label">Today's Update</label>
            <select 
              value={updateFilter} 
              onChange={(e) => setUpdateFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Updates</option>
              <option value="updated">Updated Today</option>
              <option value="pending">Pending Update</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Date Range</label>
            <select 
              value={dateRangeFilter} 
              onChange={(e) => setDateRangeFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>

          <button 
            onClick={clearAllFilters}
            className="clear-filters-button"
          >
            Clear All
          </button>
        </div>

        <div className="results-info">
          <span className="results-count">
            Showing {filteredData.length} of {enhancedRows.length} lots
            {stats.lotsWithPCS > 0 && ` • ${stats.lotsWithPCS} lots with PCS data`}
            {completionFilter === 'partial' && ` • Partial Pending: ${stats.partialPendingLots}`}
            {completionFilter === 'complete' && ` • Complete: ${stats.completedLots}`}
          </span>
          {Object.keys(stats.statusDistribution).length > 0 && (
            <div className="status-distribution">
              {Object.entries(stats.statusDistribution).slice(0, 3).map(([status, count]) => (
                <span key={status} className="status-pill">
                  <span 
                    className="status-dot"
                    style={{ backgroundColor: getStatusColor(status) }}
                  ></span>
                  {status}: {count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error} - Showing sample data</span>
        </div>
      )}

      {/* Data Table - Updated with all new columns */}
      <div className="table-container">
        <div className="table-wrapper">
          <table className="table">
            <thead className="table-header">
              <tr>
                <th className="th">Lot No.</th>
                <th className="th">Category</th>
                <th className="th">Garment Type</th>
                <th className="th">Brand</th>
                <th className="th">Fabric</th>
                <th className="th">Total PCS</th>
                <th className="th">Stitching Days</th>
                <th className="th">Emb/Print Days</th>
                <th className="th">Total Days</th>
                <th className="th">Days Over Plan</th>
                <th className="th">Current Status</th>
                <th className="th">Complete Date</th>
                {completionFilter !== 'complete' && <th className="th">Today's Update</th>}
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, index) => (
                <React.Fragment key={row.id || index}>
                  <tr 
                    className={`table-row ${selectedRow?.id === row.id ? 'selected-row' : ''}`}
                    onClick={() => handleRowClick(row)}
                  >
                    <td className="td">
                      <div className="lot-number-container">
                        <strong className="lot-number">{row['Lot Number'] || 'N/A'}</strong>
                        {row.isUpdatedToday && row.showUpdateBadge && (
                          <span className="new-badge">NEW</span>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <div 
                        className="category-badge"
                        style={{
                          backgroundColor: row.category === 'M' ? '#dbeafe' : 
                                       row.category === 'W' ? '#fce7f3' : '#f0fdf4',
                          color: row.category === 'M' ? '#1e40af' : 
                                row.category === 'W' ? '#be185d' : '#166534'
                        }}
                      >
                        {row.category}
                      </div>
                    </td>
                    <td className="td">
                      <div className="garment-type">
                        {row['Garment Type'] || 'N/A'}
                      </div>
                    </td>
                    <td className="td">
                      <div className="brand">{row['BRAND'] || 'N/A'}</div>
                    </td>
                    <td className="td">
                      <div className="fabric">{row['Fabric'] || 'N/A'}</div>
                    </td>
                    <td className="td">
                      <div className="pcs-cell">
                        <span className="pcs-number">
                          {row.totalPCS > 0 ? row.totalPCS.toLocaleString() : 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="td">
                      <div 
                        className="days-cell"
                        style={{
                          color: row.daysSinceIssue > 7 ? '#dc2626' : 
                                row.daysSinceIssue > 3 ? '#d97706' : '#059669',
                        }}
                      >
                        <span className="days-number">{row.daysSinceIssue}</span>
                        <span className="days-label">days</span>
                      </div>
                    </td>
                    <td className="td">
                      <div 
                        className="emb-days-cell"
                        style={{
                          color: row.embPrintStatus === 'Pending' ? '#d97706' : 
                                row.embPrintStatus === 'Completed' ? '#059669' : '#3b82f6',
                        }}
                      >
                        <span className="days-number">{row.embPrintDays}</span>
                        <span className="days-label">days</span>
                        <div className="emb-status">
                          ({row.embPrintStatus})
                        </div>
                      </div>
                    </td>
                    {/* Total Days Column */}
                    <td className="td">
                      <div 
                        className="total-days-cell"
                        style={{
                          color: row.totalDays > 20 ? '#dc2626' : 
                                row.totalDays > 15 ? '#d97706' : '#059669',
                          fontWeight: '600'
                        }}
                      >
                        <span className="days-number">{row.totalDays}</span>
                        <span className="days-label">days</span>
                      </div>
                    </td>
                    {/* Days More Than Planned Column */}
                    <td className="td">
                      <div 
                        className="overtime-cell"
                        style={{
                          backgroundColor: row.daysMoreThanPlanned > 0 ? '#fef2f2' : '#f0fdf4',
                          color: row.daysMoreThanPlanned > 0 ? '#dc2626' : '#059669',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          textAlign: 'center',
                          display: 'inline-block',
                          minWidth: '60px'
                        }}
                      >
                        {row.daysMoreThanPlanned > 0 ? (
                          <>
                            <span style={{marginRight: '4px'}}>⏰</span>
                            +{row.daysMoreThanPlanned}
                          </>
                        ) : (
                          <>
                            <span style={{marginRight: '4px'}}>✅</span>
                            -
                          </>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <div 
                        className="status-cell"
                        style={{
                          backgroundColor: row.statusBackground,
                          color: row.statusColor,
                          border: `1px solid ${row.statusColor}25`
                        }}
                      >
                        {row.latestWipStatus || 'Not Started'}
                      </div>
                    </td>
                    {/* Complete Date Column */}
                    <td className="td">
                      <div 
                        className="complete-date-cell"
                        style={{
                          backgroundColor: row.completeDate !== 'Pending' ? '#d1fae5' : '#f3f4f6',
                          color: row.completeDate !== 'Pending' ? '#059669' : '#6b7280',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: row.completeDate !== 'Pending' ? '600' : '400',
                          textAlign: 'center',
                          display: 'inline-block',
                          minWidth: '70px'
                        }}
                      >
                        {row.completeDate}
                      </div>
                    </td>
                    {/* Today's Update Column - Hide for completed lots */}
                    {completionFilter !== 'complete' && (
                      <td className="td">
                        {row.showUpdateBadge ? (
                          <div 
                            className="update-cell"
                            style={{
                              backgroundColor: row.isUpdatedToday ? '#d1fae5' : '#fee2e2',
                              color: row.isUpdatedToday ? '#059669' : '#dc2626',
                            }}
                          >
                            {row.isUpdatedToday ? (
                              <>
                                <span className="update-icon">✅</span>
                                UPDATED
                              </>
                            ) : (
                              <>
                                <span className="update-icon">⏳</span>
                                PENDING
                              </>
                            )}
                          </div>
                        ) : (
                          <div 
                            className="update-cell"
                            style={{
                              backgroundColor: '#f3f4f6',
                              color: '#6b7280',
                            }}
                          >
                            <span className="update-icon">✅</span>
                            COMPLETED
                          </div>
                        )}
                      </td>
                    )}
                    <td className="td">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadIndividualPDF(row);
                        }}
                        className="download-button"
                        title="Download Lot PDF"
                      >
                        <span className="download-icon">📥</span>
                        PDF
                      </button>
                    </td>
                  </tr>
                  
                  {/* Expanded Row Details */}
                  {selectedRow?.id === row.id && (
                    <tr>
                      <td colSpan={completionFilter !== 'complete' ? "14" : "13"} className="expanded-td">
                        <div className="details-panel">
                          <div className="details-header">
                            <h3 className="details-title">
                              Lot Details - {row['Lot Number'] || 'N/A'}
                            </h3>
                            <button 
                              onClick={() => setSelectedRow(null)}
                              className="close-button"
                            >
                              ✕
                            </button>
                          </div>
                          
                          <UpdateIndicator 
                            wipData={row.wipData}
                            dateOfIssue={row['Date of Issue']}
                            challanData={row.challanData}
                            totalPCS={row.totalPCS}
                            completeStatus={row.completionStatus ? { status: row.completionStatus } : null}
                          />
                          
                          <StatusTimeline wipData={row.wipData} />
                          
                          <div className="details-grid">
                            <div className="detail-item">
                              <label className="detail-label">Style:</label>
                              <span className="detail-value">{row['Style'] || 'N/A'}</span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Supervisor:</label>
                              <span className="detail-value">{row[supervisorHeaderKey] || 'N/A'}</span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Date of Issue:</label>
                              <span className="detail-value">{row['Date of Issue'] || 'N/A'}</span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Total PCS:</label>
                              <span className="detail-value" style={{ fontWeight: '600', color: '#1e40af' }}>
                                {row.totalPCS > 0 ? row.totalPCS.toLocaleString() : 'N/A'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Total Days:</label>
                              <span className="detail-value" style={{ fontWeight: '600' }}>
                                {row.totalDays} days
                              </span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Days Over Plan:</label>
                              <span className="detail-value" style={{ 
                                color: row.daysMoreThanPlanned > 0 ? '#dc2626' : '#059669',
                                fontWeight: '600' 
                              }}>
                                {row.daysMoreThanPlanned > 0 ? `+${row.daysMoreThanPlanned} days` : 'On schedule'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Complete Date:</label>
                              <span className="detail-value" style={{ 
                                color: row.completeDate !== 'Pending' ? '#059669' : '#6b7280',
                                fontWeight: row.completeDate !== 'Pending' ? '600' : '400' 
                              }}>
                                {row.completeDate}
                              </span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Completion Status:</label>
                              <span className="detail-value" style={{ 
                                color: row.completionStatus === 'Complete Lot' ? '#10b981' : 
                                      row.completionStatus === 'Partially Pending' ? '#f59e0b' : '#6b7280',
                                fontWeight: '500'
                              }}>
                                {row.completionStatus || 'Not Completed'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Season:</label>
                              <span className="detail-value">{row['SEASON'] || 'N/A'}</span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Party Name:</label>
                              <span className="detail-value">{row['PARTY NAME'] || 'N/A'}</span>
                            </div>
                            <div className="detail-item">
                              <label className="detail-label">Category:</label>
                              <span className="detail-value">{row.category || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          
          {filteredData.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h3 className="empty-title">
                {searchTerm ? 'No matching lots found' : 'No lots available'}
              </h3>
              <p className="empty-text">
                {searchTerm 
                  ? 'Try adjusting your search terms or clear filters' 
                  : 'No production lots found for the current criteria.'
                }
              </p>
              {(searchTerm || statusFilter !== 'all' || updateFilter !== 'all') && (
                <button 
                  onClick={clearAllFilters}
                  className="empty-action-button"
                >
                  Clear All Filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <div className="footer-content">
          <div className="last-updated">
            Last updated: {new Date().toLocaleString()}
          </div>
          <div className="footer-stats">
            {filteredData.length} lots • {stats.updatedToday} updated today • {stats.totalPCS.toLocaleString()} total PCS
            {completionFilter === 'partial' && ` • ${stats.partialPendingLots} partial pending`}
            {completionFilter === 'complete' && ` • ${stats.completedLots} completed`}
          </div>
        </div>
      </div>
    </div>
  );
}

// Mock data for development/offline
const getMockData = () => {
  return [
    {
      'Lot Number': 'LOT-001',
      'Garment Type': 'Shirts',
      'Style': 'S001',
      'BRAND': 'Brand A',
      'Fabric': 'Cotton',
      'Supervisor': 'rohit',
      'M/W/K': 'M',
      'WIP Status': JSON.stringify([
        {"status":"Cutting in Progress","remarks":"","timestamp":"2024-01-15T10:30:00"},
        {"status":"Stitching Started","remarks":"","timestamp":"2024-01-16T14:20:00"},
        {"status":"Quality Check","remarks":"","timestamp":"2024-01-17T09:15:00"}
      ]),
      'Completed Status': JSON.stringify([
        {"status":"Partially Pending","remarks":"","timestamp":"2024-01-18T10:00:00"}
      ]),
      'Challan History': JSON.stringify([
        {"number":"CH-EMB-0052","date":"29 Sept 2024","by":"","completeLot":false,"totalQty":415,"items":[{"shade":"BLACK","qty":140},{"shade":"OFF-WHITE","qty":135},{"shade":"OLIVE","qty":140}],"receivedDate":"2024-10-15T07:26:24.062Z","embCompleted":true,"embUpdatedAt":"2024-10-15T08:38:37.517Z"}
      ]),
      'Date of Issue': '2024-01-15',
      'PARTY NAME': 'Party A',
      'SEASON': 'Spring 2024',
    },
    {
      'Lot Number': 'LOT-002',
      'Garment Type': 'Pants',
      'Style': 'P001',
      'BRAND': 'Brand B',
      'Fabric': 'Denim',
      'Supervisor': 'Rohit',
      'M/W/K': 'W',
      'WIP Status': JSON.stringify([
        {"status":"Dori Pending","remarks":"","timestamp":"2024-01-18T11:00:00"},
        {"status":"Zip Pending","remarks":"","timestamp":"2024-01-19T16:45:00"}
      ]),
      'Completed Status': JSON.stringify([
        {"status":"Complete Lot","remarks":"","timestamp":"2024-01-21T12:00:00"}
      ]),
      'Challan History': JSON.stringify([
        {"number":"CH-EMB-0053","date":"15 Oct 2024","by":"","completeLot":false,"totalQty":300,"items":[{"shade":"BLUE","qty":150},{"shade":"BLACK","qty":150}],"receivedDate":"2024-10-16T07:26:24.062Z","embCompleted":false}
      ]),
      'Date of Issue': '2024-01-10',
      'PARTY NAME': 'Party B',
      'SEASON': 'Summer 2024',
    },
    {
      'Lot Number': 'LOT-003',
      'Garment Type': 'Jackets',
      'Style': 'J001',
      'BRAND': 'Brand C',
      'Fabric': 'Polyester',
      'Supervisor': 'ROHIT',
      'M/W/K': 'K',
      'WIP Status': JSON.stringify([
        {"status":"Complete","remarks":"","timestamp":"2024-01-20T08:30:00"}
      ]),
      'Completed Status': JSON.stringify([]),
      'Challan History': JSON.stringify([]),
      'Date of Issue': '2024-01-20',
      'PARTY NAME': 'Party C',
      'SEASON': 'Winter 2024',
    }
  ];
};

export default DailyUpdationSystem;
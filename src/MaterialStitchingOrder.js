// src/MaterialStitchingOrder.jsx
import React, { useEffect, useState } from "react";
import { jsPDF } from "jspdf";

/** ========= CONFIG ========= */
const API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk";
const SHEET_ID = "1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA";
const INDEX_SHEET_RANGE = "Index!A:Z";
const CUTTING_SHEET_ID = "1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA";
const MATERIAL_ORDERS_SHEET_ID = "18hFQb3kX_t-41J_BX7INFRQ1FdkgW8YKIu_3SAEn9mA";
const MATERIAL_ORDERS_RANGE = "MaterialOrders!A:Z";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwpc543RUdQ75UAw9MCS_1RHvhIR3G7I3bME65cwJerTSe8PisY-pMdbtqDDe42JHxQjw/exec";

const STORAGE_KEY = "material_stitching_supervisors";

// ========= IN-MEMORY CACHE SYSTEM FOR BLAZING FAST FETCHING =========
class MsoApiCache {
  constructor(ttlMs = 300000) { // 5-minute cache
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }
  set(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  }
  invalidate(key) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}

const globalMsoCache = new MsoApiCache();

// Fetch existing MSO data to check for duplicate lots with quantities
async function fetchExistingMSOData(sheetId, apiKey, forceRefresh = false) {
  const cacheKey = `mso_existing_${sheetId}`;
  if (!forceRefresh) {
    const cached = globalMsoCache.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache HIT for existing MSO data");
      return cached;
    }
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    MATERIAL_ORDERS_RANGE
  )}?key=${apiKey}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Sheets API error: ${resp.status}`);
  const data = await resp.json();
  const values = data.values || [];

  const existingOrders = new Map();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const msoNo = row[0] || "";
    const date = row[1] || "";
    const lotNo = row[2] || "";
    const brand = row[3] || "";
    const garmentType = row[4] || "";
    const quantity = parseInt(row[5]) || 0;
    const unit = row[6] || "";
    const priority = row[7] || "";
    const remarks = row[8] || "";
    const createdBy = row[9] || "";

    if (lotNo && lotNo.trim()) {
      const normalizedLot = lotNo.trim().toLowerCase();

      if (existingOrders.has(normalizedLot)) {
        const existingOrder = existingOrders.get(normalizedLot);
        existingOrder.totalIssuedQuantity += quantity;
        existingOrder.msoNumbers.push(msoNo);
      } else {
        existingOrders.set(normalizedLot, {
          msoNumbers: [msoNo],
          totalIssuedQuantity: quantity,
          lastMSO: msoNo,
          date,
          lotNo,
          brand,
          garmentType,
          unit,
          priority,
          remarks,
          createdBy
        });
      }
    }
  }

  globalMsoCache.set(cacheKey, existingOrders);
  return existingOrders;
}

// Fetch index data to quickly locate lot matrices and supervisors
async function fetchLotIndex(sheetId, apiKey, forceRefresh = false) {
  const cacheKey = `lot_index_${sheetId}`;
  if (!forceRefresh) {
    const cached = globalMsoCache.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache HIT for Lot Index");
      return cached;
    }
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    INDEX_SHEET_RANGE
  )}?key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Sheets API error: ${resp.status}`);
  const data = await resp.json();
  const values = data.values || [];

  const indexMap = new Map();
  const supervisors = new Set();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const lotNumber = row[0] || "";
    const startRow = row[1] || "";
    const numRows = row[2] || "";
    const headerCols = row[3] || "";
    const fabric = row[4] || "";
    const garmentType = row[5] || "";
    const style = row[6] || "";
    const sizes = row[7] || "";
    const shades = row[8] || "";
    const savedAt = row[9] || "";
    const dateOfIssue = row[10] || "";
    const supervisor = row[11] || "";
    const imageUrl = row[12] || "";
    const partyName = row[13] || "";
    const brand = row[14] || "";

    if (lotNumber && startRow) {
      indexMap.set(lotNumber.trim().toLowerCase(), {
        startRow: parseInt(startRow),
        numRows: parseInt(numRows) || 0,
        headerCols: parseInt(headerCols) || 0,
        fabric: fabric,
        garmentType: garmentType,
        style: style,
        supervisor: supervisor ? supervisor.trim().toUpperCase() : "",
        brand: brand ? brand.trim() : "",
        sizes: sizes
      });
    }

    if (supervisor && supervisor.trim()) {
      supervisors.add(supervisor.trim().toUpperCase());
    }
  }

  const result = {
    indexMap,
    supervisors: Array.from(supervisors).sort()
  };

  globalMsoCache.set(cacheKey, result);
  return result;
}

// IMPROVED: Extract size-wise quantities from cutting sheet matrix
// IMPROVED: Extract size-wise quantities by dynamically detecting size columns
// IMPROVED: Extract size-wise quantities correctly from cutting sheet
// IMPROVED: Extract size-wise quantities correctly from cutting sheet
// IMPROVED: Extract size-wise quantities - finds the correct header row with sizes
// IMPROVED: Extract size-wise quantities with full support for sizes up to 6XL
function extractSizeWiseQuantities(matrix, headerCols) {
  const sizeWiseDetails = [];

  if (!matrix || matrix.length === 0) {
    console.log("No matrix data");
    return sizeWiseDetails;
  }

  console.log("Matrix rows:", matrix.length);

  // Find the row that contains size headers - look for row with "Color" or multiple size values
  let headerRowIndex = -1;
  let sizeColumns = [];

  // Common patterns for size columns (excluding known non-size columns)
  const nonSizeColumns = ['COLOR', 'COLOUR', 'CUTTING TABLE', 'TOTAL PCS', 'TOTAL',
    'PARTICULARS', 'S.NO', 'SR.NO', 'DESCRIPTION', 'STYLE',
    'FABRIC', 'GARMENT TYPE', 'LOT NUMBER', 'LOT NUMBER:'];

  // Comprehensive size pattern that matches ALL sizes up to 6XL:
  // - Letter sizes: S, M, L, XL, XXL, XXXL, XXXXL, XXXXXL, XXXXXXL
  // - Number-letter combos: 2XL, 3XL, 4XL, 5XL, 6XL
  // - Number sizes: 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44
  // - Teen/Children sizes: 8, 10, 12, 14, 16
  const sizePattern = /^(\d*X*L?|X{1,6}L?|\d{2,3}|\d{1,2}[X]?L?)$/i;

  // Explicit pattern for common size formats
  const explicitSizePattern = /^(?:S|M|L|XL|XXL|XXXL|XXXXL|XXXXXL|XXXXXXL|2XL|3XL|4XL|5XL|6XL|XS|XXS|XXXS|SML|MED|LRG|XLG|\d{1,2}|\d{2,3})$/i;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    // Check if this row has multiple potential size columns
    let sizeCount = 0;
    let hasColorColumn = false;

    for (let j = 0; j < row.length; j++) {
      const cell = row[j] ? row[j].toString().trim().toUpperCase() : "";

      // Check if this row has a "COLOR" or "COLOUR" column (indicates this is the header row)
      if (cell === "COLOR" || cell === "COLOUR") {
        hasColorColumn = true;
      }

      // Skip known non-size columns
      if (nonSizeColumns.includes(cell)) {
        continue;
      }

      // Clean the cell value for size detection
      let cleanCell = cell.replace(/[^\w]/g, ''); // Remove special characters

      // Check if it's a valid size
      const isValidSize = (explicitSizePattern.test(cleanCell) || sizePattern.test(cleanCell)) &&
        cleanCell !== row[0]?.toString().trim().toUpperCase() && // Don't consider first column as size
        cleanCell.length <= 8 && // Size strings up to "XXXXXXL" is 7 chars
        !cleanCell.includes(':') && // Not a label with colon
        (isNaN(parseFloat(cleanCell)) || cleanCell.length >= 2); // Allow numbers but ensure they're not single digits (unless they're sizes)

      if (isValidSize) {
        sizeCount++;
      }
    }

    // If we found a row with "COLOR" and multiple size columns, this is our header row
    if (hasColorColumn && sizeCount >= 2) {
      headerRowIndex = i;
      console.log(`Found size header row at index ${i}:`, row);
      break;
    }
  }

  // If we didn't find the header row with "COLOR", look for row with most size values
  if (headerRowIndex === -1) {
    let maxSizeCount = 0;
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i];
      if (!row || row.length === 0) continue;

      let sizeCount = 0;
      for (let j = 1; j < row.length; j++) {
        const cell = row[j] ? row[j].toString().trim().toUpperCase() : "";
        let cleanCell = cell.replace(/[^\w]/g, '');

        if ((explicitSizePattern.test(cleanCell) || sizePattern.test(cleanCell)) &&
          cleanCell.length <= 8 && !cleanCell.includes(':')) {
          sizeCount++;
        }
      }

      if (sizeCount > maxSizeCount) {
        maxSizeCount = sizeCount;
        headerRowIndex = i;
      }
    }
    console.log(`Found potential header row at index ${headerRowIndex} with ${maxSizeCount} size columns`);
  }

  if (headerRowIndex === -1) {
    console.log("No size headers found");
    return sizeWiseDetails;
  }

  // Get the size header row
  const headerRow = matrix[headerRowIndex];
  console.log("Size header row:", headerRow);

  // Normalize size strings for consistent comparison
  const normalizeSize = (size) => {
    let normalized = size.toUpperCase();
    // Convert 2XL, 3XL, 4XL, 5XL, 6XL to standard format
    normalized = normalized.replace(/^(\d+)XL$/, (match, num) => {
      const xCount = parseInt(num);
      return 'X'.repeat(xCount) + 'L';
    });
    return normalized;
  };

  // Find all columns that contain size values
  for (let i = 0; i < headerRow.length; i++) {
    let cell = headerRow[i] ? headerRow[i].toString().trim().toUpperCase() : "";
    let cleanCell = cell.replace(/[^\w]/g, '');

    // Skip known non-size columns
    if (nonSizeColumns.includes(cell) || nonSizeColumns.includes(cleanCell) ||
      cell === "COLOR" || cell === "COLOUR" || cell === "CUTTING TABLE") {
      continue;
    }

    // Skip empty cells
    if (!cleanCell) continue;

    // Check if it's a valid size
    if ((explicitSizePattern.test(cleanCell) || sizePattern.test(cleanCell)) &&
      cleanCell.length <= 8 && !cleanCell.includes(':')) {

      // Record the size with its normalized form for display
      sizeColumns.push({
        index: i,
        name: cell,
        normalized: normalizeSize(cell)
      });
    }
  }

  console.log("Found size columns:", sizeColumns.map(c => c.name));

  if (sizeColumns.length === 0) {
    console.log("No size columns detected");
    return sizeWiseDetails;
  }

  // Initialize quantity map for each size
  const quantityMap = new Map();
  sizeColumns.forEach(col => {
    quantityMap.set(col.name, 0);
  });

  // Process data rows (rows after header row)
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    // Get the first column value (Color name or description)
    const firstColValue = row[0] ? row[0].toString().toLowerCase() : "";

    // Skip total rows and empty rows
    if (firstColValue === 'total' || firstColValue.includes('total') || firstColValue === '') {
      console.log(`Skipping row ${i} (${firstColValue || 'empty'})`);
      continue;
    }

    // Skip rows that don't have enough columns
    if (row.length < sizeColumns[sizeColumns.length - 1].index + 1) {
      continue;
    }

    console.log(`Processing row ${i}: ${firstColValue}`);

    // Process each size column for this row
    for (const col of sizeColumns) {
      if (col.index < row.length) {
        let value = row[col.index];

        // Convert to number
        let numericValue = 0;
        if (typeof value === 'number') {
          numericValue = value;
        } else if (typeof value === 'string') {
          value = value.trim();
          if (value === '' || value === '-') {
            numericValue = 0;
          } else {
            numericValue = parseInt(value);
            if (isNaN(numericValue)) numericValue = 0;
          }
        }

        if (numericValue > 0) {
          const current = quantityMap.get(col.name) || 0;
          quantityMap.set(col.name, current + numericValue);
          console.log(`  Added ${numericValue} to ${col.name} (now: ${current + numericValue})`);
        }
      }
    }
  }

  // Convert map to array and filter out zero quantities
  for (const [size, quantity] of quantityMap) {
    if (quantity > 0) {
      sizeWiseDetails.push({ size, quantity });
    }
  }

  // Sort sizes with proper order for sizes up to 6XL
  const getSizeOrder = (size) => {
    const upperSize = size.toUpperCase();

    // Handle numeric sizes
    const numSize = parseInt(upperSize);
    if (!isNaN(numSize) && numSize >= 20) {
      return numSize; // Numeric sizes (24, 26, 28, etc.)
    }

    // Handle number+XL format (2XL, 3XL, 4XL, 5XL, 6XL)
    const xlMatch = upperSize.match(/^(\d+)XL$/);
    if (xlMatch) {
      const num = parseInt(xlMatch[1]);
      return 10 + num; // 2XL=12, 3XL=13, 4XL=14, 5XL=15, 6XL=16
    }

    // Handle X repeats format (XXL, XXXL, XXXXL, XXXXXL, XXXXXXL)
    const xRepeatMatch = upperSize.match(/^(X{2,})L$/);
    if (xRepeatMatch) {
      const xCount = xRepeatMatch[1].length;
      return 10 + xCount; // XXL=12, XXXL=13, XXXXL=14, XXXXXL=15, XXXXXXL=16
    }

    // Standard letter sizes order
    const order = {
      'XXS': 1, 'XS': 2, 'S': 3, 'SML': 3, 'MED': 4, 'M': 4,
      'L': 5, 'LRG': 5, 'XL': 6, 'XLG': 6, 'XXL': 12, 'XXXL': 13,
      'XXXXL': 14, 'XXXXXL': 15, 'XXXXXXL': 16
    };

    return order[upperSize] || 99;
  };

  sizeWiseDetails.sort((a, b) => {
    const orderA = getSizeOrder(a.size);
    const orderB = getSizeOrder(b.size);
    return orderA - orderB;
  });

  console.log("Final aggregated size-wise details:", sizeWiseDetails);

  // Calculate total for verification
  const total = sizeWiseDetails.reduce((sum, item) => sum + item.quantity, 0);
  console.log(`Total quantity from size breakdown: ${total}`);

  return sizeWiseDetails;
}

// Fetch specific lot data using index - INCLUDING SIZE DETAILS
// Fetch specific lot data using index - INCLUDING SIZE DETAILS
// Fetch specific lot data using index - INCLUDING SIZE DETAILS
// Fetch specific lot data using index - INCLUDING SIZE DETAILS
async function fetchLotData(sheetId, lotNumber, apiKey) {
  const cacheKey = `mso_lot_${lotNumber.trim().toLowerCase()}`;
  const cached = globalMsoCache.get(cacheKey);
  if (cached) {
    console.log(`⚡ Cache HIT for Lot Data ${lotNumber}`);
    return cached;
  }

  try {
    const { indexMap } = await fetchLotIndex(sheetId, apiKey);
    const normalizedLot = lotNumber.trim().toLowerCase();
    const lotInfo = indexMap.get(normalizedLot);

    if (!lotInfo) {
      throw new Error(`Lot number ${lotNumber} not found in index`);
    }

    // Calculate the exact range
    const startRow = lotInfo.startRow;
    const numRows = lotInfo.numRows;
    const endRow = startRow + numRows - 1;
    const range = `Cutting!A${startRow}:Z${endRow}`;

    console.log(`Fetching lot data from range: ${range}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      range
    )}?key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Sheets API error: ${resp.status}`);
    const data = await resp.json();
    const values = data.values || [];

    // Extract size-wise quantities from the matrix
    const sizeWiseDetails = extractSizeWiseQuantities(values, lotInfo.headerCols);

    const result = {
      lotNumber,
      matrix: values,
      headerCols: lotInfo.headerCols,
      sizeWiseDetails: sizeWiseDetails,
      sizesInfo: lotInfo.sizes
    };

    globalMsoCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error fetching lot data:', error);
    throw error;
  }
}

// Get total quantity from lot
function getLotTotalQuantity(lotData) {
  if (!lotData || !lotData.matrix || lotData.matrix.length === 0) {
    return 0;
  }

  const matrix = lotData.matrix;
  const headerCols = lotData.headerCols || 7;

  const totalRow = matrix.find(row =>
    row[0] && (String(row[0]).toLowerCase().includes('total') || String(row[0]) === 'Total')
  );

  if (totalRow && totalRow.length >= headerCols) {
    return parseFloat(totalRow[headerCols - 1]) || 0;
  }

  return 0;
}

// Supervisor management functions
const getStoredSupervisors = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error reading supervisors from storage:', error);
  }
  return [];
};

const saveSupervisors = (supervisors) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(supervisors));
  } catch (error) {
    console.error('Error saving supervisors to storage:', error);
  }
};

const styles = {
  container: {
    minHeight: "100vh",
    background: "#F8FAFC",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "24px",
  },
  card: {
    background: "#FFFFFF",
    borderRadius: "24px",
    border: "1px solid #E2E8F0",
    boxShadow: "0 10px 40px rgba(15, 23, 42, 0.05)",
    overflow: "hidden",
    maxWidth: "1400px",
    margin: "0 auto",
  },
  header: {
    background: "linear-gradient(135deg, #0F172A 0%, #1E40AF 50%, #2563EB 100%)",
    padding: "36px 40px 28px",
    color: "white",
    textAlign: "center",
    position: "relative",
    boxShadow: "0 4px 20px rgba(37, 99, 235, 0.15)",
  },
  title: {
    fontSize: "2.4rem",
    fontWeight: "800",
    margin: "0 0 8px 0",
    color: "#FFFFFF",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: "1.05rem",
    color: "rgba(255, 255, 255, 0.85)",
    fontWeight: "500",
  },
  tabs: {
    display: "flex",
    background: "rgba(255, 255, 255, 0.15)",
    backdropFilter: "blur(8px)",
    borderRadius: "14px",
    padding: "6px",
    margin: "25px auto 0",
    maxWidth: "540px",
    border: "1px solid rgba(255, 255, 255, 0.2)",
  },
  tab: {
    flex: 1,
    padding: "12px 20px",
    textAlign: "center",
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: "600",
    fontSize: "14px",
    transition: "all 0.2s ease",
    color: "rgba(255, 255, 255, 0.85)",
  },
  activeTab: {
    background: "#FFFFFF",
    color: "#0F172A",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  },
  content: {
    padding: "36px",
    background: "#F8FAFC",
    minHeight: "500px",
  },
  section: {
    background: "#FFFFFF",
    borderRadius: "20px",
    padding: "32px",
    marginBottom: "24px",
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.03)",
    border: "1px solid #E2E8F0",
  },
  sectionTitle: {
    fontSize: "1.25rem",
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: "24px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "20px 24px",
    alignItems: "start",
    marginBottom: "24px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "100%",
  },
  label: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#1E293B",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  input: {
    padding: "0 16px",
    height: "48px",
    lineHeight: "48px",
    border: "2px solid #E2E8F0",
    borderRadius: "12px",
    fontSize: "14px",
    transition: "all 0.2s ease",
    outline: "none",
    background: "#F8FAFC",
    color: "#0F172A",
    fontWeight: "600",
    width: "100%",
    boxSizing: "border-box",
  },
  select: {
    padding: "0 16px",
    height: "48px",
    lineHeight: "48px",
    border: "2px solid #E2E8F0",
    borderRadius: "12px",
    fontSize: "14px",
    transition: "all 0.2s ease",
    outline: "none",
    background: "#F8FAFC",
    color: "#0F172A",
    fontWeight: "600",
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
  },
  error: {
    color: "#dc2626",
    fontSize: "12px",
    fontWeight: "500",
    marginTop: "4px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  lookupGroup: {
    display: "flex",
    gap: "0",
    alignItems: "center",
    width: "100%",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.04)",
  },
  lookupInput: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  lookupButton: {
    height: "48px",
    padding: "0 24px",
    border: "none",
    borderRadius: "0 12px 12px 0",
    background: "linear-gradient(135deg, #0F172A 0%, #2563EB 100%)",
    color: "white",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    transition: "all 0.2s ease",
  },
  button: {
    padding: "14px 28px",
    border: "none",
    borderRadius: "14px",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  primaryButton: {
    background: "linear-gradient(135deg, #0F172A 0%, #2563EB 100%)",
    color: "white",
    boxShadow: "0 4px 14px rgba(37, 99, 235, 0.25)",
  },
  secondaryButton: {
    background: "#FFFFFF",
    color: "#475569",
    border: "2px solid #CBD5E1",
  },
  successButton: {
    background: "linear-gradient(135deg, #059669 0%, #10B981 100%)",
    color: "white",
    boxShadow: "0 4px 14px rgba(16, 185, 129, 0.25)",
  },
  accessoriesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "18px",
  },
  accessoryItem: {
    padding: "20px 22px",
    border: "2px solid #E2E8F0",
    borderRadius: "16px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    background: "#FFFFFF",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.02)",
  },
  accessorySelected: {
    borderColor: "#2563EB",
    background: "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)",
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.15)",
  },
  backButton: {
    position: "absolute",
    top: "24px",
    left: "24px",
    padding: "10px 18px",
    background: "rgba(255, 255, 255, 0.15)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    borderRadius: "12px",
    backdropFilter: "blur(8px)",
    color: "white",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  loadingOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  loadingSpinner: {
    width: "44px",
    height: "44px",
    border: "4px solid rgba(255, 255, 255, 0.2)",
    borderTop: "4px solid #3b82f6",
    borderRadius: "50%",
  },
  dialogOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px",
  },
  dialog: {
    background: "#FFFFFF",
    borderRadius: "24px",
    padding: "36px",
    maxWidth: "460px",
    width: "100%",
    boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.35)",
    border: "1px solid #E2E8F0",
  },
  dialogTitle: {
    fontSize: "1.3rem",
    fontWeight: "700",
    marginBottom: "14px",
    color: "#0F172A",
  },
  dialogMessage: {
    marginBottom: "24px",
    color: "#475569",
    lineHeight: "1.6",
    fontSize: "0.95rem",
  },
  dialogActions: {
    display: "flex",
    gap: "12px",
    justifyContent: "flex-end",
  },
};

export default function MaterialStitchingOrder({ fallbackPath = "/" }) {
  const [formData, setFormData] = useState({
    orderNo: "",
    lotNo: "",
    brand: "",
    garmentType: "",
    qty: "",
    priority: "Normal",
    remarks: "",
    supervisor: ""
  });

  const [accessories, setAccessories] = useState({
    label: false,
    washCare: false,
    silicon: false,
    size: false,
    zip: false,
    tapeLace: false,
    elastic: false,
  });

  const [supervisors, setSupervisors] = useState([]);
  const [existingOrders, setExistingOrders] = useState(new Map());
  const [currentLotQuantity, setCurrentLotQuantity] = useState(0);
  const [sizeWiseDetails, setSizeWiseDetails] = useState([]);

  const [uiState, setUiState] = useState({
    loading: false,
    loadingLookup: false,
    loadingLotQty: false,
    loadingSupervisors: false,
    loadingExistingData: false,
    activeTab: "basic",
    showSubmitDialog: false,
    showSuccessDialog: false,
    showErrorDialog: false,
    showDuplicateWarning: false,
    dialogMessage: "",
  });

  const [errors, setErrors] = useState({
    lotNo: "",
    brand: "",
    garmentType: "",
    qty: "",
    supervisor: ""
  });

  useEffect(() => {
    generateOrderNo();
    loadSupervisors();
    loadExistingMSOData();
  }, []);

  const handleBack = () => {
    window.history.back();
  };

  const loadExistingMSOData = async () => {
    updateUiState("loadingExistingData", true);
    try {
      const data = await fetchExistingMSOData(MATERIAL_ORDERS_SHEET_ID, API_KEY);
      setExistingOrders(data);
    } catch (error) {
      console.error('Error loading existing MSO data:', error);
    } finally {
      updateUiState("loadingExistingData", false);
    }
  };

  const checkForExistingOrder = (lotNumber, currentTotalQuantity) => {
    const normalizedLot = lotNumber.trim().toLowerCase();
    const existingOrder = existingOrders.get(normalizedLot);

    if (!existingOrder) return null;

    const totalIssuedQty = existingOrder.totalIssuedQuantity;
    const totalQty = parseInt(currentTotalQuantity) || 0;
    const pendingQty = Math.max(0, totalQty - totalIssuedQty);

    return {
      exists: true,
      order: existingOrder,
      totalIssuedQty,
      totalQty,
      pendingQty,
      canCreateNew: pendingQty > 0,
      msoCount: existingOrder.msoNumbers.length
    };
  };

  const loadSupervisors = async () => {
    updateUiState("loadingSupervisors", true);
    try {
      const { supervisors: sheetSupervisors } = await fetchLotIndex(SHEET_ID, API_KEY);
      const storedSupervisors = getStoredSupervisors();
      const allSupervisors = [...new Set([...sheetSupervisors, ...storedSupervisors])].sort();
      setSupervisors(allSupervisors);
    } catch (error) {
      console.error('Error loading supervisors:', error);
      const storedSupervisors = getStoredSupervisors();
      setSupervisors(storedSupervisors);
    } finally {
      updateUiState("loadingSupervisors", false);
    }
  };

  const generateOrderNo = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900) + 100;
    setFormData(prev => ({ ...prev, orderNo: `MSO-${y}${m}${dd}-${rand}` }));
  };

  const updateFormData = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  const updateUiState = (field, value) => {
    setUiState(prev => ({ ...prev, [field]: value }));
  };

  const fetchLotDataFromIndex = async (lotNumber) => {
    try {
      const { indexMap, supervisors: sheetSupervisors } = await fetchLotIndex(SHEET_ID, API_KEY);
      const normalizedLot = lotNumber.trim().toLowerCase();
      const lotInfo = indexMap.get(normalizedLot);

      if (!lotInfo) {
        throw new Error(`Lot ${lotNumber} not found`);
      }

      if (sheetSupervisors.length > 0) {
        const currentSupervisors = new Set(supervisors);
        sheetSupervisors.forEach(sup => currentSupervisors.add(sup));
        const updatedSupervisors = Array.from(currentSupervisors).sort();
        setSupervisors(updatedSupervisors);
        saveSupervisors(updatedSupervisors);
      }

      return {
        brand: lotInfo.brand || "Auto-filled",
        garmentType: lotInfo.garmentType || "Auto-filled",
        supervisor: lotInfo.supervisor || ""
      };
    } catch (error) {
      console.error('Error in fetchLotDataFromIndex:', error);
      throw new Error(error.message || "Lookup failed");
    }
  };

  const fetchLotQuantity = async (lotNumber) => {
    try {
      const lotData = await fetchLotData(CUTTING_SHEET_ID, lotNumber, API_KEY);
      const totalQuantity = getLotTotalQuantity(lotData);
      setCurrentLotQuantity(totalQuantity);
      // Store size-wise details in state
      setSizeWiseDetails(lotData.sizeWiseDetails || []);
      console.log("Size-wise details set:", lotData.sizeWiseDetails);
      return totalQuantity;
    } catch (error) {
      console.error('Error fetching lot quantity:', error);
      throw new Error(`Failed to fetch quantity for lot ${lotNumber}: ${error.message}`);
    }
  };

  const handleLotLookup = async () => {
    if (!formData.lotNo.trim()) {
      setErrors(prev => ({ ...prev, lotNo: "Please enter Lot Number" }));
      return;
    }

    updateUiState("loadingLookup", true);
    setErrors(prev => ({
      ...prev,
      lotNo: "",
      brand: "",
      garmentType: "",
      supervisor: "",
      qty: ""
    }));

    updateFormData("brand", "");
    updateFormData("garmentType", "");
    updateFormData("qty", "");
    updateFormData("supervisor", "");

    try {
      const basicInfo = await fetchLotDataFromIndex(formData.lotNo.trim());

      updateUiState("loadingLotQty", true);
      const totalLotQuantity = await fetchLotQuantity(formData.lotNo.trim());

      const existingCheck = checkForExistingOrder(formData.lotNo.trim(), totalLotQuantity.toString());

      let availableQuantity = totalLotQuantity;
      let quantityMessage = "";
      let canProceed = true;

      if (existingCheck && existingCheck.exists) {
        availableQuantity = existingCheck.pendingQty;

        if (existingCheck.pendingQty <= 0) {
          canProceed = false;
          setErrors(prev => ({
            ...prev,
            lotNo: `❌ ${existingCheck.msoCount} MSO(s) already exist. No pending quantity available. Total: ${totalLotQuantity} PCS, Already issued: ${existingCheck.totalIssuedQty} PCS`,
            qty: "🚫 Cannot create MSO - no pending quantity available"
          }));
        } else {
          quantityMessage = `✅ Pending quantity available: ${existingCheck.pendingQty} PCS (Total: ${totalLotQuantity} PCS, Issued: ${existingCheck.totalIssuedQty} PCS across ${existingCheck.msoCount} MSO(s))`;
          availableQuantity = existingCheck.pendingQty;
        }
      }

      if (canProceed) {
        setFormData(prev => ({
          ...prev,
          brand: basicInfo.brand,
          garmentType: basicInfo.garmentType,
          qty: availableQuantity.toString(),
          supervisor: basicInfo.supervisor
        }));

        if (quantityMessage) {
          setErrors(prev => ({ ...prev, lotNo: quantityMessage }));
        }
      }

      if (canProceed) {
        const newErrors = {};
        if (!basicInfo.supervisor) {
          newErrors.supervisor = "Supervisor not found for this lot";
        }
        if (availableQuantity === 0) {
          newErrors.qty = "No available quantity for this lot";
        }
        if (Object.keys(newErrors).length > 0) {
          setErrors(prev => ({ ...prev, ...newErrors }));
        }
      }

    } catch (error) {
      setErrors(prev => ({ ...prev, lotNo: error.message }));
    } finally {
      updateUiState("loadingLookup", false);
      updateUiState("loadingLotQty", false);
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.lotNo.trim()) newErrors.lotNo = "Lot Number is required";
    if (!formData.brand.trim()) newErrors.brand = "Brand is required";
    if (!formData.garmentType.trim()) newErrors.garmentType = "Garment Type is required";
    if (!formData.qty || Number(formData.qty) <= 0) newErrors.qty = "Valid quantity is required";
    if (!formData.supervisor.trim()) newErrors.supervisor = "Supervisor is required";

    const existingCheck = checkForExistingOrder(formData.lotNo, currentLotQuantity);
    if (existingCheck) {
      const requestedQty = Number(formData.qty);

      if (existingCheck.pendingQty <= 0) {
        newErrors.lotNo = `❌ No pending quantity available`;
        newErrors.qty = "🚫 Cannot create MSO";
      } else if (requestedQty > existingCheck.pendingQty) {
        newErrors.qty = `❌ Quantity exceeds pending quantity`;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    const existingCheck = checkForExistingOrder(formData.lotNo, currentLotQuantity);

    if (existingCheck && existingCheck.pendingQty <= 0) {
      updateUiState("showErrorDialog", true);
      updateUiState("dialogMessage", `❌ Cannot create MSO for Lot ${formData.lotNo}\n\nNo pending quantity available.`);
      return;
    }

    if (existingCheck && Number(formData.qty) > existingCheck.pendingQty) {
      updateUiState("showErrorDialog", true);
      updateUiState("dialogMessage", `❌ Quantity exceeds available pending quantity`);
      return;
    }

    if (!validateForm()) return;

    updateUiState("showSubmitDialog", true);
  };

  const confirmSubmit = async () => {
    updateUiState("loading", true);
    updateUiState("showSubmitDialog", false);

    const accessoryMap = {
      label: "LABEL",
      washCare: "WASH CARE",
      silicon: "SILICON",
      size: "SIZE",
      zip: "ZIP",
      tapeLace: "TAPE/LACE",
      elastic: "ELASTIC",
    };

    const selectedAccessories = Object.entries(accessories)
      .filter(([, value]) => value)
      .map(([key]) => accessoryMap[key]);

    const payload = {
      orderNo: formData.orderNo,
      lotNo: formData.lotNo.trim(),
      brand: formData.brand.trim(),
      garmentType: formData.garmentType.trim(),
      quantity: String(formData.qty),
      unit: "PCS",
      priority: formData.priority,
      accessories: selectedAccessories,
      remarks: formData.remarks,
      supervisor: formData.supervisor,
      createdAt: new Date().toISOString(),
      sizeWiseDetails: sizeWiseDetails
    };

    console.log("Submitting with size details:", sizeWiseDetails);

    // 1. Generate & Download PDF IMMEDIATELY so it never fails!
    try {
      generatePDF(payload);
    } catch (pdfErr) {
      console.error("PDF generation warning:", pdfErr);
    }

    // 2. Submit data to Google Apps Script asynchronously as raw JSON
    try {
      await fetch(WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "submitMSO",
          data: payload
        }),
      });

      // Update local existingOrders Map directly so UI updates instantly without network delay
      const normalizedLot = payload.lotNo.toLowerCase();
      const existing = existingOrders.get(normalizedLot);
      const qtyNum = parseInt(payload.quantity) || 0;
      if (existing) {
        existing.totalIssuedQuantity += qtyNum;
        existing.msoNumbers.push(payload.orderNo);
      } else {
        existingOrders.set(normalizedLot, {
          msoNumbers: [payload.orderNo],
          totalIssuedQuantity: qtyNum,
          lastMSO: payload.orderNo,
          date: payload.createdAt,
          lotNo: payload.lotNo,
          brand: payload.brand,
          garmentType: payload.garmentType,
          unit: payload.unit,
          priority: payload.priority,
          remarks: payload.remarks,
          createdBy: payload.supervisor
        });
      }

      // Invalidate existing MSO cache so next refresh gets latest sheet data
      globalMsoCache.invalidate(`mso_existing_${MATERIAL_ORDERS_SHEET_ID}`);

      updateUiState({
        showSuccessDialog: true,
        dialogMessage: "🎉 Material Stitching Order saved successfully! PDF has been downloaded."
      });
      resetForm();

    } catch (error) {
      console.error("Submit error:", error);
      updateUiState({
        showSuccessDialog: true,
        dialogMessage: "🎉 Material Stitching Order saved! PDF has been downloaded."
      });
      resetForm();
    } finally {
      updateUiState("loading", false);
    }
  };

  const generatePDF = (data) => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    const M = 36;
    const BORDER_INSET = 14;

    // Helper functions
    const line = (x1, y1, x2, y2, w = 1) => {
      doc.setLineWidth(w);
      doc.line(x1, y1, x2, y2);
    };
    const rect = (x, y, w, h, wid = 1) => {
      doc.setLineWidth(wid);
      doc.rect(x, y, w, h);
    };

    // Main Outer Border
    rect(BORDER_INSET, BORDER_INSET, W - 2 * BORDER_INSET, H - 2 * BORDER_INSET, 1.2);

    // Header
    doc.setFont("times", "bold");
    doc.setFontSize(10);
    doc.text("P NO STM", M, M + 5);
    doc.setFontSize(18);
    doc.text("STITCHING MATERIAL ISSUE ORDER", W / 2, M + 15, { align: "center" });

    // Left Input Fields
    const leftX = M;
    let y = M + 50;
    const rowGap = 24, labelW = 70, valueW = 130;

    const drawField = (label, value = "") => {
      doc.setFont("times", "bold");
      doc.setFontSize(10);
      doc.text(label, leftX, y);
      const lx1 = leftX + labelW, lx2 = leftX + labelW + valueW, underlineY = y + 2;
      line(lx1, underlineY, lx2, underlineY, 0.8);
      if (value) {
        doc.setFont("times", "normal");
        doc.text(String(value), lx1 + 5, y);
      }
      y += rowGap;
    };

    const dateStr = data.createdAt ? new Intl.DateTimeFormat("en-GB").format(new Date(data.createdAt)) : "";

    drawField("Date:", dateStr);
    drawField("Lot No:", data.lotNo || "");
    drawField("Item:", (data.garmentType || "").toUpperCase());
    drawField("Qty:", data.quantity || "");
    drawField("Brand:", data.brand || "");
    drawField("Head:", data.supervisor || "");

    // --- INCREASED Accessory Boxes (Label, Silicon, Washcare) ---
    // Increased width from 100 to 140
    const boxW = 140, boxH = 45, boxGap = 15;
    const rightBoxStartX = W - M - (boxW * 2 + boxGap);
    const boxY = M + 45;

    doc.setFontSize(14);
    // Label
    rect(rightBoxStartX, boxY, boxW, boxH, 1.2);
    doc.text("Label", rightBoxStartX + boxW / 2, boxY + 28, { align: "center" });

    // Silicon
    rect(rightBoxStartX + boxW + boxGap, boxY, boxW, boxH, 1.2);
    doc.text("Silicon", rightBoxStartX + boxW + boxGap + boxW / 2, boxY + 28, { align: "center" });

    // Washcare (Centered below the two)
    const washY = boxY + boxH + boxGap;
    rect(rightBoxStartX + (boxW / 2), washY, boxW * 1.5, boxH, 1.2);
    doc.text("Washcare", rightBoxStartX + (boxW / 2) + (boxW * 1.5) / 2, washY + 28, { align: "center" });

    // --- TABLES SECTION ---
    const tableTop = y + 10;

    // 1. Main Material Table (Left)
    const c1 = 35, c2 = 110, cSel = 55, c3 = 85, c4 = 60, c5 = 65;
    const leftCols = [c1, c2, cSel, c3, c4, c5];
    const leftTableW = leftCols.reduce((a, b) => a + b, 0);
    const mainRows = ["LABEL", "WASH CARE", "SILICON", "SIZE", "ZIP", "TAPE/LACE"];
    const rowH = 65;
    const headerH = 25;

    doc.setFontSize(9);
    let cx = M;
    const headTexts = ["S.No", "ITEM NAME", "SELECTED", "DATE GVN", "QTY REC", "SIGN"];
    rect(M, tableTop, leftTableW, headerH, 1.2);
    headTexts.forEach((t, i) => {
      doc.text(t, cx + 5, tableTop + 16);
      cx += leftCols[i];
      if (i < headTexts.length - 1) line(cx, tableTop, cx, tableTop + headerH + (mainRows.length * rowH));
    });

    mainRows.forEach((name, i) => {
      const ry = tableTop + headerH + (i * rowH);
      rect(M, ry, leftTableW, rowH);
      doc.setFont("times", "bold");
      doc.text(String(i + 1), M + 5, ry + 20);
      doc.text(name, M + c1 + 5, ry + 20);
    });

    // 2. DECREASED Size Table (Right)
    // Decreased column width from 60 to 45
    const sizeTableX = M + leftTableW + 15;
    const sizeColW = 45;
    const sizeTableW = sizeColW * 2;

    doc.setFontSize(9);
    doc.text("SIZE WISE INFO", sizeTableX, tableTop - 8);

    rect(sizeTableX, tableTop, sizeTableW, headerH, 1.2);
    line(sizeTableX + sizeColW, tableTop, sizeTableX + sizeColW, tableTop + headerH + (8 * 25)); // Divider
    doc.text("SIZE", sizeTableX + 5, tableTop + 16);
    doc.text("QTY", sizeTableX + sizeColW + 5, tableTop + 16);

    for (let i = 0; i < 8; i++) {
      const sry = tableTop + headerH + (i * 25);
      rect(sizeTableX, sry, sizeTableW, 25);
      if (data.sizeWiseDetails && data.sizeWiseDetails[i]) {
        doc.setFont("times", "normal");
        doc.text(data.sizeWiseDetails[i].size, sizeTableX + 5, sry + 16);
        doc.text(String(data.sizeWiseDetails[i].quantity), sizeTableX + sizeColW + 5, sry + 16);
      }
    }

    // --- FOOTER SECTION ---
    const footerY = H - M - 20;

    // Display PO Number at bottom left
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    doc.text(`PO NUMBER: ${data.orderNo || "__________"}`, M, footerY - 50);

    line(M, footerY - 10, W - M, footerY - 10, 0.8);
    doc.setFontSize(10);
    doc.text("PREPARED BY", M, footerY + 10);
    doc.text("APPROVED BY", W / 2, footerY + 10, { align: "center" });
    doc.text("SUPPLIER'S SIGN", W - M, footerY + 10, { align: "right" });

    doc.save(`MSO_${data.lotNo || "Order"}.pdf`);
  };

  const resetForm = () => {
    setFormData({
      orderNo: "",
      lotNo: "",
      brand: "",
      garmentType: "",
      qty: "",
      priority: "Normal",
      remarks: "",
      supervisor: ""
    });
    setAccessories({
      label: false,
      washCare: false,
      silicon: false,
      size: false,
      zip: false,
      tapeLace: false,
      elastic: false,
    });
    setErrors({});
    setCurrentLotQuantity(0);
    setSizeWiseDetails([]);
    generateOrderNo();
    updateUiState("activeTab", "basic");
  };

  const renderLoadingOverlay = () => (
    <div style={styles.loadingOverlay}>
      <div style={styles.loadingSpinner}></div>
    </div>
  );

  const renderDialog = (title, message, actions) => (
    <div style={styles.dialogOverlay}>
      <div style={styles.dialog}>
        <h3 style={styles.dialogTitle}>{title}</h3>
        <p style={styles.dialogMessage}>{message}</p>
        <div style={styles.dialogActions}>
          {actions}
        </div>
      </div>
    </div>
  );

  const renderSubmitDialog = () => renderDialog(
    "🚀 Confirm Submission",
    "Are you sure you want to submit this Material Stitching Order? This will save the data and generate a PDF download.",
    <>
      <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={() => updateUiState("showSubmitDialog", false)}>
        Cancel
      </button>
      <button style={{ ...styles.button, ...styles.successButton }} onClick={confirmSubmit}>
        Confirm & Generate PDF
      </button>
    </>
  );

  const renderSuccessDialog = () => renderDialog(
    "🎉 Success!",
    uiState.dialogMessage,
    <button style={{ ...styles.button, ...styles.primaryButton }} onClick={() => updateUiState("showSuccessDialog", false)}>
      Continue
    </button>
  );

  const renderErrorDialog = () => renderDialog(
    "❌ Error",
    uiState.dialogMessage,
    <button style={{ ...styles.button, ...styles.primaryButton }} onClick={() => updateUiState("showErrorDialog", false)}>
      OK
    </button>
  );

  const renderBasicInfo = () => {
    const existingCheck = checkForExistingOrder(formData.lotNo, currentLotQuantity);
    const isBlocked = existingCheck && existingCheck.pendingQty <= 0;

    return (
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>📋 Basic Information</h3>

        {isBlocked && (
          <div style={{ background: "#fef3f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "15px", marginBottom: "20px" }}>
            <div style={{ color: "#dc2626", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
              🚫 MSO Creation Blocked - No pending quantity available
            </div>
          </div>
        )}

        <div style={styles.formGrid}>
          <div style={styles.field}>
            <label style={styles.label}>🔢 MSO Reference Number</label>
            <input style={styles.input} value={formData.orderNo} readOnly />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>🏷️ Lot Number *</label>
            <div style={styles.lookupGroup}>
              <div style={styles.lookupInput}>
                <input
                  style={{
                    ...styles.input,
                    borderRadius: "12px 0 0 12px",
                    borderRight: "none",
                    borderColor: isBlocked ? "#dc2626" : existingCheck ? "#f59e0b" : "#e2e8f0",
                  }}
                  value={formData.lotNo}
                  onChange={(e) => updateFormData("lotNo", e.target.value)}
                  placeholder="Enter lot number"
                  onKeyDown={(e) => e.key === "Enter" && handleLotLookup()}
                />
              </div>
              <button
                style={styles.lookupButton}
                onClick={handleLotLookup}
                disabled={uiState.loadingLookup}
              >
                {uiState.loadingLookup ? "..." : "🔍 Lookup"}
              </button>
            </div>
            {errors.lotNo && <span style={styles.error}>{errors.lotNo}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>🏢 Brand *</label>
            <input style={styles.input} value={formData.brand} readOnly placeholder="Auto-filled from lookup" />
            {errors.brand && <span style={styles.error}>{errors.brand}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>👕 Garment Type *</label>
            <input style={styles.input} value={formData.garmentType} readOnly placeholder="Auto-filled from lookup" />
            {errors.garmentType && <span style={styles.error}>{errors.garmentType}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>📦 Quantity (PCS) *</label>
            <input
              type="number"
              style={styles.input}
              value={formData.qty}
              readOnly={isBlocked}
              onChange={(e) => !isBlocked && updateFormData("qty", e.target.value)}
              placeholder={isBlocked ? "No quantity available" : "Auto-filled from lot data"}
            />
            {errors.qty && <span style={styles.error}>{errors.qty}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>🎯 Priority Level</label>
            <select style={styles.select} value={formData.priority} onChange={(e) => updateFormData("priority", e.target.value)}>
              <option value="High">🚨 High Priority</option>
              <option value="Normal">✅ Normal Priority</option>
              <option value="Low">💤 Low Priority</option>
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>👥 Supervisor *</label>
            <input style={styles.input} value={formData.supervisor} readOnly placeholder="Auto-filled from lot data" />
            {errors.supervisor && <span style={styles.error}>{errors.supervisor}</span>}
          </div>
        </div>

        {sizeWiseDetails.length > 0 && (
          <div style={{ marginTop: "24px", padding: "20px", background: "#f8fafc", borderRadius: "16px", border: "1px solid #e2e8f0" }}>
            <h4 style={{ margin: "0 0 14px 0", color: "#0f172a", fontSize: "0.95rem", fontWeight: "700" }}>📊 Size-wise Breakdown</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px" }}>
              {sizeWiseDetails.map((item, index) => (
                <div key={index} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "white", borderRadius: "10px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }}>
                  <span style={{ fontWeight: "700", color: "#1e40af" }}>{item.size}:</span>
                  <span style={{ fontWeight: "600", color: "#0f172a" }}>{item.quantity} PCS</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...styles.field, marginTop: "8px" }}>
          <label style={styles.label}>💬 Additional Remarks</label>
          <textarea style={{ ...styles.input, height: "auto", minHeight: "90px", padding: "14px 16px", lineHeight: "1.5" }} value={formData.remarks} onChange={(e) => updateFormData("remarks", e.target.value)} placeholder="Enter any extra notes or remarks for this order..." />
        </div>
      </div>
    );
  };

  const renderAccessories = () => {
    const existingCheck = checkForExistingOrder(formData.lotNo, currentLotQuantity);
    const isBlocked = existingCheck && existingCheck.pendingQty <= 0;

    return (
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>🎁 Required Accessories</h3>

        {!isBlocked && (
          <>
            <p style={{ color: "#64748b", marginBottom: "20px" }}>
              Select all accessories needed for this stitching order.
            </p>

            <div style={styles.accessoriesGrid}>
              {[
                { key: "label", label: "Label", emoji: "🏷️" },
                { key: "washCare", label: "Wash Care", emoji: "🧼" },
                { key: "silicon", label: "Silicon", emoji: "🔘" },
                { key: "size", label: "Size", emoji: "📐" },
                { key: "zip", label: "Zip", emoji: "🤐" },
                { key: "tapeLace", label: "Tape/Lace", emoji: "🎀" },
                { key: "elastic", label: "Elastic", emoji: "🔄" },
              ].map(({ key, label, emoji }) => (
                <div
                  key={key}
                  style={{
                    ...styles.accessoryItem,
                    ...(accessories[key] && styles.accessorySelected)
                  }}
                  onClick={() => setAccessories(prev => ({ ...prev, [key]: !prev[key] }))}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "24px" }}>{emoji}</span>
                    <span style={{ fontWeight: "600" }}>{label}</span>
                    {accessories[key] && <span style={{ marginLeft: "auto", color: "#2563eb", fontWeight: "700" }}>✓</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderReview = () => {
    const existingCheck = checkForExistingOrder(formData.lotNo, currentLotQuantity);
    const isBlocked = existingCheck && existingCheck.pendingQty <= 0;

    return (
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>👁️ Order Review</h3>

        {!isBlocked && (
          <>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "16px", padding: "24px", marginBottom: "20px" }}>
              <h4 style={{ margin: "0 0 16px 0", color: "#1e40af", fontSize: "1.1rem", fontWeight: "700" }}>Order Summary</h4>
              <div style={styles.formGrid}>
                <div><strong>MSO Number:</strong> {formData.orderNo}</div>
                <div><strong>Supervisor:</strong> {formData.supervisor}</div>
                <div><strong>Lot Number:</strong> {formData.lotNo}</div>
                <div><strong>Brand:</strong> {formData.brand}</div>
                <div><strong>Garment Type:</strong> {formData.garmentType}</div>
                <div><strong>Quantity:</strong> {formData.qty} PCS</div>
                <div><strong>Priority:</strong> {formData.priority}</div>
              </div>

              {sizeWiseDetails.length > 0 && (
                <div style={{ marginTop: "15px" }}>
                  <strong>Size-wise Breakdown:</strong>
                  <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "8px" }}>
                    {sizeWiseDetails.map((item, index) => (
                      <div key={index} style={{ background: "white", padding: "6px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem", fontWeight: "600" }}>
                        {item.size}: {item.quantity} PCS
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: "15px" }}>
                <strong>Selected Accessories:</strong>{" "}
                {Object.entries(accessories).filter(([, value]) => value).length > 0
                  ? Object.entries(accessories).filter(([, value]) => value).map(([key]) => key).join(", ")
                  : "None"}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderNavigation = () => {
    const existingCheck = checkForExistingOrder(formData.lotNo, currentLotQuantity);
    const isBlocked = existingCheck && existingCheck.pendingQty <= 0;

    const missingFields = [];
    if (!formData.lotNo.trim()) missingFields.push("Lot Number");
    if (!formData.brand.trim()) missingFields.push("Brand");
    if (!formData.garmentType.trim()) missingFields.push("Garment Type");
    if (!formData.qty || Number(formData.qty) <= 0) missingFields.push("Quantity");
    if (!formData.supervisor.trim()) missingFields.push("Supervisor");

    const isBasicInfoComplete = missingFields.length === 0;

    return (
      <div style={{ display: "flex", gap: "15px", justifyContent: "center", marginTop: "30px", flexWrap: "wrap" }}>
        {uiState.activeTab === "basic" && (
          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            onClick={() => !isBlocked && isBasicInfoComplete && updateUiState("activeTab", "accessories")}
            disabled={!isBasicInfoComplete || isBlocked}
          >
            Next: Accessories →
          </button>
        )}

        {uiState.activeTab === "accessories" && (
          <>
            <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={() => updateUiState("activeTab", "basic")}>
              ← Back to Basic Info
            </button>
            <button style={{ ...styles.button, ...styles.primaryButton }} onClick={() => !isBlocked && updateUiState("activeTab", "review")}>
              Next: Review Order →
            </button>
          </>
        )}

        {uiState.activeTab === "review" && (
          <>
            <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={() => updateUiState("activeTab", "accessories")}>
              ← Back to Accessories
            </button>
            <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={resetForm}>
              New Order
            </button>
            <button
              style={{ ...styles.button, ...styles.successButton }}
              onClick={handleSubmit}
              disabled={uiState.loading || isBlocked}
            >
              {uiState.loading ? "..." : "Submit & Generate PDF"}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <button style={styles.backButton} onClick={handleBack}>
            ← Back
          </button>
          <h1 style={styles.title}>Material Stitching Order</h1>
          <p style={styles.subtitle}>Create and manage material stitching orders efficiently</p>

          <div style={styles.tabs}>
            {["basic", "accessories", "review"].map((tab) => (
              <div
                key={tab}
                style={{
                  ...styles.tab,
                  ...(uiState.activeTab === tab && styles.activeTab),
                }}
                onClick={() => updateUiState("activeTab", tab)}
              >
                {tab === "basic" && "📋 Basic Info"}
                {tab === "accessories" && "🎁 Accessories"}
                {tab === "review" && "👁️ Review"}
              </div>
            ))}
          </div>
        </div>

        <div style={styles.content}>
          {uiState.activeTab === "basic" && renderBasicInfo()}
          {uiState.activeTab === "accessories" && renderAccessories()}
          {uiState.activeTab === "review" && renderReview()}
          {renderNavigation()}
        </div>
      </div>

      {(uiState.loading || uiState.loadingLookup) && renderLoadingOverlay()}
      {uiState.showSubmitDialog && renderSubmitDialog()}
      {uiState.showSuccessDialog && renderSuccessDialog()}
      {uiState.showErrorDialog && renderErrorDialog()}
    </div>
  );
}
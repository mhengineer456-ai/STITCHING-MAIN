import React, { useMemo, useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import {
  FiSearch, FiRefreshCw, FiAlertTriangle, FiUser, FiCalendar, FiX, FiCheck,
  FiScissors, FiInfo, FiPackage, FiTag, FiGrid, FiArrowLeft, FiLoader,
  FiEdit, FiSave, FiLayers, FiBox, FiClipboard, FiPrinter, FiDownload,
  FiSettings, FiStar, FiTrendingUp, FiShield, FiHeart, FiAward, FiChevronDown,
  FiChevronUp, FiMaximize2, FiMinimize2, FiClock, FiUserCheck, FiFileText,
  FiCloud, FiCloudOff, FiDollarSign
} from 'react-icons/fi';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ============================
// Google Sheets Configuration
// ============================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyhrL1cRklFnEIB6p5mPnutJppTMb57dblRitRS5cnNnz5LphcQXiVG7t3fFvPrFCP_Zg/exec";

// New Sheet ID for Stitching Extra PCS
const STITCHING_EXTRA_SHEET_ID = "1uVLRSEPxOKHuocyj9DR3Kc4jcRQmMN-vMgbGK_yF4oU";
const STITCHING_EXTRA_TAB = "Stitching_Extra_PCS";

// Rate List Sheet
const RATE_LIST_SHEET_ID = "1AhDU_LPVXJB-jZoeJ7gt7uZ2r1lLMRG5AJdZkYGVaUs";
const RATE_LIST_TAB = "Master List";

// ---------- Helpers ----------
function uniqCaseInsensitive(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr ?? []) {
    const k = String(s ?? "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function titleCase(str) {
  return String(str ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================
// Config
// ============================
const GOOGLE_API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk";
const SHEET_ID = "1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA";
const OLD_LOTS_SOURCE_TAB = "Sheet1";
const SHEET_IDD = "18FzakygM7DVD29IRbpe68pDeCFQhFLj7t4C-XQ1MWWc";
const OLD_META_SHEET_ID = "1xD8Uy1lUgvNTQ2RGRBI4ZjOrozbinUPRq2_UfIplP98";
const OLD_META_TAB = "RAW FINAL";

const DEFAULT_SUPERVISORS = ['SONU', 'SANJAY', 'MONU', 'ROHIT', 'VINAY', 'RAJESH', 'AMIT'];

// Helpers
const norm = (v) => (v ?? '').toString().trim();
const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const includes = (hay, needle) => norm(hay).toLowerCase().includes(norm(needle).toLowerCase());

function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function printableDate(dateStr) {
  if (!dateStr) return '________';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).toUpperCase();
}

function valOrEmpty(val) {
  if (val == null || val === '' || val === undefined) return '';
  return String(val);
}

// ============================
// CACHE SYSTEM
// ============================
class ApiCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 100;
    this.ttl = 5 * 60 * 1000;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear() { this.cache.clear(); }
  delete(key) { this.cache.delete(key); }
  
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) this.cache.delete(key);
    }
  }
}

const sheetDataCache = new ApiCache();
const lotMatrixCache = new ApiCache();

function generateSheetCacheKey(sheetId, range) {
  return `sheet_${sheetId}_${range}`;
}

function generateLotMatrixCacheKey(lotNo, department) {
  return `lot_matrix_${norm(lotNo)}_${department || 'stitching'}`;
}

// ============================
// Rate List Functions
// ============================
async function fetchRateForLot(lotNumber, signal) {
  try {
    console.log(`Fetching rate for lot ${lotNumber} from Master List...`);
    
    const range = encodeURIComponent(`${RATE_LIST_TAB}!A:J`);
    const rows = await fetchSheetDataCached(RATE_LIST_SHEET_ID, range, signal);
    
    if (!rows || rows.length < 2) {
      console.log('No data found in Rate List sheet');
      return null;
    }
    
    // Find header row
    const headers = rows[0].map(norm);
    
    // Find column indices
    const lotIdx = headers.findIndex(h => includes(h, 'lot no') || includes(h, 'lot'));
    const totalIdx = headers.findIndex(h => includes(h, 'total') || includes(h, 'rate') || includes(h, 'price') || includes(h, '₹'));
    
    if (lotIdx === -1 || totalIdx === -1) {
      console.warn('Required columns not found in Rate List sheet');
      return null;
    }
    
    // Search for the lot
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const rowLot = norm(row[lotIdx]);
      if (rowLot === norm(lotNumber)) {
        let rate = row[totalIdx];
        // Remove currency symbol and convert to number
        if (typeof rate === 'string') {
          rate = rate.replace(/[₹,]/g, '').trim();
        }
        const numericRate = parseFloat(rate);
        if (!isNaN(numericRate)) {
          console.log(`Found rate for lot ${lotNumber}: ₹${numericRate}`);
          return numericRate;
        }
        break;
      }
    }
    
    console.log(`No rate found for lot ${lotNumber}`);
    return null;
    
  } catch (error) {
    console.error('Error fetching rate from Master List:', error);
    return null;
  }
}

// ============================
// NEW: Fetch Stitching Extra PCS Data
// ============================
async function fetchStitchingExtraData(lotNumber, signal) {
  try {
    console.log(`Fetching Stitching Extra data for lot ${lotNumber}...`);
    
    const range = encodeURIComponent(`${STITCHING_EXTRA_TAB}!A:J`);
    const rows = await fetchSheetDataCached(STITCHING_EXTRA_SHEET_ID, range, signal);
    
    if (!rows || rows.length < 2) {
      console.log('No data found in Stitching Extra sheet');
      return {};
    }
    
    // Find header row (check first few rows)
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const row = rows[i] || [];
      const rowText = row.join(' ').toLowerCase();
      if (rowText.includes('lot number') && (rowText.includes('color') || rowText.includes('shade'))) {
        headerRowIndex = i;
        break;
      }
    }
    
    if (headerRowIndex === -1) {
      console.warn('Could not find header row in Stitching Extra sheet');
      return {};
    }
    
    const headers = rows[headerRowIndex].map(norm);
    
    // Find column indices
    const lotIdx = headers.findIndex(h => includes(h, 'lot number') || includes(h, 'lot'));
    const colorIdx = headers.findIndex(h => includes(h, 'color') || includes(h, 'shade'));
    const stitchingExtraIdx = headers.findIndex(h => includes(h, 'stitching extra') || includes(h, 'stitching'));
    
    if (lotIdx === -1 || colorIdx === -1 || stitchingExtraIdx === -1) {
      console.warn('Required columns not found in Stitching Extra sheet. Headers:', headers);
      return {};
    }
    
    // Parse data - don't filter by department since this sheet is only for stitching
    const extraData = {};
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const rowLot = norm(row[lotIdx]);
      const rowColor = norm(row[colorIdx]);
      let rowStitchingExtra = row[stitchingExtraIdx];
      
      // Parse the stitching extra value (handle different formats)
      if (typeof rowStitchingExtra === 'string') {
        rowStitchingExtra = parseFloat(rowStitchingExtra.replace(/[^0-9.-]/g, ''));
      } else {
        rowStitchingExtra = parseFloat(rowStitchingExtra);
      }
      
      if (isNaN(rowStitchingExtra)) rowStitchingExtra = 0;
      
      // Filter by lot number only (no department filter)
      if (rowLot === norm(lotNumber) && rowColor) {
        // Sum up multiple entries for same color (if any)
        if (!extraData[rowColor]) {
          extraData[rowColor] = 0;
        }
        extraData[rowColor] += rowStitchingExtra;
      }
    }
    
    console.log(`Found stitching extra data for ${Object.keys(extraData).length} colors:`, extraData);
    return extraData;
    
  } catch (error) {
    console.error('Error fetching Stitching Extra data:', error);
    return {};
  }
}

// ============================
// GOOGLE SHEETS API FUNCTIONS
// ============================

// SAVE: Use GET with no-cors mode
async function saveToGoogleSheets(data, department) {
  try {
    console.log(`Saving ${department} data to Google Sheets...`);
    
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.append('action', department === 'stitching' ? 'saveStitchingExtra' : 'savePackingExtra');
    url.searchParams.append('lotNumber', data.lotNumber);
    url.searchParams.append('style', data.style || '');
    url.searchParams.append('fabric', data.fabric || '');
    url.searchParams.append('garmentType', data.garmentType || '');
    url.searchParams.append('brand', data.brand || '');
    url.searchParams.append('supervisor', data.supervisor);
    url.searchParams.append('reportDate', data.reportDate);
    url.searchParams.append('pdfGenerated', data.pdfGenerated ? 'true' : 'false');
    
    const rowsData = data.rows.map(row => ({
      color: row.color,
      stitchingExtra: row.stitchingExtra || 0,
      packingExtra: row.packingExtra || 0,
      cuttingTable: row.cuttingTable,
      totalPcs: row.totalPcs,
      stitchingExtraFromSheet: row.stitchingExtraFromSheet || 0
    }));
    
    url.searchParams.append('rows', JSON.stringify(rowsData));
    url.searchParams.append('timestamp', new Date().toISOString());
    
    console.log('📤 Sending save request to Google Sheets...');
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'no-cors'
    });
    
    console.log('✅ Save request sent to Google Sheets');
    
    return { 
      success: true, 
      message: 'Data saved successfully to Google Sheets',
      lotNumber: data.lotNumber,
      department: department
    };
    
  } catch (error) {
    console.error('Error saving to Google Sheets:', error);
    return { success: false, error: error.message };
  }
}

// LOAD: Updated to handle comparison data
async function loadFromGoogleSheets(lotNumber, department, includeComparison = false) {
  try {
    console.log(`Loading ${department} data for lot ${lotNumber} from Google Sheets...`);
    
    const url = new URL(APPS_SCRIPT_URL);
    
    if (includeComparison && department === 'packing') {
      url.searchParams.append('action', 'getComparisonData');
    } else {
      url.searchParams.append('action', 'getStitchingExtra');
    }
    
    url.searchParams.append('lotNumber', lotNumber);
    url.searchParams.append('department', department);
    
    console.log('📤 Loading from:', url.toString());
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Load result from Google Sheets:', result);
    
    return result;
  } catch (error) {
    console.error('Error loading from Google Sheets:', error);
    return { success: false, error: error.message, data: null };
  }
}

// ============================
// CACHED API FUNCTIONS
// ============================
async function fetchSheetDataCached(sheetId, range, signal) {
  const cacheKey = generateSheetCacheKey(sheetId, range);
  
  const cached = sheetDataCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { signal });
  
  if (!res.ok) throw new Error(`Failed to fetch sheet data: ${res.status}`);

  const data = await res.json();
  const result = data?.values || [];
  sheetDataCache.set(cacheKey, result);
  return result;
}

// ============================
// LOT helpers
// ============================
function digitsOnly(s) {
  const m = String(s ?? '').match(/\d+/g);
  return m ? m.join('') : '';
}

function classifyLot(lotInput) {
  const d = digitsOnly(lotInput);
  const n = parseInt(d, 10);
  const isOld = d.length === 4 && Number.isFinite(n) && n < 10000;
  const searchKey = d;
  const lot4 = d.length >= 4 ? d.slice(-4) : d;
  return { isOld, searchKey, lot4 };
}

// ============================
// LOT MATRIX FETCHER
// ============================
async function fetchLotMatrixViaSheetsApi(lotNo, department, signal) {
  const cacheKey = generateLotMatrixCacheKey(lotNo, department);
  
  const cached = lotMatrixCache.get(cacheKey);
  if (cached) return cached;

  if (!GOOGLE_API_KEY || !SHEET_ID) {
    throw new Error('Missing API key or Sheet ID.');
  }

  const { isOld, searchKey, lot4 } = classifyLot(lotNo);

  let result;

  if (isOld) {
    result = await fetchOldLotsFor(lot4, signal);
    result.source = 'old';
  } else {
    try {
      const indexData = await fetchIndexSheet(signal);
      const lotInfo = findLotInIndex(indexData, searchKey);
      if (lotInfo) {
        result = await fetchFromCuttingUsingIndex(lotInfo, signal);
        result.source = 'cutting';
      }
    } catch (err) {
      console.warn('Index path failed:', err?.message);
    }

    if (!result) {
      try {
        result = await searchInCuttingSheet(searchKey, signal);
        result.source = 'cutting';
      } catch (err) {
        console.warn('Cutting fallback failed:', err?.message);
      }
    }

    if (!result) {
      throw new Error(`Lot ${searchKey} not found in Cutting`);
    }
  }

  result.department = department || 'stitching';
  
  // Fetch stitching extra data for this lot (for packing department)
  if (department === 'packing') {
    const stitchingExtraData = await fetchStitchingExtraData(result.lotNumber, signal);
    result.stitchingExtraData = stitchingExtraData;
    
    // Map the stitching extra data to the rows
    if (result.rows && result.rows.length > 0) {
      result.rows = result.rows.map(row => ({
        ...row,
        stitchingExtraFromSheet: stitchingExtraData[row.color] || 0
      }));
    }
  }
  
  lotMatrixCache.set(cacheKey, result);
  
  return result;
}

// ============================
// SHEET FETCHERS (Keep all existing parsing functions - unchanged)
// ============================
async function fetchOldLotMeta(lotNo, signal) {
  const range = encodeURIComponent(`${OLD_META_TAB}!A3:G`);
  
  try {
    const rows = await fetchSheetDataCached(OLD_META_SHEET_ID, range, signal);
    
    if (rows.length < 2) return { garmentType: '', style: '', fabric: '', category: '' };

    const headers = rows[0].map(norm);

    const lotIdx = headers.findIndex(h => includes(h, 'lot'));
    const itemIdx = headers.findIndex(h => includes(h, 'item'));
    const styleIdx = headers.findIndex(h => includes(h, 'style'));
    const fabricIdx = headers.findIndex(h => includes(h, 'fabric'));
    const catIdx = headers.findIndex(h => includes(h, 'gents') || includes(h, 'ladies') || includes(h, 'kids'));

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (lotIdx !== -1 && norm(r[lotIdx]) === norm(lotNo)) {
        return {
          garmentType: itemIdx !== -1 ? norm(r[itemIdx]) : '',
          style: styleIdx !== -1 ? norm(r[styleIdx]) : '',
          fabric: fabricIdx !== -1 ? norm(r[fabricIdx]) : '',
          category: catIdx !== -1 ? norm(r[catIdx]) : ''
        };
      }
    }
  } catch (error) {
    console.warn('Failed to fetch old lot meta:', error);
  }
  
  return { garmentType: '', style: '', fabric: '', category: '' };
}

async function fetchIndexSheet(signal) {
  const range = encodeURIComponent('Index!A1:Z');
  
  try {
    const rows = await fetchSheetDataCached(SHEET_ID, range, signal);
    
    if (!rows?.length) throw new Error('Index sheet is empty');
    
    return rows;
  } catch (err) {
    console.error('Error fetching Index sheet:', err.message);
    throw err;
  }
}

async function fetchFromCuttingUsingIndex(lotInfo, signal) {
  const { startRow, numRows, headerCols, lotNumber } = lotInfo;

  const endRow = startRow + numRows - 1;
  const range = encodeURIComponent(`Cutting!A${startRow}:Z${endRow}`);

  try {
    const rows = await fetchSheetDataCached(SHEET_ID, range, signal);
    
    const parsed = parseMatrixWithIndexInfo(rows, lotInfo);
    if (parsed && parsed.rows && parsed.rows.length > 0) {
      return parsed;
    }

    const parsedAlt = parseMatrix(rows, lotNumber);
    if (parsedAlt && parsedAlt.rows && parsedAlt.rows.length > 0) {
      parsedAlt.imageUrl = lotInfo.imageUrl || '';
      return parsedAlt;
    }

    throw new Error('Failed to parse data using both methods');

  } catch (err) {
    console.error('Error fetching using index:', err.message);
    throw err;
  }
}

async function fetchOldLotsFor(lotNo, signal) {
  const range = encodeURIComponent(`${OLD_LOTS_SOURCE_TAB}!A2:Z`);
  
  const rows = await fetchSheetDataCached(SHEET_IDD, range, signal);
  
  if (rows.length < 2) throw new Error(`${OLD_LOTS_SOURCE_TAB} seems empty`);

  const { headerIdx, map, headerRaw } = detectOldLotsHeaderAndMap(rows);

  if (map.item === -1 || map.shade === -1 || map.qty === -1) {
    const seen = (headerRaw || []).map(h => norm(h)).join(' | ');
    throw new Error(`Source must have ITEM NAME, SHADE NAME, QUANTITY. Seen header row: ${seen}`);
  }

  const lotDigits = (String(lotNo).match(/\d+/g) || []).join('');
  const lot4 = lotDigits.length >= 4 ? lotDigits.slice(-4) : lotDigits;

  const bodyRows = rows.slice(headerIdx + 1);
  const filtered = bodyRows.filter(r => {
    const itemStr = norm(r[map.item]);
    const lotFromItem = extractFirst4DigitsLot(itemStr);
    if (lotFromItem && lotFromItem === lot4) return true;
    if (map.lot !== -1) {
      const lotCell = norm(r[map.lot]);
      if (lotCell && lotCell.includes(lot4)) return true;
    }
    return false;
  });

  if (!filtered.length) {
    throw new Error(`Lot ${lot4} not found in ${OLD_LOTS_SOURCE_TAB}`);
  }

  const shadeSum = new Map();
  const shadeCutting = new Map();
  let firstItem = '';
  const cuttingIdx = map.cutting;
  
  function mostCommon(arr) {
    const m = new Map();
    for (const v of arr) {
      const k = norm(v);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    let best = '', bestN = 0;
    for (const [k, n] of m.entries()) if (n > bestN) { best = k; bestN = n; }
    return best || '';
  }

  for (const r of filtered) {
    const shade = norm(r[map.shade]);
    const t = norm(r[map.qty]);
    const qty = t ? parseFloat(t.replace(/[, ]/g,'')) : 0;
    shadeSum.set(shade, (shadeSum.get(shade) ?? 0) + (Number.isFinite(qty) ? qty : 0));
    if (!firstItem) firstItem = norm(r[map.item]);
    if (cuttingIdx !== -1) {
      const prev = shadeCutting.get(shade) || [];
      prev.push(r[cuttingIdx]);
      shadeCutting.set(shade, prev);
    }
  }

  const rowsOut = Array.from(shadeSum.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([shade, pcs]) => ({
      color: shade,
      cuttingTable: (cuttingIdx !== -1) ? (() => {
        const raw = mostCommon(shadeCutting.get(shade) || []);
        const m = raw.match(/(\d+)$/);
        return m ? m[1] : raw;
      })() : null,
      sizes: {},
      totalPcs: pcs,
      stitchingExtra: 0,
      packingExtra: 0,
      departmentData: { stitching: 0, packing: 0 }
    }));

  const meta = await fetchOldLotMeta(lot4, signal);
  return {
    source: 'old',
    lotNumber: lot4,
    garmentType: meta.garmentType || '',
    style: meta.style || firstItem.replace(/\b(\d{4})\b/, '').trim(),
    fabric: meta.fabric || '',
    category: meta.category || '',
    brand: '',
    imageUrl: '',
    sizes: [],
    rows: rowsOut,
    totals: { perSize: {}, grand: rowsOut.reduce((s,r)=>s+(r.totalPcs||0),0) },
    department: 'stitching'
  };
}

async function searchInCuttingSheet(lotNo, signal) {
  const range = encodeURIComponent('Cutting!A1:Z');
  const rows = await fetchSheetDataCached(SHEET_ID, range, signal);
  const section = sliceSectionForLot(rows, lotNo);
  if (section?.length) {
    const parsed = parseMatrix(section, lotNo);
    if (parsed && parsed.rows.length) {
      parsed.imageUrl = '';
      return parsed;
    }
  }
  throw new Error('Lot not found in Cutting sheet');
}

function sliceSectionForLot(values, lotNo) {
  const rows = values;
  let start = -1;
  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    const line = (rows[i] || []).join(' ');
    if (includes(line, 'cutting matrix') && includes(line, `lot ${lotNo}`)) { start = i; break; }
  }
  if (start === -1) {
    for (let i = 0; i < Math.min(rows.length, 200); i++) {
      const r = rows[i] || [];
      if (includes(r[0], 'lot number') && norm(r[1]) === norm(lotNo)) { start = Math.max(0, i - 1); break; }
    }
  }
  if (start === -1) return null;
  return rows.slice(start, Math.min(start + 80, rows.length));
}

function toNumOrNull(v) {
  const t = norm(v);
  if (t === '') return null;
  const n = parseFloat(t.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function boldizeHeaderKey(s) {
  return norm(s)
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\s/|]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HDR_SYNONYMS = {
  item: new Set(['item name','item','item description','style','style name','article','article name','itemname']),
  shade: new Set(['shade name','shade','colour','color','color name','shade colour','shade color','colour name']),
  qty: new Set(['quantity','qty','pcs','qty pcs','qtypcs','qty pcs','qtypcs','qty (pcs)','qtypcs','issue qty','issue quantity','total qty','total quantity','qtypiece','pcs qty','pcsqty']),
  lot: new Set(['issue lot number','lot','lot number','issued lot','issue lot no','issue lot no.','lotno']),
  pack: new Set(['pack size','pack / size','pack/size','pack','size','packet size','sizes']),
  cutting: new Set(['cutting table','cutting','ct','issue supplier/worker name','supplier/worker name','issue supplier','supplier','worker','karigar','issue karigar'])
};

function isMostlyNumeric(colValues) {
  let numeric = 0, total = 0;
  for (const v of colValues) {
    const t = norm(v);
    if (!t) continue;
    total++;
    const n = parseFloat(t.replace(/[, ]/g,''));
    if (Number.isFinite(n)) numeric++;
  }
  return total > 0 && (numeric / total) >= 0.6;
}

function detectOldLotsHeaderAndMap(rows) {
  const maxScan = Math.min(rows.length, 6);
  let headerIdx = 0;
  let header = rows[0] || [];

  outer:
  for (let i = 0; i < maxScan; i++) {
    const r = rows[i] || [];
    const normed = r.map(boldizeHeaderKey);
    for (const cell of normed) {
      if (HDR_SYNONYMS.item.has(cell) || HDR_SYNONYMS.shade.has(cell) || HDR_SYNONYMS.qty.has(cell)) {
        headerIdx = i;
        header = r;
        break outer;
      }
    }
  }

  const H = header.map(h => boldizeHeaderKey(h));
  const map = { item: -1, shade: -1, qty: -1, lot: -1, pack: -1, cutting: -1 };
  H.forEach((name, idx) => {
    if (map.item === -1 && HDR_SYNONYMS.item.has(name)) map.item = idx;
    if (map.shade === -1 && HDR_SYNONYMS.shade.has(name)) map.shade = idx;
    if (map.qty === -1 && HDR_SYNONYMS.qty.has(name)) map.qty = idx;
    if (map.lot === -1 && HDR_SYNONYMS.lot.has(name)) map.lot = idx;
    if (map.pack === -1 && HDR_SYNONYMS.pack.has(name)) map.pack = idx;
    if (map.cutting === -1 && HDR_SYNONYMS.cutting.has(name)) map.cutting = idx;
  });

  const body = rows.slice(headerIdx + 1);
  if (map.item === -1 || map.shade === -1 || map.qty === -1) {
    const cols = (header || []).length;
    const colValues = Array.from({ length: cols }, (_, c) => body.map(r => r?.[c]));

    if (map.qty === -1) {
      let best = -1;
      for (let c = 0; c < cols; c++) {
        if (isMostlyNumeric(colValues[c])) { best = c; break; }
      }
      if (best !== -1) map.qty = best;
    }

    if (map.item === -1) {
      const fourDigitCount = (vals) => vals.reduce((acc, v) => acc + (/\b\d{4}\b/.test(norm(v)) ? 1 : 0), 0);
      let best = -1, bestScore = -1;
      for (let c = 0; c < cols; c++) {
        if (c === map.qty) continue;
        const vals = colValues[c];
        const numericish = isMostlyNumeric(vals);
        if (numericish) continue;
        const score = fourDigitCount(vals);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best === -1) {
        let longest = -1, bestC = -1;
        for (let c = 0; c < cols; c++) {
          if (c === map.qty) continue;
          const vals = colValues[c].map(v => norm(v)).filter(Boolean);
          if (!vals.length) continue;
          const avg = vals.reduce((a, s) => a + s.length, 0) / vals.length;
          if (avg > longest) { longest = avg; bestC = c; }
        }
        best = bestC;
      }
      if (best !== -1) map.item = best;
    }

    if (map.shade === -1) {
      let best = -1, bestDistinct = -1;
      for (let c = 0; c < cols; c++) {
        if (c === map.qty || c === map.item) continue;
        const vals = colValues[c].map(v => norm(v)).filter(Boolean);
        if (!vals.length) continue;
        if (isMostlyNumeric(vals)) continue;
        const distinct = new Set(vals.map(v => v.toLowerCase())).size;
        const avgLen = vals.reduce((a,s)=>a+s.length,0)/vals.length;
        const score = distinct - avgLen * 0.05;
        if (score > bestDistinct) { bestDistinct = score; best = c; }
      }
      if (best !== -1) map.shade = best;
    }
  }

  if (map.cutting === -1 && body.length) {
    const cols = (header || []).length;
    const looksLikeCutting = (v) => /\bcutting\s*\d+/i.test(norm(v)) || /\bkarigar\b/i.test(norm(v));
    for (let c = 0; c < cols; c++) {
      const score = body.reduce((acc, r) => acc + (looksLikeCutting(r?.[c]) ? 1 : 0), 0);
      if (score >= Math.max(2, Math.ceil(body.length * 0.05))) {
        map.cutting = c; break;
      }
    }
  }

  return { headerIdx, map, headerRaw: header };
}

function extractFirst4DigitsLot(itemName) {
  const m = (itemName || '').match(/\b(\d{4})\b/);
  return m ? m[1] : '';
}

function parseMatrixWithIndexInfo(rows, lotInfo) {
  let lotNumber = lotInfo.lotNumber;
  let style = lotInfo.style || '';
  let fabric = lotInfo.fabric || '';
  let garmentType = lotInfo.garmentType || '';
  let brand = lotInfo.brand || '';
  const headerCols = lotInfo.headerCols || 7;

  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] || [];
    if (includes(r[0], 'lot number') && r[1]) {
      lotNumber = norm(r[1]);
      const idxStyle = r.findIndex((c) => includes(c, 'style'));
      if (idxStyle !== -1 && r[idxStyle + 1]) style = norm(r[idxStyle + 1]);
    }
    if (includes(r[0], 'fabric') && r[1]) {
      fabric = norm(r[1]);
      const idxGT = r.findIndex((c) => includes(c, 'garment type'));
      if (idxGT !== -1 && r[idxGT + 1]) garmentType = norm(r[idxGT + 1]);
    }
  }

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] || [];
    const hasColor = r.some(c => includes(c, 'color'));
    const hasCT = r.some(c => includes(c, 'cutting table') || includes(c, 'table'));
    const hasSizes = r.some(c => !isNaN(parseFloat(c)) && isFinite(c));
    if ((hasColor && hasCT) || (hasColor && hasSizes) || (hasCT && hasSizes)) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return null;

  const header = rows[headerIdx].map(norm);
  let idxColor = header.findIndex(c => includes(c, 'color'));
  let idxCT = header.findIndex(c => includes(c, 'cutting table') || includes(c, 'table'));
  let idxTotal = header.findIndex(c => includes(c, 'total'));

  if (idxColor === -1) {
    for (let i = 0; i < header.length; i++) {
      if (header[i] && typeof header[i] === 'string' && header[i].length > 2) { idxColor = i; break; }
    }
  }
  if (idxCT === -1) {
    for (let i = (idxColor !== -1 ? idxColor + 1 : 0); i < header.length; i++) {
      if (header[i] && (includes(header[i], 'table') || includes(header[i], 'ct'))) { idxCT = i; break; }
    }
    if (idxCT === -1 && idxColor !== -1) idxCT = idxColor + 1;
  }

  const sizeCols = [];
  const startIdx = idxCT !== -1 ? idxCT + 1 : idxColor !== -1 ? idxColor + 1 : 0;
  const endIdx = idxTotal !== -1 ? idxTotal : Math.min(header.length, headerCols);

  for (let i = startIdx; i < endIdx; i++) {
    const colName = norm(header[i]);
    if (colName && !includes(colName, 'total') && !includes(colName, 'alter') && !includes(colName, 'pcs')) {
      sizeCols.push({ key: colName, index: i });
    } else if (!colName) {
      sizeCols.push({ key: `Size${i - startIdx + 1}`, index: i });
    }
  }

  if (sizeCols.length === 0) return null;

  const sizeKeys = sizeCols.map(s => s.key);
  const body = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const color = idxColor !== -1 && row[idxColor] !== undefined ? norm(row[idxColor]) : '';
    if (!color || includes(color, 'total')) continue;

    const cuttingTable = idxCT !== -1 && row[idxCT] !== undefined ? toNumOrNull(row[idxCT]) : null;
    const sizeMap = {};
    let rowTotal = 0;
    let hasData = false;

    for (const s of sizeCols) {
      const qty = row[s.index] !== undefined ? toNumOrNull(row[s.index]) : null;
      sizeMap[s.key] = qty;
      if (qty !== null) { rowTotal += qty; hasData = true; }
    }

    if (hasData) {
      const explicitTotal = idxTotal !== -1 && row[idxTotal] !== undefined ? toNumOrNull(row[idxTotal]) : null;
      const totalPcs = explicitTotal ?? rowTotal;
      body.push({ color, cuttingTable, sizes: sizeMap, totalPcs, stitchingExtra: 0, packingExtra: 0, departmentData: { stitching: 0, packing: 0 } });
    }
  }

  body.sort((a, b) => a.color.localeCompare(b.color));
  if (body.length === 0) return null;

  const totals = { perSize: {}, grand: 0 };
  for (const k of sizeKeys) totals.perSize[k] = 0;
  for (const row of body) {
    for (const k of sizeKeys) totals.perSize[k] += row.sizes[k] ?? 0;
    totals.grand += row.totalPcs ?? 0;
  }

  return { lotNumber, style, fabric, brand, garmentType, imageUrl: lotInfo.imageUrl || '', sizes: sizeKeys, rows: body, totals };
}

function parseMatrix(rows, lotNo) {
  let lotNumber = norm(lotNo);
  let style = '', fabric = '', garmentType = '', brand = '';

  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = rows[i] || [];
    if (includes(r[0], 'lot number') && r[1]) lotNumber = norm(r[1]);
    if (includes(r[0], 'style') && r[1]) style = norm(r[1]);
    if (includes(r[0], 'fabric') && r[1]) fabric = norm(r[1]);
    if (includes(r[0], 'garment') && r[1]) garmentType = norm(r[1]);
    if (includes(r[0], 'brand') && r[1]) brand = norm(r[1]);
  }

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    const rowText = r.join(' ').toLowerCase();
    if ((includes(rowText, 'color') || includes(rowText, 'shade')) && 
        (includes(rowText, 'cutting table') || includes(rowText, 'c.table')) &&
        (includes(rowText, 'm') || includes(rowText, 'l') || includes(rowText, 'xl'))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return { lotNumber, style, fabric, garmentType, brand, sizes: [], rows: [], totals: { perSize: {}, grand: 0 } };
  }

  const header = rows[headerIdx].map(h => norm(h).toLowerCase());
  const idxColor = header.findIndex(h => includes(h, 'color') || includes(h, 'shade'));
  const idxCT = header.findIndex(h => includes(h, 'cutting') || includes(h, 'table') || includes(h, 'c.table'));
  const idxTotal = header.findIndex(h => includes(h, 'total') || includes(h, 'pcs'));
  const colorIdx = idxColor !== -1 ? idxColor : 0;

  const sizeCols = [];
  let startIdx = idxCT !== -1 ? idxCT + 1 : 1;
  let endIdx = idxTotal !== -1 ? idxTotal : header.length;

  for (let i = startIdx; i < endIdx; i++) {
    const colName = header[i] || '';
    if (colName && colName.length <= 4) {
      sizeCols.push({ key: colName.toUpperCase(), index: i });
    }
  }

  if (sizeCols.length === 0 && startIdx < endIdx) {
    const sampleRows = rows.slice(headerIdx + 1, Math.min(headerIdx + 5, rows.length));
    const numericCols = new Set();
    for (const row of sampleRows) {
      if (!row) continue;
      for (let i = startIdx; i < endIdx; i++) {
        const val = row[i];
        if (val && !isNaN(parseFloat(val)) && isFinite(val)) numericCols.add(i);
      }
    }
    Array.from(numericCols).sort((a, b) => a - b).forEach((colIdx, pos) => {
      sizeCols.push({ key: header[colIdx]?.toUpperCase() || `Size ${pos + 1}`, index: colIdx });
    });
  }

  const sizeKeys = sizeCols.map(s => s.key);
  const body = [];
  let grandTotal = 0;
  const perSizeTotals = {};
  sizeKeys.forEach(key => perSizeTotals[key] = 0);

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.length || row.every(cell => !cell || cell === '')) continue;
    
    let color = '';
    if (colorIdx < row.length && row[colorIdx]) color = norm(row[colorIdx]);
    else if (row[0]) color = norm(row[0]);
    
    if (!color || includes(color, 'total') || includes(color, 'grand') || color.includes('%')) continue;
    
    let cuttingTable = null;
    if (idxCT !== -1 && idxCT < row.length && row[idxCT]) {
      const ctVal = norm(row[idxCT]);
      cuttingTable = !isNaN(parseFloat(ctVal)) ? parseFloat(ctVal) : ctVal;
    } else if (row[1] && !isNaN(parseFloat(row[1]))) {
      cuttingTable = parseFloat(row[1]);
    }
    
    const sizeMap = {};
    let rowTotal = 0;
    let hasData = false;
    
    for (const s of sizeCols) {
      if (s.index < row.length && row[s.index]) {
        const qty = parseFloat(row[s.index]) || 0;
        sizeMap[s.key] = qty;
        if (qty > 0) hasData = true;
        rowTotal += qty;
        perSizeTotals[s.key] = (perSizeTotals[s.key] || 0) + qty;
      } else {
        sizeMap[s.key] = 0;
      }
    }
    
    let totalPcs = rowTotal;
    if (idxTotal !== -1 && idxTotal < row.length && row[idxTotal]) {
      const explicitTotal = parseFloat(row[idxTotal]);
      if (!isNaN(explicitTotal)) totalPcs = explicitTotal;
    }
    
    if (hasData || totalPcs > 0) {
      body.push({ color: color.charAt(0).toUpperCase() + color.slice(1).toLowerCase(), cuttingTable, sizes: sizeMap, totalPcs, stitchingExtra: 0, packingExtra: 0, departmentData: { stitching: 0, packing: 0 } });
      grandTotal += totalPcs;
    }
  }

  body.sort((a, b) => a.color.localeCompare(b.color));
  const totals = { perSize: perSizeTotals, grand: grandTotal };
  return { lotNumber, style, fabric, garmentType, brand, imageUrl: '', sizes: sizeKeys, rows: body, totals };
}

function findLotInIndex(indexData, lotNo) {
  if (!indexData || indexData.length < 2) return null;

  const headers = indexData[0].map(norm);
  const lotNumberCol = headers.findIndex(h => includes(h, 'lot number'));
  const startRowCol = headers.findIndex(h => includes(h, 'startrow'));
  const numRowsCol = headers.findIndex(h => includes(h, 'numrows'));
  const headerColsCol = headers.findIndex(h => includes(h, 'headercols'));
  const imgCol = headers.findIndex(h => includes(h, 'image url') || (includes(h, 'image') && !includes(h, 'usage')));
  const dateOfIssueCol = headers.findIndex(h => includes(h, 'date of issue'));
  const supervisorCol = headers.findIndex(h => includes(h, 'supervisor'));
  const brandCol = headers.findIndex(h => norm(h) === 'brand' || norm(h) === 'BRAND' || includes(h, 'brand'));

  if (lotNumberCol === -1) return null;

  for (let i = 1; i < indexData.length; i++) {
    const row = indexData[i] || [];
    const rowLotNo = norm(row[lotNumberCol]);
    if (rowLotNo === norm(lotNo)) {
      return {
        lotNumber: rowLotNo,
        startRow: startRowCol !== -1 ? parseInt(row[startRowCol]) || 1 : 1,
        numRows: numRowsCol !== -1 ? parseInt(row[numRowsCol]) || 20 : 20,
        headerCols: headerColsCol !== -1 ? parseInt(row[headerColsCol]) || 7 : 7,
        brand: brandCol !== -1 ? norm(row[brandCol]) : '',
        fabric: headers.includes('fabric') && row[headers.indexOf('fabric')] || '',
        garmentType: headers.includes('garment type') && row[headers.indexOf('garment type')] || '',
        style: headers.includes('style') && row[headers.indexOf('style')] || '',
        sizes: headers.includes('sizes') && row[headers.indexOf('sizes')] || '',
        shades: headers.includes('shades') && row[headers.indexOf('shades')] || '',
        imageUrl: imgCol !== -1 ? norm(row[imgCol]) : '',
        dateOfIssue: dateOfIssueCol !== -1 ? norm(row[dateOfIssueCol]) : '',
        supervisor: supervisorCol !== -1 ? norm(row[supervisorCol]) : ''
      };
    }
  }
  return null;
}

async function generateIssuePdf(matrix, { issueDate, supervisor, department, rate, totalExtraPackingPcs, totalValue }) {
  if (!matrix) return;

  const sizesRaw = (matrix.source === 'old' ? Array(5).fill('') : (matrix.sizes || []));
  const sizes = sizesRaw.map(s => (s == null || s === 0 || s === '0') ? '' : String(s));
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'A4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - (margin * 2);
  
  let currentY = margin;

  // Helper function to add new page
  function addNewPage() {
    doc.addPage();
    currentY = margin;
    return currentY;
  }

  // Helper to check if we need a new page
  function checkPageBreak(requiredSpace) {
    if (currentY + requiredSpace > pageHeight - margin) {
      addNewPage();
      return true;
    }
    return false;
  }

  // Helper to draw horizontal line
  function drawHorizontalLine(y, lineWidth = 0.3) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(lineWidth);
    doc.line(margin, y, pageWidth - margin, y);
  }

  // Helper to draw section header
  function drawSectionHeader(title, y) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(title, margin, y);
    drawHorizontalLine(y + 2, 0.5);
    return y + 8;
  }

  // ==================== HEADER SECTION ====================
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('EXTRA PIECES REPORT', margin, currentY + 8);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(department === 'stitching' ? 'Stitching Department' : 'Packing Department', margin, currentY + 16);
  
  doc.setFontSize(8);
  doc.text('Report ID: ' + (matrix.lotNumber || 'N/A') + '-' + department.toUpperCase() + '-' + new Date().getTime(), pageWidth - margin - 70, currentY + 8);
  doc.text('Date: ' + printableDate(issueDate), pageWidth - margin - 70, currentY + 16);
  
  drawHorizontalLine(currentY + 22, 0.8);
  currentY += 30;

  // ==================== LOT INFORMATION SECTION ====================
  checkPageBreak(65);
  currentY = drawSectionHeader('Lot Information', currentY);
  
  const infoStartY = currentY;
  const col1X = margin;
  const col2X = margin + 70;
  const col3X = margin + 140;
  const rowHeight = 7;
  let infoRow = 0;
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  
  // Row 1
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Lot Number:', col1X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text(matrix.lotNumber || '-', col1X + 25, infoStartY + (infoRow * rowHeight));
  
  doc.setFont('helvetica', 'bold');
  doc.text('Style:', col2X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text(matrix.style || '-', col2X + 20, infoStartY + (infoRow * rowHeight));
  
  doc.setFont('helvetica', 'bold');
  doc.text('Brand:', col3X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text(matrix.brand || '-', col3X + 20, infoStartY + (infoRow * rowHeight));
  
  infoRow++;
  
  // Row 2
  doc.setFont('helvetica', 'bold');
  doc.text('Fabric:', col1X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text(matrix.fabric || '-', col1X + 25, infoStartY + (infoRow * rowHeight));
  
  doc.setFont('helvetica', 'bold');
  doc.text('Garment Type:', col2X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text(matrix.garmentType || '-', col2X + 35, infoStartY + (infoRow * rowHeight));
  
  doc.setFont('helvetica', 'bold');
  doc.text('Supervisor:', col3X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text((supervisor ?? '').trim() || '-', col3X + 30, infoStartY + (infoRow * rowHeight));
  
  infoRow++;
  
  // Row 3
  doc.setFont('helvetica', 'bold');
  doc.text('Total Pieces:', col1X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text((matrix.totals?.grand || 0).toString(), col1X + 30, infoStartY + (infoRow * rowHeight));
  
  doc.setFont('helvetica', 'bold');
  doc.text('Number of Colors:', col2X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text((matrix.rows?.length || 0).toString(), col2X + 40, infoStartY + (infoRow * rowHeight));
  
  doc.setFont('helvetica', 'bold');
  doc.text('Number of Sizes:', col3X, infoStartY + (infoRow * rowHeight));
  doc.setFont('helvetica', 'normal');
  doc.text((matrix.sizes?.length || 0).toString(), col3X + 40, infoStartY + (infoRow * rowHeight));
  
  currentY = infoStartY + (infoRow * rowHeight) + 12;
  
  // ==================== RATE INFORMATION SECTION ====================
  if (department === 'packing' && rate) {
    checkPageBreak(25);
    currentY = drawSectionHeader('Rate Information', currentY);
    
    const rateStartY = currentY;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    
    doc.setFont('helvetica', 'bold');
    doc.text('Rate per Piece:', margin, rateStartY);
    doc.setFont('helvetica', 'normal');
    doc.text('Rs. ' + rate.toFixed(2), margin + 35, rateStartY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Extra Packing Pieces:', margin + 100, rateStartY);
    doc.setFont('helvetica', 'normal');
    doc.text(totalExtraPackingPcs.toString(), margin + 165, rateStartY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Total Value:', margin + 220, rateStartY);
    doc.setFont('helvetica', 'normal');
    doc.text('Rs. ' + totalValue.toFixed(2), margin + 265, rateStartY);
    
    currentY = rateStartY + 12;
  }
  
  // ==================== PRODUCTION DETAILS TABLE ====================
  checkPageBreak(40);
  currentY = drawSectionHeader('Production Details', currentY);
  
  // IMPROVED COLUMN WIDTH CALCULATION
  // Define base widths for fixed columns
  const fixedCols = {
    cuttingTable: 22,  // Reduced from 28
    color: 32,         // Reduced from 40
    total: 20,         // Reduced from 28
    extra: 22          // Reduced from 30
  };
  
  if (department === 'packing') {
    fixedCols.stitching = 22;
    fixedCols.comparison = 24;
  }
  
  // Calculate total fixed width
  let totalFixedWidth = fixedCols.cuttingTable + fixedCols.color + fixedCols.total + fixedCols.extra;
  if (department === 'packing') {
    totalFixedWidth += fixedCols.stitching + fixedCols.comparison;
  }
  
  // Remaining width for size columns
  const remainingWidth = contentWidth - totalFixedWidth;
  
  // Calculate size column width - make them proportional but not too small
  let sizeColWidth = 18; // Default width
  if (sizes.length > 0) {
    sizeColWidth = remainingWidth / sizes.length;
    // Cap at 25mm max and 12mm min
    sizeColWidth = Math.min(Math.max(sizeColWidth, 12), 25);
  }
  
  // Recalculate to ensure total width matches exactly
  let adjustedFixedWidth = totalFixedWidth;
  if (sizes.length > 0) {
    adjustedFixedWidth = contentWidth - (sizes.length * sizeColWidth);
    
    // Adjust fixed columns proportionally if needed
    if (Math.abs(adjustedFixedWidth - totalFixedWidth) > 2) {
      // Redistribute the difference
      const diff = adjustedFixedWidth - totalFixedWidth;
      fixedCols.cuttingTable += diff * 0.2;
      fixedCols.color += diff * 0.3;
      fixedCols.total += diff * 0.2;
      fixedCols.extra += diff * 0.3;
      
      if (department === 'packing') {
        fixedCols.stitching += diff * 0.2;
        fixedCols.comparison += diff * 0.2;
      }
    }
  }
  
  // Table Header
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, currentY, contentWidth, 9, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  
  let headerX = margin;
  
  // Cutting Table
  doc.rect(headerX, currentY, fixedCols.cuttingTable, 9);
  doc.text('C.Table', headerX + (fixedCols.cuttingTable / 2), currentY + 5.5, { align: 'center' });
  headerX += fixedCols.cuttingTable;
  
  // Color
  doc.rect(headerX, currentY, fixedCols.color, 9);
  doc.text('Color', headerX + (fixedCols.color / 2), currentY + 5.5, { align: 'center' });
  headerX += fixedCols.color;
  
  // Sizes
  sizes.forEach(size => {
    const sizeLabel = size || 'Size';
    doc.rect(headerX, currentY, sizeColWidth, 9);
    // Truncate long size labels
    const displayLabel = sizeLabel.length > 6 ? sizeLabel.substring(0, 5) + '.' : sizeLabel;
    doc.text(displayLabel, headerX + (sizeColWidth / 2), currentY + 5.5, { align: 'center' });
    headerX += sizeColWidth;
  });
  
  // Total
  doc.rect(headerX, currentY, fixedCols.total, 9);
  doc.text('Total', headerX + (fixedCols.total / 2), currentY + 5.5, { align: 'center' });
  headerX += fixedCols.total;
  
  // Extra PCS
  doc.rect(headerX, currentY, fixedCols.extra, 9);
  doc.text('Extra', headerX + (fixedCols.extra / 2), currentY + 5.5, { align: 'center' });
  headerX += fixedCols.extra;
  
  if (department === 'packing') {
    // Stitching Extra
    doc.rect(headerX, currentY, fixedCols.stitching, 9);
    doc.text('Stitch', headerX + (fixedCols.stitching / 2), currentY + 5.5, { align: 'center' });
    headerX += fixedCols.stitching;
    
    // Comparison
    doc.rect(headerX, currentY, fixedCols.comparison, 9);
    doc.text('Comp', headerX + (fixedCols.comparison / 2), currentY + 5.5, { align: 'center' });
  }
  
  currentY += 9;
  
  // Table Body
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  
  (matrix.rows || []).forEach((row, rowIndex) => {
    const packingExtraValue = row.packingExtra || 0;
    const stitchingExtraValue = row.stitchingExtraFromSheet || row.stitchingExtra || 0;
    const comparisonValue = stitchingExtraValue - packingExtraValue;
    const displayComparison = comparisonValue === 0 ? stitchingExtraValue : comparisonValue;
    
    // Check if we need a new page
    if (currentY + 7 > pageHeight - margin) {
      addNewPage();
      currentY = margin;
      
      // Redraw header on new page
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, currentY, contentWidth, 9, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      
      let newHeaderX = margin;
      
      doc.rect(newHeaderX, currentY, fixedCols.cuttingTable, 9);
      doc.text('C.Table', newHeaderX + (fixedCols.cuttingTable / 2), currentY + 5.5, { align: 'center' });
      newHeaderX += fixedCols.cuttingTable;
      
      doc.rect(newHeaderX, currentY, fixedCols.color, 9);
      doc.text('Color', newHeaderX + (fixedCols.color / 2), currentY + 5.5, { align: 'center' });
      newHeaderX += fixedCols.color;
      
      sizes.forEach(size => {
        const sizeLabel = size || 'Size';
        const displayLabel = sizeLabel.length > 6 ? sizeLabel.substring(0, 5) + '.' : sizeLabel;
        doc.rect(newHeaderX, currentY, sizeColWidth, 9);
        doc.text(displayLabel, newHeaderX + (sizeColWidth / 2), currentY + 5.5, { align: 'center' });
        newHeaderX += sizeColWidth;
      });
      
      doc.rect(newHeaderX, currentY, fixedCols.total, 9);
      doc.text('Total', newHeaderX + (fixedCols.total / 2), currentY + 5.5, { align: 'center' });
      newHeaderX += fixedCols.total;
      
      doc.rect(newHeaderX, currentY, fixedCols.extra, 9);
      doc.text('Extra', newHeaderX + (fixedCols.extra / 2), currentY + 5.5, { align: 'center' });
      newHeaderX += fixedCols.extra;
      
      if (department === 'packing') {
        doc.rect(newHeaderX, currentY, fixedCols.stitching, 9);
        doc.text('Stitch', newHeaderX + (fixedCols.stitching / 2), currentY + 5.5, { align: 'center' });
        newHeaderX += fixedCols.stitching;
        
        doc.rect(newHeaderX, currentY, fixedCols.comparison, 9);
        doc.text('Comp', newHeaderX + (fixedCols.comparison / 2), currentY + 5.5, { align: 'center' });
      }
      
      currentY += 9;
    }
    
    let rowX = margin;
    
    // Cutting Table
    doc.rect(rowX, currentY, fixedCols.cuttingTable, 7);
    const ctValue = valOrEmpty(row.cuttingTable || '');
    doc.text(ctValue.length > 8 ? ctValue.substring(0, 7) + '.' : ctValue, rowX + 2, currentY + 4.5);
    rowX += fixedCols.cuttingTable;
    
    // Color
    doc.rect(rowX, currentY, fixedCols.color, 7);
    const colorValue = valOrEmpty(row.color || '');
    doc.text(colorValue.length > 10 ? colorValue.substring(0, 9) + '.' : colorValue, rowX + 2, currentY + 4.5);
    rowX += fixedCols.color;
    
    // Sizes
    sizes.forEach(size => {
      const sizeValue = row.sizes?.[size];
      doc.rect(rowX, currentY, sizeColWidth, 7);
      const text = sizeValue !== undefined && sizeValue !== null ? sizeValue.toString() : '-';
      doc.text(text, rowX + (sizeColWidth / 2), currentY + 4.5, { align: 'center' });
      rowX += sizeColWidth;
    });
    
    // Total
    doc.rect(rowX, currentY, fixedCols.total, 7);
    doc.setFont('helvetica', 'bold');
    doc.text(valOrEmpty(row.totalPcs), rowX + (fixedCols.total / 2), currentY + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    rowX += fixedCols.total;
    
    // Extra PCS
    doc.rect(rowX, currentY, fixedCols.extra, 7);
    doc.text(valOrEmpty(packingExtraValue), rowX + (fixedCols.extra / 2), currentY + 4.5, { align: 'center' });
    rowX += fixedCols.extra;
    
    if (department === 'packing') {
      // Stitching Extra
      doc.rect(rowX, currentY, fixedCols.stitching, 7);
      doc.text(valOrEmpty(stitchingExtraValue), rowX + (fixedCols.stitching / 2), currentY + 4.5, { align: 'center' });
      rowX += fixedCols.stitching;
      
      // Comparison
      doc.rect(rowX, currentY, fixedCols.comparison, 7);
      if (displayComparison !== 0) {
        doc.setFont('helvetica', 'bold');
      }
      doc.text(valOrEmpty(displayComparison), rowX + (fixedCols.comparison / 2), currentY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    }
    
    currentY += 7;
  });
  
  // Table Footer - Totals
  const totalLotPcs = matrix.totals?.grand || 0;
  const totalPackingExtra = matrix.rows?.reduce((sum, r) => sum + (r.packingExtra || 0), 0) || 0;
  const totalStitchingExtra = matrix.rows?.reduce((sum, r) => sum + (r.stitchingExtraFromSheet || r.stitchingExtra || 0), 0) || 0;
  const totalComparison = totalStitchingExtra - totalPackingExtra;
  const displayTotalComparison = totalComparison === 0 ? totalStitchingExtra : totalComparison;
  
  if (currentY + 7 <= pageHeight - margin) {
    let footerX = margin;
    
    // Cutting Table and Color columns
    doc.rect(footerX, currentY, fixedCols.cuttingTable, 7);
    footerX += fixedCols.cuttingTable;
    
    doc.rect(footerX, currentY, fixedCols.color, 7);
    footerX += fixedCols.color;
    
    // Sizes columns (skip)
    sizes.forEach(() => {
      doc.rect(footerX, currentY, sizeColWidth, 7);
      footerX += sizeColWidth;
    });
    
    // Total
    doc.rect(footerX, currentY, fixedCols.total, 7);
    doc.setFont('helvetica', 'bold');
    doc.text(valOrEmpty(totalLotPcs), footerX + (fixedCols.total / 2), currentY + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    footerX += fixedCols.total;
    
    // Extra PCS
    doc.rect(footerX, currentY, fixedCols.extra, 7);
    doc.setFont('helvetica', 'bold');
    doc.text(valOrEmpty(totalPackingExtra), footerX + (fixedCols.extra / 2), currentY + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    footerX += fixedCols.extra;
    
    if (department === 'packing') {
      // Stitching Extra
      doc.rect(footerX, currentY, fixedCols.stitching, 7);
      doc.setFont('helvetica', 'bold');
      doc.text(valOrEmpty(totalStitchingExtra), footerX + (fixedCols.stitching / 2), currentY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      footerX += fixedCols.stitching;
      
      // Comparison
      doc.rect(footerX, currentY, fixedCols.comparison, 7);
      if (displayTotalComparison !== 0) {
        doc.setFont('helvetica', 'bold');
      }
      doc.text(valOrEmpty(displayTotalComparison), footerX + (fixedCols.comparison / 2), currentY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    }
    
    currentY += 7;
  }
  
  currentY += 15;
  
  // ==================== SIGNATURE SECTION ====================
  if (currentY + 45 > pageHeight - margin) {
    addNewPage();
    currentY = margin;
  }
  
  drawHorizontalLine(currentY, 0.5);
  currentY += 8;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Authorization', margin, currentY);
  currentY += 8;
  
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('This report is generated based on the production data and approved by the respective department heads.', margin, currentY);
  currentY += 12;
  
  const sigWidth = (contentWidth - 30) / 4;
  const signatureY = currentY;
  
  const deptHeaders = department === 'stitching' 
    ? ['Cutting Department', 'Stitching Department', 'Quality Assurance', 'Area Supervisor'] 
    : ['Packing Department', 'Quality Assurance', 'Dispatch Department', 'Area Supervisor'];
  
  for (let i = 0; i < 4; i++) {
    const sigX = margin + 10 + (i * sigWidth);
    const sigBoxWidth = sigWidth - 8;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(deptHeaders[i], sigX + (sigBoxWidth / 2), signatureY + 5, { align: 'center' });
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text('Authorized Signatory', sigX + (sigBoxWidth / 2), signatureY + 25, { align: 'center' });
    
    // Signature line
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.line(sigX, signatureY + 18, sigX + sigBoxWidth, signatureY + 18);
    
    doc.setFontSize(6);
    doc.setTextColor(120, 120, 120);
    doc.text('Signature with Date', sigX + (sigBoxWidth / 2), signatureY + 32, { align: 'center' });
  }
  
  currentY = signatureY + 42;
  
  // ==================== FOOTER ====================
  const footerY = pageHeight - 10;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  
  doc.text('Generated on: ' + new Date().toLocaleString(), margin, footerY);
  doc.text('Page ' + doc.internal.getNumberOfPages() + ' of ' + doc.internal.getNumberOfPages(), pageWidth - margin - 30, footerY);
  
  // Add footer line
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3);
  
  // ==================== SAVE PDF ====================
  const fname = department.toUpperCase() + '_Lot_' + (matrix.lotNumber || 'Unknown') + '_' + printableDate(issueDate).replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
  doc.save(fname);
}
// ============================
// STYLED COMPONENTS
// ============================
const Container = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #002e5c;
  overflow: hidden;
`;

const MainContainer = styled.div`
  flex: 1;
  margin: 10px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #dcefff;
`;

const ContentWrapper = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  &::-webkit-scrollbar { width: 8px; height: 8px; }
  &::-webkit-scrollbar-track { background: #f0f7ff; }
  &::-webkit-scrollbar-thumb { background: #b8d1e6; border-radius: 4px; &:hover { background: #90b8d9; } }
`;

const HeaderSection = styled.div`
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  border: 1px solid #e1f0fa;
  box-shadow: 0 2px 8px rgba(0, 100, 200, 0.05);
`;

const HeaderTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.9rem;
  font-weight: 600;
  color: #003772;
  display: flex;
  align-items: center;
  gap: 12px;
  svg { color: #2c7be0; width: 32px; height: 32px; }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 12px;
`;

const Button = styled.button`
  padding: 10px 20px;
  border-radius: 8px;
  border: 1px solid ${props => props.primary ? '#2c7be0' : '#d0e2f2'};
  background: ${props => props.primary ? '#003881' : 'white'};
  color: ${props => props.primary ? 'white' : '#2c3e50'};
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.2s;
  &:hover { background: ${props => props.primary ? '#1a5cb0' : '#f0f7ff'}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const SearchForm = styled.form`
  display: flex;
  gap: 16px;
  align-items: center;
`;

const SearchInput = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 2px solid #d9e8f5;
  border-radius: 10px;
  background: white;
  &:focus-within { border-color: #00367e; }
  input { flex: 1; border: none; outline: none; font-size: 1rem; background: transparent; &::placeholder { color: #002a4d; } }
  svg { color: #7fa9cc; }
`;

const DepartmentToggle = styled.div`
  display: flex;
  gap: 8px;
  background: #f0f7ff;
  padding: 4px;
  border-radius: 10px;
  margin-top: 20px;
`;

const DeptButton = styled.button`
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: ${props => props.active ? 'white' : 'transparent'};
  color: ${props => props.active ? '#1e4a7a' : '#5e7e9f'};
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid ${props => props.active ? '#d9e8f5' : 'transparent'};
  &:hover { background: ${props => props.active ? 'white' : '#e1f0fa'}; }
`;

const ErrorMessage = styled.div`
  margin-bottom: 24px;
  padding: 16px 20px;
  background: #fff0f0;
  border: 1px solid #ffb3b3;
  border-radius: 10px;
  color: #c53030;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const SuccessMessage = styled.div`
  margin-bottom: 24px;
  padding: 16px 20px;
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
  border-radius: 10px;
  color: #2e7d32;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 24px;
  @media (max-width: 1200px) { grid-template-columns: 1fr; }
`;

const InfoPanel = styled.div`
  background: white;
  border-radius: 12px;
  padding: 24px;
  border: 1px solid #e1f0fa;
  box-shadow: 0 2px 8px rgba(0, 100, 200, 0.05);
  height: fit-content;
`;

const InfoHeader = styled.h3`
  margin: 0 0 20px 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: #1e4a7a;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 15px;
  border-bottom: 2px solid #e6f0fa;
  svg { color: #2c7be0; }
`;

const InfoRow = styled.div`
  display: grid;
  grid-template-columns: 30px 90px 1fr;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #e6f0fa;
  &:hover { background: #f8fcff; }
  &:last-child { border-bottom: none; }
  svg { color: #2c7be0; }
`;

const InfoLabel = styled.span` color: #00254b; font-size: 0.9rem; font-weight: 500; `;
const InfoValue = styled.span` font-weight: 600; color: #002853; font-size: 1rem; `;

const SummaryBox = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin: 20px 0;
  padding: 20px 0;
  border-top: 2px solid #e6f0fa;
  border-bottom: 2px solid #e6f0fa;
`;

const SummaryItem = styled.div` text-align: center; padding: 10px; background: #ffffff; border-radius: 8px; `;
const SummaryLabel = styled.div` font-size: 0.8rem; color: #002b57; margin-bottom: 5px; font-weight: 500; `;
const SummaryValue = styled.div` font-size: 1.5rem; font-weight: 700; color: #003063; `;

const TablePanel = styled.div`
  background: white;
  border-radius: 12px;
  padding: 24px;
  border: 1px solid #e1f0fa;
  box-shadow: 0 2px 8px rgba(0, 100, 200, 0.05);
  overflow: hidden;
`;

const TableHeader = styled.h3`
  margin: 0 0 20px 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: #1e4a7a;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 15px;
  border-bottom: 2px solid #e6f0fa;
  svg { color: #2c7be0; }
`;

const TableContainer = styled.div`
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid #e1f0fa;
  &::-webkit-scrollbar { height: 8px; }
  &::-webkit-scrollbar-track { background: #f0f7ff; }
  &::-webkit-scrollbar-thumb { background: #b8d1e6; border-radius: 4px; &:hover { background: #90b8d9; } }
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  min-width: 800px;
  th { background: #002c5f; padding: 15px 12px; text-align: center; font-weight: 600; color: #ffffff; border: 1px solid #d9e8f5; white-space: nowrap; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 12px; border: 1px solid #d9e8f5; text-align: center; color: #2c3e50; }
  tbody tr:hover { background: #f8fcff; }
  tbody tr td:first-child { font-weight: 500; color: #1e4a7a; }
  tfoot td { background: #f0f7ff; font-weight: 600; color: #1e4a7a; border-top: 2px solid #b8d1e6; }
`;

const ExtraInput = styled.input`
  width: 80px;
  padding: 8px;
  border: 2px solid #d9e8f5;
  border-radius: 6px;
  text-align: center;
  font-weight: 500;
  &:focus { outline: none; border-color: #2c7be0; }
  &:hover { border-color: #90b8d9; }
`;

const ComparisonValue = styled.span`
  font-weight: 600;
  color: ${props => {
    if (props.value > 0) return '#d32f2f';
    if (props.value < 0) return '#388e3c';
    return '#ff9800';
  }};
  background: ${props => {
    if (props.value > 0) return '#ffebee';
    if (props.value < 0) return '#e8f5e9';
    return '#fff3e0';
  }};
  padding: 4px 8px;
  border-radius: 4px;
  display: inline-block;
  min-width: 50px;
`;

const InstructionsPanel = styled.div`
  background: white;
  border-radius: 12px;
  padding: 40px;
  border: 1px solid #e1f0fa;
  box-shadow: 0 2px 8px rgba(0, 100, 200, 0.05);
  text-align: center;
`;

const InstructionsTitle = styled.h2`
  margin: 0 0 30px 0;
  font-size: 2rem;
  font-weight: 700;
  color: #00356e;
`;

const InstructionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 25px;
  margin-bottom: 40px;
`;

const InstructionCard = styled.div`
  padding: 30px 20px;
  background: #f8fcff;
  border-radius: 12px;
  border: 1px solid #d9e8f5;
  h3 { margin: 0 0 15px 0; font-size: 1.2rem; font-weight: 600; color: #002955; }
  p { margin: 0; color: #00366b; font-size: 0.95rem; line-height: 1.6; }
`;

const FeatureList = styled.div`
  margin-top: 30px;
  padding: 30px;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #d9e8f5;
  h3 { margin: 0 0 20px 0; font-size: 1.2rem; font-weight: 600; color: #00264e; }
`;

const FeatureItem = styled.div`
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 10px 0;
  color: #00254b;
  font-size: 1rem;
  svg { color: #2c7be0; font-size: 1.2rem; }
`;

const TipsBox = styled.div`
  margin-top: 30px;
  padding: 25px;
  background: #ffffff;
  border: 1px solid #ffe5a3;
  border-radius: 12px;
  h4 { margin: 0 0 15px 0; font-size: 1.1rem; font-weight: 600; color: #b85c00; }
  ul { margin: 0; padding-left: 20px; color: #8b5e3c; li { margin: 8px 0; font-size: 0.95rem; } }
`;

const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: #ffffff;
  color: #000a5f;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  margin-left: 10px;
  border: 1px solid #a3d8a3;
`;

const SaveNotification = styled.div`
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #4CAF50;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 2000;
  animation: slideIn 0.3s ease;
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
`;

const DialogOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Dialog = styled.div`
  background: white;
  border-radius: 16px;
  width: 100%;
  max-width: 500px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  border: 1px solid #d9e8f5;
`;

const DialogHeader = styled.div`
  padding: 24px;
  border-bottom: 1px solid #e1f0fa;
  display: flex;
  justify-content: space-between;
  align-items: center;
  h3 { margin: 0; font-size: 1.3rem; font-weight: 600; color: #1e4a7a; }
`;

const DialogContent = styled.div`
  padding: 24px;
`;

const DialogField = styled.div`
  margin-bottom: 24px;
  label { display: block; margin-bottom: 10px; font-size: 0.95rem; font-weight: 500; color: #1e4a7a; }
  input, select { width: 100%; padding: 12px 16px; border: 2px solid #d9e8f5; border-radius: 8px; font-size: 1rem; &:focus { outline: none; border-color: #2c7be0; } &:disabled { background: #f0f7ff; cursor: not-allowed; } }
`;

const DialogActions = styled.div`
  padding: 24px;
  border-top: 1px solid #e1f0fa;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: #7fa9cc;
  padding: 8px;
  border-radius: 6px;
  &:hover { color: #1e4a7a; background: #f0f7ff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Spinner = styled.div`
  width: 20px;
  height: 20px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top: 3px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
`;

// Rate Display Component
const RateDisplay = styled.div`
  margin-top: 15px;
  padding: 12px;
  background: ${props => props.hasRate ? '#e8f5e9' : '#fff3e0'};
  border-radius: 8px;
  border: 1px solid ${props => props.hasRate ? '#81c784' : '#ffb74d'};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const RateValue = styled.span`
  font-size: 1.2rem;
  font-weight: 700;
  color: ${props => props.hasRate ? '#2e7d32' : '#f57c00'};
`;

// ============================
// MAIN COMPONENT
// ============================
export default function ExtraPcs() {
  const [lotInput, setLotInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const abortRef = useRef(null);
  const [extraPcsData, setExtraPcsData] = useState({});
  const [selectedDepartment, setSelectedDepartment] = useState('stitching');
  const [showDialog, setShowDialog] = useState(false);
  const [issueDate, setIssueDate] = useState(() => todayLocalISO());
  const [supervisor, setSupervisor] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [lastSavedLot, setLastSavedLot] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalData, setOriginalData] = useState({});
  const [syncingToCloud, setSyncingToCloud] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rateData, setRateData] = useState(null);
  const [fetchingRate, setFetchingRate] = useState(false);
  const [showRateDialog, setShowRateDialog] = useState(false);

  const LS_KEY_SUPERVISORS = 'extraPcs.supervisors';
  const [supervisorOptions, setSupervisorOptions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY_SUPERVISORS) || '[]');
      return uniqCaseInsensitive([...DEFAULT_SUPERVISORS, ...saved]);
    } catch {
      return DEFAULT_SUPERVISORS.slice();
    }
  });

  // Calculate total extra packing pcs (only the extra pieces, not including total lot pcs)
  const totalExtraPackingPcs = useMemo(() => {
    if (!matrix || selectedDepartment !== 'packing') return 0;
    return matrix.rows?.reduce((sum, row) => sum + (extraPcsData[row.color]?.packing || 0), 0) || 0;
  }, [matrix, extraPcsData, selectedDepartment]);

  // Fetch rate when matrix is loaded and department is packing
  const fetchRate = async () => {
    if (!matrix || !matrix.lotNumber) return;
    
    setFetchingRate(true);
    try {
      const rate = await fetchRateForLot(matrix.lotNumber, abortRef.current?.signal);
      setRateData(rate);
      if (rate) {
        setSuccess(`✅ Rate found for lot ${matrix.lotNumber}: ₹${rate.toFixed(2)} per piece`);
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(`⚠️ No rate found for lot ${matrix.lotNumber} in Master List`);
        setTimeout(() => setError(''), 3000);
      }
    } catch (error) {
      console.error('Error fetching rate:', error);
      setError(`Failed to fetch rate: ${error.message}`);
    } finally {
      setFetchingRate(false);
    }
  };

  // Function to refresh data when switching to packing department
  const refreshDataForPacking = async () => {
    if (!matrix || !matrix.lotNumber || selectedDepartment !== 'packing') return;
    
    setIsRefreshing(true);
    setError('');
    
    try {
      console.log(`🔄 Refreshing data for packing department - Lot: ${matrix.lotNumber}`);
      
      // Clear cache for this lot to force fresh data
      const cacheKey = generateLotMatrixCacheKey(matrix.lotNumber, 'packing');
      lotMatrixCache.delete(cacheKey);
      
      // Fetch fresh data from cutting matrix
      const freshData = await fetchLotMatrixViaSheetsApi(matrix.lotNumber, 'packing', abortRef.current?.signal);
      
      if (freshData) {
        // Fetch stitching extra data from the separate sheet
        const stitchingExtraData = await fetchStitchingExtraData(matrix.lotNumber, abortRef.current?.signal);
        
        // Preserve the extra PCS data that was entered for packing
        const preservedExtraPcsData = { ...extraPcsData };
        
        // Update matrix with fresh data
        setMatrix(freshData);
        
        // Merge the stitching extra data with existing extra PCS data
        const updatedExtraPcsData = { ...preservedExtraPcsData };
        
        // Add stitching extra data from the separate sheet
        Object.keys(stitchingExtraData).forEach(color => {
          if (!updatedExtraPcsData[color]) {
            updatedExtraPcsData[color] = {};
          }
          updatedExtraPcsData[color].stitching = stitchingExtraData[color];
          updatedExtraPcsData[color].stitchingFromSheet = stitchingExtraData[color];
          
          // Recalculate comparison if packing extra exists
          if (updatedExtraPcsData[color].packing !== undefined) {
            const comparison = stitchingExtraData[color] - (updatedExtraPcsData[color].packing || 0);
            updatedExtraPcsData[color].comparison = comparison;
            updatedExtraPcsData[color].displayValue = comparison === 0 ? stitchingExtraData[color] : comparison;
            updatedExtraPcsData[color].status = comparison > 0 ? 'deficit' : (comparison < 0 ? 'surplus' : 'equal');
          }
        });
        
        // Also try to load comparison data from Google Sheets if available
        const comparisonResult = await loadFromGoogleSheets(matrix.lotNumber, 'packing', true);
        
        if (comparisonResult.success && comparisonResult.data) {
          Object.keys(comparisonResult.data).forEach(color => {
            updatedExtraPcsData[color] = {
              ...updatedExtraPcsData[color],
              ...comparisonResult.data[color]
            };
          });
        }
        
        setExtraPcsData(updatedExtraPcsData);
        
        // Update the matrix rows with all data
        const updatedRows = freshData.rows.map(row => ({
          ...row,
          stitchingExtra: stitchingExtraData[row.color] || 0,
          stitchingExtraFromSheet: stitchingExtraData[row.color] || 0,
          packingExtra: updatedExtraPcsData[row.color]?.packing || 0,
          comparisonValue: updatedExtraPcsData[row.color]?.comparison || 0,
          displayComparison: updatedExtraPcsData[row.color]?.displayValue || 0
        }));
        
        setMatrix(prev => ({ ...prev, rows: updatedRows }));
        
        setSuccess('✅ Data refreshed with latest Stitching Extra and Comparison information');
        setTimeout(() => setSuccess(''), 3000);
        
        console.log('✅ Data refresh complete');
      }
    } catch (error) {
      console.error('Error refreshing data for packing:', error);
      setError(`Failed to refresh data: ${error.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load saved stitching extra PCS data from Google Sheets
  const loadStitchingData = async (lotNumber) => {
    if (!lotNumber) return;
    
    try {
      const result = await loadFromGoogleSheets(lotNumber, 'stitching');
      
      if (result.success && result.data) {
        console.log('Loaded stitching data from Google Sheets:', result.data);
        setExtraPcsData(prevData => {
          // Merge with existing data to preserve packing extra values
          const mergedData = { ...prevData };
          Object.keys(result.data).forEach(color => {
            if (!mergedData[color]) mergedData[color] = {};
            mergedData[color].stitching = result.data[color].stitching || 0;
            mergedData[color].stitchingFromSheet = result.data[color].stitching || 0;
          });
          return mergedData;
        });
        setOriginalData(result.data);
        setHasUnsavedChanges(false);
        
        if (matrix) {
          const updatedRows = matrix.rows.map(row => ({
            ...row,
            stitchingExtra: result.data[row.color]?.stitching || 0,
            stitchingExtraFromSheet: result.data[row.color]?.stitching || 0
          }));
          setMatrix(prev => ({ ...prev, rows: updatedRows }));
        }
        
        console.log('✅ Data loaded from Google Sheets successfully');
      } else {
        console.log('No data found in Google Sheets for this lot');
        // Don't clear extraPcsData if it already has packing data
        if (selectedDepartment === 'stitching') {
          setExtraPcsData({});
          setOriginalData({});
        }
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      console.error('Failed to load stitching data from Google Sheets:', error);
      setError(`Failed to load data: ${error.message}`);
      // Don't clear data on error
    }
  };

  // Save stitching extra PCS data to Google Sheets
  const saveStitchingDataToCloud = async () => {
    if (!matrix || selectedDepartment !== 'stitching') {
      setError('No stitching data to save');
      return;
    }
    
    if (!supervisor || supervisor.trim() === '') {
      setError('Please enter supervisor name before saving');
      return;
    }
    
    setSyncingToCloud(true);
    setError('');
    
    try {
      const dataToSave = {
        lotNumber: matrix.lotNumber,
        style: matrix.style,
        fabric: matrix.fabric,
        garmentType: matrix.garmentType,
        brand: matrix.brand,
        supervisor: supervisor,
        reportDate: todayLocalISO(),
        pdfGenerated: false,
        rows: matrix.rows.map(row => ({
          color: row.color,
          stitchingExtra: extraPcsData[row.color]?.stitching || 0,
          packingExtra: 0,
          cuttingTable: row.cuttingTable,
          totalPcs: row.totalPcs
        }))
      };
      
      const result = await saveToGoogleSheets(dataToSave, 'stitching');
      
      if (result.success) {
        setOriginalData(extraPcsData);
        setHasUnsavedChanges(false);
        setLastSavedLot(matrix.lotNumber);
        setSuccess('✅ Data successfully saved to Google Sheets!');
        setTimeout(() => setSuccess(''), 3000);
        console.log('✅ Data saved to Google Sheets successfully');
      } else {
        throw new Error(result.error || 'Failed to save to Google Sheets');
      }
    } catch (error) {
      console.error('Failed to save to Google Sheets:', error);
      setError(`Failed to save to Google Sheets: ${error.message}`);
    } finally {
      setSyncingToCloud(false);
    }
  };

  function saveSupervisorOptions(next) {
    const onlyCustom = next.filter(
      s => !DEFAULT_SUPERVISORS.map(x => x.toLowerCase()).includes((s || '').toLowerCase())
    );
    localStorage.setItem(LS_KEY_SUPERVISORS, JSON.stringify(onlyCustom));
  }

  function addSupervisorToOptions(name) {
    const t = titleCase(name);
    if (!t) return;
    const next = uniqCaseInsensitive([...supervisorOptions, t]);
    setSupervisorOptions(next);
    saveSupervisorOptions(next);
  }

  const typedIsNewSupervisor = useMemo(() => {
    const t = (supervisor ?? '').trim().toLowerCase();
    if (!t) return false;
    return !supervisorOptions.some(opt => (opt || '').toLowerCase() === t);
  }, [supervisor, supervisorOptions]);

  const canSearch = useMemo(() => norm(lotInput).length > 0 && !loading, [lotInput, loading]);

  // Cache cleanup
  useEffect(() => {
    const interval = setInterval(() => {
      sheetDataCache.cleanup();
      lotMatrixCache.cleanup();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Watch for department changes and refresh data when switching to packing
  useEffect(() => {
    if (matrix && selectedDepartment === 'packing') {
      refreshDataForPacking();
      // Also fetch rate when switching to packing
      fetchRate();
    }
  }, [selectedDepartment]);

  const handleSearch = async (e) => {
    e?.preventDefault?.();
    if (!canSearch) return;

    if (hasUnsavedChanges && matrix && selectedDepartment === 'stitching') {
      const confirm = window.confirm('You have unsaved changes. Do you want to save before loading a new lot?');
      if (confirm) {
        await saveStitchingDataToCloud();
      }
    }

    setError('');
    setSuccess('');
    setMatrix(null);
    setExtraPcsData({});
    setOriginalData({});
    setHasUnsavedChanges(false);
    setRateData(null);
    setLoading(true);

    abortRef.current?.abort?.();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const lotNumber = norm(lotInput);
      const cacheKey = generateLotMatrixCacheKey(lotNumber, selectedDepartment);
      const cachedMatrix = lotMatrixCache.get(cacheKey);
      
      let data;
      if (cachedMatrix) {
        data = cachedMatrix;
      } else {
        data = await fetchLotMatrixViaSheetsApi(lotNumber, selectedDepartment, ctrl.signal);
      }
      
      setMatrix(data);
      
      if (selectedDepartment === 'stitching') {
        await loadStitchingData(data.lotNumber);
      } else if (selectedDepartment === 'packing') {
        // Load both stitching and comparison data
        await loadStitchingData(data.lotNumber);
        const comparisonResult = await loadFromGoogleSheets(data.lotNumber, 'packing', true);
        if (comparisonResult.success && comparisonResult.data) {
          const updatedExtraPcsData = { ...extraPcsData };
          Object.keys(comparisonResult.data).forEach(color => {
            updatedExtraPcsData[color] = {
              ...updatedExtraPcsData[color],
              stitching: comparisonResult.data[color].stitchingExtra || 0,
              packing: comparisonResult.data[color].packingExtra || 0,
              comparison: comparisonResult.data[color].comparison || 0,
              displayValue: comparisonResult.data[color].displayValue || 0,
              status: comparisonResult.data[color].status || ''
            };
          });
          setExtraPcsData(updatedExtraPcsData);
        }
        
        // Fetch rate for packing department
        await fetchRate();
      }
      
    } catch (err) {
      setError(err?.message || "Failed to fetch data.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    if (hasUnsavedChanges && matrix && selectedDepartment === 'stitching') {
      const confirm = window.confirm('You have unsaved changes. Are you sure you want to discard them?');
      if (!confirm) return;
    }
    
    setLotInput('');
    setMatrix(null);
    setError('');
    setSuccess('');
    setExtraPcsData({});
    setOriginalData({});
    setHasUnsavedChanges(false);
    setRateData(null);
    abortRef.current?.abort?.();
  };

  const handleBack = () => {
    if (hasUnsavedChanges && matrix && selectedDepartment === 'stitching') {
      const confirm = window.confirm('You have unsaved changes. Do you want to save before leaving?');
      if (confirm) {
        saveStitchingDataToCloud();
      }
    }
    
    if (window.history?.length > 1) window.history.back();
    else window.close?.();
  };

  const openDialog = () => {
    if (selectedDepartment !== 'packing') {
      setError("PDF generation is only available for Packing department. Use the Submit button to save Stitching data.");
      return;
    }
    
    if (!matrix) {
      setError("No lot data available. Please search for a lot first.");
      return;
    }
    
    setDialogError('');
    setSupervisor('');
    setIssueDate(todayLocalISO());
    setGenerating(false);
    setShowRateDialog(true);
  };
  
  const handleRateAction = (useRate) => {
    setShowRateDialog(false);
    if (useRate) {
      if (!rateData) {
        setDialogError('No rate available for this lot. Please fetch rate first.');
        return;
      }
      setShowDialog(true);
    } else {
      setShowDialog(true);
    }
  };

  const closeDialog = () => {
    if (generating) return;
    setShowDialog(false);
    setShowRateDialog(false);
  };

  const handleGeneratePDF = async () => {
    if (!supervisor || supervisor.trim() === '') {
      setDialogError('Supervisor is required.');
      return;
    }
    
    if (!matrix) {
      setDialogError('No lot data available.');
      return;
    }
    
    setDialogError('');
    setGenerating(true);

    try {
      const dataToSave = {
        lotNumber: matrix.lotNumber,
        style: matrix.style,
        fabric: matrix.fabric,
        garmentType: matrix.garmentType,
        brand: matrix.brand,
        supervisor: supervisor,
        reportDate: issueDate,
        pdfGenerated: true,
        rows: matrix.rows.map(row => ({
          color: row.color,
          packingExtra: extraPcsData[row.color]?.packing || 0,
          stitchingExtra: row.stitchingExtraFromSheet || extraPcsData[row.color]?.stitching || 0,
          cuttingTable: row.cuttingTable,
          totalPcs: row.totalPcs
        }))
      };
      
      const saveResult = await saveToGoogleSheets(dataToSave, 'packing');
      
      if (!saveResult.success) {
        console.warn('Failed to save to Google Sheets, but continuing with PDF generation');
      }
      
      const updatedMatrix = {
        ...matrix,
        rows: matrix.rows.map(row => ({
          ...row,
          stitchingExtra: row.stitchingExtraFromSheet || extraPcsData[row.color]?.stitching || 0,
          packingExtra: extraPcsData[row.color]?.packing || 0
        }))
      };
      
      // Calculate total extra packing pcs for rate calculation
      const totalExtraPackingPcsValue = totalExtraPackingPcs;
      const totalValue = rateData ? rateData * totalExtraPackingPcsValue : 0;
      
      await generateIssuePdf(updatedMatrix, { 
        issueDate, 
        supervisor, 
        department: selectedDepartment,
        rate: rateData,
        totalExtraPackingPcs: totalExtraPackingPcsValue,
        totalValue: totalValue
      });
      
      setShowDialog(false);
      setGenerating(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      
      if (saveResult.success) {
        setSuccess('✅ PDF generated and data saved to Google Sheets successfully!');
        setTimeout(() => setSuccess(''), 3000);
      }
      
    } catch (error) {
      setDialogError(`Failed to generate PDF: ${error.message}`);
      setGenerating(false);
    }
  };

  const handleExtraPcsChange = (color, type, value) => {
    const numValue = parseInt(value) || 0;
    
    const newData = {
      ...extraPcsData,
      [color]: {
        ...extraPcsData[color],
        [type]: numValue
      }
    };
    
    setExtraPcsData(newData);
    setHasUnsavedChanges(true);
    
    if (matrix) {
      const updatedRows = matrix.rows.map(row => {
        if (row.color === color) {
          return {
            ...row,
            [type === 'stitching' ? 'stitchingExtra' : 'packingExtra']: numValue
          };
        }
        return row;
      });
      setMatrix(prev => ({ ...prev, rows: updatedRows }));
    }
  };

  const displaySizes = useMemo(() => {
    if (!matrix) return [];
    return matrix.source === 'old' ? Array(5).fill('') : (matrix.sizes || []);
  }, [matrix]);

  const totalsWithExtra = useMemo(() => {
    if (!matrix) return { totalCutting: 0, totalStitchingExtra: 0, totalPackingExtra: 0 };
    const totalCutting = matrix.totals?.grand || 0;
    const totalStitchingExtra = Object.values(extraPcsData).reduce((sum, item) => sum + (item.stitching || 0), 0);
    const totalPackingExtra = Object.values(extraPcsData).reduce((sum, item) => sum + (item.packing || 0), 0);
    return { totalCutting, totalStitchingExtra, totalPackingExtra };
  }, [matrix, extraPcsData]);

  return (
    <Container>
      <MainContainer>
        <ContentWrapper>
          <HeaderSection>
            <HeaderTop>
              <Title>
                <FiScissors /> Extra Pcs Detail
                {matrix && <StatusBadge><FiCheck size={14} /> Loaded</StatusBadge>}
                {hasUnsavedChanges && selectedDepartment === 'stitching' && (
                  <StatusBadge style={{ background: '#fff3e0', color: '#b85c00' }}>
                    <FiEdit size={14} /> Unsaved
                  </StatusBadge>
                )}
                {isRefreshing && (
                  <StatusBadge style={{ background: '#e3f2fd', color: '#1976d2' }}>
                    <FiLoader size={14} /> Refreshing...
                  </StatusBadge>
                )}
              </Title>
              <ButtonGroup>
                <Button onClick={handleBack}><FiArrowLeft /> Back</Button>
                <Button primary onClick={handleSearch} disabled={!canSearch}>
                  {loading ? <Spinner /> : <><FiSearch /> Search</>}
                </Button>
                <Button onClick={handleClear}><FiRefreshCw /> Reset</Button>
              </ButtonGroup>
            </HeaderTop>

            <SearchForm onSubmit={handleSearch}>
              <SearchInput>
                <FiSearch />
                <input
                  value={lotInput}
                  onChange={(e) => setLotInput(e.target.value)}
                  placeholder="Enter Lot No (e.g., 64003)"
                  autoFocus
                />
              </SearchInput>
            </SearchForm>

            <DepartmentToggle>
              <DeptButton active={selectedDepartment === 'stitching'} onClick={() => setSelectedDepartment('stitching')}>
                <FiScissors /> Stitching
              </DeptButton>
              <DeptButton active={selectedDepartment === 'packing'} onClick={() => setSelectedDepartment('packing')}>
                <FiPackage /> Packing
              </DeptButton>
            </DepartmentToggle>
          </HeaderSection>

          {error && (
            <ErrorMessage>
              <FiAlertTriangle size={20} />
              {error}
            </ErrorMessage>
          )}

          {success && (
            <SuccessMessage>
              <FiCheck size={20} />
              {success}
            </SuccessMessage>
          )}

          {matrix ? (
            <ContentGrid>
              <InfoPanel>
                <InfoHeader><FiInfo /> Lot Information</InfoHeader>
                <InfoRow><FiTag /><InfoLabel>Lot No:</InfoLabel><InfoValue>{matrix.lotNumber || '—'}</InfoValue></InfoRow>
                <InfoRow><FiTag /><InfoLabel>Style:</InfoLabel><InfoValue>{matrix.style || '—'}</InfoValue></InfoRow>
                <InfoRow><FiGrid /><InfoLabel>Fabric:</InfoLabel><InfoValue>{matrix.fabric || '—'}</InfoValue></InfoRow>
                <InfoRow><FiTag /><InfoLabel>Garment:</InfoLabel><InfoValue>{matrix.garmentType || '—'}</InfoValue></InfoRow>
                <InfoRow><FiTag /><InfoLabel>Brand:</InfoLabel><InfoValue>{matrix.brand || '—'}</InfoValue></InfoRow>

                <InfoRow>
                  <FiUser /><InfoLabel>Supervisor:</InfoLabel>
                  <InfoValue>
                    <input
                      list="supervisorList"
                      placeholder="Enter supervisor name"
                      value={supervisor}
                      onChange={(e) => setSupervisor(titleCase(e.target.value))}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #d9e8f5' }}
                    />
                    <datalist id="supervisorList">
                      {supervisorOptions.map((name) => <option key={name} value={name} />)}
                    </datalist>
                    {typedIsNewSupervisor && (
                      <Button onClick={() => addSupervisorToOptions(supervisor)} style={{ marginTop: '5px', padding: '4px 8px', fontSize: '0.8rem' }}>
                        Add
                      </Button>
                    )}
                  </InfoValue>
                </InfoRow>

                {/* Rate Display for Packing Department */}
                {selectedDepartment === 'packing' && (
                  <RateDisplay hasRate={rateData !== null}>
                    <span>Rate per piece:</span>
                    <RateValue hasRate={rateData !== null}>
                      {fetchingRate ? <Spinner /> : (rateData !== null ? `₹${rateData.toFixed(2)}` : 'Not available')}
                    </RateValue>
                    <Button 
                      onClick={fetchRate} 
                      disabled={fetchingRate}
                      style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                    >
                      {fetchingRate ? <Spinner /> : <FiRefreshCw />} Fetch Rate
                    </Button>
                  </RateDisplay>
                )}

                <SummaryBox>
                  <SummaryItem><SummaryLabel>Total Pcs</SummaryLabel><SummaryValue>{matrix.totals?.grand || 0}</SummaryValue></SummaryItem>
                  <SummaryItem><SummaryLabel>Colors</SummaryLabel><SummaryValue>{matrix.rows?.length || 0}</SummaryValue></SummaryItem>
                  <SummaryItem><SummaryLabel>Sizes</SummaryLabel><SummaryValue>{matrix.sizes?.length || 0}</SummaryValue></SummaryItem>
                </SummaryBox>

                {selectedDepartment === 'stitching' ? (
                  <Button primary onClick={saveStitchingDataToCloud} style={{ width: '100%' }} disabled={!hasUnsavedChanges || syncingToCloud}>
                    {syncingToCloud ? <Spinner /> : <><FiCloud /> Submit to Cloud</>}
                  </Button>
                ) : (
                  <Button primary onClick={openDialog} style={{ width: '100%' }}>
                    <FiFileText /> Generate PDF Report
                  </Button>
                )}
                
                {selectedDepartment === 'stitching' && !hasUnsavedChanges && extraPcsData && Object.keys(extraPcsData).length > 0 && (
                  <div style={{ marginTop: '12px', fontSize: '0.85rem', color: '#4CAF50', textAlign: 'center' }}>
                    <FiCheck /> Data synced to cloud
                  </div>
                )}
              </InfoPanel>

              <TablePanel>
                <TableHeader>
                  <FiGrid /> Cutting Matrix - {selectedDepartment === 'stitching' ? 'Stitching' : 'Packing'}
                  {selectedDepartment === 'packing' && matrix && (
                    <Button 
                      onClick={refreshDataForPacking} 
                      style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: '0.8rem' }}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? <Spinner /> : <FiRefreshCw />} Refresh
                    </Button>
                  )}
                </TableHeader>
                <TableContainer>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>Color</th>
                        <th>Cutting Table</th>
                        {displaySizes.map((s, i) => <th key={i}>{s || `Size ${i + 1}`}</th>)}
                        <th>Total</th>
                        <th>Extra ({selectedDepartment === 'stitching' ? 'Stitching' : 'Packing'})</th>
                        {selectedDepartment === 'packing' && <th>Stitching Extra</th>}
                        {selectedDepartment === 'packing' && <th>Comparison</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map((r, idx) => {
                        const packingExtraValue = (extraPcsData[r.color]?.packing || 0);
                        const stitchingExtraValue = (r.stitchingExtraFromSheet || extraPcsData[r.color]?.stitching || 0);
                        const comparisonValue = extraPcsData[r.color]?.comparison !== undefined ? 
                          extraPcsData[r.color].comparison : 
                          (stitchingExtraValue - packingExtraValue);
                        const displayComparison = extraPcsData[r.color]?.displayValue !== undefined ?
                          extraPcsData[r.color].displayValue :
                          (comparisonValue === 0 ? stitchingExtraValue : comparisonValue);
                        
                        return (
                          <tr key={idx}>
                            <td style={{ fontWeight: 500, textAlign: 'left' }}>{r.color}</td>
                            <td>{r.cuttingTable ?? '—'}</td>
                            {displaySizes.map(s => (
                              <td key={s} style={{ textAlign: 'center' }}>
                                {r.sizes?.[s] !== undefined && r.sizes?.[s] !== null ? r.sizes[s] : '—'}
                              </td>
                            ))}
                            <td><strong style={{ color: '#003772' }}>{r.totalPcs ?? '—'}</strong></td>
                            <td>
                              <ExtraInput
                                type="number"
                                min="0"
                                value={selectedDepartment === 'stitching' ? (extraPcsData[r.color]?.stitching || 0) : packingExtraValue}
                                onChange={(e) => handleExtraPcsChange(r.color, selectedDepartment === 'stitching' ? 'stitching' : 'packing', e.target.value)}
                                placeholder="0"
                              />
                            </td>
                            {selectedDepartment === 'packing' && (
                              <td>
                                <strong style={{ color: '#2c7be0' }}>{stitchingExtraValue}</strong>
                              </td>
                            )}
                            {selectedDepartment === 'packing' && (
                              <td>
                                <ComparisonValue value={displayComparison}>
                                  {displayComparison !== null ? displayComparison : '—'}
                                </ComparisonValue>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="2" style={{ textAlign: 'right' }}><strong>Total:</strong></td>
                        {displaySizes.map((s, idx) => (
                          <td key={idx} style={{ textAlign: 'center' }}>
                            <strong>{matrix.totals?.perSize?.[s] !== undefined ? matrix.totals.perSize[s] : 0}</strong>
                          </td>
                        ))}
                        <td style={{ textAlign: 'center' }}>
                          <strong style={{ color: '#003772', fontSize: '1.1rem' }}>{matrix.totals?.grand || 0}</strong>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <strong style={{ color: '#003772' }}>
                            {selectedDepartment === 'stitching' ? totalsWithExtra.totalStitchingExtra : totalsWithExtra.totalPackingExtra}
                          </strong>
                        </td>
                        {selectedDepartment === 'packing' && (
                          <>
                            <td style={{ textAlign: 'center' }}>
                              <strong style={{ color: '#2c7be0' }}>
                                {matrix.rows?.reduce((sum, row) => sum + (row.stitchingExtraFromSheet || extraPcsData[row.color]?.stitching || 0), 0)}
                              </strong>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <strong style={{ 
                                color: (() => {
                                  const totalStitching = matrix.rows?.reduce((sum, row) => sum + (row.stitchingExtraFromSheet || extraPcsData[row.color]?.stitching || 0), 0);
                                  const totalPacking = totalsWithExtra.totalPackingExtra;
                                  const totalComparison = totalStitching - totalPacking;
                                  const displayTotalComparison = totalComparison === 0 ? totalStitching : totalComparison;
                                  
                                  if (totalComparison > 0) return '#d32f2f';
                                  if (totalComparison < 0) return '#388e3c';
                                  return '#ff9800';
                                })()
                              }}>
                                {(() => {
                                  const totalStitching = matrix.rows?.reduce((sum, row) => sum + (row.stitchingExtraFromSheet || extraPcsData[row.color]?.stitching || 0), 0);
                                  const totalPacking = totalsWithExtra.totalPackingExtra;
                                  const totalComparison = totalStitching - totalPacking;
                                  const displayTotalComparison = totalComparison === 0 ? totalStitching : totalComparison;
                                  return displayTotalComparison;
                                })()}
                              </strong>
                            </td>
                          </>
                        )}
                      </tr>
                    </tfoot>
                  </StyledTable>
                </TableContainer>
                {selectedDepartment === 'packing' && rateData && (
                  <div style={{ marginTop: '20px', padding: '15px', background: '#e8f5e9', borderRadius: '8px', border: '1px solid #81c784' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold' }}>Extra Packing Summary:</span>
                      <span style={{ fontSize: '1.1rem' }}>
                        <strong>Total Extra Packing Pcs:</strong> {totalExtraPackingPcs} &nbsp;|&nbsp;
                        <strong>Rate:</strong> ₹{rateData.toFixed(2)}/pc &nbsp;|&nbsp;
                        <strong>Total Value:</strong> <span style={{ color: '#2e7d32', fontSize: '1.2rem' }}>₹{(rateData * totalExtraPackingPcs).toFixed(2)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </TablePanel>
            </ContentGrid>
          ) : (
            !loading && !error && (
              <InstructionsPanel>
                <InstructionsTitle>Welcome to Extra Pcs Detail</InstructionsTitle>
                <InstructionsGrid>
                  <InstructionCard><h3>1. Select Department</h3><p>Choose Stitching or Packing department to manage extra pieces efficiently.</p></InstructionCard>
                  <InstructionCard><h3>2. Search Lot</h3><p>Enter a lot number to load the complete cutting matrix with all details.</p></InstructionCard>
                  <InstructionCard><h3>3. Enter Extra PCS</h3><p>Add extra pieces for each shade color. Submit for Stitching, generate PDF for Packing.</p></InstructionCard>
                </InstructionsGrid>
                <FeatureList>
                  <h3>Key Features</h3>
                  <FeatureItem><FiCheck /> Stitching: Enter data and click "Submit to Cloud" to save to Google Sheets</FeatureItem>
                  <FeatureItem><FiCheck /> Packing: Generate professional PDF reports with cloud backup</FeatureItem>
                  <FeatureItem><FiCheck /> View stitching extra data from separate sheet when in packing mode</FeatureItem>
                  <FeatureItem><FiCheck /> Comparison data is stored and retrieved from dedicated Comparison sheet</FeatureItem>
                  <FeatureItem><FiDollarSign /> Rate management: Fetch rates from Master List for packing calculations</FeatureItem>
                  <FeatureItem><FiCheck /> Automatic data refresh when switching to Packing department</FeatureItem>
                  <FeatureItem><FiCheck /> Manual refresh button available in Packing view</FeatureItem>
                  <FeatureItem><FiCheck /> Comparison column shows difference between Stitching Extra and Packing Extra</FeatureItem>
                  <FeatureItem><FiCheck /> Red = Deficit (Stitching Extra {'>'} Packing Extra), Green = Surplus (Stitching Extra {'<'} Packing Extra), Orange = Equal</FeatureItem>
                  <FeatureItem><FiCheck /> Real-time calculations and instant updates</FeatureItem>
                  <FeatureItem><FiCheck /> Smart caching for lightning-fast performance</FeatureItem>
                  <FeatureItem><FiCheck /> Automatic supervisor saving for quick access</FeatureItem>
                  <FeatureItem><FiCloud /> Data automatically syncs to Google Sheets for permanent storage</FeatureItem>
                </FeatureList>
                <TipsBox>
                  <h4>Quick Tips</h4>
                  <ul>
                    <li><strong>Stitching Department:</strong> Enter data, add supervisor name, and click "Submit to Cloud" to save to Google Sheets</li>
                    <li><strong>Packing Department:</strong> Enter data, add supervisor, and generate PDF reports (auto-saved to cloud)</li>
                    <li><strong>Rate Management:</strong> Click "Fetch Rate" to get rate from Master List based on lot number</li>
                    <li><strong>Auto Refresh:</strong> When switching to Packing department, data automatically refreshes to show latest Stitching Extra values and Comparison data</li>
                    <li><strong>Comparison Column:</strong> Shows Stitching Extra - Packing Extra. When equal, shows the Stitching Extra value instead of 0</li>
                    <li><strong>Extra Packing Summary:</strong> Shows only the extra packing PCS (not total lot PCS) with rate calculation</li>
                    <li><strong>Comparison Data Storage:</strong> All comparison calculations are stored in the Comparison_Data sheet for historical tracking</li>
                    <li>Packing view shows Stitching Extra data from the Stitching_Extra_PCS sheet and Comparison data from Comparison_Data sheet</li>
                    <li>Unsaved changes are indicated by a yellow badge</li>
                    <li>Search results are cached for 5 minutes for faster loading</li>
                    <li>New supervisors are saved automatically for future use</li>
                    <li>All data is backed up to Google Sheets for permanent storage and reporting</li>
                  </ul>
                </TipsBox>
              </InstructionsPanel>
            )
          )}
        </ContentWrapper>
      </MainContainer>

      {/* Rate Selection Dialog */}
      {showRateDialog && (
        <DialogOverlay onClick={closeDialog}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <h3>Rate Selection for Packing Report</h3>
              <CloseButton onClick={closeDialog} disabled={generating}><FiX /></CloseButton>
            </DialogHeader>
            <DialogContent>
              <p style={{ marginBottom: '20px', color: '#00254b' }}>
                Would you like to include the rate information in the packing report?
              </p>
              {rateData ? (
                <div style={{ padding: '15px', background: '#e8f5e9', borderRadius: '8px', marginBottom: '20px' }}>
                  <strong>Rate Found:</strong> ₹{rateData.toFixed(2)} per piece
                </div>
              ) : (
                <div style={{ padding: '15px', background: '#fff3e0', borderRadius: '8px', marginBottom: '20px' }}>
                  <strong>No rate found</strong> for lot {matrix?.lotNumber} in Master List.
                  <Button 
                    onClick={fetchRate} 
                    disabled={fetchingRate}
                    style={{ marginLeft: '10px', padding: '4px 12px' }}
                  >
                    {fetchingRate ? <Spinner /> : 'Fetch Rate'}
                  </Button>
                </div>
              )}
              <DialogActions>
                <Button onClick={() => handleRateAction(false)}>
                  Continue without Rate
                </Button>
                <Button primary onClick={() => handleRateAction(true)} disabled={!rateData && !fetchingRate}>
                  Include Rate in Report
                </Button>
              </DialogActions>
            </DialogContent>
          </Dialog>
        </DialogOverlay>
      )}

      {showDialog && (
        <DialogOverlay onClick={closeDialog}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <h3>Generate {selectedDepartment === 'stitching' ? 'Stitching' : 'Packing'} Report</h3>
              <CloseButton onClick={closeDialog} disabled={generating}><FiX /></CloseButton>
            </DialogHeader>
            <DialogContent>
              <DialogField>
                <label>Report Date</label>
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={generating} />
              </DialogField>
              <DialogField>
                <label>Supervisor</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input list="supervisorListDialog" placeholder="Enter supervisor name" value={supervisor} onChange={(e) => setSupervisor(titleCase(e.target.value))} disabled={generating} style={{ flex: 1 }} />
                  {typedIsNewSupervisor && !generating && (<Button onClick={() => addSupervisorToOptions(supervisor)}>Add</Button>)}
                </div>
                <datalist id="supervisorListDialog">{supervisorOptions.map((name) => <option key={name} value={name} />)}</datalist>
              </DialogField>
              {rateData && (
                <DialogField>
                  <label>Rate Information (Will be included in report)</label>
                  <div style={{ padding: '10px', background: '#e8f5e9', borderRadius: '8px' }}>
                    <strong>Rate:</strong> ₹{rateData.toFixed(2)} per piece<br />
                    <strong>Total Extra Packing Pcs:</strong> {totalExtraPackingPcs}<br />
                    <strong>Total Value:</strong> ₹{(rateData * totalExtraPackingPcs).toFixed(2)}
                  </div>
                </DialogField>
              )}
              {dialogError && (<ErrorMessage style={{ marginTop: '10px' }}><FiAlertTriangle /> {dialogError}</ErrorMessage>)}
              <DialogActions>
                <Button onClick={closeDialog} disabled={generating}>Cancel</Button>
                <Button primary onClick={handleGeneratePDF} disabled={generating || !supervisor.trim()}>
                  {generating ? <Spinner /> : <><FiCheck /> Generate PDF</>}
                </Button>
              </DialogActions>
            </DialogContent>
          </Dialog>
        </DialogOverlay>
      )}

      {saveSuccess && (
        <SaveNotification>
          <FiCheck /> Data saved successfully to Google Sheets!
        </SaveNotification>
      )}
    </Container>
  );
}
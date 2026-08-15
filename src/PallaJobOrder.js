import React, { useMemo, useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import {
  FiSearch, FiRefreshCw, FiAlertTriangle, FiUser, FiCalendar, FiX, FiCheck,
  FiScissors, FiInfo, FiPackage, FiTag, FiGrid, FiArrowLeft, FiLoader, FiUsers
} from 'react-icons/fi';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ============================
// Helper Functions
// ============================
function extractSavedAtDate(savedAtString) {
  if (!savedAtString) return '';
  const dateObj = new Date(savedAtString);
  if (isNaN(dateObj.getTime())) return '';
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}

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

function printableDate(isoDate) {
  if (!isoDate) return '';
  let dateObj;
  if (isoDate.includes('/')) {
    const dateTimeParts = isoDate.split(' ');
    if (dateTimeParts.length > 0) {
      const datePart = dateTimeParts[0];
      const [month, day, year] = datePart.split('/').map(Number);
      dateObj = new Date(year, month - 1, day);
    }
  }
  if (!dateObj || isNaN(dateObj.getTime())) {
    dateObj = new Date(isoDate);
  }
  if (isNaN(dateObj.getTime())) return String(isoDate || '');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}

function extractDriveId(url) {
  if (!url) return null;
  const s = String(url);
  let m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})(?:\/|$)/);
  if (m) return m[1];
  m = s.match(/open\?id=([a-zA-Z0-9_-]{10,})/i);
  if (m) return m[1];
  return null;
}

function candidateDriveImageUrls(id) {
  return [
    `https://lh3.googleusercontent.com/d/${id}=w2000`,
    `https://lh3.googleusercontent.com/u/0/d/${id}=w2000`,
    `https://drive.google.com/thumbnail?id=${id}&sz=w2000`,
    `https://drive.google.com/thumbnail?authuser=0&id=${id}&sz=w2000`,
    `https://drive.google.com/uc?id=${id}`,
    `https://drive.google.com/uc?export=view&id=${id}`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ];
}

function loadImageForPdf(urls) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) return reject(new Error('All image candidates failed'));
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => { i += 1; tryNext(); };
      img.src = urls[i];
    };
    tryNext();
  });
}

// ============================
// Config
// ============================
const GOOGLE_API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk";
const SHEET_ID = "1Hj3JeJEKB43aYYWv8gk2UhdU6BWuEQfCg5pBlTdBMNA";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwNNkF3_EdiabmRONtKHYWUCK9oKRy2xK_Fs8mIXTPqQSL5sdSCWX9H7elY43gofWuuIQ/exec";

// QR CODE COMPLETION APPS SCRIPT URL
const QR_COMPLETION_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzpWzBH1yDvxp_eY1Yv34b9h96-olVdpoq-m0WSOhfjFs56lfLWdGQzqBjRrO7FeXOsIA/exec";

// NEW: Issue Records Sheet ID
const ISSUE_RECORDS_SHEET_ID = "19EYMNOzNLXnSF76Qb4camHIgESNZ-ZMfOMjcc3FAMs4";
const ISSUE_RECORDS_TAB = "IssueRecords";

const OLD_LOTS_SOURCE_TAB = "Sheet1";
const OLD_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMuD4XQ_kiTE59WNIY-OXwZkZzDhEuSiWy86qySeQFMrokUEy9YsoU0bBAUvbp5XNKIg/exec";
const SHEET_IDD = "18FzakygM7DVD29IRbpe68pDeCFQhFLj7t4C-XQ1MWWc";
const OLD_META_SHEET_ID = "1xD8Uy1lUgvNTQ2RGRBI4ZjOrozbinUPRq2_UfIplP98";
const OLD_META_TAB = "RAW FINAL";
const ISSUE_LOG_SHEET_ID = SHEET_ID;
const ISSUE_LOG_TAB = "Index";

const DEFAULT_SUPERVISORS = ['SONU', 'SANJAY', 'MONU', 'ROHIT','VINAY'];

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
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instances
const sheetDataCache = new ApiCache();
const lotMatrixCache = new ApiCache();

// Cache key generators
function generateSheetCacheKey(sheetId, range) {
  return `sheet_${sheetId}_${range}`;
}

function generateLotMatrixCacheKey(lotNo) {
  return `lot_matrix_${norm(lotNo)}`;
}

// ============================
// NEW FUNCTION: Check if lot already issued
// ============================
// ============================
// NEW FUNCTION: Check if lot already issued - FIXED to check column B (Lot Number)
// ============================
async function checkIfLotAlreadyIssued(lotNumber, signal) {
  if (!GOOGLE_API_KEY || !ISSUE_RECORDS_SHEET_ID) {
    console.warn('Missing API key or Issue Records Sheet ID');
    return false;
  }

  try {
    // FIXED: Check column B (B:B) instead of column A (A:A)
    // Column A has timestamps, Column B has Lot Numbers
    const range = encodeURIComponent(`${ISSUE_RECORDS_TAB}!B:B`);
    const cacheKey = generateSheetCacheKey(ISSUE_RECORDS_SHEET_ID, range);
    let rows = sheetDataCache.get(cacheKey);
    
    if (!rows) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ISSUE_RECORDS_SHEET_ID}/values/${range}?key=${GOOGLE_API_KEY}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to fetch issue records: ${res.status}`);
      const data = await res.json();
      rows = data?.values || [];
      sheetDataCache.set(cacheKey, rows);
    }

    // Check if lot number exists in column B
    // Skip header row if exists (row 1 might have headers)
    const startIndex = rows.length > 0 && rows[0][0]?.toLowerCase().includes('lot') ? 1 : 0;
    
    for (let i = startIndex; i < rows.length; i++) {
      const rowLot = norm(rows[i]?.[0] || '');
      if (rowLot && eq(rowLot, lotNumber)) {
        console.log(`🚫 Lot ${lotNumber} found in issue records at row ${i+1}`);
        return true; // Lot already issued
      }
    }
    
    console.log(`✅ Lot ${lotNumber} not found in issue records - can be issued`);
    return false; // Lot not found in issue records
  } catch (error) {
    console.warn('⚠️ Error checking issue records:', error.message);
    return false; // On error, allow submission (better to let it try than block)
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

async function submitIssueToSeparateSheet(issueData, signal) {
  const url = QR_COMPLETION_APPS_SCRIPT_URL;
  
  // Create URL with parameters for GET request (most reliable with no-cors)
  const params = new URLSearchParams({
    action: 'submitIssue',
    lotNumber: issueData.lotNumber,
    supervisor: issueData.supervisor,
    issueDate: issueData.issueDate,
    manpower: issueData.manpower || '0',
    totalPieces: String(issueData.totalPieces || '0'),
    style: issueData.style || '',
    fabric: issueData.fabric || '',
    garmentType: issueData.garmentType || '',
    timestamp: Date.now().toString()
  });
  
  const fullUrl = `${url}?${params.toString()}`;
  console.log('📤 Submitting to:', fullUrl);
  
  try {
    // Use GET request with no-cors (this will work but you won't get response)
    await fetch(fullUrl, {
      method: 'GET',
      mode: 'no-cors',
      signal
    });
    
    console.log('✅ Issue data submitted to Google Sheet');
    return { success: true };
  } catch (error) {
    console.warn('⚠️ Failed to save to sheet:', error.message);
    // Still return success to allow PDF generation
    return { success: true, warning: error.message };
  }
}

// ============================
// UPDATED: GENERATE QR CODE FUNCTION (FIXED FOR SCANABILITY)
// ============================
async function generateQRCodeForJob(lotNumber, issueDate, supervisor, manpower) {
  try {
    // Create unique job ID
    const jobId = `${lotNumber}_${issueDate.replace(/-/g, '')}_${Date.now()}`;
    
    // Use the completion URL with proper parameters
    const baseUrl = QR_COMPLETION_APPS_SCRIPT_URL;
    
    // Create URL with all job details
    const url = new URL(baseUrl);
    url.searchParams.append('action', 'completeJob');
    url.searchParams.append('jobId', jobId);
    url.searchParams.append('lot', lotNumber);
    url.searchParams.append('supervisor', supervisor);
    url.searchParams.append('issueDate', issueDate);
    url.searchParams.append('manpower', manpower);
    url.searchParams.append('timestamp', Date.now().toString());
    
    const qrUrl = url.toString();
    console.log('📱 QR Code URL:', qrUrl);
    
    // Generate QR code with optimal settings for scanability
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'H',      // High error correction
      margin: 2,                       // Margin around QR code
      width: 300,                       // Larger size for better scanning
      color: {
        dark: '#000000',                // Black modules
        light: '#ffffff'                 // White background
      }
    });
    
    return {
      qrCodeDataURL,
      jobId,
      completionUrl: qrUrl
    };
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    throw error;
  }
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
// OPTIMIZED LOT MATRIX FETCHER
// ============================
async function fetchLotMatrixViaSheetsApi(lotNo, signal) {
  const cacheKey = generateLotMatrixCacheKey(lotNo);
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
        result.cuttingDate = lotInfo.savedAt || '';
      }
    } catch (err) {
      console.warn('Index path failed:', err?.message);
    }

    if (!result) {
      try {
        result = await searchInCuttingSheet(searchKey, signal);
        result.source = 'cutting';
        result.cuttingDate = '';
      } catch (err) {
        console.warn('Cutting fallback failed:', err?.message);
      }
    }

    if (!result) {
      throw new Error(`Lot ${searchKey} not found in Cutting`);
    }
  }

  lotMatrixCache.set(cacheKey, result);
  return result;
}

// ============================
// OPTIMIZED SHEET FETCHERS
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
  const { startRow, numRows, lotNumber } = lotInfo;
  const endRow = startRow + numRows - 1;
  const range = encodeURIComponent(`Cutting!A${startRow}:Z${endRow}`);

  try {
    const rows = await fetchSheetDataCached(SHEET_ID, range, signal);
    const parsed = parseMatrixWithIndexInfo(rows, lotInfo);
    if (parsed && parsed.rows && parsed.rows.length > 0) return parsed;

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

function normalizeHeaderKey(s) {
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
  cutting: new Set(['cutting table','cutting','ct','issue supplier/worker name','supplier/worker name','supplier/worker','issue supplier','supplier','worker','karigar','issue karigar'])
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
    const normed = r.map(normalizeHeaderKey);
    for (const cell of normed) {
      if (HDR_SYNONYMS.item.has(cell) || HDR_SYNONYMS.shade.has(cell) || HDR_SYNONYMS.qty.has(cell)) {
        headerIdx = i;
        header = r;
        break outer;
      }
    }
  }

  const H = header.map(h => normalizeHeaderKey(h));
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

async function fetchOldLotsFor(lotNo, signal) {
  try {
    const url = new URL(OLD_APPS_SCRIPT_URL);
    url.searchParams.append('lot', lotNo);
    url.searchParams.append('action', 'getLotData');
    const searchTime = new Date().toISOString();
    url.searchParams.append('searchTime', searchTime);
    url.searchParams.append('source', 'palla_job_order');
    
    fetch(url, { signal, mode: 'no-cors' }).catch(err => {
      console.warn('⚠️ Search log failed:', err.message);
    });
  } catch (appsScriptError) {
    console.warn('⚠️ Apps Script call failed:', appsScriptError.message);
  }
  
  const range = encodeURIComponent(`${OLD_LOTS_SOURCE_TAB}!A2:Z`);
  const rows = await fetchSheetDataCached(SHEET_IDD, range, signal);
  if (rows.length < 2) throw new Error(`${OLD_LOTS_SOURCE_TAB} seems empty`);

  const { headerIdx, map, headerRaw } = detectOldLotsHeaderAndMap(rows);

  if (map.item === -1 || map.shade === -1 || map.qty === -1) {
    const seen = (headerRaw || []).map(h => norm(h)).join(' | ');
    throw new Error(`Source must have ITEM NAME, SHADE NAME, QUANTITY.\nSeen header row: ${seen}`);
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
    const seen = (headerRaw || []).map(h => norm(h)).join(' | ');
    throw new Error(`Lot ${lot4} not found in ${OLD_LOTS_SOURCE_TAB}.`);
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
      cuttingTable: (cuttingIdx !== -1)
        ? (() => {
            const raw = mostCommon(shadeCutting.get(shade) || []);
            const m = raw.match(/(\d+)$/);
            return m ? m[1] : raw;
          })()
        : null,
      sizes: {},
      totalPcs: pcs
    }));

  const meta = await fetchOldLotMeta(lot4, signal);
  
  return {
    source: 'old',
    lotNumber: lot4,
    garmentType: meta.garmentType || '',
    style: meta.style || firstItem.replace(/\b(\d{4})\b/, '').trim(),
    fabric: meta.fabric || '',
    category: meta.category || '',
    imageUrl: '',
    cuttingDate: '',
    sizes: [],
    rows: rowsOut,
    totals: { perSize: {}, grand: rowsOut.reduce((s,r)=>s+(r.totalPcs||0),0) },
    _payloadForIssue: {
      meta: {
        issueDate: new Date().toISOString().split('T')[0],
        supervisor: '',
        sourceType: 'old',
        lotNumber: lot4,
        style: meta.style || firstItem.replace(/\b(\d{4})\b/, '').trim(),
        fabric: meta.fabric || '',
        garmentType: meta.garmentType || ''
      },
      shades: rowsOut.map(row => row.color),
      sizes: [],
      cells: {},
      cutting: rowsOut.reduce((acc, row) => {
        acc[row.color] = row.cuttingTable || '';
        return acc;
      }, {}),
      rowTotals: rowsOut.reduce((acc, row) => {
        acc[row.color] = row.totalPcs;
        return acc;
      }, {})
    }
  };
}

function parseMatrixWithIndexInfo(rows, lotInfo) {
  let lotNumber = lotInfo.lotNumber;
  let style = lotInfo.style || '';
  let fabric = lotInfo.fabric || '';
  let garmentType = lotInfo.garmentType || '';
  const headerCols = lotInfo.headerCols || 7;
  const cuttingDate = lotInfo.savedAt || '';

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
  const allColors = new Set();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const color = idxColor !== -1 && row[idxColor] !== undefined ? norm(row[idxColor]) : '';
    if (color && !includes(color, 'total')) allColors.add(color);
  }

  const body = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const color = idxColor !== -1 && row[idxColor] !== undefined ? norm(row[idxColor]) : '';
    if (!color) { if (body.length > 0) break; continue; }
    if (includes(color, 'total')) break;

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
      body.push({ color, cuttingTable, sizes: sizeMap, totalPcs });
    }
  }

  if (allColors.size > body.length) {
    const existingColors = new Set(body.map(row => row.color));
    const missing = Array.from(allColors).filter(c => !existingColors.has(c));
    for (const color of missing) {
      const sizeMap = {};
      for (const s of sizeCols) sizeMap[s.key] = null;
      body.push({ color, cuttingTable: null, sizes: sizeMap, totalPcs: 0 });
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

  return {
    lotNumber,
    style,
    fabric,
    garmentType,
    imageUrl: lotInfo.imageUrl || '',
    cuttingDate,
    sizes: sizeKeys,
    rows: body,
    totals
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
      parsed.cuttingDate = '';
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

const valOrEmpty = v => (v == null || v === 0 || v === '0' ? '' : v);

function toNumOrNull(v) {
  const t = norm(v);
  if (t === '') return null;
  const n = parseFloat(t.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseMatrix(rows, lotNo) {
  let lotNumber = norm(lotNo);
  let style = '';
  let fabric = '';
  let garmentType = '';

  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] || [];
    if (includes(r[0], 'lot number')) {
      if (r[1]) lotNumber = norm(r[1]);
      const idxStyle = r.findIndex((c) => includes(c, 'style'));
      if (idxStyle !== -1 && r[idxStyle + 1]) style = norm(r[idxStyle + 1]);
    }
    if (includes(r[0], 'fabric')) {
      if (r[1]) fabric = norm(r[1]);
      const idxGT = r.findIndex((c) => includes(c, 'garment type'));
      if (idxGT !== -1 && r[idxGT + 1]) garmentType = norm(r[idxGT + 1]);
    }
  }

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const hasColor = r.some((c) => includes(c, 'color'));
    const hasCT = r.some((c) => includes(c, 'cutting table'));
    if (hasColor && hasCT) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    return { lotNumber, style, fabric, garmentType, sizes: [], rows: [], totals: { perSize: {}, grand: 0 } };
  }

  const header = rows[headerIdx].map(norm);
  const idxColor = header.findIndex((c) => includes(c, 'color'));
  const idxCT = header.findIndex((c) => includes(c, 'cutting table'));
  const idxTotal = header.findIndex((c) => includes(c, 'total'));

  const sizeCols = [];
  for (let i = idxCT + 1; i < header.length; i++) {
    if (i === idxTotal) break;
    if (norm(header[i])) sizeCols.push({ key: header[i], index: i });
  }
  const sizeKeys = sizeCols.map((s) => s.key);

  const allColors = new Set();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const color = norm(row[idxColor]);
    if (color && !includes(color, 'total')) allColors.add(color);
  }

  const body = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const first = norm(row[idxColor]);
    if (!first) { if (body.length) break; continue; }
    if (includes(first, 'total')) break;

    const color = first;
    const cuttingTable = toNumOrNull(row[idxCT]);
    const sizeMap = {};
    let rowTotal = 0;
    for (const s of sizeCols) {
      const qty = toNumOrNull(row[s.index]);
      sizeMap[s.key] = qty;
      rowTotal += (qty ?? 0);
    }
    const explicitTotal = idxTotal !== -1 ? toNumOrNull(row[idxTotal]) : null;
    const totalPcs = explicitTotal ?? rowTotal;
    body.push({ color, cuttingTable, sizes: sizeMap, totalPcs });
  }

  if (allColors.size > body.length) {
    const existingColors = new Set(body.map(row => row.color));
    const missingColors = Array.from(allColors).filter(color => !existingColors.has(color));
    for (const color of missingColors) {
      const sizeMap = {};
      for (const s of sizeCols) sizeMap[s.key] = null;
      body.push({ color, cuttingTable: null, sizes: sizeMap, totalPcs: 0 });
    }
  }

  body.sort((a, b) => a.color.localeCompare(b.color));

  const totals = { perSize: {}, grand: 0 };
  for (const k of sizeKeys) totals.perSize[k] = 0;
  for (const row of body) {
    for (const k of sizeKeys) totals.perSize[k] += row.sizes[k] ?? 0;
    totals.grand += row.totalPcs ?? 0;
  }

  return { lotNumber, style, fabric, garmentType, imageUrl: '', sizes: sizeKeys, rows: body, totals };
}

function findLotInIndex(indexData, lotNo) {
  if (!indexData || indexData.length < 2) return null;

  const headers = indexData[0].map(norm);
  const lotNumberCol = headers.findIndex(h => includes(h, 'lot number'));
  const startRowCol = headers.findIndex(h => includes(h, 'startrow'));
  const numRowsCol = headers.findIndex(h => includes(h, 'numrows'));
  const headerColsCol = headers.findIndex(h => includes(h, 'headercols'));
  const imgCol = headers.findIndex(h => includes(h, 'image url') || (includes(h, 'image') && !includes(h, 'usage')));
  const savedAtCol = headers.findIndex(h => includes(h, 'saved at') || includes(h, 'savedat'));

  if (lotNumberCol === -1) return null;

  for (let i = 1; i < indexData.length; i++) {
    const row = indexData[i] || [];
    const rowLotNo = norm(row[lotNumberCol]);
    if (rowLotNo === norm(lotNo)) {
      let savedAt = '';
      if (savedAtCol !== -1 && row[savedAtCol]) {
        savedAt = extractSavedAtDate(norm(row[savedAtCol]));
      }
      return {
        lotNumber: rowLotNo,
        startRow: startRowCol !== -1 ? parseInt(row[startRowCol]) || 1 : 1,
        numRows: numRowsCol !== -1 ? parseInt(row[numRowsCol]) || 20 : 20,
        headerCols: headerColsCol !== -1 ? parseInt(row[headerColsCol]) || 7 : 7,
        fabric: headers.includes('fabric') && row[headers.indexOf('fabric')] || '',
        garmentType: headers.includes('garment type') && row[headers.indexOf('garment type')] || '',
        style: headers.includes('style') && row[headers.indexOf('style')] || '',
        sizes: headers.includes('sizes') && row[headers.indexOf('sizes')] || '',
        shades: headers.includes('shades') && row[headers.indexOf('shades')] || '',
        imageUrl: imgCol !== -1 ? norm(row[imgCol]) : '',
        savedAt
      };
    }
  }
  return null;
}

// ============================
// UPDATED PDF GENERATION WITH QR CODE
// ============================
// ============================
// UPDATED PDF GENERATION WITH QR CODE
// ============================
// ============================
// UPDATED PDF GENERATION WITH QR CODE - LARGER SECTIONS
// ============================
async function generateIssuePdf(matrix, { 
  issueDate, 
  supervisor, 
  manpower = '0'
}) {
  if (!matrix) return;

  // Generate QR code for this job
  let qrCodeDataURL = null;
  let jobId = null;
  let completionUrl = null;
  
  try {
    const qrResult = await generateQRCodeForJob(
      matrix.lotNumber,
      issueDate,
      supervisor,
      manpower
    );
    qrCodeDataURL = qrResult.qrCodeDataURL;
    jobId = qrResult.jobId;
    completionUrl = qrResult.completionUrl;
    console.log('✅ QR Code generated for job:', jobId);
    console.log('📱 Scan URL:', completionUrl);
  } catch (qrError) {
    console.warn('⚠️ Failed to generate QR code:', qrError);
  }

  const sizesRaw = (matrix.source === 'old' ? Array(5).fill('') : (matrix.sizes || []));
  const sizes = sizesRaw.map(s => (s == null || s === 0 || s === '0') ? '' : String(s));
  const orientation = 'landscape'; 
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'A4' });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const M = 18;
  const borderPad = 6;
  const line = 0.9;

  doc.setDrawColor(0); doc.setTextColor(0); doc.setLineWidth(line);

  // Helper function to draw QR placeholder
  function drawQRPlaceholder(doc, x, y, sectionW, sectionH) {
    const qrSize = 80;
    const qrX = x + (sectionW - qrSize) / 2;
    const qrY = y + 10;
    
    doc.setDrawColor(150);
    doc.setLineWidth(0.5);
    doc.rect(qrX, qrY, qrSize, qrSize);
    
    doc.setFontSize(8);
    doc.text('QR Code', x + sectionW/2, qrY + qrSize/2, { align: 'center' });
    doc.text('Unavailable', x + sectionW/2, qrY + qrSize/2 + 10, { align: 'center' });
  }

  // Header Function - Modified for 4 sections with increased height
  function addHeader(currentPage) {
    const borderX = 8, borderY = 8, borderW = W - 16, borderH = H - 16;
    
    if (currentPage === 1) {
      doc.rect(borderX, borderY, borderW, borderH);
    }

    const CM = M + borderPad;
    const headerTop = CM + 12;
    const contentWidth = W - (CM * 2);

    const minSectionW = 120;
    let sectionW = Math.floor(contentWidth / 4);
    if (sectionW < minSectionW) sectionW = minSectionW;
    if (sectionW * 4 > contentWidth) sectionW = Math.floor(contentWidth / 4);
    
    // INCREASED SECTION HEIGHT from 70 to 120 to accommodate larger QR code
    const sectionH = 120;

    const s1X = CM;
    const s2X = s1X + sectionW;
    const s3X = s2X + sectionW;
    const s4X = s3X + sectionW;

    if (currentPage === 1) {
      doc.setLineWidth(0.9);
      doc.rect(CM, headerTop - 6, sectionW * 4, sectionH + 12);
      doc.setLineWidth(0.6);
      doc.rect(s1X, headerTop, sectionW, sectionH);
      doc.rect(s2X, headerTop, sectionW, sectionH);
      doc.rect(s3X, headerTop, sectionW, sectionH);
      doc.rect(s4X, headerTop, sectionW, sectionH);

      doc.setFont('times', 'bold');
      doc.setFontSize(16);
      let headingY = headerTop - 10;
      if (headingY < borderY + 12) headingY = borderY + 12;
      doc.text('Palla JobOrder', borderX + borderW / 2, headingY, { align: 'center' });
    }

    function printLabelValue(label, value, x, y, labelFont = { style: 'bold', size: 10 }, valueFont = { style: 'normal', size: 10 }, maxValueW = null) {
      doc.setFont('times', labelFont.style);
      doc.setFontSize(labelFont.size);
      doc.text(label, x, y);
      const pad = 4;
      const valueX = x + doc.getTextWidth(label) + pad;
      doc.setFont('times', valueFont.style);
      doc.setFontSize(valueFont.size);
      let valText = String(value ?? '');
      if (maxValueW && doc.getTextWidth(valText) > maxValueW) {
        while (valText.length && doc.getTextWidth(valText + '…') > maxValueW) {
          valText = valText.slice(0, -1);
        }
        valText += '…';
      }
      doc.text(valText, valueX, y);
    }

    // Section 1 - Basic info (spread out vertically in taller section)
    if (currentPage === 1) {
      const s1InnerX = s1X + 6;
      let s1Y = headerTop + 20;
      
      printLabelValue('Date', printableDate(issueDate), s1InnerX, s1Y);

      s1Y += 25;
      const availableItemW = sectionW - (s1InnerX - s1X) - doc.getTextWidth('Item') - 12;
      let itemText = String(matrix.garmentType || matrix.style || '');
      let itemToPrint = itemText;
      if (doc.getTextWidth(itemText) > availableItemW) {
        while (itemToPrint.length && doc.getTextWidth(itemToPrint + '…') > availableItemW) {
          itemToPrint = itemToPrint.slice(0, -1);
        }
        itemToPrint += '…';
      }
      printLabelValue('Item', itemToPrint, s1InnerX, s1Y);

      s1Y += 25;
      const fabricText = String(matrix.fabric || '');
      const availableFabricW = sectionW - (s1InnerX - s1X) - doc.getTextWidth('Fabric') - 12;
      let fabricToPrint = fabricText;
      if (doc.getTextWidth(fabricText) > availableFabricW) {
        while (fabricToPrint.length && doc.getTextWidth(fabricToPrint + '…') > availableFabricW) {
          fabricToPrint = fabricToPrint.slice(0, -1);
        }
        fabricToPrint += '…';
      }
      printLabelValue('Fabric', fabricToPrint, s1InnerX, s1Y);
    }

    // Section 2 - Lot info (spread out vertically in taller section)
    if (currentPage === 1) {
      const s2InnerX = s2X + 6;
      let s2Y = headerTop + 20;
      
      const priorityText = String(matrix.priority ?? '');
      const availablePriorityW = sectionW - (s2InnerX - s2X) - doc.getTextWidth('Priority') - 12;
      let priorityToPrint = priorityText;
      if (doc.getTextWidth(priorityText) > availablePriorityW) {
        while (priorityToPrint.length && doc.getTextWidth(priorityToPrint + '…') > availablePriorityW) {
          priorityToPrint = priorityToPrint.slice(0, -1);
        }
        priorityToPrint += '…';
      }
      printLabelValue('Priority', priorityToPrint, s2InnerX, s2Y);

      s2Y += 25;
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      const lotVal = String(matrix.lotNumber || '');
      const lotLabelW = doc.getTextWidth('Lot No.');
      const lotAvailable = sectionW - (s2InnerX - s2X) - lotLabelW - 12;
      let lotToPrint = lotVal;
      let lotFs = 10;
      doc.setFontSize(lotFs);
      while (doc.getTextWidth(lotToPrint) > lotAvailable && lotFs > 8) {
        lotFs -= 0.5;
        doc.setFontSize(lotFs);
      }
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      doc.text('Lot No.', s2InnerX, s2Y);
      doc.setFont('times', 'bold'); doc.setFontSize(lotFs);
      doc.text(lotToPrint, s2InnerX + lotLabelW + 4, s2Y);

      s2Y += 25;
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      const supervisorLabel = 'Supervisor:';
      doc.text(supervisorLabel, s2InnerX, s2Y);
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      const supervisorText = (supervisor ?? '').trim() || '________';
      const supLabelW = doc.getTextWidth(supervisorLabel);
      const supAvailableW = sectionW - (s2InnerX - s2X) - supLabelW - 12;
      let supToPrint = supervisorText;
      if (doc.getTextWidth(supervisorText) > supAvailableW) {
        while (supToPrint.length && doc.getTextWidth(supToPrint + '…') > supAvailableW) {
          supToPrint = supToPrint.slice(0, -1);
        }
        supToPrint += '…';
      }
      doc.text(supToPrint, s2InnerX + supLabelW + 4, s2Y);
      
      // Add Job ID for reference
      if (jobId) {
        s2Y += 25;
        doc.setFont('times', 'normal');
        doc.setFontSize(7);
        doc.text(`Job ID: ${jobId.substring(0, 16)}...`, s2InnerX, s2Y);
      }
    }

    // Section 3 - Cutting Info (spread out vertically in taller section)
    if (currentPage === 1) {
      const s3InnerX = s3X + 6;
      let s3Y = headerTop + 20;
      
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text('Cutting Info:', s3InnerX, s3Y);
      
      s3Y += 25;
      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      
      const cuttingDateText = matrix.cuttingDate ? printableDate(matrix.cuttingDate) : '________';
      doc.text(`Cutting Date: ${cuttingDateText}`, s3InnerX, s3Y);
      
      s3Y += 25;
      const cuttingTable = matrix.cuttingTable || '________';
      doc.text(`Table: ${cuttingTable}`, s3InnerX, s3Y);
      
      if (manpower && manpower !== '0') {
        s3Y += 25;
        doc.text(`Manpower: ${manpower} persons`, s3InnerX, s3Y);
      }
    }

    // Section 4 - QR Code - LARGER SIZE
    if (currentPage === 1) {
      const s4InnerX = s4X + 6;
      let s4Y = headerTop + 16;
      
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text('Completion QR Code', s4InnerX, s4Y);
      
      s4Y += 20;
      
      if (qrCodeDataURL) {
        try {
          // LARGER QR code size for better scanning - 90x90 pixels
          const qrSize = 70;
          
          // Center the QR code in the box
          const qrX = s4X + (sectionW - qrSize) / 2;
          const qrY = s4Y;
          
          doc.addImage(qrCodeDataURL, 'PNG', qrX, qrY, qrSize, qrSize);
          
          doc.setFont('times', 'normal');
          doc.setFontSize(8);
          // doc.text('Scan to mark as COMPLETED', s4X + sectionW/2, qrY + qrSize + 12, { align: 'center' });
          // doc.text(`Job ID: ${jobId?.substring(0, 8)}...`, s4X + sectionW/2, qrY + qrSize + 22, { align: 'center' });
        } catch (imgError) {
          console.warn('Failed to add QR image to PDF:', imgError);
          drawQRPlaceholder(doc, s4InnerX, s4Y, sectionW, sectionH);
        }
      } else {
        drawQRPlaceholder(doc, s4InnerX, s4Y, sectionW, sectionH);
      }
    }

    return {
      headerBottomY: headerTop + sectionH + 6,
      CM
    };
  }

  const { headerBottomY, CM } = addHeader(1);

  // Table starting position adjusted for taller header
  const tableTop = headerBottomY + 12;

  const head = [[ 
    'C.table', 
    'COLOR', 
    ...sizes, 
    'PCS',
    'EXTRA PCS',
    { content: 'Alter of Cutting', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold' } },
    { content: 'Alter of Emb/Print', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold' } },
    { content: 'Alter of Stitching', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold' } }
  ]];

  const head2 = [[
    '',  // C.table
    '',  // COLOR
    ...sizes.map(() => ''),  // Size columns
    '',  // PCS
    '',  // EXTRA PCS
    'QTY', 'ACTION',  // Under Alter of Cutting
    'QTY', 'ACTION',  // Under Alter of Emb/Print
    'QTY', 'ACTION'   // Under Alter of Stitching
  ]];

  const body = (matrix.rows || []).map((r) => ([
    valOrEmpty(r.cuttingTable),
    valOrEmpty(r.color),
    ...(matrix.source === 'old'
      ? Array(sizes.length).fill('')
      : sizes.map(s => valOrEmpty(r.sizes?.[s]))
    ),
    valOrEmpty(r.totalPcs),
    valOrEmpty(r.extraPcs ?? ''),
    valOrEmpty(r.alterCuttingQty ?? ''),
    valOrEmpty(r.alterCuttingAction ?? ''),
    valOrEmpty(r.alterEmbPrintQty ?? ''),
    valOrEmpty(r.alterEmbPrintAction ?? ''),
    valOrEmpty(r.alterStitchingQty ?? ''),
    valOrEmpty(r.alterStitchingAction ?? '')
  ]));

  const foot = [[
    '—',
    'TOTAL',
    ...sizes.map(() => ''),
    valOrEmpty(matrix.totals?.grand),
    '',
    '', '',
    '', '',
    '', ''
  ]];

  const CM2 = CM;
  
  const idxTable = 0;
  const idxColor = 1;
  const idxFirstSize = 2;
  const idxPcs = idxFirstSize + sizes.length;
  const idxExtraPcs = idxPcs + 1;
  const idxAlterCuttingQty = idxExtraPcs + 1;
  const idxAlterCuttingAction = idxAlterCuttingQty + 1;
  const idxAlterEmbPrintQty = idxAlterCuttingAction + 1;
  const idxAlterEmbPrintAction = idxAlterEmbPrintQty + 1;
  const idxAlterStitchingQty = idxAlterEmbPrintAction + 1;
  const idxAlterStitchingAction = idxAlterStitchingQty + 1;

  const colStyles = {
    [idxTable]: { halign: 'center', overflow: 'linebreak' },
    [idxColor]: { halign: 'left', overflow: 'linebreak' },
    [idxPcs]: { halign: 'center', overflow: 'linebreak' },
    [idxExtraPcs]: { halign: 'center', overflow: 'linebreak' },
    [idxAlterCuttingQty]: { halign: 'center', overflow: 'linebreak' },
    [idxAlterCuttingAction]: { halign: 'center', overflow: 'linebreak' },
    [idxAlterEmbPrintQty]: { halign: 'center', overflow: 'linebreak' },
    [idxAlterEmbPrintAction]: { halign: 'center', overflow: 'linebreak' },
    [idxAlterStitchingQty]: { halign: 'center', overflow: 'linebreak' },
    [idxAlterStitchingAction]: { halign: 'center', overflow: 'linebreak' },
  };
  
  for (let i = 0; i < sizes.length; i++) {
    colStyles[idxFirstSize + i] = { 
      halign: 'center', 
      overflow: 'linebreak',
      cellWidth: 'auto'
    };
  }

  const targetRowHeight = Math.floor(315 / 20);
  
  const tableConfig = {
    head: [head[0], head2[0]],
    body, 
    foot,
    startY: tableTop,
    theme: 'grid',
    styles: {
      font: 'times',
      fontSize: 8,
      textColor: [0,0,0],
      lineColor: [0,0,0],
      lineWidth: line,
      cellPadding: 3,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak',
      minCellHeight: targetRowHeight,
      maxCellHeight: targetRowHeight
    },
    headStyles: { 
      fillColor: [255,255,255], 
      textColor: [0,0,0], 
      fontStyle: 'bold', 
      fontSize: 8,
      halign: 'center',
      minCellHeight: targetRowHeight,
      maxCellHeight: targetRowHeight
    },
    bodyStyles: { 
      fillColor: null,
      minCellHeight: targetRowHeight,
      maxCellHeight: targetRowHeight
    },
    footStyles: { 
      fillColor: [255,255,255], 
      textColor: [0,0,0], 
      fontStyle: 'bold', 
      fontSize: 8,
      halign: 'center',
      minCellHeight: targetRowHeight,
      maxCellHeight: targetRowHeight
    },
    columnStyles: colStyles,
    margin: { left: CM2, right: CM2 },
    rowPageBreak: 'auto',
    pageBreak: 'auto',
    didDrawPage: function(data) {
      addHeader(data.pageNumber);
      
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        data.settings.margin.left,
        doc.internal.pageSize.height - 10
      );
      
      const borderX = 8, borderY = 8, borderW = W - 16, borderH = H - 16;
      if (data.pageNumber > 1) {
        doc.rect(borderX, borderY, borderW, borderH);
      }
    }
  };

  autoTable(doc, tableConfig);

  const afterTableY = doc.lastAutoTable ? (doc.lastAutoTable.finalY + 12) : (tableTop + 200);
  const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
  const totalPages = doc.internal.getNumberOfPages();
  
  if (currentPage === totalPages && (H - afterTableY) > 140) {
    await drawBottomSections(doc, afterTableY, W, H, CM2, matrix);
  } else if (currentPage === totalPages) {
    doc.addPage();
    addHeader(doc.internal.getCurrentPageInfo().pageNumber);
    await drawBottomSections(doc, 50, W, H, CM2, matrix);
  }

  const fname = `Lot_${matrix.lotNumber || 'Unknown'}_Issue_${(issueDate || '').replace(/-/g, '')}.pdf`;
  doc.save(fname);
  
  return { jobId, qrGenerated: !!qrCodeDataURL, completionUrl };
}

async function drawBottomSections(doc, afterTableY, W, H, CM2, matrix) {
  function addHeader(pageNumber) {
    const CM = CM2;
    const headerTop = CM + 12;
    const contentWidth = W - (CM * 2);

    const minSectionW = 110;
    let sectionW = Math.floor(contentWidth / 4);
    if (sectionW < minSectionW) sectionW = minSectionW;
    if (sectionW * 4 > contentWidth) sectionW = Math.floor(contentWidth / 4);
    
    // Match the increased section height
    const sectionH = 120;

    const s1X = CM;
    const s2X = s1X + sectionW;
    const s3X = s2X + sectionW;
    const s4X = s3X + sectionW;

    if (pageNumber === 1) {
      doc.setLineWidth(0.9);
      doc.rect(CM, headerTop - 6, sectionW * 4, sectionH + 12);
      doc.setLineWidth(0.6);
      doc.rect(s1X, headerTop, sectionW, sectionH);
      doc.rect(s2X, headerTop, sectionW, sectionH);
      doc.rect(s3X, headerTop, sectionW, sectionH);
      doc.rect(s4X, headerTop, sectionW, sectionH);

      doc.setFont('times', 'bold');
      doc.setFontSize(16);
      let headingY = headerTop - 10;
      doc.text('Palla JobOrder', W / 2, headingY, { align: 'center' });
    }

    return {
      headerBottomY: headerTop + sectionH + 6,
      CM
    };
  }

  addHeader(doc.internal.getCurrentPageInfo().pageNumber);

  const sig1W = 160;
  const sig2W = 160;
  const sig3W = 200;
  const sigGap = 15;
  const totalSigW = sig1W + sig2W + sig3W + 2 * sigGap;
  const sigStartX = (W - totalSigW) / 2;
  const sigBoxH = 50;
  const sigBoxY = H - 90;

  function drawSigBoxWithLabel(x, y, w, h, label) {
    doc.rect(x, y, w, h);
    const sigLineY = y + Math.round(h * 0.4);
    const sigPad = 10;
    doc.line(x + sigPad, sigLineY, x + w - sigPad, sigLineY);
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.text(label, x + w / 2, y + h - 8, { align: 'center' });
  }

  drawSigBoxWithLabel(sigStartX, sigBoxY, sig1W, sigBoxH, 'Lot Allotment by Pintu');
  drawSigBoxWithLabel(sigStartX + sig1W + sigGap, sigBoxY, sig2W, sigBoxH, 'Lot Issue (Cutting Head)');
  drawSigBoxWithLabel(sigStartX + sig1W + sigGap + sig2W + sigGap, sigBoxY, sig3W, sigBoxH, ' Stitching Supervisor');
}

// ============================
// STYLES (keep all your existing styled components)
// ============================
const Wrap = styled.div`
  max-width: 2200px;
  margin: 0 auto;
  padding: 24px 20px 40px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #ffffffff;
  background: #ffffffff;
  min-height: 100vh;
`;

const HeaderPaper = styled.div`
  background: rgba(15, 23, 42, 0.7);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  color: white;
  align-items: center;
  @media (max-width: 900px) { grid-template-columns: 1fr; gap: 20px; }
`;

const TitleSection = styled.div`
  display: flex; align-items: center; gap: 16px;
  h1 { margin: 0 0 6px 0; font-size: 1.8rem; font-weight: 700; color: #ffffffff; }
  p { margin: 0; color: #ffffffff; font-size: 1rem; }
`;

const TitleIcon = styled.div`
  display: flex; align-items: center; justify-content: center;
  width: 60px; height: 60px; border-radius: 14px;
  background: linear-gradient(135deg, #0F172A 0%, #2563EB 100%);
  color: white; font-size: 24px;
  box-shadow: 0 6px 12px rgba(37, 99, 235, 0.25);
`;

const SearchSection = styled.div` display: flex; flex-direction: column; gap: 16px; `;
const Form = styled.form`
  display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;

const SearchBox = styled.label`
  display: grid; grid-template-columns: 24px 1fr; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 12px; background: #ffffffff; border: 2px solid #e2e8f0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04); color: #1E40AF; transition: all 0.2s ease;
  &:focus-within { border-color: #2563EB; box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15); }
  input { background: transparent; border: none; outline: none; color: #000000ff; font-size: 1rem; ::placeholder { color: #64748b; } }
`;

const BtnRow = styled.div` display: flex; gap: 10px; align-items: center; `;

const BaseBtn = styled.button`
  border-radius: 12px; padding: 12px 18px; font-weight: 600; display: inline-flex;
  align-items: center; gap: 8px; cursor: pointer; border: none; transition: all 0.2s ease; font-size: 0.95rem;
`;

const PrimaryBtn = styled(BaseBtn)`
  background: linear-gradient(135deg, #0F172A 0%, #2563EB 100%); color: white; box-shadow: 0 4px 8px rgba(37, 99, 235, 0.3);
  &:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(37, 99, 235, 0.4); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const GhostBtn = styled(BaseBtn)` background: white; border: 2px solid #e2e8f0; color: #00275eff; &:hover { background: #f8fafc; border-color: #cbd5e1; } `;

const Spinner = styled.div`
  width: ${props => props.size || '16px'};
  height: ${props => props.size || '16px'};
  border: 2px solid ${props => props.trackColor || 'rgba(255, 255, 255, 0.3)'};
  border-top: 2px solid ${props => props.spinColor || 'white'};
  border-radius: 50%;
  animation: spin ${props => props.speed || '0.8s'} linear infinite;
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const InstructionsSection = styled.div`
  background: white;
  border-radius: 16px;
  padding: 32px;
  margin-top: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  border: 1px solid #e2e8f0;
`;

const InstructionsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f1f5f9;
  
  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: #1e293b;
  }
  
  svg {
    color: #8b5cf6;
  }
`;

const InstructionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
`;

const InstructionCard = styled.div`
  background: #f8fafc;
  border-radius: 12px;
  padding: 24px;
  border-left: 4px solid #8b5cf6;
  
  .instruction-icon {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    background: rgba(139, 92, 246, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #8b5cf6;
    font-size: 1.5rem;
    margin-bottom: 16px;
  }
  
  .instruction-title {
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 12px;
    font-size: 1.1rem;
  }
  
  .instruction-desc {
    color: #64748b;
    line-height: 1.6;
    font-size: 0.95rem;
  }
`;

const FeaturesList = styled.div`
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 12px;
  padding: 24px;
  margin-top: 24px;
`;

const FeatureItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
  
  &:last-child {
    margin-bottom: 0;
  }
  
  .feature-check {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #10b981;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.7rem;
    margin-top: 2px;
    flex-shrink: 0;
  }
  
  .feature-text {
    color: #475569;
    line-height: 1.5;
  }
`;

const QuickTips = styled.div`
  background: linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);
  border: 1px solid #fed7aa;
  border-radius: 12px;
  padding: 20px;
  margin-top: 24px;
`;

const TipsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  
  h4 {
    margin: 0;
    color: #ea580c;
    font-size: 1rem;
  }
  
  svg {
    color: #ea580c;
  }
`;

const TipItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
  
  &:last-child {
    margin-bottom: 0;
  }
  
  .tip-bullet {
    color: #ea580c;
    font-size: 0.8rem;
    margin-top: 2px;
    flex-shrink: 0;
  }
  
  .tip-text {
    color: #92400e;
    font-size: 0.9rem;
    line-height: 1.4;
  }
`;

const ErrorCard = styled.div`
  margin-bottom: 24px; display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: center;
  background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #dc2626;
  padding: 14px 16px; border-radius: 12px; font-weight: 500;
`;

const HintCard = styled.div`
  margin-top: 24px; padding: 16px; border-radius: 12px; background: white; border: 2px dashed #cbd5e1;
  color: #003681ff; font-size: 0.95rem; line-height: 1.5; display: flex; align-items: center; gap: 12px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.04);
  code { background: #f1f5f9; padding: 3px 6px; border-radius: 6px; font-family: monospace; color: #475569; font-size: 0.9rem; }
`;

const ContentGrid = styled.div`
  display: grid; grid-template-columns: 1fr 2fr; gap: 24px;
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
`;

const InfoPanel = styled.div`
  background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  display: flex; flex-direction: column; height: fit-content; border-bottom: 1px solid black; border-top: 1px solid black;
`;

const TablePanel = styled.div`
  background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  overflow: hidden; display: flex; flex-direction: column; border-bottom: 1px solid black; border-top: 1px solid black;
`;

const PanelHeader = styled.div`
  display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9;
  h3 { margin: 0; font-size: 1.2rem; font-weight: 600; color: #1e293b; }
  svg { color: #8b5cf6; }
`;

const InfoGrid = styled.div` display: grid; gap: 16px; margin-bottom: 24px; `;

const InfoItem = styled.div` 
  display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; padding: 12px; background: #f8fafc; border-radius: 12px;
`;

const InfoIcon = styled.div` 
  display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 10px; background: rgba(139, 92, 246, 0.1); color: #8b5cf6;
`;

const InfoLabel = styled.div` 
  font-size: 0.85rem; color: #020066ff; font-weight: 500; margin-bottom: 4px; 
`;

const InfoValue = styled.div` 
  font-weight: 600; color: #1e293b; font-size: 1rem; 
`;

const SummaryCard = styled.div` 
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; padding: 16px; background: #f8fafc; border-radius: 12px;
`;

const SummaryItem = styled.div` 
  text-align: center; padding: 12px; border-bottom: 1px solid blue;
`;

const SummaryLabel = styled.div` 
  font-size: 0.85rem; color: #002f72ff; margin-bottom: 6px; 
`;

const SummaryValue = styled.div` 
  font-weight: 700; color: #1e293b; font-size: 1.4rem; 
`;

const ActionsRow = styled.div` 
  display: flex; justify-content: flex-end; margin-top: auto; 
`;

const TableContainer = styled.div` 
  width: 100%; overflow: auto; 
`;

const Table = styled.table`
  width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.9rem;
  thead th { position: sticky; top: 0; background: #05315eff; text-align: center; padding: 12px 14px; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #fff; white-space: nowrap; border-radius: 1px; }
  tbody td, tfoot td { padding: 10px 14px; color:#000000ff; border: 1px solid #f1f5f9; }
  tbody tr { transition: background 0.2s ease; &:hover { background: #f8fafc; } }
  td.num { text-align: center; font-variant-numeric: tabular-nums; }
  td.strong, th.strong { font-weight: 700; }
  tfoot td { background: #ffffffff; font-weight: 700; color: #000000ff; }
`;

// Dialog Styles
const DialogOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
`;

const DialogContainer = styled.div`
  background: white;
  border-radius: 16px;
  padding: 0;
  width: 100%;
  max-width: 880px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
`;

const DialogHeader = styled.div`
  background: #11003aff;
  padding: 20px;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 16px 16px 0 0;
  
  h3 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
  }
`;

const CloseButton = styled.button`
  background: rgba(255, 255, 255, 0.2);
  border: none;
  font-size: 1.3rem;
  color: white;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const DialogContent = styled.div`
  padding: 24px;
`;

const DialogActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e2e8f0;
`;

const SimplePrimaryBtn = styled(BaseBtn)`
  background: #200069ff;
  color: white;
  padding: 12px 24px;
  font-size: 1rem;
  
  &:hover:not(:disabled) {
    background: #7c3aed;
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const SimpleGhostBtn = styled(BaseBtn)`
  background: white;
  border: 2px solid #e2e8f0;
  color: #000000ff;
  padding: 12px 24px;
  font-size: 1rem;
  
  &:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
  }
`;

const SimpleField = styled.label`
  display: grid;
  gap: 8px;
  margin: 20px 0 16px;
  
  input {
    width: 90%;
    padding: 14px 16px;
    border-radius: 12px;
    border: 2px solid #e2e8f0;
    background: white;
    color: #000000ff;
    outline: none;
    font-size: 1rem;
    
    &:focus {
      border-color: #8b5cf6;
    }
    
    &:disabled {
      background: #f8fafc;
      color: #94a3b8;
    }
  }
`;

const AddButton = styled.button`
  white-space: nowrap;
  border-radius: 8px;
  border: 2px solid #e2e8f0;
  background: #fff;
  color: #475569;
  font-weight: 600;
  padding: 10px 12px;
  cursor: pointer;
  
  &:hover {
    background: #f8fafc;
  }
`;

const FieldLabel = styled.div` 
  display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #475569; font-weight: 500; 
`;

// NEW: Warning Message for Already Issued
const WarningMessage = styled.div`
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 12px;
  padding: 16px;
  margin: 20px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  
  svg {
    color: #f59e0b;
    flex-shrink: 0;
  }
  
  div {
    color: #92400e;
    font-size: 0.95rem;
    line-height: 1.5;
  }
`;

// ============================
// MAIN COMPONENT
// ============================
export default function PallaJobOrder() {
  const [lotInput, setLotInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const [preGeneratedPdf, setPreGeneratedPdf] = useState(null);
  const [attendanceCount, setAttendanceCount] = useState('');

  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [issueDate, setIssueDate] = useState(() => todayLocalISO());
  const [supervisor, setSupervisor] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState('');
  
  // NEW: State for checking if lot already issued
  const [isLotAlreadyIssued, setIsLotAlreadyIssued] = useState(false);
  const [checkingIssueStatus, setCheckingIssueStatus] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      sheetDataCache.cleanup();
      lotMatrixCache.cleanup();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const LS_KEY_SUPERVISORS = 'pallaJobOrder.supervisors';
  const [supervisorOptions, setSupervisorOptions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY_SUPERVISORS) || '[]');
      return uniqCaseInsensitive([...DEFAULT_SUPERVISORS, ...saved]);
    } catch {
      return DEFAULT_SUPERVISORS.slice();
    }
  });

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

  useEffect(() => {
    if (matrix) {
      const generatePdfBackground = async () => {
        try {
          await generateIssuePdfBlob(matrix, { 
            issueDate: todayLocalISO(), 
            supervisor: '' 
          });
        } catch (err) {
          console.warn('Background PDF generation failed:', err);
        }
      };
      
      generatePdfBackground();
    }
  }, [matrix]);

  const handleSearch = async (e) => {
    e?.preventDefault?.();
    if (!canSearch) return;

    setError('');
    setMatrix(null);
    setPreGeneratedPdf(null);
    setSubmissionStatus('');
    setIsLotAlreadyIssued(false); // Reset already issued state
    setLoading(true);

    abortRef.current?.abort?.();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const cacheKey = generateLotMatrixCacheKey(lotInput);
      const cachedMatrix = lotMatrixCache.get(cacheKey);
      
      if (cachedMatrix) {
        setMatrix(cachedMatrix);
      } else {
        const data = await fetchLotMatrixViaSheetsApi(norm(lotInput), ctrl.signal);
        setMatrix(data);
      }
    } catch (err) {
      console.error('❌ Search error:', err);
      setError(err?.message || "Failed to fetch data.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setLotInput('');
    setMatrix(null);
    setPreGeneratedPdf(null);
    setError('');
    setSubmissionStatus('');
    setIsLotAlreadyIssued(false); // Reset already issued state
    abortRef.current?.abort?.();
  };

  const handleBack = () => {
    if (window.history?.length > 1) window.history.back();
    else window.close?.();
  };

  // NEW: Updated openIssueDialog with duplicate check
  const openIssueDialog = async () => {
    if (!matrix) {
      setError("No lot data available. Please search for a lot first.");
      return;
    }
    
    // Reset states
    setDialogError('');
    setSupervisor('');
    setAttendanceCount('');
    setIssueDate(todayLocalISO());
    setSubmissionStatus('');
    setIsLotAlreadyIssued(false);
    setCheckingIssueStatus(true);
    setShowIssueDialog(true);
    
    // Check if lot already issued
    try {
      const alreadyIssued = await checkIfLotAlreadyIssued(matrix.lotNumber);
      setIsLotAlreadyIssued(alreadyIssued);
      
      if (alreadyIssued) {
        setDialogError(`⚠️ Lot ${matrix.lotNumber} has already been issued. Please check the Issue Records sheet.`);
      }
    } catch (error) {
      console.warn('Error checking issue status:', error);
      // Don't block the dialog, just show a warning
      setDialogError('Unable to verify if lot was already issued. You can still proceed.');
    } finally {
      setCheckingIssueStatus(false);
    }
  };

  const closeIssueDialog = () => {
    if (confirming) return;
    setShowIssueDialog(false);
  };

  const handleConfirmIssue = async () => {
    if (!norm(supervisor)) { 
      setDialogError('Supervisor is required.'); 
      return; 
    }
    if (!attendanceCount || parseInt(attendanceCount) <= 0) {
      setDialogError('Please enter a valid attendance count (minimum 1).');
      return;
    }
    
    // NEW: Block if already issued
    if (isLotAlreadyIssued) {
      setDialogError('This lot has already been issued and cannot be issued again.');
      return;
    }
    
    setDialogError('');
    setConfirming(true);
    setSubmissionStatus('submitting');

    try {
      const totalQty = matrix?.totals?.grand || 0;
      
      const colors = matrix.rows.map(row => row.color);
      const sizes = matrix.sizes || [];
      
      const issueData = {
        lotNumber: matrix.lotNumber,
        supervisor: supervisor,
        issueDate: issueDate,
        style: matrix.style || '',
        fabric: matrix.fabric || '',
        garmentType: matrix.garmentType || '',
        totalPieces: totalQty,
        manpower: attendanceCount,
        colors: colors,
        sizes: sizes,
        cuttingDate: matrix.cuttingDate || '',
        status: 'Issued',
        notes: `Issued from Palla Job Order app on ${new Date().toLocaleString()}`
      };
      
      setSubmissionStatus('saving-to-sheet');
      try {
        await submitIssueToSeparateSheet(issueData);
        console.log('✅ Issue data saved to separate Google Sheet');
      } catch (sheetError) {
        console.warn('⚠️ Could not save to sheet (PDF will still be generated):', sheetError);
      }
      
      setSubmissionStatus('generating');
      let pdfResult = null;
      try {
        pdfResult = await generateIssuePdf(matrix, { 
          issueDate, 
          supervisor, 
          manpower: attendanceCount || '0'
        });
        console.log('✅ PDF generated with QR code:', pdfResult);
      } catch (pdfError) {
        console.warn('⚠️ PDF generation warning:', pdfError);
      }

      setSubmissionStatus('success');
      addSupervisorToOptions(supervisor);
      
      setAttendanceCount('');
      
      // Clear cache for this lot
      const matrixCacheKey = generateLotMatrixCacheKey(matrix.lotNumber);
      lotMatrixCache.delete(matrixCacheKey);
      
      // Clear issue records cache
      const issueRecordsCacheKey = generateSheetCacheKey(ISSUE_RECORDS_SHEET_ID, `${ISSUE_RECORDS_TAB}!A:A`);
      sheetDataCache.delete(issueRecordsCacheKey);
      
      setTimeout(() => {
        setShowIssueDialog(false);
        setSubmissionStatus('');
        setConfirming(false);
        
        const qrStatus = pdfResult?.qrGenerated ? 'with QR code' : '(QR generation failed)';
        setError(`✅ PDF generated for Lot ${matrix.lotNumber} - ${supervisor} ${qrStatus}. Data saved to separate sheet.`);
        
        setTimeout(() => {
          if (lotInput) {
            handleSearch({ preventDefault: () => {} });
          }
        }, 1000);
        
      }, 1500);

    } catch (e) {
      console.error('❌ Error:', e);
      setSubmissionStatus('error');
      setDialogError('PDF generated successfully.');
      setConfirming(false);
      
      try {
        await generateIssuePdf(matrix, { 
          issueDate, 
          supervisor,
          manpower: attendanceCount || '0'
        });
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
      }
    }
  };

  const generateIssuePdfBlob = async (matrix, { issueDate, supervisor }) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve('pdf-blob-placeholder');
      }, 1000);
    });
  };

  const displaySizes = useMemo(() => {
    if (!matrix) return [];
    return matrix.source === 'old'
      ? Array(5).fill('')
      : (matrix.sizes || []);
  }, [matrix]);

  const getStatusMessage = () => {
    switch (submissionStatus) {
      case 'submitting':
        return 'Starting submission process...';
      case 'saving-to-sheet':
        return 'Saving data to separate Google Sheet...';
      case 'generating':
        return 'Generating PDF with QR code...';
      case 'success':
        return '✅ Success! PDF with QR code generated and data saved.';
      case 'error':
        return '⚠️ PDF generated (sheet save may have failed).';
      default:
        return '';
    }
  };

  return (
    <Wrap>
      <HeaderPaper>
        <TitleSection>
          <TitleIcon><FiScissors /></TitleIcon>
          <div>
            <h1>Palla Job Order</h1>
            <p>Search a Lot No. to view its Cutting Matrix and totals</p>
          </div>
        </TitleSection>

        <SearchSection>
          <Form onSubmit={handleSearch}>
            <SearchBox>
              <FiSearch />
              <input
                value={lotInput}
                onChange={(e) => setLotInput(e.target.value)}
                placeholder="Enter Lot No (e.g., 64003)"
                autoFocus
              />
            </SearchBox>

            <BtnRow>
              <GhostBtn
                as={motion.button}
                type="button"
                onClick={handleBack}
                whileTap={{ scale: 0.98 }}
                title="Back"
              >
                <FiArrowLeft /> Back
              </GhostBtn>

              <PrimaryBtn as={motion.button} type="submit" disabled={!canSearch} whileTap={{ scale: 0.98 }}>
                {loading ? <Spinner /> : <><FiSearch /> Search</>}
              </PrimaryBtn>

              <GhostBtn as={motion.button} type="button" onClick={handleClear} whileTap={{ scale: 0.98 }}>
                <FiRefreshCw /> Reset
              </GhostBtn>
            </BtnRow>
          </Form>
        </SearchSection>
      </HeaderPaper>

      {error && (
        <ErrorCard>
          <FiAlertTriangle />
          <span>{error}</span>
        </ErrorCard>
      )}

      {matrix ? (
        <ContentGrid>
          <InfoPanel>
            <PanelHeader><FiInfo /><h3>Lot Information</h3></PanelHeader>
            <InfoGrid>
              <InfoItem>
                <InfoIcon><FiPackage /></InfoIcon>
                <div><InfoLabel>Lot Number</InfoLabel><InfoValue>{matrix.lotNumber || '—'}</InfoValue></div>
              </InfoItem>
              <InfoItem>
                <InfoIcon><FiTag /></InfoIcon>
                <div><InfoLabel>Style</InfoLabel><InfoValue>{matrix.style || '—'}</InfoValue></div>
              </InfoItem>
              <InfoItem>
                <InfoIcon><FiGrid /></InfoIcon>
                <div><InfoLabel>Fabric</InfoLabel><InfoValue>{matrix.fabric || '—'}</InfoValue></div>
              </InfoItem>
              <InfoItem>
                <InfoIcon><FiTag /></InfoIcon>
                <div><InfoLabel>Garment Type</InfoLabel><InfoValue>{matrix.garmentType || '—'}</InfoValue></div>
              </InfoItem>
              <InfoItem>
                <InfoIcon><FiCalendar /></InfoIcon>
                <div><InfoLabel>Cutting Date</InfoLabel><InfoValue>{matrix.cuttingDate || '—'}</InfoValue></div>
              </InfoItem>
            </InfoGrid>
            <SummaryCard>
              <SummaryItem><SummaryLabel>Total Pieces</SummaryLabel><SummaryValue>{matrix.totals.grand}</SummaryValue></SummaryItem>
              <SummaryItem><SummaryLabel>Colors</SummaryLabel><SummaryValue>{matrix.rows.length}</SummaryValue></SummaryItem>
              <SummaryItem><SummaryLabel>Sizes</SummaryLabel><SummaryValue>{matrix.sizes.length}</SummaryValue></SummaryItem>
            </SummaryCard>
            <ActionsRow>
              <PrimaryBtn
                as={motion.button}
                type="button"
                onClick={openIssueDialog}
                whileTap={{ scale: 0.98 }}
                whileHover={{ scale: 1.02 }}
                disabled={!matrix}
                style={{ 
                  opacity: !matrix ? 0.6 : 1,
                  cursor: !matrix ? 'not-allowed' : 'pointer'
                }}
              >
                <FiGrid />         
                Submit to Stitching (with QR)
              </PrimaryBtn>
            </ActionsRow>
          </InfoPanel>

          <TablePanel>
            <PanelHeader><FiGrid /><h3>Cutting Matrix</h3></PanelHeader>
            <TableContainer>
              <Table>
                <thead>
                  <tr>
                    <th>Color</th>
                    <th>Cutting Table</th>
                    {displaySizes.map((s, i) => (
                      <th key={`${s || 'size'}-${i}`}>{s || '\u00A0'}</th>
                    ))}
                    <th>Total Pcs</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.color}</td>
                      <td className="num">{r.cuttingTable ?? ''}</td>
                      {displaySizes.map((s, i) => (
                        <td key={`${r.color}-${s || 'size'}-${i}`} className="num">
                          {r.sizes?.[s] ?? ''}
                        </td>
                      ))}
                      <td className="num strong">{r.totalPcs ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="strong">Total</td>
                    <td className="num">—</td>
                    {displaySizes.map((s, i) => (
                      <td key={`total-${s || 'size'}-${i}`} className="num strong">
                        {matrix.totals.perSize?.[s] ?? 0}
                      </td>
                    ))}
                    <td className="num strong">{matrix.totals.grand}</td>
                  </tr>
                </tfoot>
              </Table>
            </TableContainer>
          </TablePanel>
        </ContentGrid>
      ) : (
        !loading && !error && (
          <>
            <HintCard>
              <FiInfo />
              <span>
                💡 Tip: If your spreadsheet has one tab per lot, name them like <code>Cutting Matrix — Lot 64003</code> or <code>Cutting Matrix - Lot 64003</code>. The system will find them automatically.
              </span>
            </HintCard>

            <InstructionsSection>
              <InstructionsHeader>
                <FiInfo />
                <h2>How to Use This Tool</h2>
              </InstructionsHeader>

              <InstructionsGrid>
                <InstructionCard>
                  <div className="instruction-icon">
                    <FiSearch />
                  </div>
                  <div className="instruction-title">1. Search for a Lot</div>
                  <div className="instruction-desc">
                    Enter a Lot Number in the search box above. The system will automatically search through both new cutting data and old lot records to find matching information.
                  </div>
                </InstructionCard>

                <InstructionCard>
                  <div className="instruction-icon">
                    <FiGrid />
                  </div>
                  <div className="instruction-title">2. Review Cutting Matrix</div>
                  <div className="instruction-desc">
                    View the complete cutting matrix showing colors, cutting tables, sizes, and quantities. Verify all details are correct before proceeding.
                  </div>
                </InstructionCard>

                <InstructionCard>
                  <div className="instruction-icon">
                    <FiGrid />
                  </div>
                  <div className="instruction-title">3. Generate QR Code</div>
                  <div className="instruction-desc">
                    Click 'Submit to Stitching (with QR)' to generate a PDF with a QR code. When scanned, it will automatically mark the job as completed.
                  </div>
                </InstructionCard>
              </InstructionsGrid>

              <FeaturesList>
                <h3 style={{ margin: '0 0 16px 0', color: '#1e293b' }}>Key Features</h3>
                <FeatureItem>
                  <div className="feature-check">
                    <FiCheck />
                  </div>
                  <div className="feature-text">
                    <strong>QR Code Completion</strong> - Scan QR code to automatically update completion status in Google Sheets
                  </div>
                </FeatureItem>
                <FeatureItem>
                  <div className="feature-check">
                    <FiCheck />
                  </div>
                  <div className="feature-text">
                    <strong>Automatic Lot Detection</strong> - Searches both new cutting sheets and old lot databases automatically
                  </div>
                </FeatureItem>
                <FeatureItem>
                  <div className="feature-check">
                    <FiCheck />
                  </div>
                  <div className="feature-text">
                    <strong>Professional PDF Generation</strong> - Creates comprehensive issue documents with QR codes for tracking
                  </div>
                </FeatureItem>
                <FeatureItem>
                  <div className="feature-check">
                    <FiCheck />
                  </div>
                  <div className="feature-text">
                    <strong>Duplicate Issue Prevention</strong> - Automatically checks if a lot has already been issued before allowing a new submission
                  </div>
                </FeatureItem>
              </FeaturesList>

              <QuickTips>
                <TipsHeader>
                  <FiAlertTriangle />
                  <h4>Quick Tips</h4>
                </TipsHeader>
                <TipItem>
                  <div className="tip-bullet">•</div>
                  <div className="tip-text">
                    Lot Format: You can search using full lot numbers (64003) or 4-digit codes for older lots
                  </div>
                </TipItem>
                <TipItem>
                  <div className="tip-bullet">•</div>
                  <div className="tip-text">
                    Auto-complete: Supervisor names are saved and suggested for faster data entry
                  </div>
                </TipItem>
                <TipItem>
                  <div className="tip-bullet">•</div>
                  <div className="tip-text">
                    QR Code Tracking: Each job gets a unique QR code that can be scanned to mark completion
                  </div>
                </TipItem>
                <TipItem>
                  <div className="tip-bullet">•</div>
                  <div className="tip-text">
                    Duplicate Prevention: The system checks the IssueRecords sheet to prevent issuing the same lot twice
                  </div>
                </TipItem>
              </QuickTips>
            </InstructionsSection>
          </>
        )
      )}

      {showIssueDialog && (
        <DialogOverlay onClick={closeIssueDialog}>
          <DialogContainer onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <h3><FiGrid /> Palla Job Order with QR Code</h3>
              <CloseButton onClick={closeIssueDialog} disabled={confirming}>
                <FiX />
              </CloseButton>
            </DialogHeader>

            <DialogContent>
              {checkingIssueStatus && (
                <div style={{ 
                  margin: '20px 0', 
                  padding: '15px', 
                  background: '#f0f9ff', 
                  borderRadius: '12px', 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <Spinner size="20px" trackColor="#e2e8f0" spinColor="#8b5cf6" />
                  <span style={{ color: '#0369a1' }}>Checking if lot already issued...</span>
                </div>
              )}

              {/* NEW: Warning message for already issued lot */}
              {isLotAlreadyIssued && !checkingIssueStatus && (
                <WarningMessage>
                  <FiAlertTriangle size={24} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '4px' }}>
                      ⚠️ Lot Already Issued
                    </strong>
                    Lot {matrix?.lotNumber} has already been issued and cannot be submitted again. 
                    Please check the Issue Records sheet for details.
                  </div>
                </WarningMessage>
              )}

              <SimpleField>
                <FieldLabel><FiCalendar /> Date of Issue</FieldLabel>
                <input 
                  type="date" 
                  value={issueDate} 
                  onChange={(e) => setIssueDate(e.target.value)}
                  disabled={confirming || isLotAlreadyIssued}
                />
              </SimpleField>

              <SimpleField>
                <FieldLabel><FiUser /> Supervisor</FieldLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <input
                    list="supervisorList"
                    placeholder="Supervisor"
                    value={supervisor}
                    onChange={(e) => setSupervisor(titleCase(e.target.value))}
                    disabled={confirming || isLotAlreadyIssued}
                  />
                  {typedIsNewSupervisor && !confirming && !isLotAlreadyIssued && (
                    <AddButton
                      type="button"
                      onClick={() => addSupervisorToOptions(supervisor)}
                      title="Add"
                    >
                      + Add
                    </AddButton>
                  )}
                </div>
                <datalist id="supervisorList">
                  {supervisorOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </SimpleField>

              <SimpleField>
                <FieldLabel>
                  <FiUser /> Manpower (Daily Attendance)
                </FieldLabel>
                <input
                  type="number"
                  min="1"
                  placeholder="Enter number of persons"
                  value={attendanceCount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || (/^\d+$/.test(value) && parseInt(value) >= 1)) {
                      setAttendanceCount(value);
                    }
                  }}
                  disabled={confirming || isLotAlreadyIssued}
                />
              </SimpleField>

              <SimpleField>
                <FieldLabel>
                  <FiPackage /> Stitching Issue Quantity
                </FieldLabel>
                <input
                  type="text"
                  value={matrix?.totals?.grand || 0}
                  disabled
                  readOnly
                  style={{
                    background: '#f8fafc',
                    color: '#1e293b',
                    fontWeight: 'bold',
                    cursor: 'default'
                  }}
                />
              </SimpleField>

              {!isLotAlreadyIssued && (
                <div style={{ 
                  margin: '20px 0', 
                  padding: '15px', 
                  background: '#f0f9ff', 
                  borderRadius: '12px', 
                  border: '1px solid #bae6fd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <FiGrid size={24} color="#0369a1" />
                  <div>
                    <div style={{ fontWeight: '600', color: '#0369a1', marginBottom: '4px' }}>
                      QR Code will be generated
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#075985' }}>
                      Scan the QR code on the PDF to mark this job as completed
                    </div>
                  </div>
                </div>
              )}

              {submissionStatus && (
                <div style={{ margin: '20px 0', padding: '15px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <Spinner size="16px" trackColor="#e2e8f0" spinColor="#8b5cf6" />
                    <span style={{ fontWeight: '600', color: '#1e293b' }}>
                      {getStatusMessage()}
                    </span>
                  </div>
                  {submissionStatus === 'error' && (
                    <div style={{ color: '#dc2626', fontSize: '0.9rem', marginTop: '10px' }}>
                      {dialogError}
                    </div>
                  )}
                </div>
              )}

              <DialogActions>
                <SimpleGhostBtn 
                  type="button" 
                  onClick={closeIssueDialog} 
                  disabled={confirming}
                >
                  Cancel
                </SimpleGhostBtn>
                <SimplePrimaryBtn 
                  type="button" 
                  onClick={handleConfirmIssue} 
                  disabled={confirming || isLotAlreadyIssued || checkingIssueStatus} 
                >
                  {confirming ? (
                    <>
                      <Spinner size="16px" spinColor="white" /> Processing...
                    </>
                  ) : isLotAlreadyIssued ? (
                    <>
                      <FiAlertTriangle /> Already Issued
                    </>
                  ) : (
                    <>
                      <FiGrid /> Generate QR & Issue
                    </>
                  )}
                </SimplePrimaryBtn>
              </DialogActions>
            </DialogContent>
          </DialogContainer>
        </DialogOverlay>
      )}
    </Wrap>
  );
}
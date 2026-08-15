import React, { useMemo, useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import {
  FiSearch, FiRefreshCw, FiAlertTriangle, FiUser, FiCalendar, FiX, FiCheck,
  FiScissors, FiInfo, FiPackage, FiTag, FiGrid, FiArrowLeft, FiLoader,FiGlobe,FiEdit2, FiSettings, FiTool
} from 'react-icons/fi';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ---------- Helpers (module scope, hoisted) ----------
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
// const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyBaS5sEqHTMWcTrdxzjKhjHJg5zJ0TGRCIrPsgfpSHiAakBtQqCnptekUvBcTowItWyQ/exec";
const OLD_LOTS_SOURCE_TAB = "Sheet1";
// const OLD_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMuD4XQ_kiTE59WNIY-OXwZkZzDhEuSiWy86qySeQFMrokUEy9YsoU0bBAUvbp5XNKIg/exec";
const SHEET_IDD = "18FzakygM7DVD29IRbpe68pDeCFQhFLj7t4C-XQ1MWWc";
const OLD_META_SHEET_ID = "1xD8Uy1lUgvNTQ2RGRBI4ZjOrozbinUPRq2_UfIplP98";
const OLD_META_TAB = "RAW FINAL";
const ISSUE_LOG_SHEET_ID = SHEET_ID;
const ISSUE_LOG_TAB = "Index";
const ALTER_JOB_ORDERS_SHEET_ID = '19zo4q6LXAAUfaURHEBeCWWVyKWCBvYZlqk1pADBfg4w'; // Same as main sheet
const ALTER_JOB_ORDERS_TAB = "AlterJobOrders";

const MAX_RANGE = 'A1:Z';
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
    this.ttl = 5 * 60 * 1000; // 5 minutes
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

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }

  delete(key) {
    this.cache.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}
const translations = {
  en: {
    // Header
    title: "Alter Job Order",
    subtitle: "Search a Lot No. to view its Cutting Matrix and totals",
    searchPlaceholder: "Enter Lot No (e.g., 64003)",
    back: "Back",
    search: "Search",
    reset: "Reset",
    
    // Instructions
    howToUse: "How to Use This Tool",
    step1: "1. Search for a Lot",
    step1Desc: "Enter a Lot Number in the search box above. The system will automatically search through both new cutting data and old lot records to find matching information.",
    step2: "2. Review Cutting Matrix",
    step2Desc: "View the complete cutting matrix showing colyors, cutting tables, sizes, and quantities. Verify all details are correct before proceeding.",
    step3: "3. Issue job Order for Alter",
    step3Desc: "Once verified, click 'Submit to Stitching' to generate the official issue document and record the transaction in the system.",
    
    // Features
    keyFeatures: "Key Features",
    feature1: "Automatic Lot Detection - Searches both new cutting sheets and old lot databases automatically",
    feature2: "Duplicate Prevention - Prevents re-issuing lots that are already in the stitching pipeline",
    feature3: "Professional PDF Generation - Creates comprehensive issue documents with QR codes for tracking",
    feature4: "Real-time Validation - Checks lot status and ensures data integrity before processing",
    
    // Quick Tips
    quickTips: "Quick Tips",
    tip1: "Lot Format: You can search using full lot numbers (64003) or 4-digit codes for older lots",
    tip2: "Auto-complete: Supervisor names are saved and suggested for faster data entry",
    tip3: "Data Safety: The system automatically checks if a lot is already issued to prevent duplicates",
    tip4: "Offline Capable: PDF generation works even if the data submission encounters temporary issues",
    
    // Lot Information
    lotInfo: "Lot Information",
    lotNumber: "Lot Number",
    style: "Style",
    fabric: "Fabric",
    garmentType: "Garment Type",
    totalPieces: "Total Pieces",
    colors: "Colors",
    sizes: "Sizes",
    
    // Table
    cuttingMatrix: "Cutting Matrix",
    color: "Color",
    cuttingTable: "Cutting Table",
    totalPcs: "Total Pcs",
    total: "Total",
    
    // Buttons
    submitToStitching: "Submit to Alter JobOrder",
    alreadyIssued: "Already Issued",
    
    // Dialog
    issueToStitching: "Issue For Alter JobOrder Challan",
    dateOfIssue: "Date of Issue",
    supervisor: "Supervisor",
    add: "Add",
    cancel: "Cancel",
    confirmIssue: "Confirm Issue",
    processing: "Processing...",
    
    // Status Messages
    preparingSubmission: "Preparing submission",
    savingToSheets: "Saving to Sheets",
    generatingPDF: "Generating PDF",
    successMessage: "Success! Data submitted and PDF generated.",
    submissionFailed: "Submission Failed",
    tryAgain: "Try Again",
    
    // Errors
    lotAlreadyIssued: "Lot already issued",
    lotAlreadyIssuedDesc: "This lot has been processed before. Please pick a different lot to continue.",
    supervisorRequired: "Supervisor is required.",
    noDataAvailable: "No lot data available. Please search for a lot first.",
    
    // Tip
    tip: "💡 Tip: If your spreadsheet has one tab per lot, name them like",
    
    // Language
    language: "Language",
    hindi: "Hindi",
    english: "English"
  },
  hi: {
    // Header
    title: "सिलाई के लिए जारी करें",
    subtitle: "लॉट नंबर डालकर उसकी कटिंग मैट्रिक्स और कुल मात्रा देखें",
    searchPlaceholder: "लॉट नंबर डालें (जैसे, 64003)",
    back: "पीछे",
    search: "खोजें",
    reset: "रीसेट",
    
    // Instructions
    howToUse: "इस टूल का उपयोग कैसे करें",
    step1: "1. लॉट खोजें",
    step1Desc: "ऊपर दिए गए सर्च बॉक्स में लॉट नंबर डालें। सिस्टम स्वचालित रूप से नई कटिंग डेटा और पुराने लॉट रिकॉर्ड दोनों में खोज करेगा।",
    step2: "2. कटिंग मैट्रिक्स की समीक्षा करें",
    step2Desc: "रंग, कटिंग टेबल, साइज और मात्रा दिखाने वाली पूरी कटिंग मैट्रिक्स देखें। आगे बढ़ने से पहले सभी विवरण सही हैं सुनिश्चित करें।",
    step3: "3. सिलाई के लिए जारी करें",
    step3Desc: "सत्यापित होने के बाद, आधिकारिक दस्तावेज़ बनाने और लेनदेन रिकॉर्ड करने के लिए 'सिलाई के लिए जमा करें' पर क्लिक करें।",
    
    // Features
    keyFeatures: "मुख्य विशेषताएं",
    feature1: "स्वचालित लॉट डिटेक्शन - नई कटिंग शीट और पुराने लॉट डेटाबेस दोनों में स्वचालित रूप से खोजता है",
    feature2: "डुप्लिकेट रोकथाम - पहले से सिलाई पाइपलाइन में मौजूद लॉट को दोबारा जारी करने से रोकता है",
    feature3: "पेशेवर PDF जनरेशन - ट्रैकिंग के लिए QR कोड वाले व्यापक दस्तावेज़ बनाता है",
    feature4: "रीयल-टाइम वैलिडेशन - प्रोसेसिंग से पहले लॉट स्टेटस की जांच करता है और डेटा अखंडता सुनिश्चित करता है",
    
    // Quick Tips
    quickTips: "त्वरित सुझाव",
    tip1: "लॉट फॉर्मेट: आप पूर्ण लॉट नंबर (64003) या पुराने लॉट के लिए 4-अंकीय कोड का उपयोग कर सकते हैं",
    tip2: "ऑटो-कम्पलीट: सुपरवाइजर नाम सहेजे जाते हैं और तेज डेटा एंट्री के लिए सुझाए जाते हैं",
    tip3: "डेटा सुरक्षा: सिस्टम स्वचालित रूप से जांचता है कि लॉट पहले से जारी तो नहीं है",
    tip4: "ऑफलाइन सक्षम: डेटा सबमिशन में अस्थायी समस्याएं आने पर भी PDF जनरेशन काम करता है",
    
    // Lot Information
    lotInfo: "लॉट जानकारी",
    lotNumber: "लॉट नंबर",
    style: "स्टाइल",
    fabric: "फैब्रिक",
    garmentType: "गारमेंट प्रकार",
    totalPieces: "कुल पीस",
    colors: "रंग",
    sizes: "साइज",
    
    // Table
    cuttingMatrix: "कटिंग मैट्रिक्स",
    color: "रंग",
    cuttingTable: "कटिंग टेबल",
    totalPcs: "कुल पीस",
    total: "कुल",
    
    // Buttons
    submitToStitching: "सिलाई के लिए जमा करें",
    alreadyIssued: "पहले ही जारी",
    
    // Dialog
    issueToStitching: "सिलाई के लिए जारी करें",
    dateOfIssue: "जारी करने की तारीख",
    supervisor: "सुपरवाइजर",
    add: "जोड़ें",
    cancel: "रद्द करें",
    confirmIssue: "जारी करने की पुष्टि करें",
    processing: "प्रोसेसिंग...",
    
    // Status Messages
    preparingSubmission: "सबमिशन तैयार कर रहा है",
    savingToSheets: "शीट में सेव कर रहा है",
    generatingPDF: "PDF जनरेट कर रहा है",
    successMessage: "सफलता! डेटा जमा किया गया और PDF जनरेट हुआ।",
    submissionFailed: "सबमिशन विफल",
    tryAgain: "फिर से कोशिश करें",
    
    // Errors
    lotAlreadyIssued: "लॉट पहले ही जारी हो चुका है",
    lotAlreadyIssuedDesc: "यह लॉट पहले प्रोसेस किया जा चुका है। कृपया जारी रखने के लिए कोई अलग लॉट चुनें।",
    supervisorRequired: "सुपरवाइजर आवश्यक है।",
    noDataAvailable: "कोई लॉट डेटा उपलब्ध नहीं है। कृपया पहले लॉट खोजें।",
    
    // Tip
    tip: "💡 टिप: यदि आपकी स्प्रेडशीट में प्रति लॉट एक टैब है, तो उन्हें इस तरह नाम दें",
    
    // Language
    language: "भाषा",
    hindi: "हिंदी",
    english: "अंग्रेजी"
  }
};

// Language Context
const LanguageContext = React.createContext();

// Language Toggle Component
const LanguageToggle = styled.button`
  position: fixed;
  top: 20px;
  right: 20px;
  background: rgba(15, 23, 42, 0.9);
  border: none;
  border-radius: 12px;
  padding: 12px 16px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(15, 23, 42, 1);
    transform: translateY(-2px);
  }
`;

// Global cache instances
const sheetDataCache = new ApiCache();
const lotMatrixCache = new ApiCache();
const issueStatusCache = new ApiCache();

// Cache key generators
function generateSheetCacheKey(sheetId, range) {
  return `sheet_${sheetId}_${range}`;
}

function generateLotMatrixCacheKey(lotNo) {
  return `lot_matrix_${norm(lotNo)}`;
}

function generateIssueStatusCacheKey(lotNo) {
  return `issue_status_${norm(lotNo)}`;
}

// ============================
// CACHED API FUNCTIONS
// ============================
async function fetchSheetDataCached(sheetId, range, signal) {
  const cacheKey = generateSheetCacheKey(sheetId, range);
  
  const cached = sheetDataCache.get(cacheKey);
  if (cached) {
    console.log('📦 Cache HIT for sheet data:', range);
    return cached;
  }

  console.log('🔄 Cache MISS for sheet data:', range);
  
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { signal });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet data: ${res.status}`);
  }

  const data = await res.json();
  const result = data?.values || [];
  
  sheetDataCache.set(cacheKey, result);
  
  return result;
}

async function isLotAlreadyIssued(lotNo, signal) {
  const cacheKey = generateIssueStatusCacheKey(lotNo);
  
  const cached = issueStatusCache.get(cacheKey);
  if (cached !== undefined && cached !== null) {
    console.log('📦 Cache HIT for alter issue status:', lotNo, '->', cached);
    return cached;
  }

  console.log('🔄 Cache MISS for alter issue status:', lotNo);

  if (!GOOGLE_API_KEY || !ALTER_JOB_ORDERS_SHEET_ID) {
    console.log('❌ Missing API key or AlterJobOrders Sheet ID');
    issueStatusCache.set(cacheKey, false);
    return false;
  }

  // Search in column B (Lot Number column) - use a wider range
  const range = encodeURIComponent(`${ALTER_JOB_ORDERS_TAB}!A2:Z`);
  
  try {
    console.log('📊 Fetching AlterJobOrders sheet data...');
    const rows = await fetchSheetDataCached(ALTER_JOB_ORDERS_SHEET_ID, range, signal);
    console.log('📊 AlterJobOrders sheet rows count:', rows.length);
    
    console.log('🔍 Searching for lot in AlterJobOrders:', lotNo);
    
    let isIssued = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      // Column B (index 1) contains Lot Number
      const rowLotNo = norm(row[1]); // Column B is index 1
      
      if (rowLotNo === norm(lotNo)) {
        isIssued = true;
        console.log(`🎯 Found lot ${lotNo} in AlterJobOrders at row ${i + 2}`);
        break;
      }
    }

    console.log(`📝 Final result for ${lotNo}: isAlreadyIssued =`, isIssued);
    issueStatusCache.set(cacheKey, isIssued);
    
    return isIssued;
  } catch (error) {
    console.warn('❌ Error checking AlterJobOrders:', error);
    issueStatusCache.set(cacheKey, false);
    return false;
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
  if (cached) {
    console.log('📦 Cache HIT for lot matrix:', lotNo);
    return cached;
  }

  console.log('🔄 Cache MISS for lot matrix:', lotNo);

  if (!GOOGLE_API_KEY || !SHEET_ID) {
    throw new Error('Missing API key or Sheet ID.');
  }

  const { isOld, searchKey, lot4 } = classifyLot(lotNo);
  console.log('Searching for lot:', { isOld, searchKey, lot4 });

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

    const lotIdx     = headers.findIndex(h => includes(h, 'lot'));
    const itemIdx    = headers.findIndex(h => includes(h, 'item'));
    const styleIdx   = headers.findIndex(h => includes(h, 'style'));
    const fabricIdx  = headers.findIndex(h => includes(h, 'fabric'));
    const catIdx     = headers.findIndex(h => includes(h, 'gents') || includes(h, 'ladies') || includes(h, 'kids'));

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (lotIdx !== -1 && norm(r[lotIdx]) === norm(lotNo)) {
        return {
          garmentType: itemIdx   !== -1 ? norm(r[itemIdx])   : '',
          style:       styleIdx  !== -1 ? norm(r[styleIdx])  : '',
          fabric:      fabricIdx !== -1 ? norm(r[fabricIdx]) : '',
          category:    catIdx    !== -1 ? norm(r[catIdx])    : ''
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
    
    if (!rows?.length) {
      throw new Error('Index sheet is empty');
    }

    console.log('Fetched Index sheet with', rows.length, 'rows');
    return rows;
  } catch (err) {
    console.error('Error fetching Index sheet:', err.message);
    throw err;
  }
}
async function saveAlterJobOrderToSheets(data) {
  try {
    const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec";
    
    // DEBUG: Check what we're sending
    console.log('🔍 Master Glti Total being sent:', data.masterGltiTotal);
    console.log('🔍 Master Glti Counts being sent:', data.masterGltiCounts);
    console.log('🔍 Has masterGltiCounts:', Object.keys(data.masterGltiCounts || {}).length > 0);
    console.log('🔍 Total Alter PCS calculation:', 
      (data.kharchaTotal || 0) + 
      (data.embPendingTotal || 0) + 
      (data.masterGltiTotal || 0)
    );
    
    // Prepare the data object exactly like your Apps Script expects
    const payload = {
      lotNumber: data.lotNumber || '',
      fabric: data.fabric || '',
      garmentType: data.garmentType || '',
      style: data.style || '',
      brand: data.brand || '',
      totalPcs: data.totalPcs || 0,
      issueDate: data.issueDate || '',
      supervisor: data.supervisor || '',
      kharchaTotal: data.kharchaTotal || 0,
      embPendingTotal: data.embPendingTotal || 0,
      masterGltiTotal: data.masterGltiTotal || 0,
      totalAlterPcs: (data.kharchaTotal || 0) + (data.embPendingTotal || 0) + (data.masterGltiTotal || 0),
      alterCounts: data.alterCounts || {},
      masterGltiCounts: data.masterGltiCounts || {}
    };
    
    console.log('📦 Full payload being sent:', JSON.stringify(payload, null, 2));
    
    // Send as pure JSON
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      mode: 'cors'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('📥 Response received:', result);
    
    return {
      success: result.success || true,
      message: result.message || 'Data sent successfully',
      method: 'POST',
      timestamp: new Date().toISOString(),
      qrUrl: result.qrUrl
    };
    
  } catch (error) {
    console.error('❌ Primary method failed:', error);
    
    // Try GET as fallback with simpler data
    try {
      console.log('🔄 Trying GET fallback...');
      
      // Build simple URL with essential parameters
      const baseUrl = "https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec";
      const params = new URLSearchParams();
      
      // Send all data as parameters, including masterGltiCounts as JSON string
      params.append('lotNumber', data.lotNumber || '');
      params.append('fabric', data.fabric || '');
      params.append('garmentType', data.garmentType || '');
      params.append('style', data.style || '');
      params.append('brand', data.brand || '');
      params.append('totalPcs', data.totalPcs || 0);
      params.append('issueDate', data.issueDate || '');
      params.append('supervisor', data.supervisor || '');
      params.append('kharchaTotal', data.kharchaTotal || 0);
      params.append('embPendingTotal', data.embPendingTotal || 0);
      params.append('masterGltiTotal', data.masterGltiTotal || 0);
      params.append('totalAlterPcs', (data.kharchaTotal || 0) + (data.embPendingTotal || 0) + (data.masterGltiTotal || 0));
      params.append('alterCounts', JSON.stringify(data.alterCounts || {}));
      params.append('masterGltiCounts', JSON.stringify(data.masterGltiCounts || {})); // Add this
      
      const url = `${baseUrl}?${params.toString()}`;
      console.log('🔄 GET URL (first 500 chars):', url.substring(0, 500));
      
      const response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors'
      });
      
      console.log('📥 GET fallback sent');
      
      return {
        success: true,
        message: 'Data sent via GET fallback',
        method: 'GET',
        timestamp: new Date().toISOString(),
        qrUrl: `${baseUrl}?action=showOptions&lot=${encodeURIComponent(data.lotNumber || '')}`
      };
    } catch (finalError) {
      console.error('❌ All methods failed:', finalError);
      return {
        success: false,
        error: 'All submission methods failed',
        details: {
          primary: error.message,
          get: finalError.message
        }
      };
    }
  }
}

// Update the fallback GET function too



async function fetchFromCuttingUsingIndex(lotInfo, signal) {
  const { startRow, numRows, headerCols, lotNumber } = lotInfo;

  const endRow = startRow + numRows - 1;
  const range = encodeURIComponent(`Cutting!A${startRow}:Z${endRow}`);

  try {
    const rows = await fetchSheetDataCached(SHEET_ID, range, signal);
    
    console.log(`Fetched ${rows.length} rows from Cutting sheet using index`);

    const parsed = parseMatrixWithIndexInfo(rows, lotInfo);
    if (parsed && parsed.rows && parsed.rows.length > 0) {
      console.log('Successfully parsed using index information');
      return parsed;
    }

    console.log('Primary parsing failed, trying alternative approach');
    const parsedAlt = parseMatrix(rows, lotNumber);
    if (parsedAlt && parsedAlt.rows && parsedAlt.rows.length > 0) {
      parsedAlt.imageUrl = lotInfo.imageUrl || '';
      console.log('Successfully parsed with alternative method');
      return parsedAlt;
    }

    throw new Error('Failed to parse data using both methods');

  } catch (err) {
    console.error('Error fetching using index:', err.message);
    throw err;
  }
}

// ---------- Old-lots header detection ----------
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
  item: new Set([
    'item name','item','item description','style','style name','article','article name','itemname'
  ]),
  shade: new Set([
    'shade name','shade','colour','color','color name','shade colour','shade color','colour name'
  ]),
  qty: new Set([
    'quantity','qty','pcs','qty pcs','qtypcs','qty pcs','qtypcs','qty (pcs)','qtypcs',
    'issue qty','issue quantity','total qty','total quantity','qtypiece','pcs qty','pcsqty'
  ]),
  lot: new Set([
    'issue lot number','lot','lot number','issued lot','issue lot no','issue lot no.','lotno'
  ]),
  pack: new Set([
    'pack size','pack / size','pack/size','pack','size','packet size','sizes'
  ]),
  cutting: new Set([
    'cutting table','cutting','ct',
    'issue supplier/worker name','supplier/worker name','supplier/worker',
    'issue supplier','supplier','worker','karigar','issue karigar'
  ])
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
    if (map.item === -1 && HDR_SYNONYMS.item.has(name))  map.item  = idx;
    if (map.shade === -1 && HDR_SYNONYMS.shade.has(name)) map.shade = idx;
    if (map.qty === -1 && HDR_SYNONYMS.qty.has(name))     map.qty   = idx;
    if (map.lot === -1 && HDR_SYNONYMS.lot.has(name))     map.lot   = idx;
    if (map.pack === -1 && HDR_SYNONYMS.pack.has(name))   map.pack  = idx;
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
  const range = encodeURIComponent(`${OLD_LOTS_SOURCE_TAB}!A2:Z`);
  
  const rows = await fetchSheetDataCached(SHEET_IDD, range, signal);
  
  if (rows.length < 2) throw new Error(`${OLD_LOTS_SOURCE_TAB} seems empty`);

  const { headerIdx, map, headerRaw } = detectOldLotsHeaderAndMap(rows);

  if (map.item === -1 || map.shade === -1 || map.qty === -1) {
    const seen = (headerRaw || []).map(h => norm(h)).join(' | ');
    throw new Error(
      `Source must have ITEM NAME, SHADE NAME, QUANTITY (any common variant).\n` +
      `Seen header row: ${seen}\n` +
      `Tip: Rename headers closer to: "ITEM NAME", "SHADE NAME", "QUANTITY" or add them anywhere on the header row.`
    );
  }
  

  const lotDigits = (String(lotNo).match(/\d+/g) || []).join('');
  const lot4 = lotDigits.length >= 4 ? lotDigits.slice(-4) : lotDigits;

  const bodyRows = rows.slice(headerIdx + 1);

  const filtered = bodyRows.filter(r => {
    const itemStr  = norm(r[map.item]);
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
    throw new Error(
      `Lot ${lot4} not found in ${OLD_LOTS_SOURCE_TAB}. ` +
      `Ensure ITEM NAME contains the 4-digit lot (e.g., "... 5411 ...") or there is a LOT column.\n` +
      `Seen header row: ${seen}`
    );
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
    style:       meta.style || firstItem.replace(/\b(\d{4})\b/, '').trim(),
    fabric:      meta.fabric || '',
    category:    meta.category || '',
    imageUrl:    '',
    sizes: [],
    rows: rowsOut,
    totals: { perSize: {}, grand: rowsOut.reduce((s,r)=>s+(r.totalPcs||0),0) }
  };
}


// ============================
// Cutting parsers
// ============================
function parseMatrixWithIndexInfo(rows, lotInfo) {
  console.log('Parsing with index info:', lotInfo);

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

    const styleIdx = r.findIndex(c => includes(c, 'style'));
    if (styleIdx !== -1 && r[styleIdx + 1] && !style) style = norm(r[styleIdx + 1]);

    const fabricIdx = r.findIndex(c => includes(c, 'fabric'));
    if (fabricIdx !== -1 && r[fabricIdx + 1] && !fabric) fabric = norm(r[fabricIdx + 1]);

    const garmentTypeIdx = r.findIndex(c => includes(c, 'garment type'));
    if (garmentTypeIdx !== -1 && r[garmentTypeIdx + 1] && !garmentType) garmentType = norm(r[garmentTypeIdx + 1]);
    const brandIdx = r.findIndex(c => includes(c, 'brand'));
if (brandIdx !== -1 && r[brandIdx + 1] && !brand) brand = norm(r[brandIdx + 1]);
  }

  let headerIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] || [];

    const hasColor = r.some(c => includes(c, 'color'));
    const hasCT = r.some(c => includes(c, 'cutting table') || includes(c, 'table'));
    const hasSizes = r.some(c => !isNaN(parseFloat(c)) && isFinite(c));

    if ((hasColor && hasCT) || (hasColor && hasSizes) || (hasCT && hasSizes)) {
      headerIdx = i;
      console.log('Found header at row:', i);
      break;
    }
  }

  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i] || [];
      const textCols = r.filter(c => typeof c === 'string' && c.trim().length > 2);
      const numberCols = r.filter(c => !isNaN(parseFloat(c)) && isFinite(c));
      if (textCols.length >= 2 && numberCols.length >= 2) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const r = rows[i] || [];
        if (r.some(cell => norm(cell))) { headerIdx = i; break; }
      }
    }
  }

  if (headerIdx === -1) {
    console.error('Could not find header row in provided data');
    return null;
  }

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

  if (sizeCols.length === 0) {
    for (let i = startIdx; i < endIdx; i++) {
      for (let j = headerIdx + 1; j < Math.min(headerIdx + 5, rows.length); j++) {
        const cellValue = rows[j]?.[i];
        if (cellValue && !isNaN(parseFloat(cellValue)) && isFinite(cellValue)) {
          const colName = norm(header[i]) || `Size${i - startIdx + 1}`;
          sizeCols.push({ key: colName, index: i });
          break;
        }
      }
    }
  }

  if (sizeCols.length === 0) {
    console.error('No size columns found');
    return null;
  }

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
      brand,
    garmentType,
    imageUrl: lotInfo.imageUrl || '',
    sizes: sizeKeys,
    rows: body,
    totals
  };
}

async function searchInCuttingSheet(lotNo, signal) {
  console.log('Searching in Cutting sheet (fallback)');

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

// const valOrEmpty = v => (v == null || v === 0 || v === '0' ? '' : v);

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
  
  // Add these columns for issue status check
  const dateOfIssueCol = headers.findIndex(h => includes(h, 'date of issue'));
  const supervisorCol = headers.findIndex(h => includes(h, 'supervisor'));
  
  // FIXED: Use findIndex with includes for brand column
   const brandCol = headers.findIndex(h => 
    norm(h) === 'brand' || 
    norm(h) === 'BRAND' || 
    includes(h, 'brand')
  );

  if (lotNumberCol === -1) {
    console.log('Lot Number column not found in Index sheet');
    return null;
  }

  for (let i = 1; i < indexData.length; i++) {
    const row = indexData[i] || [];
    const rowLotNo = norm(row[lotNumberCol]);

    if (rowLotNo === norm(lotNo)) {
      const hasDateOfIssue = dateOfIssueCol !== -1 && norm(row[dateOfIssueCol]) !== "";
      const hasSupervisor = supervisorCol !== -1 && norm(row[supervisorCol]) !== "";
      const isAlreadyIssued = hasDateOfIssue || hasSupervisor; // CHANGED: OR instead of AND

      return {
        lotNumber: rowLotNo,
        startRow: startRowCol !== -1 ? parseInt(row[startRowCol]) || 1 : 1,
        numRows: numRowsCol !== -1 ? parseInt(row[numRowsCol]) || 20 : 20,
        headerCols: headerColsCol !== -1 ? parseInt(row[headerColsCol]) || 7 : 7,
        // FIXED: Use the brandCol index to access the brand value
     brand: brandCol !== -1 ? norm(row[brandCol]) : '',
        // Other fields remain the same
        fabric: headers.includes('fabric') && row[headers.indexOf('fabric')] || '',
        garmentType: headers.includes('garment type') && row[headers.indexOf('garment type')] || '',
        style: headers.includes('style') && row[headers.indexOf('style')] || '',
        sizes: headers.includes('sizes') && row[headers.indexOf('sizes')] || '',
        shades: headers.includes('shades') && row[headers.indexOf('shades')] || '',
        imageUrl: imgCol !== -1 ? norm(row[imgCol]) : '',
        // Add issue status information
        dateOfIssue: dateOfIssueCol !== -1 ? norm(row[dateOfIssueCol]) : '',
        supervisor: supervisorCol !== -1 ? norm(row[supervisorCol]) : '',
        isAlreadyIssued: isAlreadyIssued
      };
    }
  }

  return null;
}
// ============================
// PDF Generation (Optimized)
// ============================
// ============================
// PDF Generation (Optimized) - Single QR Code Version
// ============================
async function generateIssuePdf(matrix, { issueDate, supervisor, alterCounts, masterGltiCounts = {} }) {
  if (!matrix) return;

  // Function to load QR code
  async function loadQRCodeImage(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 120, 120);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load QR code image'));
      img.src = imageUrl;
    });
  }

  // Generate QR codes (keep existing functions same)
  async function generateCuttingQRCode(lotNumber) {
    const trackingUrl = `https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec?action=showCuttingOptions&lot=${lotNumber}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(trackingUrl)}`;
    return await loadQRCodeImage(qrUrl);
  }
  // Add this function with your other QR code generators
async function generateFabricIssuedQRCode(lotNumber) {
  const trackingUrl = `https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec?action=showFabricIssuedOptions&lot=${lotNumber}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(trackingUrl)}`;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 120, 120);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load Fabric Issued QR code image'));
    img.src = qrUrl;
  });
}
// Add this with your other QR code generators
async function generatePackingQRCode(lotNumber) {
  const trackingUrl = `https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec?action=showPackingOptions&lot=${lotNumber}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(trackingUrl)}`;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 120, 120);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load Packing QR code image'));
    img.src = qrUrl;
  });
}

  async function generateEmbPrintingQRCode(lotNumber) {
    const trackingUrl = `https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec?action=showEmbPrintingOptions&lot=${lotNumber}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(trackingUrl)}`;
    return await loadQRCodeImage(qrUrl);
  }

  async function generateStitchingQRCode(lotNumber) {
    const trackingUrl = `https://script.google.com/macros/s/AKfycbyuuGR2VkyulsXHeEi88pcqozqa-kmI1mWIGwvjWqVQUfzR1OQ__sQsqIPZ_Fh_oMUadA/exec?action=showStitchingOptions&lot=${lotNumber}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(trackingUrl)}`;
    return await loadQRCodeImage(qrUrl);
  }

  const sizesRaw = (matrix.source === 'old' ? Array(5).fill('') : (matrix.sizes || []));
  const sizes = sizesRaw.map(s => (s == null || s === 0 || s === '0') ? '' : String(s));
  const orientation = 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'A4' });

  const W = doc.internal.pageSize.getWidth(); // 595.28 pt
  const H = doc.internal.pageSize.getHeight(); // 841.89 pt

  // Add thick page border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(2);
  doc.rect(8, 8, W - 16, H - 16);

  // Add inner border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(2);
  doc.rect(12, 12, W - 24, H - 24);

  // Minimal margins with inner padding
  const M = 20;
  const innerPadding = 5;
  const line = 0.5;

  doc.setDrawColor(0); 
  doc.setTextColor(0); // Pure black text
  doc.setLineWidth(line);

  // Generate QR codes
// Generate QR codes
const cuttingQRCode = await generateCuttingQRCode(matrix.lotNumber);
const embPrintingQRCode = await generateEmbPrintingQRCode(matrix.lotNumber);
const stitchingQRCode = await generateStitchingQRCode(matrix.lotNumber);
const fabricIssuedQRCode = await generateFabricIssuedQRCode(matrix.lotNumber);
const packingQRCode = await generatePackingQRCode(matrix.lotNumber); // Add this line

  // Professional Header with black & white styling
  async function addHeader(currentPage) {
    const CM = M + innerPadding;
    const headerTop = CM + 15;
    const contentWidth = W - (CM * 2);

    if (currentPage === 1) {
      // Company/Organization header
      doc.setFont('times', 'bold');
      doc.setFontSize(12);
  
      
      // Main title
      doc.setFontSize(16);
      doc.text('ALTER JOB ORDER FOR UPTO STITCHING', W / 2, headerTop + 10, { align: 'center' });
      
      // Underline
      doc.setLineWidth(1);
      const titleWidth = doc.getTextWidth('ALTER JOB ORDER FOR UPTO STITCHING');
      doc.line((W - titleWidth) / 2 - 10, headerTop + 16, (W + titleWidth) / 2 + 10, headerTop + 16);
      
      // Reset line width
      doc.setLineWidth(0.5);
      
      // Header info in two columns
      const colWidth = contentWidth / 2;
      const leftX = CM;
      const rightX = leftX + colWidth;
      let y = headerTop + 35;

      // Left column with light gray background
      doc.setFillColor(255, 255, 255);
      doc.rect(leftX, y - 5, colWidth, 75, 'F');
      doc.rect(leftX, y - 5, colWidth, 75);
      
      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.text('ISSUE DETAILS', leftX + colWidth/2, y + 5, { align: 'center' });
      
      doc.line(leftX + 15, y + 10, leftX + colWidth - 15, y + 10);
      
      y += 20;
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text(`Date:`, leftX + 20, y);
      doc.setFont('times', 'bold');
      doc.text(printableDate(issueDate), leftX + 60, y);
      
      y += 16;
      doc.setFont('times', 'bold');
      const itemText = String(matrix.garmentType || matrix.style || '');
      doc.text(`Item:`, leftX + 20, y);
      doc.text(truncateText(doc, itemText, colWidth - 80), leftX + 60, y);
      
      y += 16;
      const fabricText = String(matrix.fabric || '');
      doc.text(`Fabric:`, leftX + 20, y);
      doc.text(truncateText(doc, fabricText, colWidth - 80), leftX + 60, y);
      
      y += 16;
      const brandText = String(matrix.brand || '');
      doc.text(`Brand:`, leftX + 20, y);
      doc.text(truncateText(doc, brandText, colWidth - 80), leftX + 60, y);

      // Right column with light gray background
      y = headerTop + 35;
      doc.setFillColor(255, 255, 255);
      doc.rect(rightX, y - 5, colWidth, 75, 'F');
      doc.rect(rightX, y - 5, colWidth, 75);
      
      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.text('LOT INFORMATION', rightX + colWidth/2, y + 5, { align: 'center' });
      doc.line(rightX + 15, y + 10, rightX + colWidth - 15, y + 10);
      
      y += 20;
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      const styleText = String(matrix.style || '');
      doc.text(`Style:`, rightX + 20, y);
      doc.text(truncateText(doc, styleText, colWidth - 80), rightX + 60, y);
      
      y += 16;
      doc.text(`Lot No:`, rightX + 20, y);
      doc.setFont('times', 'bold');
      doc.text(matrix.lotNumber || '', rightX + 70, y);
      
      y += 16;
      doc.setFont('times', 'bold');
      const garmentText = String(matrix.garmentType || '');
      doc.text(`Garment:`, rightX + 20, y);
      doc.text(truncateText(doc, garmentText, colWidth - 80), rightX + 75, y);
      
      y += 16;
      doc.text(`Supervisor:`, rightX + 20, y);
      doc.setFont('times', 'bold');
      doc.text((supervisor ?? '').trim() || '________', rightX + 85, y);

      return {
        headerBottomY: headerTop + 115,
        CM
      };
    }

    return {
      headerBottomY: headerTop + 40,
      CM
    };
  }

  // Helper function to truncate text
  function truncateText(doc, text, maxWidth) {
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 3 && doc.getTextWidth(truncated + '...') > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
  }

  // Add header
  const { headerBottomY, CM } = await addHeader(1);

  const tableTop = headerBottomY + 15;

  // Table headers - UPDATED to include Master ki Glti
  const head = [[ 
    'KARIGAR', 
    'C.TABLE', 
    'COLOR', 
    ...sizes, 
    'PCS', 
    'KHARCHA ALTER', 
    'EMB/PRINT ALTER',
    'MASTER KI GLTI'  // Added new header
  ]];

  // Calculate totals - UPDATED to include Master ki Glti
// Calculate totals - UPDATED to include Master ki Glti
let totalKharchaPcs = 0;
let totalEmbPcs = 0;
let totalMasterGltiPcs = 0; // Added for Master ki Glti
  
const body = (matrix.rows || []).map((r, index) => {
  const rowAlters = alterCounts ? alterCounts[index] || [] : [];
  const rowMasterGlti = masterGltiCounts ? masterGltiCounts[index] || {} : {};
  
  let kharchaTotal = 0;
  let embTotal = 0;
  let masterGltiTotal = 0; // Added for Master ki Glti
  
  // Calculate from alterCounts (kharcha and emb)
  rowAlters.forEach(entry => {
    const pcs = parseInt(entry.pcs) || 0;
    if (entry.category === 'kharcha') kharchaTotal += pcs;
    else if (entry.category === 'emb_pending') embTotal += pcs;
  });
  
  // Calculate from masterGltiCounts
  if (rowMasterGlti && rowMasterGlti.pcs) {
    masterGltiTotal = parseInt(rowMasterGlti.pcs) || 0;
  }
  
  totalKharchaPcs += kharchaTotal;
  totalEmbPcs += embTotal;
  totalMasterGltiPcs += masterGltiTotal; // Added for Master ki Glti
  
  return [
    valOrEmpty(r.karigar || ''),
    valOrEmpty(r.cuttingTable),
    valOrEmpty(r.color || ''), // Color name - will be wrapped
    ...sizes.map(s => valOrEmpty(r.sizes?.[s])),
    valOrEmpty(r.totalPcs),
    kharchaTotal > 0 ? valOrEmpty(kharchaTotal) : '0',
    embTotal > 0 ? valOrEmpty(embTotal) : '0',
    masterGltiTotal > 0 ? valOrEmpty(masterGltiTotal) : '0' // Added for Master ki Glti
  ];
});
  const totalAlterPcs = totalKharchaPcs + totalEmbPcs + totalMasterGltiPcs; // Updated
  const totalLotPcs = matrix.totals?.grand || 0;

  // Footer row - UPDATED to include Master ki Glti
  const foot = [[
    '', '', 'TOTAL',
    ...sizes.map(() => ''),
    valOrEmpty(totalLotPcs),
    valOrEmpty(totalKharchaPcs),
    valOrEmpty(totalEmbPcs),
    valOrEmpty(totalMasterGltiPcs), // Added for Master ki Glti
  ]];

  const CM2 = CM;
  const availableWidth = W - (CM2 * 2);

  // Calculate column widths - Reduced size columns, increased color column
  const sizesCount = sizes.length;
  
  // Column widths allocation - UPDATED to include Master ki Glti
  const columnConfig = [
    { name: 'karigar', width: 50, align: 'left' },    // Karigar
    { name: 'table', width: 40, align: 'center' },    // Cutting Table
    { name: 'color', width: 70, align: 'left' },      // Increased for color wrapping
    // Size columns will be calculated
    { name: 'pcs', width: 30, align: 'center' },      // PCS
    { name: 'kharcha', width: 60, align: 'center' },  // Kharcha Alter
    { name: 'emb', width: 60, align: 'center' },      // Emb/Print Alter
    { name: 'master_glti', width: 60, align: 'center' }, // Added: Master ki Glti
  ];
  
  const fixedWidth = columnConfig.reduce((sum, col) => sum + col.width, 0);
  const sizesWidth = availableWidth - fixedWidth;
  const sizeW = sizesCount > 0 ? Math.max(14, Math.floor(sizesWidth / sizesCount)) : 0;

  // Column styles for black & white printing - UPDATED to include Master ki Glti
  const colStyles = {};
  let colIndex = 0;
  
  // KARIGAR
  colStyles[colIndex++] = { 
    cellWidth: 50, 
    halign: 'left',
    fontStyle: 'bold',
    fontSize: 8
  };
  
  // C.TABLE
  colStyles[colIndex++] = { 
    cellWidth: 40, 
    halign: 'center',
    fontStyle: 'bold',
    fontSize: 8
  };
  
  // COLOR - with word wrapping
  colStyles[colIndex++] = { 
    cellWidth: 70, 
    halign: 'left',
    fontStyle: 'bold',
    fontSize: 8,
    cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
    overflow: 'linebreak'
  };
  
  // Size columns - reduced width
  for (let i = 0; i < sizesCount; i++) {
    colStyles[colIndex++] = { 
      cellWidth: sizeW, 
      halign: 'center',
      fontStyle: 'bold',
      fontSize: 8,
      fillColor: [250, 250, 250]
    };
  }
  
  // PCS
  colStyles[colIndex++] = { 
    cellWidth: 30, 
    halign: 'center',
    fontStyle: 'bold',
    fontSize: 8
  };
  
  // KHARCHA ALTER
  colStyles[colIndex++] = { 
    cellWidth: 60, 
    halign: 'center',
    fontStyle: 'bold',
    fontSize: 8
  };
  
  // EMB/PRINT ALTER
  colStyles[colIndex++] = { 
    cellWidth: 60, 
    halign: 'center',
    fontStyle: 'bold',
    fontSize: 8
  };
  
  // MASTER KI GLTI - Added new column style
  colStyles[colIndex++] = { 
    cellWidth: 60, 
    halign: 'center',
    fontStyle: 'bold',
    fontSize: 8
  };

  // Configure autoTable with black & white styling
  const tableConfig = {
    head, 
    body, 
    foot,
    startY: tableTop,
    theme: 'grid',
    tableWidth: availableWidth,
    styles: {
      font: 'times',
      fontSize: 9,
      textColor: [0, 0, 0], // Black text
      lineColor: [0, 0, 0],
      lineWidth: 1,
      cellPadding: 3,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak'
    },
    headStyles: { 
     fillColor: [245, 245, 245], // Light grey
textColor: [0, 0, 0],       // Dark black

      fontStyle: 'bold', 
      fontSize: 9,
      halign: 'center',
      lineWidth: 1,
      lineColor: [0, 0, 0]
    },
    bodyStyles: { 
      fillColor: [255, 255, 255], // White background
      lineWidth: 1,
      lineColor: [0, 0, 0]
    },
    footStyles: { 
      fillColor: [255, 255, 255], 
      textColor: [0, 0, 0], 
      fontStyle: 'bold', 
      fontSize: 9,
      halign: 'center',
      lineWidth: 1,
      lineColor: [0, 0, 0]
    },
    columnStyles: colStyles,
    margin: { left: CM2, right: CM2 },
    didDrawPage: function(data) {
      // Add border around table area
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.5);
      doc.rect(CM2 - 5, tableTop - 5, availableWidth + 10, data.cursor.y - tableTop + 10);
      
      if (data.pageNumber > 1) {
        addHeader(data.pageNumber);
      }
      
      // Page number
      doc.setFont('times', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0); // Black text
      doc.text(
        `Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`,
        W - M - 40,
        H - M
      );
    }
  };

  autoTable(doc, tableConfig);

  // Get position after table
  const afterTableY = doc.lastAutoTable ? (doc.lastAutoTable.finalY + 20) : (tableTop + 200);

  // Draw bottom sections - NEED TO UPDATE THIS TO INCLUDE MASTER KI GLTI
  const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
  const totalPages = doc.internal.getNumberOfPages();
  
  if (currentPage === totalPages) {
  // In generateIssuePdf function, update this call:
await drawBottomSections(doc, afterTableY, W, H, CM2, matrix, totalAlterPcs, totalKharchaPcs, totalEmbPcs, totalMasterGltiPcs, totalLotPcs, cuttingQRCode, embPrintingQRCode, stitchingQRCode, fabricIssuedQRCode, packingQRCode);
  }

  const fname = `Lot_${matrix.lotNumber || 'Unknown'}_Alter_Job-Order_${printableDate(issueDate).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  doc.save(fname);
}

async function drawBottomSections(doc, afterTableY, W, H, CM2, matrix, totalAlterPcs, totalKharchaPcs, totalEmbPcs, totalMasterGltiPcs, totalLotPcs, cuttingQRCode, embPrintingQRCode, stitchingQRCode, fabricIssuedQRCode, packingQRCode) {
  const totalAvailableWidth = W - (2 * CM2);
  
  // SECTION 1: Three Boxes (Keep existing code as is)
  const boxesY = afterTableY + 25;
  const boxHeight = 90;
  const boxGap = 12;
  const boxWidth = (totalAvailableWidth - (2 * boxGap)) / 3;
  
  // Box styling function
  function drawBox(x, y, width, height, title) {
    // Main box
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.8);
    doc.rect(x, y, width, height);
    
    // Header
    doc.setFillColor(220, 220, 220);
    doc.rect(x, y, width, 22, 'F');
    doc.setDrawColor(0, 0, 0);
    doc.rect(x, y, width, 22);
    
    // Title
    doc.setFont('times', 'bold'); 
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(title, x + width/2, y + 14, { align: 'center' });
    
    doc.line(x + 15, y + 10, x + width - 15, y + 10);
    
    return { contentStartY: y + 30 };
  }
  
  // Box 1: Alter Eligibility
  const box1X = CM2;
  const box1Content = drawBox(box1X, boxesY, boxWidth, boxHeight, 'ALTER ELIGIBILITY');
  const box1ContentY = box1Content.contentStartY;
  
  const onePercent = Math.ceil(totalLotPcs * 0.01);
  const higherValue = Math.max(onePercent, 10);
  
  doc.setFont('times', 'bold'); 
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  
  doc.text(`Total Lot Quantity:`, box1X + 15, box1ContentY);
  doc.setFont('times', 'bold');
  doc.text(`${totalLotPcs} Pcs`, box1X + boxWidth - 15, box1ContentY, { align: 'right' });
  
  doc.setFont('times', 'bold');
  doc.text(`1% Allowance:`, box1X + 15, box1ContentY + 16);
  doc.setFont('times', 'bold');
  doc.text(`${onePercent} Pcs`, box1X + boxWidth - 15, box1ContentY + 16, { align: 'right' });
  
  doc.text(`Actual Alter:`, box1X + 15, box1ContentY + 32);
  doc.setFont('times', 'bold');
  doc.text(`${totalAlterPcs} Palla`, box1X + boxWidth - 15, box1ContentY + 32, { align: 'right' });
  
  // Status indicator
  const statusY = boxesY + boxHeight - 20;
  doc.setFont('times', 'bold'); 
  doc.setFontSize(10);
  
  if (totalAlterPcs <= onePercent) {
    doc.text('✓ WITHIN ALLOWANCE', box1X + boxWidth/2, statusY, { align: 'center' });
  } else {
    doc.text('EXCEEDS LIMIT', box1X + boxWidth/2, statusY, { align: 'center' });
    doc.setFont('times', 'bold'); 
    doc.setFontSize(8);
    doc.text('MD Approval Required', box1X + boxWidth/2, statusY + 10, { align: 'center' });
  }
  
  // Box 2: Authorization
  const box2X = box1X + boxWidth + boxGap;
  const box2Content = drawBox(box2X, boxesY, boxWidth, boxHeight, 'AUTHORIZATION');
  const box2ContentY = box2Content.contentStartY;
  
  doc.setFont('times', 'bold'); 
  doc.setFontSize(9);
  doc.text('Authorization Limit:', box2X + 15, box2ContentY);
  
  doc.setFont('times', 'bold'); 
  doc.setFontSize(12);
  doc.text(`${higherValue} Palla`, box2X + boxWidth/2, box2ContentY + 25, { align: 'center' });
  
  doc.setFont('times', 'bold'); 
  doc.setFontSize(8);
  doc.text('(Higher of 1% or 10 PCs)', box2X + boxWidth/2, box2ContentY + 35, { align: 'center' });
  
  // Signature area
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.6);
  const sigLineY = boxesY + boxHeight - 30;
  doc.line(box2X + 25, sigLineY, box2X + boxWidth - 25, sigLineY);
  
  doc.setFont('times', 'bold'); 
  doc.setFontSize(10);
  doc.text('MOHIT SIR', box2X + boxWidth/2, sigLineY + 12, { align: 'center' });
  
  doc.setFont('times', 'bold'); 
  doc.setFontSize(8);
  doc.text('Executive Assistant', box2X + boxWidth/2, sigLineY + 22, { align: 'center' });
  
  // Box 3: Alter Breakdown
  const box3X = box2X + boxWidth + boxGap;
  const box3Content = drawBox(box3X, boxesY, boxWidth, boxHeight, 'ALTER BREAKDOWN');
  const box3ContentY = box3Content.contentStartY;
  
  // Breakdown table
  const breakdownData = [
    { label: 'Kharcha Alter:', value: `${totalKharchaPcs}` },
    { label: 'Emb/Printing Alter:', value: `${totalEmbPcs}` },
    { label: 'Master ki Glti:', value: `${totalMasterGltiPcs}` },
    { label: 'TOTAL ALTER:', value: `${totalAlterPcs}` }
  ];
  
  let breakdownY = box3ContentY;
  breakdownData.forEach((item, index) => {
    const isTotal = index === 3;
    
    doc.setFont('times', isTotal ? 'bold' : 'bold');
    doc.setFontSize(isTotal ? 10 : 9);
    
    // Color coding for different alter types
    if (item.label === 'Kharcha Alter:') {
      doc.setTextColor(220, 38, 38); // Red for Kharcha
    } else if (item.label === 'Emb/Printing Alter:') {
      doc.setTextColor(22, 163, 74); // Green for Emb/Printing
    } else if (item.label === 'Master ki Glti:') {
      doc.setTextColor(147, 51, 234); // Purple for Master ki Glti
    } else {
      doc.setTextColor(0, 0, 0); // Black for total
    }
    
    doc.text(item.label, box3X + 15, breakdownY);
    
    doc.setFont('times', 'bold');
    doc.setFontSize(isTotal ? 12 : 10);
    doc.text(`${item.value} Palla`, box3X + boxWidth - 15, breakdownY, { align: 'right' });
    
    // Reset color
    doc.setTextColor(0, 0, 0);
    
    breakdownY += isTotal ? 20 : 18;
  });
  
  // Reset
  doc.setDrawColor(0, 0, 0);
  
  // ==============================================
  // SECTION 2: ALL 5 QR CODES IN SINGLE LINE (UPDATED FOR 5 CODES)
  // ==============================================
  const qrSectionY = boxesY + boxHeight + 35;
  const qrGap = 20; // Slightly reduced gap for 5 codes
  const qrSize = 60; // Slightly reduced size for 5 codes
  
  // Calculate total width for 5 QR codes
  const qrTotalWidth = (qrSize * 5) + (qrGap * 4); // 5 codes, 4 gaps
  const qrStartX = CM2 + (totalAvailableWidth - qrTotalWidth) / 2;
  
  // QR Code styling function
  function drawQRCodeSection(x, y, size, qrCode, title) {
    // Container with border
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.rect(x, y, size, size, 'FD');
    
    // QR Code
    if (qrCode) {
      try {
        doc.addImage(qrCode, 'PNG', x + 3, y + 3, size - 6, size - 6);
      } catch (error) {
        doc.setFont('times', 'bold'); 
        doc.setFontSize(8);
        doc.text('QR', x + size/2, y + size/2, { align: 'center' });
        doc.rect(x, y, size, size);
      }
    }
    
    // Department title
    doc.setFont('times', 'bold'); 
    doc.setFontSize(9);
    
    // Split title if it has multiple words
    const titleWords = title.split(' ');
    if (titleWords.length > 1) {
      // Two-line title for multi-word departments
      const firstPart = titleWords.slice(0, Math.ceil(titleWords.length/2)).join(' ');
      const secondPart = titleWords.slice(Math.ceil(titleWords.length/2)).join(' ');
      
      doc.text(firstPart, x + size/2, y + size + 10, { align: 'center' });
      doc.text(secondPart, x + size/2, y + size + 22, { align: 'center' });
      
      // Instruction below second line
      doc.setFont('times', 'bold'); 
      doc.setFontSize(6);
      doc.text('Scan to Track', x + size/2, y + size + 32, { align: 'center' });
    } else {
      // Single word title
      doc.text(title, x + size/2, y + size + 12, { align: 'center' });
      
      // Instruction
      doc.setFont('times', 'bold'); 
      doc.setFontSize(7);
      doc.text('Scan to Track', x + size/2, y + size + 24, { align: 'center' });
    }
  }
  
  // Draw ALL FIVE QR code sections in ONE LINE
  drawQRCodeSection(qrStartX, qrSectionY, qrSize, fabricIssuedQRCode, 'FABRIC ISSUED');
  drawQRCodeSection(qrStartX + qrSize + qrGap, qrSectionY, qrSize, cuttingQRCode, 'CUTTING');
  drawQRCodeSection(qrStartX + (qrSize + qrGap) * 2, qrSectionY, qrSize, embPrintingQRCode, 'EMB/PRINTING');
  drawQRCodeSection(qrStartX + (qrSize + qrGap) * 3, qrSectionY, qrSize, stitchingQRCode, 'STITCHING');
  drawQRCodeSection(qrStartX + (qrSize + qrGap) * 4, qrSectionY, qrSize, packingQRCode, 'PACKING'); // Added Packing QR
  
  // Add a title above the QR codes
  doc.setFont('times', 'bold'); 
  doc.setFontSize(12);
  doc.text('TRACKING QR CODES', W / 2, qrSectionY - 20, { align: 'center' });
  
  // Add separator line above QR codes
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(CM2, qrSectionY - 30, W - CM2, qrSectionY - 30);
  
  // ==============================================
  // SECTION 3: Signature Section at Bottom (UPDATED FOR 4 DEPARTMENTS)
  // ==============================================
  const signatureY = H - 70;
  const signatureBoxWidth = totalAvailableWidth / 4; // Changed from 3 to 4 for 4 departments
  const signaturePadding = 25;
  
  // Draw separator line
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.5);
  doc.line(CM2, signatureY - 20, CM2 + totalAvailableWidth, signatureY - 20);
  
  // Signature section styling function
  function drawSignatureSection(x, width, title, department) {
    // Department label
    doc.setFont('times', 'bold'); 
    doc.setFontSize(9);
    doc.text(department, x + width/2, signatureY - 10, { align: 'center' });
    
    // Title
    doc.setFont('times', 'bold'); 
    doc.setFontSize(10);
    doc.text(title, x + width/2, signatureY + 5, { align: 'center' });
    
    // Signature line
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.8);
    doc.line(x + signaturePadding, signatureY + 15, x + width - signaturePadding, signatureY + 15);
    
    // Instruction
    doc.setFont('times', 'italic'); 
    doc.setFontSize(8);
    doc.text('Signature with Date', x + width/2, signatureY + 30, { align: 'center' });
  }
  
  // Draw four signature sections
  drawSignatureSection(CM2, signatureBoxWidth, 'CUTTING INCHARGE', 'Department');
  drawSignatureSection(CM2 + signatureBoxWidth, signatureBoxWidth, 'EMB/PRINTING HEAD', 'Department');
  drawSignatureSection(CM2 + signatureBoxWidth * 2, signatureBoxWidth, 'STITCHING SUPERVISOR', 'Department');
  drawSignatureSection(CM2 + signatureBoxWidth * 3, signatureBoxWidth, 'PACKING SUPERVISOR', 'Department'); // Added Packing
  
  // Final border around entire content
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(15, 15, W - 30, H - 30);
}

// Bottom sections with black & white styling


// Helper function for printable date
function printableDate(dateStr) {
  if (!dateStr) return '________';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).toUpperCase();
}

// Helper function for values
function valOrEmpty(val) {
  if (val == null || val === '' || val === undefined) return '';
  return String(val);
}

// Helper function for date formatting
// function printableDate(dateStr) {
//   if (!dateStr) return '';
//   try {
//     const d = new Date(dateStr);
//     return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB');
//   } catch {
//     return dateStr;
//   }
// }

// UPDATED drawBottomSections function with Cutting QR Code box
// async function drawBottomSections(doc, afterTableY, W, H, CM2, matrix, totalAlterPcs, totalKharchaPcs, totalEmbPcs, alterCounts = {}, cuttingQRCode) {
//   // ---- FIRST ROW: Three boxes ----
//   const firstRowHeight = 140;
//   const gap = 15;
  
//   // Calculate total width available for boxes (3 boxes with 2 gaps)
//   const totalAvailableWidth = W - (2 * CM2);
//   const boxWidth = (totalAvailableWidth - (2 * gap)) / 3;

//   // Calculate alter totals from alterCounts
//   const totalKharchaAlter = Object.values(alterCounts).filter(data => data.category === 'kharcha').length;
//   const totalEmbPendingAlter = Object.values(alterCounts).filter(data => data.category === 'emb_pending').length;
  
//   // Calculate eligibility thresholds
//   const totalLotPcs = matrix.totals.grand || 0;
//   const onePercent = Math.ceil(totalLotPcs * 0.01);
//   const threshold = Math.max(10, onePercent);
//   const isEligible = totalAlterPcs <= threshold;

//   // ---- FIRST ROW BOX POSITIONS (Three boxes) ----
//   const firstRowY = afterTableY;
//   const box1X = CM2;
//   const box2X = box1X + boxWidth + gap;
//   const box3X = box2X + boxWidth + gap;

//   // ---- BOX 1: Alter Eligibility ----
//   doc.rect(box1X, firstRowY, boxWidth, firstRowHeight);
  
//   // Add title to Alter Eligibility box
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('Alter Eligibility', box1X + boxWidth / 2, firstRowY + 15, { align: 'center' });
  
//   // Draw separator line below title
//   doc.setLineWidth(0.3);
//   doc.line(box1X + 5, firstRowY + 25, box1X + boxWidth - 5, firstRowY + 25);
  
//   // Add alter details
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   let detailY = firstRowY + 35;
  
//   // Show Kharcha Alter PCs
//   if (totalKharchaPcs > 0) {
//     doc.setFont('times', 'bold');
//     doc.text('Kharcha Alter PCs:', box1X + 10, detailY);
//     doc.setFont('times', 'bold');
//     doc.text(`${totalKharchaPcs}`, box1X + boxWidth - 10, detailY, { align: 'right' });
//     detailY += 10;
//   }
  
//   // Show Emb/Pending Alter PCs
//   if (totalEmbPcs > 0) {
//     doc.setFont('times', 'bold');
//     doc.text('Emb/Pending Alter PCs:', box1X + 10, detailY);
//     doc.setFont('times', 'bold');
//     doc.text(`${totalEmbPcs}`, box1X + boxWidth - 10, detailY, { align: 'right' });
//     detailY += 10;
//   }
  
//   // Total Alter PCs (Kharcha + Emb)
//   if (totalAlterPcs > 0) {
//     doc.setFont('times', 'bold');
//     doc.text('Total Alter PCs (K+E):', box1X + 10, detailY);
//     doc.setFont('times', 'bold');
//     doc.text(`${totalAlterPcs}`, box1X + boxWidth - 10, detailY, { align: 'right' });
//     detailY += 10;
//   }
  
//   // Total Lot PCs
//   doc.setFont('times', 'bold');
//   doc.text('Total Lot PCs:', box1X + 10, detailY);
//   doc.setFont('times', 'bold');
//   doc.text(`${totalLotPcs}`, box1X + boxWidth - 10, detailY, { align: 'right' });
//   detailY += 10;
  
//   // 1% of Total
//   doc.setFont('times', 'bold');
//   doc.text('1% of Total:', box1X + 10, detailY);
//   doc.setFont('times', 'bold');
//   doc.text(`${onePercent}`, box1X + boxWidth - 10, detailY, { align: 'right' });
//   detailY += 10;
  
//   // Threshold (10 PCs or 1%)
//   doc.setFont('times', 'bold');
//   doc.text('Threshold:', box1X + 10, detailY);
//   doc.setFont('times', 'bold');
//   doc.text(`${threshold}`, box1X + boxWidth - 10, detailY, { align: 'right' });
//   detailY += 8;
  
//   // Draw horizontal separator line
//   doc.setLineWidth(0.3);
//   doc.line(box1X + 10, detailY, box1X + boxWidth - 10, detailY);
//   detailY += 10;
  
//   // Eligibility Status
//   doc.setFont('times', 'bold'); doc.setFontSize(9);
//   if (isEligible) {
//     doc.setTextColor(34, 197, 94);
//     doc.text('✓ ELIGIBLE', box1X + boxWidth / 2, detailY, { align: 'center' });
//   } else {
//     doc.setTextColor(239, 68, 68);
//     doc.text('✗ NOT ELIGIBLE', box1X + boxWidth / 2, detailY, { align: 'center' });
//   }
//   doc.setTextColor(0, 0, 0);

//   // ---- BOX 2: Alter Breakdown ----
//   doc.rect(box2X, firstRowY, boxWidth, firstRowHeight);
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('Alter Breakdown', box2X + boxWidth / 2, firstRowY + 15, { align: 'center' });
  
//   // Draw separator line below title
//   doc.setLineWidth(0.3);
//   doc.line(box2X + 5, firstRowY + 25, box2X + boxWidth - 5, firstRowY + 25);
  
//   // Add breakdown details
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   let breakdownY = firstRowY + 40;
  
//   // Kharcha Alter Breakdown
//   doc.setFont('times', 'bold');
//   doc.text('KHARCHA ALTER:', box2X + 10, breakdownY);
//   doc.setFont('times', 'bold');
//   doc.text(`${totalKharchaPcs} PCs`, box2X + boxWidth - 10, breakdownY, { align: 'right' });
//   breakdownY += 12;
  
//   // If there are kharcha rows, show count
//   if (totalKharchaAlter > 0) {
//     doc.setFont('times', 'bold');
//     doc.text('Total Rows:', box2X + 10, breakdownY);
//     doc.setFont('times', 'bold');
//     doc.text(`${totalKharchaAlter}`, box2X + boxWidth - 10, breakdownY, { align: 'right' });
//     breakdownY += 12;
//   }
  
//   breakdownY += 5;
//   // Draw separator line
//   doc.setLineWidth(0.2);
//   doc.line(box2X + 10, breakdownY, box2X + boxWidth - 10, breakdownY);
//   breakdownY += 12;
  
//   // Emb/Printing Alter Breakdown
//   doc.setFont('times', 'bold');
//   doc.text('EMB/PRINTING ALTER:', box2X + 10, breakdownY);
//   doc.setFont('times', 'bold');
//   doc.text(`${totalEmbPcs} PCs`, box2X + boxWidth - 10, breakdownY, { align: 'right' });
//   breakdownY += 12;
  
//   // If there are emb rows, show count
//   if (totalEmbPendingAlter > 0) {
//     doc.setFont('times', 'bold');
//     doc.text('Total Rows:', box2X + 10, breakdownY);
//     doc.setFont('times', 'bold');
//     doc.text(`${totalEmbPendingAlter}`, box2X + boxWidth - 10, breakdownY, { align: 'right' });
//     breakdownY += 12;
//   }
  
//   breakdownY += 5;
//   // Draw separator line
//   doc.setLineWidth(0.2);
//   doc.line(box2X + 10, breakdownY, box2X + boxWidth - 10, breakdownY);
//   breakdownY += 12;
  
//   // Total Breakdown
//   doc.setFont('times', 'bold'); doc.setFontSize(9);
//   doc.text('TOTAL ALTER:', box2X + 10, breakdownY);
//   doc.text(`${totalAlterPcs} PCs`, box2X + boxWidth - 10, breakdownY, { align: 'right' });

//   // ---- BOX 3: Signature Box (Alter) ----
//   doc.rect(box3X, firstRowY, boxWidth, firstRowHeight);
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('Signature Box (Alter)', box3X + boxWidth / 2, firstRowY + 15, { align: 'center' });
//   doc.setLineWidth(0.3);
//   doc.line(box3X + 5, firstRowY + 25, box3X + boxWidth - 5, firstRowY + 25);
  
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   const alterText = '1% of Total PCs or 10 PC -whichever is higher->Signed By EA. After that Mohit Sir';
//   const alterTextLines = doc.splitTextToSize(alterText, boxWidth - 20);
  
//   let alterTextY = firstRowY + 45;
//   alterTextLines.forEach(line => {
//     doc.text(line, box3X + boxWidth / 2, alterTextY, { align: 'center' });
//     alterTextY += 12;
//   });

//   alterTextY += 8;
//   doc.setLineWidth(0.6);
//   doc.line(box3X + 20, alterTextY, box3X + boxWidth - 20, alterTextY);
//   doc.setFont('times', 'bold'); doc.setFontSize(7);
//   doc.text('Signature', box3X + boxWidth / 2, alterTextY + 8, { align: 'center' });

//   // ---- SECOND ROW: Three Department Head Boxes ----
//   const secondRowHeight = 100;
//   const secondRowY = firstRowY + firstRowHeight + 15;
  
//   // Recalculate box width for second row (3 boxes with 2 gaps)
//   const secondRowBoxWidth = boxWidth; // Same width as first row

//   // Department Head Box Positions
//   const deptBox1X = CM2;
//   const deptBox2X = deptBox1X + secondRowBoxWidth + gap;
//   const deptBox3X = deptBox2X + secondRowBoxWidth + gap;

//   // ---- DEPARTMENT BOX 1: Cutting Head ----
//   doc.rect(deptBox1X, secondRowY, secondRowBoxWidth, secondRowHeight);
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('CUTTING HEAD', deptBox1X + secondRowBoxWidth / 2, secondRowY + 15, { align: 'center' });
  
//   doc.setLineWidth(0.3);
//   doc.line(deptBox1X + 5, secondRowY + 25, deptBox1X + secondRowBoxWidth - 5, secondRowY + 25);
  
//   // Add instruction text
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   const cuttingText = 'Verify and approve cutting alterations';
//   doc.text(cuttingText, deptBox1X + secondRowBoxWidth / 2, secondRowY + 45, { align: 'center' });
  
//   // Signature line
//   const cuttingSigY = secondRowY + 75;
//   doc.setLineWidth(0.6);
//   doc.line(deptBox1X + 20, cuttingSigY, deptBox1X + secondRowBoxWidth - 20, cuttingSigY);
//   doc.setFont('times', 'bold'); doc.setFontSize(7);
//   doc.text('Signature', deptBox1X + secondRowBoxWidth / 2, cuttingSigY + 8, { align: 'center' });

//   // ---- DEPARTMENT BOX 2: Emb/Printing Head ----
//   doc.rect(deptBox2X, secondRowY, secondRowBoxWidth, secondRowHeight);
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('EMB/PRINTING HEAD', deptBox2X + secondRowBoxWidth / 2, secondRowY + 15, { align: 'center' });
  
//   doc.setLineWidth(0.3);
//   doc.line(deptBox2X + 5, secondRowY + 25, deptBox2X + secondRowBoxWidth - 5, secondRowY + 25);
  
//   // Add instruction text
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   const embText = 'Verify and approve embroidery/printing alterations';
//   doc.text(embText, deptBox2X + secondRowBoxWidth / 2, secondRowY + 45, { align: 'center' });
  
//   // Signature line
//   const embSigY = secondRowY + 75;
//   doc.setLineWidth(0.6);
//   doc.line(deptBox2X + 20, embSigY, deptBox2X + secondRowBoxWidth - 20, embSigY);
//   doc.setFont('times', 'bold'); doc.setFontSize(7);
//   doc.text('Signature', deptBox2X + secondRowBoxWidth / 2, embSigY + 8, { align: 'center' });

//   // ---- DEPARTMENT BOX 3: Stitching Head ----
//   doc.rect(deptBox3X, secondRowY, secondRowBoxWidth, secondRowHeight);
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('STITCHING HEAD', deptBox3X + secondRowBoxWidth / 2, secondRowY + 15, { align: 'center' });
  
//   doc.setLineWidth(0.3);
//   doc.line(deptBox3X + 5, secondRowY + 25, deptBox3X + secondRowBoxWidth - 5, secondRowY + 25);
  
//   // Add instruction text
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   const stitchingText = 'Verify and approve stitching alterations';
//   doc.text(stitchingText, deptBox3X + secondRowBoxWidth / 2, secondRowY + 45, { align: 'center' });
  
//   // Signature line
//   const stitchingSigY = secondRowY + 75;
//   doc.setLineWidth(0.6);
//   doc.line(deptBox3X + 20, stitchingSigY, deptBox3X + secondRowBoxWidth - 20, stitchingSigY);
//   doc.setFont('times', 'bold'); doc.setFontSize(7);
//   doc.text('Signature', deptBox3X + secondRowBoxWidth / 2, stitchingSigY + 8, { align: 'center' });

//   // ---- CUTTING QR CODE BOX ----
//   const cuttingBoxHeight = 100;
//   const cuttingBoxY = secondRowY + secondRowHeight + 15;
  
//   // Use full width for cutting QR code box
//   const cuttingBoxWidth = totalAvailableWidth;
//   const cuttingBoxX = CM2;
  
//   // Draw cutting QR code box
//   doc.rect(cuttingBoxX, cuttingBoxY, cuttingBoxWidth, cuttingBoxHeight);
//   doc.setFont('times', 'bold'); doc.setFontSize(10);
//   doc.text('CUTTING QR CODE - FOR TRACKING', cuttingBoxX + cuttingBoxWidth / 2, cuttingBoxY + 15, { align: 'center' });
  
//   doc.setLineWidth(0.3);
//   doc.line(cuttingBoxX + 5, cuttingBoxY + 25, cuttingBoxX + cuttingBoxWidth - 5, cuttingBoxY + 25);
  
//   // Add QR code in the left section
//   const qrSize = 80;
//   const qrX = cuttingBoxX + 30;
//   const qrY = cuttingBoxY + 40;
  
//   // Add Cutting QR code
//   if (cuttingQRCode) {
//     try {
//       doc.addImage(cuttingQRCode, 'PNG', qrX, qrY, qrSize, qrSize);
//     } catch (error) {
//       console.error('Failed to add Cutting QR code:', error);
//       // Draw placeholder if QR code fails
//       doc.setFont('times', 'bold'); doc.setFontSize(8);
//       doc.text('[QR Code Placeholder]', qrX + qrSize/2, qrY + qrSize/2, { align: 'center' });
//       doc.rect(qrX, qrY, qrSize, qrSize);
//     }
//   }
  
//   // Add instructions next to QR code
//   const instructionX = qrX + qrSize + 20;
//   const instructionY = qrY + 10;
  
//   doc.setFont('times', 'bold'); doc.setFontSize(9);
//   doc.text('Instructions:', instructionX, instructionY);
  
//   doc.setFont('times', 'bold'); doc.setFontSize(8);
//   const instructions = [
//     '1. Scan this QR code when fabric is received for Cutting',
//     '2. Scan again when Cutting alterations are completed',
//     '3. This will update the Cutting status in the system',
//     '4. Only authorized Cutting personnel should scan this code'
//   ];
  
//   let instY = instructionY + 15;
//   instructions.forEach(text => {
//     doc.text('• ' + text, instructionX, instY, { maxWidth: cuttingBoxWidth - (instructionX - cuttingBoxX) - 20 });
//     instY += 12;
//   });
  
//   // Add bottom border for QR code box
//   doc.setLineWidth(0.6);
//   doc.line(cuttingBoxX + 20, cuttingBoxY + cuttingBoxHeight - 20, cuttingBoxX + cuttingBoxWidth - 20, cuttingBoxY + cuttingBoxHeight - 20);
//   doc.setFont('times', 'bold'); doc.setFontSize(7);
//   doc.text('Scan and update Cutting progress', cuttingBoxX + cuttingBoxWidth / 2, cuttingBoxY + cuttingBoxHeight - 10, { align: 'center' });

//   // ---- Hindi paragraphs at the VERY BOTTOM ----
//   const hindiParagraphs = [
//     'यहाँ पिंटू सर के हस्ताक्षर कराना अनिवार्य है। उनके हस्ताक्षर के बिना लॉट जारी नहीं किया जाएगा।',
//     'लॉट पूरा होने के बाद पेपर को अकाउंट ऑफिस में जमा कराना है।'
//   ];

//   const bottomMargin = 15;
//   const hindiY = H - 50;
  
//   try {
//     const canvas = document.createElement('canvas');
//     const ctx = canvas.getContext('2d');

//     const fontPx = 11;
//     const lineGap = 5;
//     const padding = 10;
//     const maxTextW = Math.max(120, Math.min(560, W - 2 * CM2));
//     ctx.font = `${fontPx}px "Noto Sans Devanagari", "Mangal", "Arial Unicode MS", sans-serif`;

//     function wrapParagraph(paragraph) {
//       const words = paragraph.split(' ');
//       const lines = [];
//       let cur = '';
//       for (let i = 0; i < words.length; i++) {
//         const word = words[i];
//         const test = cur ? (cur + ' ' + word) : word;
//         const w = ctx.measureText(test).width;
//         if (w > maxTextW && cur) { lines.push(cur); cur = word; } else { cur = test; }
//       }
//       if (cur) lines.push(cur);
//       return lines;
//     }

//     const wrappedLines = [];
//     for (let p = 0; p < hindiParagraphs.length; p++) {
//       const para = hindiParagraphs[p];
//       const lines = wrapParagraph(para);
//       if (lines.length > 0) {
//         wrappedLines.push('• ' + lines[0]);
//         for (let j = 1; j < lines.length; j++) wrappedLines.push('  ' + lines[j]);
//       } else {
//         wrappedLines.push('• ' + para);
//       }
//     }

//     const maxLineWidth = Math.max(...wrappedLines.map(t => ctx.measureText(t).width));
//     canvas.width = Math.ceil(maxLineWidth + padding * 2);
//     const lineHeight = Math.ceil(fontPx * 1.2);
//     canvas.height = Math.ceil(padding * 2 + wrappedLines.length * lineHeight + (wrappedLines.length - 1) * lineGap);

//     const ctx2 = canvas.getContext('2d');
//     ctx2.fillStyle = '#000';
//     ctx2.font = `${fontPx}px "Noto Sans Devanagari", "Mangal", "Arial Unicode MS", sans-serif`;
//     ctx2.textBaseline = 'top';

//     let y = padding;
//     for (let i = 0; i < wrappedLines.length; i++) 
//       ctx2.fillText(wrappedLines[i], padding, y);
//       y += lineHeight + lineGap;
//     }

//     const dataUrl = canvas.toDataURL('image/png');
//     const imgMaxW = W - 2 * CM2;
//     let imgW = Math.min(canvas.width, imgMaxW);
//     let imgH = (canvas.height * imgW) / canvas.width;

//     const imgX = (W - imgW) / 2;
//     let imgY = H - imgH - bottomMargin;
    
//     const cuttingBoxBottom = cuttingBoxY + cuttingBoxHeight;
//     if (imgY < cuttingBoxBottom + 10) {
//       const maxAllowedH = H - bottomMargin - (cuttingBoxBottom + 10);
//       if (maxAllowedH > 20) {
//         const scale = maxAllowedH / imgH;
//         imgH *= scale;
//         imgW *= scale;
//         imgY = cuttingBoxBottom + 10;
//       }
//     }

//     doc.addImage(dataUrl, 'PNG', imgX, imgY, imgW, imgH);
//   } catch (e) {
//     doc.setFont('times', 'bold'); doc.setFontSize(9);
//     const fallbackY = H - 40;
//     doc.text('NOTE: Get Pintu sir\'s signature. Lot cannot be issued without it.', CM2, fallbackY, { maxWidth: W - 2 * CM2 });
//   }
// }
// Helper function for dashed borders
function drawDashedBorder(doc, x, y, w, h) {
  const dashGap = 4;
  const dashLen = 2;
  
  // Top dashed line
  let curX = x + 4;
  const topDashY = y + 4;
  while (curX < x + w - 4) {
    doc.line(curX, topDashY, Math.min(curX + dashLen, x + w - 4), topDashY);
    curX += dashGap;
  }
  
  // Bottom dashed line
  curX = x + 4;
  const botDashY = y + h - 4;
  while (curX < x + w - 4) {
    doc.line(curX, botDashY, Math.min(curX + dashLen, x + w - 4), botDashY);
    curX += dashGap;
  }
  
  // Left dashed line
  let curY = y + 4;
  const leftDashX = x + 4;
  while (curY < y + h - 4) {
    doc.line(leftDashX, curY, leftDashX, Math.min(curY + dashLen, y + h - 4));
    curY += dashGap;
  }
  
  // Right dashed line
  curY = y + 4;
  const rightDashX = x + w - 4;
  while (curY < y + h - 4) {
    doc.line(rightDashX, curY, rightDashX, Math.min(curY + dashLen, y + h - 4));
    curY += dashGap;
  }
}
// ============================
// STYLES - Crisp Blue & White Theme
// ============================
const Wrap = styled.div`
  max-width: 1920px;
  margin: 0 auto;
  padding: 14px 20px 36px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #0f172a;
  background: #f0f9ff;
  min-height: 100vh;
`;

const HeaderPaper = styled.div`
  background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%);
  border-radius: 18px;
  padding: 16px 24px;
  margin-bottom: 18px;
  box-shadow: 0 8px 24px -6px rgba(37, 99, 235, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  color: white;
  align-items: center;
  @media (max-width: 900px) { grid-template-columns: 1fr; gap: 16px; }
`;

const TitleSection = styled.div`
  display: flex; align-items: center; gap: 14px;
  h1 { margin: 0 0 4px 0; font-size: 1.4rem; font-weight: 850; color: #ffffff; letter-spacing: -0.02em; }
  p { margin: 0; color: #dbeafe; font-size: 0.85rem; font-weight: 500; }
`;

const TitleIcon = styled.div`
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(8px);
  color: white; font-size: 22px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
`;

const SearchSection = styled.div` display: flex; flex-direction: column; gap: 12px; `;
const Form = styled.form`
  display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;
const SearchBox = styled.label`
  display: grid; grid-template-columns: 20px 1fr; align-items: center; gap: 10px;
  padding: 10px 16px; border-radius: 20px; background: #ffffff; border: 1.5px solid #bfdbfe;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.03); color: #2563eb; transition: all 0.2s ease;
  &:focus-within { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
  input { background: transparent; border: none; outline: none; color: #0f172a; font-size: 0.9rem; ::placeholder { color: #64748b; } }
`;

const BtnRow = styled.div` display: flex; gap: 8px; align-items: center; flex-wrap: wrap; `;
const BaseBtn = styled.button`
  border-radius: 20px; padding: 8px 16px; font-weight: 600; display: inline-flex;
  align-items: center; gap: 6px; cursor: pointer; border: none; transition: all 0.2s ease; font-size: 0.85rem;
`;
const PrimaryBtn = styled(BaseBtn)`
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%); color: white; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
  &:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const GhostBtn = styled(BaseBtn)` background: #ffffff; border: 1px solid #bfdbfe; color: #1e40af; &:hover { background: #eff6ff; border-color: #2563eb; } `;

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
  background: #ffffff;
  border-radius: 18px;
  padding: 24px;
  margin-top: 18px;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.05);
  border: 1.5px solid #bfdbfe;
`;

const InstructionsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eff6ff;
  
  h2 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 800;
    color: #1e3a8a;
  }
  
  svg {
    color: #2563eb;
  }
`;

const InstructionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const InstructionCard = styled.div`
  background: #f0f9ff;
  border-radius: 14px;
  padding: 18px;
  border-left: 4px solid #2563eb;
  border: 1px solid #bfdbfe;
  border-left-width: 4px;
  
  .instruction-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2563eb;
    font-size: 1.3rem;
    margin-bottom: 12px;
  }
  
  .instruction-title {
    font-weight: 750;
    color: #1e3a8a;
    margin-bottom: 8px;
    font-size: 0.95rem;
  }
  
  .instruction-desc {
    color: #475569;
    line-height: 1.5;
    font-size: 0.85rem;
  }
`;

const LanguageBtn = styled(BaseBtn)`
  background: ${props => props.$isHindi ? '#dc2626' : '#16a34a'};
  color: white;
  border: none;
  border-radius: 20px;
  
  &:hover:not(:disabled) {
    background: ${props => props.$isHindi ? '#b91c1c' : '#15803d'};
    transform: translateY(-1px);
  }
`;

const FeaturesList = styled.div`
  background: #f0f9ff;
  border-radius: 14px;
  padding: 18px;
  margin-top: 18px;
  border: 1px solid #bfdbfe;
`;

const FeatureItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  
  &:last-child {
    margin-bottom: 0;
  }
  
  .feature-check {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #16a34a;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.65rem;
    margin-top: 2px;
    flex-shrink: 0;
  }
  
  .feature-text {
    color: #334155;
    line-height: 1.4;
    font-size: 0.85rem;
  }
`;

const QuickTips = styled.div`
  background: #fffbeb;
  border: 1.5px solid #fef08a;
  border-radius: 14px;
  padding: 16px;
  margin-top: 18px;
`;

const TipsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  
  h4 {
    margin: 0;
    color: #d97706;
    font-size: 0.9rem;
    font-weight: 750;
  }
  
  svg {
    color: #d97706;
  }
`;

const TipItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
  
  &:last-child {
    margin-bottom: 0;
  }
  
  .tip-bullet {
    color: #d97706;
    font-size: 0.75rem;
    margin-top: 2px;
    flex-shrink: 0;
  }
  
  .tip-text {
    color: #92400e;
    font-size: 0.85rem;
    line-height: 1.35;
  }
`;

const ErrorCard = styled.div`
  margin-bottom: 18px; display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: center;
  background: #fef2f2; border: 1.5px solid #fecaca; color: #dc2626;
  padding: 12px 16px; border-radius: 14px; font-weight: 600; font-size: 0.85rem;
`;

const Alert = styled.div`
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 10px;
  align-items: flex-start;
  padding: 14px 18px;
  margin-top: 14px;
  border: 1.5px solid #fecaca;
  background: #fef2f2;
  border-radius: 14px;
  color: #b91c1c;
`;

const AlertTitle = styled.div`
  font-weight: 750;
  font-size: 0.9rem;
  line-height: 1.3;
`;

const AlertMessage = styled.div`
  font-size: 0.85rem;
  line-height: 1.4;
  color: #475569;
`;

const HintCard = styled.div`
  margin-top: 18px; padding: 14px 16px; border-radius: 14px; background: #ffffff; border: 1.5px dashed #bfdbfe;
  color: #1e40af; font-size: 0.85rem; line-height: 1.5; display: flex; align-items: center; gap: 10px;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.03);
  code { background: #eff6ff; padding: 2px 6px; border-radius: 6px; font-family: monospace; color: #2563eb; font-size: 0.85rem; font-weight: 600; }
`;

const ContentGrid = styled.div`
  display: grid; 
  grid-template-columns: 320px 1fr;
  gap: 18px;
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
`;

const InfoPanel = styled.div`
  background: #ffffff; border-radius: 18px; padding: 18px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.05);
  display: flex; flex-direction: column; height: fit-content; border: 1.5px solid #bfdbfe;
`;

const TablePanel = styled.div`
  background: #ffffff; border-radius: 18px; padding: 18px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.05);
  overflow: hidden; display: flex; flex-direction: column; border: 1.5px solid #bfdbfe;
`;

const PanelHeader = styled.div`
  display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #eff6ff;
  h3 { margin: 0; font-size: 1rem; font-weight: 800; color: #1e3a8a; }
  svg { color: #2563eb; }
`;

const InfoGrid = styled.div` display: grid; gap: 10px; margin-bottom: 18px; `;
const InfoItem = styled.div` display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center; padding: 10px 12px; background: #f0f9ff; border-radius: 12px; border: 1px solid #dbeafe;`;
const InfoIcon = styled.div` display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: #eff6ff; color: #2563eb; font-size: 1rem; border: 1px solid #bfdbfe;`;
const InfoLabel = styled.div` font-size: 0.78rem; color: #0284c7; font-weight: 600; margin-bottom: 2px; `;
const InfoValue = styled.div` font-weight: 750; color: #1e3a8a; font-size: 0.9rem; `;

const SummaryCard = styled.div` display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; padding: 12px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 14px; border: 1px solid #bfdbfe;`;
const SummaryItem = styled.div` text-align: center; padding: 6px; `;
const SummaryLabel = styled.div` font-size: 0.75rem; color: #2563eb; margin-bottom: 4px; font-weight: 700; uppercase; `;
const SummaryValue = styled.div` font-weight: 850; color: #1e40af; font-size: 1.2rem; `;

const ActionsRow = styled.div` display: flex; justify-content: flex-end; margin-top: auto; `;
const TableContainer = styled.div` width: 100%; overflow: auto; border-radius: 12px; border: 1px solid #bfdbfe; `;

const Table = styled.table`
  width: 100%; border-collapse: collapse; font-size: 0.85rem;
  thead th { position: sticky; top: 0; background: #f0f9ff; text-align: center; padding: 10px 12px; border-bottom: 2px solid #bfdbfe; font-weight: 750; color: #1e40af; white-space: nowrap; text-transform: uppercase; font-size: 0.78rem; letter-spacing: 0.5px; }
  tbody td, tfoot td { padding: 8px 10px; color: #0f172a; border-bottom: 1px solid #f1f5f9; }
  tbody tr { transition: background 0.15s ease; &:hover { background: #f8fafc; } }
  td.num { text-align: center; font-variant-numeric: tabular-nums; }
  td.strong, th.strong { font-weight: 750; }
  tfoot td { background: #f8fafc; font-weight: 800; color: #1e40af; border-top: 2px solid #bfdbfe; }
`;

/* ===== Simple Dialog Styles ===== */
const DialogOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
`;

const DialogContainer = styled.div`
  background: #ffffff;
  border-radius: 20px;
  padding: 0;
  width: 100%;
  max-width: 680px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
  border: 1.5px solid #bfdbfe;
`;

const DialogHeader = styled.div`
  background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%);
  padding: 16px 20px;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 18px 18px 0 0;
  
  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    gap: 8px;
    color: white;
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
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
  color: white;
  padding: 10px 20px;
  font-size: 0.9rem;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
  
  &:hover:not(:disabled) {
    background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
    transform: translateY(-1px);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SimpleGhostBtn = styled(BaseBtn)`
  background: #ffffff;
  border: 1px solid #bfdbfe;
  color: #1e40af;
  padding: 10px 20px;
  font-size: 0.9rem;
  border-radius: 20px;
  
  &:hover {
    background: #eff6ff;
    border-color: #2563eb;
  }
`;

const SimpleField = styled.label`
  display: grid;
  gap: 6px;
  margin: 16px 0 14px;
  
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1.5px solid #bfdbfe;
    background: #f0f9ff;
    color: #0f172a;
    outline: none;
    font-size: 0.9rem;
    font-weight: 600;
    
    &:focus {
      border-color: #2563eb;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    
    &:disabled {
      background: #f1f5f9;
      color: #94a3b8;
    }
  }
`;

const SimpleInlineError = styled.div`
  margin-top: 16px;
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 10px;
  align-items: center;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #dc2626;
  padding: 14px 16px;
  border-radius: 12px;
  font-size: 0.9rem;
`;

const ProgressSteps = styled.div`
  margin: 16px 0;
  padding: 16px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
`;

const ProgressStep = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  color: ${props => props.completed ? '#16a34a' : props.active ? '#8b5cf6' : '#64748b'};
  font-weight: ${props => (props.completed || props.active) ? '600' : '500'};
  
  .step-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    background: ${props => props.completed ? '#16a34a' : props.active ? '#8b5cf6' : '#e2e8f0'};
    color: ${props => (props.completed || props.active) ? 'white' : '#64748b'};
  }
`;

const RetryButton = styled.button`
  background: #f59e0b;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 0.9rem;
  
  &:hover {
    background: #d97706;
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

const Field = styled.label`
  display: grid; gap: 8px; margin: 16px 0 12px;
  input { width: 100%; padding: 12px 14px; border-radius: 12px; border: 2px solid #e2e8f0; background: white; color: #1e293b; outline: none; transition: all 0.2s ease; font-size: 0.95rem;
    &:focus { border-color: #8b5cf6; box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.15); } }
`;
const FieldLabel = styled.div` display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #475569; font-weight: 500; `;
const InlineError = styled.div` margin-top: 12px; display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: center; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #dc2626; padding: 10px 12px; border-radius: 10px; font-size: 0.9rem; `;

const StatusMessage = styled.div`
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 12px;
  font-weight: 500;
  margin: 16px 0;
  background: ${props => {
    switch (props.status) {
      case 'success': return 'rgba(34, 197, 94, 0.1)';
      case 'error': return 'rgba(239, 68, 68, 0.1)';
      default: return 'rgba(59, 130, 246, 0.1)';
    }
  }};
  border: 1px solid ${props => {
    switch (props.status) {
      case 'success': return 'rgba(34, 197, 94, 0.2)';
      case 'error': return 'rgba(239, 68, 68, 0.2)';
      default: return 'rgba(59, 130, 246, 0.2)';
    }
  }};
  color: ${props => {
    switch (props.status) {
      case 'success': return '#16a34a';
      case 'error': return '#dc2626';
      default: return '#1d4ed8';
    }
  }};

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

// ============================
// REACT COMPONENT (OPTIMIZED)
// ============================
export default function AlterJObOrder() {
  const [lotInput, setLotInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const [alreadyIssued, setAlreadyIssued] = useState(false);
  const [preGeneratedPdf, setPreGeneratedPdf] = useState(null);
  const [language, setLanguage] = useState('en');
  const t = translations[language];
  const [alterCounts, setAlterCounts] = useState({});
  // const [totalAlterPcs, setTotalAlterPcs] = useState(0);
  const [masterGltiCounts, setMasterGltiCounts] = useState({});


  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [issueDate, setIssueDate] = useState(() => todayLocalISO());
  const [supervisor, setSupervisor] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState('');
   const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'hi' : 'en');
  };
const addAlterEntry = (rowIndex) => {
  const newAlterCounts = {
    ...alterCounts,
    [rowIndex]: [
      ...(alterCounts[rowIndex] || []),
      { pcs: '', category: '' } // New empty entry
    ]
  };
  setAlterCounts(newAlterCounts);
};

// Calculate total alter PCs
// Calculate total alter PCs
const totalAlterPcs = useMemo(() => {
  return Object.values(alterCounts).reduce((sum, rowAlters) => {
    if (Array.isArray(rowAlters)) {
      return sum + rowAlters.reduce((rowSum, entry) => {
        const pcs = parseInt(entry.pcs) || 0;
        return rowSum + pcs;
      }, 0);
    }
    return sum;
  }, 0);
}, [alterCounts]);

// Calculate Kharcha alter PCs

const handleMasterGltiChange = (rowIndex, value) => {
  // Ensure value is a number or empty string
  const numValue = value === '' ? '' : parseInt(value) || 0;
  
  setMasterGltiCounts({
    ...masterGltiCounts,
    [rowIndex]: {
      pcs: numValue,
      description: masterGltiCounts[rowIndex]?.description || ''
    }
  });
};

// Calculate total Master ki Glti PCs
const totalMasterGltiPcs = useMemo(() => {
  return Object.values(masterGltiCounts).reduce((sum, rowData) => {
    if (rowData && rowData.pcs) {
      return sum + (parseInt(rowData.pcs) || 0);
    }
    return sum;
  }, 0);
}, [masterGltiCounts]);
// Calculate per-row alter PCs
const rowAlterPcs = (rowIndex) => {
  const rowAlters = alterCounts[rowIndex] || [];
  return rowAlters.reduce((sum, entry) => {
    const pcs = parseInt(entry.pcs) || 0;
    return sum + pcs;
  }, 0);
};
const updateAlterEntry = (rowIndex, entryIndex, field, value) => {
  const rowAlters = alterCounts[rowIndex] || [];
  const updatedEntry = {
    ...rowAlters[entryIndex],
    [field]: value
  };
  
  const newRowAlters = [...rowAlters];
  newRowAlters[entryIndex] = updatedEntry;
  
  setAlterCounts({
    ...alterCounts,
    [rowIndex]: newRowAlters
  });
};

const kharchaTotal = useMemo(() => {
  return Object.values(alterCounts).filter(c => c.category === 'kharcha').length;
}, [alterCounts]);
const totalKharchaPcs = useMemo(() => {
  return Object.values(alterCounts).reduce((sum, rowAlters) => {
    if (Array.isArray(rowAlters)) {
      return sum + rowAlters.reduce((rowSum, entry) => {
        if (entry.category === 'kharcha') {
          const pcs = parseInt(entry.pcs) || 0;
          return rowSum + pcs;
        }
        return rowSum;
      }, 0);
    }
    return sum;
  }, 0);
}, [alterCounts]);


// Calculate Emb/Pending alter PCs
const totalEmbPendingPcs = useMemo(() => {
  return Object.values(alterCounts).reduce((sum, rowAlters) => {
    if (Array.isArray(rowAlters)) {
      return sum + rowAlters.reduce((rowSum, entry) => {
        if (entry.category === 'emb_pending') {
          const pcs = parseInt(entry.pcs) || 0;
          return rowSum + pcs;
        }
        return rowSum;
      }, 0);
    }
    return sum;
  }, 0);
}, [alterCounts]);
const embPendingTotal = useMemo(() => {
  return Object.values(alterCounts).filter(c => c.category === 'emb_pending').length;
}, [alterCounts]);
  
  // Add alter types state
  const [alterDetails, setAlterDetails] = useState({
    fabricAlter: '',
    cuttingAlter: '',
    embAlter: '',
    printingAlter: '',
    stitchingAlter: '',
    otherAlter: ''
  });

  // Cache cleanup on component mount
  useEffect(() => {
    const interval = setInterval(() => {
      sheetDataCache.cleanup();
      lotMatrixCache.cleanup();
      issueStatusCache.cleanup();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Supervisor suggestions with persistence
  const LS_KEY_SUPERVISORS = 'issueStitching.supervisors';
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

  // Pre-generate PDF in background when matrix loads
  useEffect(() => {
    if (matrix && !alreadyIssued) {
      const generatePdfBackground = async () => {
        try {
          console.log('Starting background PDF generation...');
          await generateIssuePdfBlob(matrix, { 
            issueDate: todayLocalISO(), 
            supervisor: '' 
          });
          console.log('Background PDF generation completed');
        } catch (err) {
          console.warn('Background PDF generation failed:', err);
        }
      };
      
      generatePdfBackground();
    }
  }, [matrix, alreadyIssued]);
  const removeAlterEntry = (rowIndex, entryIndex) => {
  const rowAlters = alterCounts[rowIndex] || [];
  
  if (rowAlters.length <= 1) {
    // If only one entry, clear it completely
    const newAlterCounts = { ...alterCounts };
    delete newAlterCounts[rowIndex];
    setAlterCounts(newAlterCounts);
  } else {
    // Remove specific entry
    const newRowAlters = rowAlters.filter((_, idx) => idx !== entryIndex);
    setAlterCounts({
      ...alterCounts,
      [rowIndex]: newRowAlters
    });
  }
};

  // OPTIMIZED SEARCH WITH CACHE
const handleSearch = async (e) => {
  e?.preventDefault?.();
  if (!canSearch) return;

  setError('');
  setMatrix(null);
  setPreGeneratedPdf(null);
  setSubmissionStatus('');
  setAlreadyIssued(false); // Reset this state
  setLoading(true);

  abortRef.current?.abort?.();
  const ctrl = new AbortController();
  abortRef.current = ctrl;

  try {
    console.log('🔎 Starting search for lot:', lotInput);
    const lotNumber = norm(lotInput);
    
    // Clear the issue status cache for this lot to force fresh check
    const issueCacheKey = generateIssueStatusCacheKey(lotNumber);
    issueStatusCache.delete(issueCacheKey);
    console.log('🗑️ Cleared issue status cache for:', lotNumber);
    
    // FIRST: Check if lot is already issued in AlterJobOrders
    console.log('🔍 Checking if lot is already issued in AlterJobOrders...');
    const isAlreadyIssued = await isLotAlreadyIssued(lotNumber, ctrl.signal);
    
    console.log('✅ Lot is not issued, proceeding with fetch...');
    
    // SECOND: Fetch lot matrix data
    const cacheKey = generateLotMatrixCacheKey(lotNumber);
    const cachedMatrix = lotMatrixCache.get(cacheKey);
    
    if (cachedMatrix) {
      console.log('🚀 Using cached lot matrix:', cachedMatrix.lotNumber);
      setMatrix(cachedMatrix);
      // Set alreadyIssued state after matrix is set
      if (isAlreadyIssued) {
        setAlreadyIssued(true);
      }
    } else {
      // Fetch fresh data
      console.log('🔄 Fetching fresh lot matrix data...');
      const data = await fetchLotMatrixViaSheetsApi(lotNumber, ctrl.signal);
      console.log('🔄 Fresh data received:', data.lotNumber);
      setMatrix(data);
      // Set alreadyIssued state after matrix is set
      if (isAlreadyIssued) {
        setAlreadyIssued(true);
      }
    }
    
  } catch (err) {
    console.error('❌ Search error:', err);
    setError(err?.message || "Failed to fetch data.");
  } finally {
    setLoading(false);
  }
};
  // Clear cache when explicitly resetting
  const handleClear = () => {
    setLotInput('');
    setMatrix(null);
    setPreGeneratedPdf(null);
    setError('');
    setSubmissionStatus('');
    abortRef.current?.abort?.();
  };

  const handleBack = () => {
    if (window.history?.length > 1) window.history.back();
    else window.close?.();
  };

const openIssueDialog = () => {
  console.log('🔄 Opening issue dialog, alreadyIssued state:', alreadyIssued);
  
  // Check if lot is already issued before opening dialog
  if (alreadyIssued) {
    const errorMsg = `This lot ${matrix?.lotNumber} is already issued and cannot be processed again.`;
    console.log('❌ Blocked dialog opening:', errorMsg);
    setError(errorMsg);
    return;
  }
  
  if (!matrix) {
    setError("No lot data available. Please search for a lot first.");
    return;
  }
  
  console.log('✅ Opening issue dialog for lot:', matrix.lotNumber);
  
  // Reset all dialog states
  setDialogError('');
  setSupervisor(''); // Reset supervisor field
  setIssueDate(todayLocalISO());
  setSubmissionStatus('');
  setConfirming(false); // Ensure confirming is false
  
  // Directly open the issue dialog
  setShowIssueDialog(true);
};
  // const handleAlterDetailsConfirm = () => {
  //   // Validate that at least one alter type has values
  //   const hasAlterValues = Object.values(alterDetails).some(value => value.trim() !== '');
    
  //   if (!hasAlterValues) {
  //     setDialogError('Please enter alter quantities for at least one alter type.');
  //     return;
  //   }
    
  //   // Close alter details dialog and open issue dialog
  //   setShowAlterDetailsDialog(false);
  //   setShowIssueDialog(true);
  // };

  const closeIssueDialog = () => {
    if (confirming) return;
    setShowIssueDialog(false);
  };
const handleAlterCountChange = (rowIndex, field, value) => {
  const newAlterCounts = {
    ...alterCounts,
    [rowIndex]: {
      ...alterCounts[rowIndex],
      [field]: value
    }
  };
  
  setAlterCounts(newAlterCounts);
  
  // Remove these two lines - totalAlterPcs is calculated with useMemo
  // Calculate total alter pieces from all rows
  // const total = Object.values(newAlterCounts).reduce((sum, rowData) => {
  //   if (rowData && rowData.pcs) {
  //     return sum + (parseInt(rowData.pcs) || 0);
  //   }
  //   return sum;
  // }, 0);
  
  // setTotalAlterPcs(total); // REMOVE THIS LINE
};

// Reset alter counts when matrix changes
useEffect(() => {
  if (matrix) {
    setAlterCounts({});
    // setTotalAlterPcs(0); // REMOVE THIS LINE
  }
}, [matrix]);

  // Reset alter counts when matrix changes
  useEffect(() => {
    if (matrix) {
      setAlterCounts({});
      // setTotalAlterPcs(0);
    }
  }, [matrix]);

  // Clear cache for this lot when it's issued
// Enhanced submission handler with timeout handling
// Inside handleConfirmIssue function, comment out this entire section:
const handleConfirmIssue = async () => {
  // Double-check supervisor is entered
  console.log('handleConfirmIssue called', {
    supervisor: supervisor,
    confirming: confirming,
    matrixExists: !!matrix
  });
  
  if (!supervisor || supervisor.trim() === '') {
    setDialogError('Supervisor is required.');
    return;
  }
  
  if (!norm(supervisor)) { 
    setDialogError('Supervisor is required.'); 
    return; 
  }
  
  if (!matrix) { 
    setDialogError('Nothing to submit. Search a lot first.'); 
    return; 
  }
  
  // Validate that alter totals are calculated
  if (totalKharchaPcs === 0 && totalEmbPendingPcs === 0 && totalMasterGltiPcs === 0) {
    setDialogError('Please add alter quantities before submitting.');
    return;
  }
  
  // Prevent multiple submissions
  if (confirming) {
    console.log('Already confirming, skipping');
    return;
  }
  
  setDialogError('');
  setConfirming(true);
  setSubmissionStatus('preparing_submission');

  try {
    // 1. Prepare data for submission
    const submissionData = {
      lotNumber: matrix.lotNumber || '',
      fabric: matrix.fabric || '',
      garmentType: matrix.garmentType || '',
      style: matrix.style || '',
      brand: matrix.brand || '',
      totalPcs: matrix.totals?.grand || 0,
      issueDate: issueDate || '',
      supervisor: supervisor || '',
      kharchaTotal: totalKharchaPcs || 0,
      embPendingTotal: totalEmbPendingPcs || 0,
      masterGltiTotal: totalMasterGltiPcs || 0,
      totalAlterPcs: totalKharchaPcs + totalEmbPendingPcs + totalMasterGltiPcs,
      alterCounts: alterCounts || {},
      masterGltiCounts: masterGltiCounts || {} // Make sure this is included
    };

    // DEBUG: Check what we're sending
    console.log('🚨 SUBMISSION DATA CHECK:', {
      masterGltiTotal: submissionData.masterGltiTotal,
      masterGltiCounts: submissionData.masterGltiCounts,
      hasMasterGltiCounts: Object.keys(submissionData.masterGltiCounts).length > 0,
      totalAlterCalculation: totalKharchaPcs + totalEmbPendingPcs + totalMasterGltiPcs
    });

    console.log('📤 Preparing to submit data:', submissionData.lotNumber);

    // 2. Save data to Google Sheets
    setSubmissionStatus('saving_to_sheets');
    console.log('Saving to Google Sheets...');
    
    const saveResult = await saveAlterJobOrderToSheets(submissionData);
    
    console.log('Save result:', saveResult);
    
    if (!saveResult.success) {
      throw new Error(`Failed to save data: ${saveResult.error || 'Unknown error'}`);
    }

    // 3. Generate PDF
    setSubmissionStatus('generating_pdf');
    console.log('Generating PDF...');
    console.log('Master Glti counts for PDF:', masterGltiCounts);

    await generateIssuePdf(matrix, { 
      issueDate, 
      supervisor, 
      alterCounts,
      masterGltiCounts
    });

    // 4. Update cache and state
    const cacheKey = generateIssueStatusCacheKey(matrix.lotNumber);
    issueStatusCache.set(cacheKey, true);
    
    // 5. Show success
    setSubmissionStatus('success');
    setAlreadyIssued(true);

    console.log('✅ Submission completed successfully');

    // 6. Close dialog after delay
    setTimeout(() => {
      setShowIssueDialog(false);
      setSubmissionStatus('');
      setAlterCounts({});
      setMasterGltiCounts({}); // Reset master glti counts
      setConfirming(false);
      console.log('Dialog closed');
    }, 2000);

  } catch (error) {
    console.error('❌ Submission error:', error);
    setSubmissionStatus('error');
    setDialogError(`Submission failed: ${error.message}. Please try again.`);
    setConfirming(false);
  }
};
  const generateIssuePdfBlob = async (matrix, { issueDate, supervisor }) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('PDF pre-generation complete');
        resolve('pdf-blob-placeholder');
      }, 1000);
    });
  };
const validateAlters = () => {
  if (!matrix) return [];
  
  const errors = [];
  
  matrix.rows.forEach((r, rowIdx) => {
    const rowAlters = alterCounts[rowIdx] || [];
    const rowTotalPcs = r.totalPcs || 0;
    const rowAlterPcsTotal = rowAlterPcs(rowIdx);
    
    if (rowAlterPcsTotal > rowTotalPcs) {
      errors.push(`Row ${rowIdx + 1} (${r.color}): ${rowAlterPcsTotal} alter PCs exceeds total ${rowTotalPcs}`);
    }
  });
  
  return errors;
};
  const displaySizes = useMemo(() => {
    if (!matrix) return [];
    return matrix.source === 'old'
      ? Array(5).fill('')
      : (matrix.sizes || []);
  }, [matrix]);

const columns = useMemo(
  () => (matrix ? ['Color', 'Cutting Table', ...displaySizes, 'Total Pcs', 'Kharcha Alter PCs', 'Kharcha Type', 'Emb Alter PCs', 'Emb Type', 'Master ki Glti', 'Master ki glti pcs'] : []),
  [matrix, displaySizes]
);
const getStatusMessage = () => {
  switch(submissionStatus) {
    case 'marking_as_issued':
      return 'Marking lot as issued...';
    case 'already_issued':
      return 'Lot marked as issued (no further actions allowed)';
    case 'error':
      return 'Error occurred. Please try again.';
    default:
      return '';
  }
};
function formatAlterDetailsForPdf(alterDetails) {
  const result = {};
  
  if (!alterDetails) return result;
  
  if (alterDetails.fabricAlter) {
    const pcs = parseFloat(alterDetails.fabricAlter);
    if (!isNaN(pcs) && pcs > 0) {
      result['Fabric'] = pcs;
    }
  }
  
  if (alterDetails.cuttingAlter) {
    const pcs = parseFloat(alterDetails.cuttingAlter);
    if (!isNaN(pcs) && pcs > 0) {
      result['Cutting'] = pcs;
    }
  }
  
  if (alterDetails.embAlter) {
    const pcs = parseFloat(alterDetails.embAlter);
    if (!isNaN(pcs) && pcs > 0) {
      result['Embroidery'] = pcs;
    }
  }
  
  if (alterDetails.printingAlter) {
    const pcs = parseFloat(alterDetails.printingAlter);
    if (!isNaN(pcs) && pcs > 0) {
      result['Printing'] = pcs;
    }
  }
  
  if (alterDetails.stitchingAlter) {
    const pcs = parseFloat(alterDetails.stitchingAlter);
    if (!isNaN(pcs) && pcs > 0) {
      result['Stitching'] = pcs;
    }
  }
  
  if (alterDetails.otherAlter) {
    const value = alterDetails.otherAlter;
    const pcs = parseFloat(value);
    if (!isNaN(pcs) && pcs > 0) {
      result['Other'] = pcs;
    } else if (typeof value === 'string' && value.trim() !== '') {
      result['Other'] = 1;
    }
  }
  
  return result;
}

  return (
     <LanguageContext.Provider value={{ language, setLanguage, t }}>
      <Wrap>
        {/* Language Toggle Button */}
       
        <HeaderPaper>
          <TitleSection>
            <TitleIcon><FiScissors /></TitleIcon>
            <div>
              <h1>{t.title}</h1>
              <p>{t.subtitle}</p>
            </div>
          </TitleSection>

          <SearchSection>
            <Form onSubmit={handleSearch}>
              <SearchBox>
                <FiSearch />
                <input
                  value={lotInput}
                  onChange={(e) => setLotInput(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  autoFocus
                />
              </SearchBox>

              <BtnRow>
                <GhostBtn
                  as={motion.button}
                  type="button"
                  onClick={handleBack}
                  whileTap={{ scale: 0.98 }}
                  title={t.back}
                >
                  <FiArrowLeft /> {t.back}
                </GhostBtn>

                <PrimaryBtn as={motion.button} type="submit" disabled={!canSearch} whileTap={{ scale: 0.98 }}>
                  {loading ? <Spinner /> : <><FiSearch /> {t.search}</>}
                </PrimaryBtn>

                <GhostBtn as={motion.button} type="button" onClick={handleClear} whileTap={{ scale: 0.98 }}>
                  <FiRefreshCw /> {t.reset}
                </GhostBtn>
                <LanguageBtn 
    as={motion.button}
    type="button"
    onClick={toggleLanguage}
    whileTap={{ scale: 0.98 }}
    $isHindi={language === 'hi'}
    title={language === 'en' ? 'Switch to Hindi' : 'Switch to English'}
  >
    <FiGlobe /> 
    {language === 'en' ? 'हिंदी' : 'English'}
  </LanguageBtn>
                
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
        {alreadyIssued && matrix && (
  <Alert>
    <FiAlertTriangle />
    <div>
      <AlertTitle>Lot Already Issued</AlertTitle>
      <AlertMessage>
        This lot has been processed before. No further actions (PDF download or submission) are allowed.
      </AlertMessage>
    </div>
  </Alert>
)}

        {matrix ? (
          <ContentGrid>
            <InfoPanel>
              <PanelHeader><FiInfo /><h3>{t.lotInfo}</h3></PanelHeader>
              <InfoGrid>
                <InfoItem>
                  <InfoIcon><FiPackage /></InfoIcon>
                  <div><InfoLabel>{t.lotNumber}</InfoLabel><InfoValue>{matrix.lotNumber || '—'}</InfoValue></div>
                </InfoItem>
                <InfoItem>
                  <InfoIcon><FiTag /></InfoIcon>
                  <div><InfoLabel>{t.style}</InfoLabel><InfoValue>{matrix.style || '—'}</InfoValue></div>
                </InfoItem>
                <InfoItem>
                  <InfoIcon><FiGrid /></InfoIcon>
                  <div><InfoLabel>{t.fabric}</InfoLabel><InfoValue>{matrix.fabric || '—'}</InfoValue></div>
                </InfoItem>
                <InfoItem>
                  <InfoIcon><FiTag /></InfoIcon>
                  <div><InfoLabel>{t.garmentType}</InfoLabel><InfoValue>{matrix.garmentType || '—'}</InfoValue></div>
                </InfoItem>
                <InfoItem>
  <InfoIcon><FiTag /></InfoIcon>
  <div><InfoLabel>Brand</InfoLabel><InfoValue>{matrix.brand || '—'}</InfoValue></div>
</InfoItem>
              </InfoGrid>
              <SummaryCard>
                <SummaryItem><SummaryLabel>{t.totalPieces}</SummaryLabel><SummaryValue>{matrix.totals.grand}</SummaryValue></SummaryItem>
                <SummaryItem><SummaryLabel>{t.colors}</SummaryLabel><SummaryValue>{matrix.rows.length}</SummaryValue></SummaryItem>
                <SummaryItem><SummaryLabel>{t.sizes}</SummaryLabel><SummaryValue>{matrix.sizes.length}</SummaryValue></SummaryItem>
              </SummaryCard>
             <ActionsRow>
  {!alreadyIssued ? (
    <PrimaryBtn
      as={motion.button}
      type="button"
      onClick={openIssueDialog}
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.02 }}
      disabled={!matrix}
      style={{ 
        opacity: !matrix ? 0.6 : 1,
        cursor: !matrix ? 'not-allowed' : 'pointer',
      }}
    >
      <FiCheck /> 
      {t.submitToStitching}
    </PrimaryBtn>
  ) : (
    <div style={{
      padding: '12px 18px',
      borderRadius: '12px',
      background: '#6b7280',
      color: 'white',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }}>
      <FiCheck /> Already Issued (No Action)
    </div>
  )}
</ActionsRow>
            </InfoPanel>

            <TablePanel>
              <PanelHeader><FiGrid /><h3>{t.cuttingMatrix}</h3></PanelHeader>
        <TableContainer>
  <Table>

<thead>
  <tr>
    <th>{t.color}</th>
    <th>{t.cuttingTable}</th>
    {displaySizes.map((s, i) => <th key={`${s || 'blank'}-${i}`}>{s || '\u00A0'}</th>)}
    <th>{t.totalPcs}</th>
    <th>Kharcha Alter PCs</th>
    <th>Kharcha Type</th>
    <th>Emb Alter PCs</th>
    <th>Emb Type</th>
    <th>Master ki Glti</th> {/* Type column */}
    <th>Master ki glti pcs</th> {/* PCs column */}
  </tr>
</thead>
<tbody>
  {matrix.rows.map((r, rowIdx) => {
    const rowAlters = alterCounts[rowIdx] || [];
    const rowTotalPcs = r.totalPcs || 0;
    
    // Separate kharcha and emb alters
    const kharchaAlters = rowAlters.filter(entry => entry.category === 'kharcha');
    const embAlters = rowAlters.filter(entry => entry.category === 'emb_pending');
    
    // Calculate totals for each category
    const kharchaTotal = kharchaAlters.reduce((sum, entry) => sum + (parseInt(entry.pcs) || 0), 0);
    const embTotal = embAlters.reduce((sum, entry) => sum + (parseInt(entry.pcs) || 0), 0);
    
    // Get Master ki Glti data
    const masterGltiData = masterGltiCounts[rowIdx] || {};
    const masterGltiPcs = parseInt(masterGltiData.pcs) || 0;
    
    const isKharchaExceeding = kharchaTotal > rowTotalPcs;
    const isEmbExceeding = embTotal > rowTotalPcs;
    const isMasterGltiExceeding = masterGltiPcs > rowTotalPcs;
    
    return (
      <React.Fragment key={rowIdx}>
        {/* Main row */}
        <tr>
          <td>{r.color}</td>
          <td className="num">{r.cuttingTable ?? ''}</td>
          {displaySizes.map((s) => (
            <td key={s} className="num">{r.sizes?.[s] ?? ''}</td>
          ))}
          <td className="num strong">{r.totalPcs ?? ''}</td>
          
          {/* Kharcha Alter PCs */}
          <td className="num" style={{ 
            color: isKharchaExceeding ? '#dc2626' : '#1e293b',
            fontWeight: kharchaTotal > 0 ? '600' : 'bold'
          }}>
            {kharchaTotal > 0 ? (
              <input
                type="number"
                min="1"
                max={rowTotalPcs}
                value={kharchaTotal}
                onChange={(e) => {
                  // Update kharcha entries
                  const newValue = e.target.value;
                  const currentAlters = alterCounts[rowIdx] || [];
                  
                  // Remove existing kharcha entries
                  const nonKharchaAlters = currentAlters.filter(entry => entry.category !== 'kharcha');
                  
                  // Add new kharcha entry with the total value
                  if (newValue && parseInt(newValue) > 0) {
                    const newKharchaEntry = { pcs: newValue, category: 'kharcha' };
                    setAlterCounts({
                      ...alterCounts,
                      [rowIdx]: [...nonKharchaAlters, newKharchaEntry]
                    });
                  } else {
                    // If value is 0 or empty, remove all kharcha entries
                    setAlterCounts({
                      ...alterCounts,
                      [rowIdx]: nonKharchaAlters
                    });
                  }
                }}
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  border: isKharchaExceeding ? '1px solid #dc2626' : '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  background: 'white',
                  color: isKharchaExceeding ? '#dc2626' : '#1e293b',
                  textAlign: 'center'
                }}
              />
            ) : (
              <input
                type="number"
                min="1"
                max={rowTotalPcs}
                placeholder="0"
                onChange={(e) => {
                  // Add new kharcha entry
                  const newValue = e.target.value;
                  if (newValue && parseInt(newValue) > 0) {
                    const newKharchaEntry = { pcs: newValue, category: 'kharcha' };
                    const currentAlters = alterCounts[rowIdx] || [];
                    setAlterCounts({
                      ...alterCounts,
                      [rowIdx]: [...currentAlters, newKharchaEntry]
                    });
                  }
                }}
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  background: '#f9fafb',
                  color: '#6b7280',
                  textAlign: 'center'
                }}
              />
            )}
            {isKharchaExceeding && (
              <div style={{ 
                fontSize: '0.7rem', 
                color: '#dc2626',
                fontWeight: 'bold',
                marginTop: '4px'
              }}>
                Max: {rowTotalPcs}
              </div>
            )}
          </td>
          
          {/* Kharcha Type - Just displays "Kharcha" if there are PCs */}
          <td className="num" style={{ 
            color: '#dc2626',
            fontWeight: kharchaTotal > 0 ? '600' : 'bold'
          }}>
            {kharchaTotal > 0 ? 'Kharcha' : ''}
          </td>
          
          {/* Emb Alter PCs */}
          <td className="num" style={{ 
            color: isEmbExceeding ? '#dc2626' : '#1e293b',
            fontWeight: embTotal > 0 ? '600' : 'bold'
          }}>
            {embTotal > 0 ? (
              <input
                type="number"
                min="1"
                max={rowTotalPcs}
                value={embTotal}
                onChange={(e) => {
                  // Update emb entries
                  const newValue = e.target.value;
                  const currentAlters = alterCounts[rowIdx] || [];
                  
                  // Remove existing emb entries
                  const nonEmbAlters = currentAlters.filter(entry => entry.category !== 'emb_pending');
                  
                  // Add new emb entry with the total value
                  if (newValue && parseInt(newValue) > 0) {
                    const newEmbEntry = { pcs: newValue, category: 'emb_pending' };
                    setAlterCounts({
                      ...alterCounts,
                      [rowIdx]: [...nonEmbAlters, newEmbEntry]
                    });
                  } else {
                    // If value is 0 or empty, remove all emb entries
                    setAlterCounts({
                      ...alterCounts,
                      [rowIdx]: nonEmbAlters
                    });
                  }
                }}
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  border: isEmbExceeding ? '1px solid #dc2626' : '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  background: 'white',
                  color: isEmbExceeding ? '#dc2626' : '#1e293b',
                  textAlign: 'center'
                }}
              />
            ) : (
              <input
                type="number"
                min="1"
                max={rowTotalPcs}
                placeholder="0"
                onChange={(e) => {
                  // Add new emb entry
                  const newValue = e.target.value;
                  if (newValue && parseInt(newValue) > 0) {
                    const newEmbEntry = { pcs: newValue, category: 'emb_pending' };
                    const currentAlters = alterCounts[rowIdx] || [];
                    setAlterCounts({
                      ...alterCounts,
                      [rowIdx]: [...currentAlters, newEmbEntry]
                    });
                  }
                }}
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  background: '#f9fafb',
                  color: '#6b7280',
                  textAlign: 'center'
                }}
              />
            )}
            {isEmbExceeding && (
              <div style={{ 
                fontSize: '0.7rem', 
                color: '#dc2626',
                fontWeight: 'bold',
                marginTop: '4px'
              }}>
                Max: {rowTotalPcs}
              </div>
            )}
          </td>
          
          {/* Emb Type - Just displays "Emb/Printing" if there are PCs */}
          <td className="num" style={{ 
            color: '#16a34a',
            fontWeight: embTotal > 0 ? '600' : 'bold'
          }}>
            {embTotal > 0 ? 'Emb/Printing' : ''}
          </td>

          {/* Master ki Glti PCs - Changed order to match Kharcha pattern */}
          <td className="num" style={{ 
            color: isMasterGltiExceeding ? '#9333ea' : '#1e293b',
            fontWeight: masterGltiPcs > 0 ? '600' : 'bold'
          }}>
            {masterGltiPcs > 0 ? (
              <input
                type="number"
                min="1"
                max={rowTotalPcs}
                value={masterGltiPcs}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setMasterGltiCounts({
                    ...masterGltiCounts,
                    [rowIdx]: {
                      ...masterGltiData,
                      pcs: newValue
                    }
                  });
                }}
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  border: isMasterGltiExceeding ? '1px solid #9333ea' : '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  background: 'white',
                  color: isMasterGltiExceeding ? '#9333ea' : '#1e293b',
                  textAlign: 'center'
                }}
              />
            ) : (
              <input
                type="number"
                min="1"
                max={rowTotalPcs}
                placeholder="0"
                onChange={(e) => {
                  const newValue = e.target.value;
                  if (newValue && parseInt(newValue) > 0) {
                    setMasterGltiCounts({
                      ...masterGltiCounts,
                      [rowIdx]: {
                        pcs: newValue,
                        description: ''
                      }
                    });
                  }
                }}
                style={{
                  width: '70px',
                  padding: '4px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  background: '#f9fafb',
                  color: '#6b7280',
                  textAlign: 'center'
                }}
              />
            )}
            {isMasterGltiExceeding && (
              <div style={{ 
                fontSize: '0.7rem', 
                color: '#9333ea',
                fontWeight: 'bold',
                marginTop: '4px'
              }}>
                Max: {rowTotalPcs}
              </div>
            )}
          </td>
          
          {/* Master ki Glti Type - Displays "Master ki Glti" when there are PCs */}
          <td className="num" style={{ 
            color: '#9333ea',
            fontWeight: masterGltiPcs > 0 ? '600' : 'bold'
          }}>
            {masterGltiPcs > 0 ? 'Master ki Glti' : ''}
          </td>
        </tr>
      </React.Fragment>
    );
  })}
</tbody>
<tfoot>
  <tr>
    <td className="strong">{t.total}</td>
    <td className="num">—</td>
    {displaySizes.map((s) => (
      <td key={s} className="num strong">{matrix.totals.perSize?.[s] ?? 0}</td>
    ))}
    <td className="num strong">{matrix.totals.grand}</td>
    <td className="num strong" style={{ color: totalKharchaPcs > 0 ? '#dc2626' : '#1e293b' }}>
      {totalKharchaPcs}
    </td>
    <td className="num strong" style={{ color: totalKharchaPcs > 0 ? '#dc2626' : '#6b7280' }}>
      {totalKharchaPcs > 0 ? 'Kharcha' : ''}
    </td>
    <td className="num strong" style={{ color: totalEmbPendingPcs > 0 ? '#16a34a' : '#1e293b' }}>
      {totalEmbPendingPcs}
    </td>
    <td className="num strong" style={{ color: totalEmbPendingPcs > 0 ? '#16a34a' : '#6b7280' }}>
      {totalEmbPendingPcs > 0 ? 'Emb/Printing' : ''}
    </td>
    <td className="num strong" style={{ color: totalMasterGltiPcs > 0 ? '#9333ea' : '#1e293b' }}>
      {totalMasterGltiPcs}
    </td>
    <td className="num strong" style={{ color: totalMasterGltiPcs > 0 ? '#9333ea' : '#6b7280' }}>
      {totalMasterGltiPcs > 0 ? 'Master ki Glti' : ''}
    </td>
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
                  {t.tip} <code>Cutting Matrix — Lot 64003</code> {t.or} <code>Cutting Matrix - Lot 64003</code>. {t.willFind}
                </span>
              </HintCard>

              <InstructionsSection>
                <InstructionsHeader>
                  <FiInfo />
                  <h2>{t.howToUse}</h2>
                </InstructionsHeader>

                <InstructionsGrid>
                  <InstructionCard>
                    <div className="instruction-icon">
                      <FiSearch />
                    </div>
                    <div className="instruction-title">{t.step1}</div>
                    <div className="instruction-desc">
                      {t.step1Desc}
                    </div>
                  </InstructionCard>

                  <InstructionCard>
                    <div className="instruction-icon">
                      <FiGrid />
                    </div>
                    <div className="instruction-title">{t.step2}</div>
                    <div className="instruction-desc">
                      {t.step2Desc}
                    </div>
                  </InstructionCard>

                  <InstructionCard>
                    <div className="instruction-icon">
                      <FiCheck />
                    </div>
                    <div className="instruction-title">{t.step3}</div>
                    <div className="instruction-desc">
                      {t.step3Desc}
                    </div>
                  </InstructionCard>
                </InstructionsGrid>

                <FeaturesList>
                  <h3 style={{ margin: '0 0 16px 0', color: '#1e293b' }}>{t.keyFeatures}</h3>
                  <FeatureItem>
                    <div className="feature-check">
                      <FiCheck />
                    </div>
                    <div className="feature-text">
                      <strong>{t.feature1.split(' - ')[0]}</strong> - {t.feature1.split(' - ')[1]}
                    </div>
                  </FeatureItem>
                  <FeatureItem>
                    <div className="feature-check">
                      <FiCheck />
                    </div>
                    <div className="feature-text">
                      <strong>{t.feature2.split(' - ')[0]}</strong> - {t.feature2.split(' - ')[1]}
                    </div>
                  </FeatureItem>
                  <FeatureItem>
                    <div className="feature-check">
                      <FiCheck />
                    </div>
                    <div className="feature-text">
                      <strong>{t.feature3.split(' - ')[0]}</strong> - {t.feature3.split(' - ')[1]}
                    </div>
                  </FeatureItem>
                  <FeatureItem>
                    <div className="feature-check">
                      <FiCheck />
                    </div>
                    <div className="feature-text">
                      <strong>{t.feature4.split(' - ')[0]}</strong> - {t.feature4.split(' - ')[1]}
                    </div>
                  </FeatureItem>
                </FeaturesList>

                <QuickTips>
                  <TipsHeader>
                    <FiAlertTriangle />
                    <h4>{t.quickTips}</h4>
                  </TipsHeader>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">
                      {t.tip1}
                    </div>
                  </TipItem>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">
                      {t.tip2}
                    </div>
                  </TipItem>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">
                      {t.tip3}
                    </div>
                  </TipItem>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">
                      {t.tip4}
                    </div>
                  </TipItem>
                </QuickTips>
              </InstructionsSection>
            </>
          )
        )}
                {/* Alter Details Dialog */}
      
        {/* Dialog with translations */}
   {showIssueDialog && (
  <DialogOverlay onClick={closeIssueDialog}>
    <DialogContainer onClick={(e) => e.stopPropagation()}>
      {/* Prevent form submission - use div instead of form */}
      <div>
        <DialogHeader>
          <h3><FiCheck /> {t.issueToStitching}</h3>
          <CloseButton onClick={closeIssueDialog} disabled={confirming}>
            <FiX />
          </CloseButton>
        </DialogHeader>

        <DialogContent>
          {/* Simple Date Field */}
          <SimpleField>
            <FieldLabel><FiCalendar /> {t.dateOfIssue}</FieldLabel>
            <input 
              type="date" 
              value={issueDate} 
              onChange={(e) => setIssueDate(e.target.value)}
              disabled={confirming}
            />
          </SimpleField>

          {/* Simple Supervisor Field */}
          <SimpleField>
            <FieldLabel><FiUser /> {t.supervisor}</FieldLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input
                list="supervisorList"
                placeholder={t.supervisor}
                value={supervisor}
                onChange={(e) => setSupervisor(titleCase(e.target.value))}
                disabled={confirming}
                onKeyDown={(e) => {
                  // Prevent Enter key from submitting
                  if (e.key === 'Enter') {
                    e.preventDefault();
                  }
                }}
              />
              {typedIsNewSupervisor && !confirming && (
                <AddButton
                  type="button"
                  onClick={() => addSupervisorToOptions(supervisor)}
                  title={t.add}
                >
                  + {t.add}
                </AddButton>
              )}
            </div>
            <datalist id="supervisorList">
              {supervisorOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </SimpleField>

          {/* Show error if any */}
          {dialogError && (
            <SimpleInlineError>
              <FiAlertTriangle />
              <span>{dialogError}</span>
            </SimpleInlineError>
          )}

          {/* Show status messages */}
          {submissionStatus && (
            <StatusMessage 
              status={submissionStatus === 'success' ? 'success' : 
                     submissionStatus === 'error' ? 'error' : 'info'}
            >
              {submissionStatus === 'saving_to_sheets' && <Spinner />}
              {submissionStatus === 'generating_pdf' && <Spinner />}
              {submissionStatus === 'success' && <FiCheck />}
              {submissionStatus === 'error' && <FiAlertTriangle />}
              <span>{getStatusMessage()}</span>
            </StatusMessage>
          )}

          <DialogActions>
            <SimpleGhostBtn 
              type="button" // Changed from type="submit"
              onClick={closeIssueDialog} 
              disabled={confirming}
            >
              {t.cancel}
            </SimpleGhostBtn>
            <SimplePrimaryBtn 
              type="button" // Changed from type="submit"
              onClick={handleConfirmIssue} 
              disabled={confirming || !supervisor.trim()} // Disabled if no supervisor
            >
              {confirming ? (
                <>
                  <Spinner size="14px" /> {t.processing}
                </>
              ) : (
                <>
                  <FiCheck /> {t.confirmIssue}
                </>
              )}
            </SimplePrimaryBtn>
          </DialogActions>
        </DialogContent>
      </div>
    </DialogContainer>
  </DialogOverlay>
)}
      </Wrap>
    </LanguageContext.Provider>
  );
}
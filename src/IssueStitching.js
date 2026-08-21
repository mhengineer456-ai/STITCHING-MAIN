import React, { useMemo, useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import {
  FiSearch, FiRefreshCw, FiAlertTriangle, FiUser, FiCalendar, FiX, FiCheck,
  FiScissors, FiInfo, FiPackage, FiTag, FiGrid, FiArrowLeft, FiLoader, FiGlobe, FiUsers,
  FiShield, FiAward, FiHeart, FiCheckCircle, FiStar, FiUserCheck
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
function printableDate(isoDate) {
  if (!isoDate) return '';

  // Try to parse different date formats
  let dateObj;

  // Handle format like "1/5/2026" or "1/5/2026 17:58:25"
  if (isoDate.includes('/')) {
    const dateTimeParts = isoDate.split(' ');
    if (dateTimeParts.length > 0) {
      const datePart = dateTimeParts[0];
      const [month, day, year] = datePart.split('/').map(Number);
      dateObj = new Date(year, month - 1, day);
    }
  }

  // Fallback to standard Date parsing
  if (!dateObj || isNaN(dateObj.getTime())) {
    dateObj = new Date(isoDate);
  }

  if (isNaN(dateObj.getTime())) return String(isoDate || '');

  // Format to Indian date format (DD/MM/YYYY)
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();

  return `${day}/${month}/${year}`;
}

// Drive image helpers
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
const OLD_LOTS_SOURCE_TAB = "Sheet1";
const OLD_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMuD4XQ_kiTE59WNIY-OXwZkZzDhEuSiWy86qySeQFMrokUEy9YsoU0bBAUvbp5XNKIg/exec";
const SHEET_IDD = "18FzakygM7DVD29IRbpe68pDeCFQhFLj7t4C-XQ1MWWc";
const OLD_META_SHEET_ID = "1xD8Uy1lUgvNTQ2RGRBI4ZjOrozbinUPRq2_UfIplP98";
const OLD_META_TAB = "RAW FINAL";
const ISSUE_LOG_SHEET_ID = SHEET_ID;
const ISSUE_LOG_TAB = "Index";
const SUPERVISOR_SHEET_ID = "1iBDfsxA9XEC9nhQE-ALBYlyGRZWOaCYvWsnGfYYbr1I";
const SUPERVISOR_TAB = "StitchingSupervisors";

const CREDENTIALS_STITCHING_ISSUES_SHEET_ID = "1oxWP8aWRih1e98SYOV1qu4XlpDIF2NZdtxisX01ZtuA";
const CREDENTIALS_STITCHING_ISSUES_TAB = "Stitching Issues";

const MAX_RANGE = 'A1:Z';
const DEFAULT_SUPERVISORS = ['SONU', 'SANJAY', 'MONU', 'ROHIT', 'VINAY'];

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
    title: "Issue to Stitching job Order",
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
    step2Desc: "View the complete cutting matrix showing colors, cutting tables, sizes, and quantities. Verify all details are correct before proceeding.",
    step3: "3. Issue to Stitching",
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
    remarks: "Remarks",
    authorizedBy: "Authorized By",

    // Table
    cuttingMatrix: "Cutting Matrix",
    color: "Color",
    cuttingTable: "Cutting Table",
    totalPcs: "Total Pcs",
    total: "Total",

    // Buttons
    submitToStitching: "Submit to Stitching",
    alreadyIssued: "Already Issued",

    // Dialog
    issueToStitching: "Issue to Stitching",
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
    remarks: "टिप्पणी",
    authorizedBy: "ऑथराइज्ड व्यक्ति (Authorized By)",

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
    return cached;
  }

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

// ============================
// SUPERVISOR FETCHER FROM GOOGLE SHEET
// ============================
async function fetchSupervisorsFromSheet(signal) {
  const cacheKey = `supervisors_stitching_${SUPERVISOR_SHEET_ID}_${SUPERVISOR_TAB}`;

  // Check cache first (cache for 10 minutes)
  const cached = sheetDataCache.get(cacheKey);
  if (cached) {
    console.log('📦 Cache HIT for supervisors list');
    return cached;
  }

  console.log('🔄 Fetching stitching supervisors from Google Sheet...');

  try {
    if (!GOOGLE_API_KEY) {
      console.warn('No API key found, using default supervisors');
      return DEFAULT_SUPERVISORS;
    }

    // Fetch columns A through F (ID, Username, Password, Name, Department, Shift)
    const range = encodeURIComponent(`${SUPERVISOR_TAB}!A2:F`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SUPERVISOR_SHEET_ID}/values/${range}?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, { signal });

    if (!res.ok) {
      throw new Error(`Failed to fetch supervisors: ${res.status}`);
    }

    const data = await res.json();
    const rows = data?.values || [];

    if (!rows.length) {
      console.warn('No supervisor data found in sheet');
      return DEFAULT_SUPERVISORS;
    }

    // Column indices based on your data structure
    // A=0: ID, B=1: Username, C=2: Password, D=3: Name, E=4: Department, F=5: Shift
    const COL_NAME = 3;        // Name column (D)
    const COL_DEPARTMENT = 4;  // Department column (E)

    // Filter only supervisors with Department = "Stitching"
    const stitchingSupervisors = rows
      .filter(row => {
        const department = row[COL_DEPARTMENT] ? norm(row[COL_DEPARTMENT]) : '';
        return department.toLowerCase() === 'stitching';
      })
      .map(row => {
        const name = row[COL_NAME] ? norm(row[COL_NAME]) : '';
        return name;
      })
      .filter(name => name && name.length > 0); // Remove empty names

    if (stitchingSupervisors.length === 0) {
      console.warn('No stitching department supervisors found');
      return DEFAULT_SUPERVISORS;
    }

    // Remove duplicates and sort
    const uniqueSupervisors = [...new Set(stitchingSupervisors.map(s => s.toUpperCase()))];
    uniqueSupervisors.sort();

    console.log(`✅ Fetched ${uniqueSupervisors.length} stitching department supervisors:`, uniqueSupervisors);

    // Cache the result (10 minutes)
    sheetDataCache.set(cacheKey, uniqueSupervisors, 10 * 60 * 1000);

    return uniqueSupervisors;
  } catch (error) {
    console.error('❌ Error fetching supervisors:', error);
    return DEFAULT_SUPERVISORS; // Fallback to default list
  }
}

// ============================
// LOT ELIGIBILITY VERIFIER FROM STITCHING ISSUES SHEET
// ============================
async function checkLotEligibility(lotNo, supervisorName, signal) {
  if (!GOOGLE_API_KEY || !CREDENTIALS_STITCHING_ISSUES_SHEET_ID) {
    throw new Error('Missing API key or Credentials Sheet ID.');
  }

  const cleanLot = norm(lotNo);
  const cleanSup = norm(supervisorName).toLowerCase();

  let rows = [];
  try {
    const rangeWithTab = encodeURIComponent(`${CREDENTIALS_STITCHING_ISSUES_TAB}!A2:N`);
    rows = await fetchSheetDataCached(CREDENTIALS_STITCHING_ISSUES_SHEET_ID, rangeWithTab, signal);
  } catch (err) {
    console.warn('Failed to fetch using tab name, trying fallback range A2:N...', err);
    const rangeFallback = encodeURIComponent('A2:N');
    rows = await fetchSheetDataCached(CREDENTIALS_STITCHING_ISSUES_SHEET_ID, rangeFallback, signal);
  }

  if (!rows || rows.length === 0) {
    return { eligible: false, reason: 'no_data', message: 'No records found in Stitching Issues Sheet.' };
  }

  let lotFound = false;
  let matchedSupervisorInSheet = '';
  let matchedAuthorizedByInSheet = '';
  let matchingRow = null;

  for (const row of rows) {
    if (!row || row.length < 2) continue;

    const rowLot = norm(row[1]); // Col B: Lot Number
    const rowSupervisor = norm(row[8] || ''); // Col I: Stitching Supervisor
    const rowAuth = norm(row[13] || ''); // Col N: Authorized By

    if (rowLot === cleanLot) {
      lotFound = true;
      matchedSupervisorInSheet = rowSupervisor;
      matchedAuthorizedByInSheet = rowAuth;
      if (rowSupervisor.toLowerCase() === cleanSup) {
        matchingRow = row;
        break;
      }
    }
  }

  if (matchingRow) {
    return {
      eligible: true,
      rowData: matchingRow,
      garmentType: norm(matchingRow[2] || ''),
      fabric: norm(matchingRow[3] || ''),
      style: norm(matchingRow[4] || ''),
      brand: norm(matchingRow[5] || ''),
      season: norm(matchingRow[6] || ''),
      directStitching: norm(matchingRow[7] || ''),
      supervisor: norm(matchingRow[8] || ''),
      issueDate: norm(matchingRow[9] || ''),
      totalPcs: norm(matchingRow[10] || ''),
      partyName: norm(matchingRow[11] || ''),
      specialRemarks: norm(matchingRow[12] || ''),
      authorizedBy: norm(matchingRow[13] || '')
    };
  }

  if (lotFound) {
    return {
      eligible: false,
      reason: 'supervisor_mismatch',
      matchedSupervisor: matchedSupervisorInSheet,
      authorizedBy: matchedAuthorizedByInSheet,
      message: `Lot "${cleanLot}" is assigned to supervisor "${matchedSupervisorInSheet}" (Authorized by "${matchedAuthorizedByInSheet}"), not "${supervisorName}". Authorization denied.`
    };
  }

  return {
    eligible: false,
    reason: 'lot_not_found',
    message: `Lot "${cleanLot}" for Supervisor "${supervisorName}" is not present in the Stitching Issues Sheet.`
  };
}

async function fetchAuthorizedPersonForLot(lotNo, signal) {
  if (!GOOGLE_API_KEY || !CREDENTIALS_STITCHING_ISSUES_SHEET_ID || !norm(lotNo)) return null;
  const cleanLot = norm(lotNo);
  try {
    const rangeWithTab = encodeURIComponent(`${CREDENTIALS_STITCHING_ISSUES_TAB}!A2:N`);
    let rows = [];
    try {
      rows = await fetchSheetDataCached(CREDENTIALS_STITCHING_ISSUES_SHEET_ID, rangeWithTab, signal);
    } catch (e) {
      const rangeFallback = encodeURIComponent('A2:N');
      rows = await fetchSheetDataCached(CREDENTIALS_STITCHING_ISSUES_SHEET_ID, rangeFallback, signal).catch(() => []);
    }
    if (!rows || !rows.length) return null;
    for (const row of rows) {
      if (!row || row.length < 2) continue;
      if (norm(row[1]) === cleanLot) {
        return {
          lotNo: cleanLot,
          garmentType: norm(row[2] || ''),
          fabric: norm(row[3] || ''),
          style: norm(row[4] || ''),
          brand: norm(row[5] || ''),
          season: norm(row[6] || ''),
          directStitching: norm(row[7] || ''),
          supervisor: norm(row[8] || ''),
          issueDate: norm(row[9] || ''),
          totalPcs: norm(row[10] || ''),
          partyName: norm(row[11] || ''),
          specialRemarks: norm(row[12] || ''),
          authorizedBy: norm(row[13] || '')
        };
      }
    }
  } catch (err) {
    console.warn('Error fetching authorized person for lot:', err);
  }
  return null;
}

async function isLotAlreadyIssued(lotNo, signal) {
  const cacheKey = generateIssueStatusCacheKey(lotNo);

  const cached = issueStatusCache.get(cacheKey);
  if (cached !== undefined && cached !== null) {
    console.log('📦 Cache HIT for issue status:', lotNo, '->', cached);
    return cached;
  }

  console.log('🔄 Cache MISS for issue status:', lotNo);

  if (!GOOGLE_API_KEY || !ISSUE_LOG_SHEET_ID) {
    console.log('❌ Missing API key or Sheet ID');
    issueStatusCache.set(cacheKey, false);
    return false;
  }

  const range = encodeURIComponent(`${ISSUE_LOG_TAB}!A2:L`);

  try {
    console.log('📊 Fetching Index sheet data...');
    const rows = await fetchSheetDataCached(ISSUE_LOG_SHEET_ID, range, signal);
    console.log('📊 Index sheet rows count:', rows.length);

    const COL_LOT = 0;
    const COL_DOI = 10;
    const COL_SUPERVISOR = 11;

    let foundLot = false;
    let isIssued = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const rowLotNo = norm(row[COL_LOT]);
      const dateValue = norm(row[COL_DOI] || '');
      const supervisorValue = norm(row[COL_SUPERVISOR] || '');

      if (rowLotNo === norm(lotNo)) {
        foundLot = true;
        isIssued = dateValue !== "" || supervisorValue !== "";
        break;
      }
    }

    if (!foundLot) {
      console.log('❌ Lot not found in Index sheet:', lotNo);
      isIssued = false;
    }

    console.log(`📝 Final result for ${lotNo}: isIssued =`, isIssued);
    issueStatusCache.set(cacheKey, isIssued);

    return isIssued;
  } catch (error) {
    console.warn('❌ Error checking issue status:', error);
    issueStatusCache.set(cacheKey, false);
    return false;
  }
}

async function fetchPendingLotsForSupervisor(supervisor, signal, currentLotNumber = null) {
  if (!GOOGLE_API_KEY || !ISSUE_LOG_SHEET_ID) {
    return {
      pendingLots: 0,
      pendingPcs: 0,
      garmentTypeSummary: [],
      zipOrderDate: ''
    };
  }

  const range = encodeURIComponent(`${ISSUE_LOG_TAB}!A1:AZ`);

  try {
    const rows = await fetchSheetDataCached(ISSUE_LOG_SHEET_ID, range, signal);

    if (!rows || rows.length < 2) {
      return {
        pendingLots: 0,
        pendingPcs: 0,
        garmentTypeSummary: [],
        zipOrderDate: ''
      };
    }

    const COLUMN_INDICES = {
      LOT_NUMBER: 0,
      SUPERVISOR: 11,
      DATE_OF_ISSUE: 10,
      GARMENT_TYPE: 5,
      TOTAL_PCS: 26,
      STATUS: 21,
      FABRIC: 4,
      STYLE: 6,
      ZIP_ORDER_DATE: 18
    };

    const firstRow = rows[0] || [];
    const hasHeaderWords = firstRow.some(cell =>
      includes(cell, 'lot') || includes(cell, 'supervisor') || includes(cell, 'date')
    );

    const startRow = hasHeaderWords ? 1 : 0;
    let pendingLots = 0;
    let pendingPcs = 0;
    const garmentTypeMap = new Map();
    let zipOrderDateForCurrentLot = '';

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i] || [];

      if (row.length < 19) continue;

      const supervisorRaw = row[COLUMN_INDICES.SUPERVISOR] || '';
      const supervisorNormalized = norm(supervisorRaw).toLowerCase().trim();
      const dateOfIssue = row[COLUMN_INDICES.DATE_OF_ISSUE] ? norm(row[COLUMN_INDICES.DATE_OF_ISSUE]) : '';
      const lotNumber = row[COLUMN_INDICES.LOT_NUMBER] ? norm(row[COLUMN_INDICES.LOT_NUMBER]) : '';
      const garmentType = row[COLUMN_INDICES.GARMENT_TYPE] ? norm(row[COLUMN_INDICES.GARMENT_TYPE]) : '';
      const totalPcsRaw = row[COLUMN_INDICES.TOTAL_PCS] || '';
      const statusRaw = row[COLUMN_INDICES.STATUS] || '';
      const zipOrderDateRaw = row[COLUMN_INDICES.ZIP_ORDER_DATE] || '';

      if (currentLotNumber && norm(lotNumber) === norm(currentLotNumber)) {
        if (zipOrderDateRaw && zipOrderDateRaw.trim() !== '') {
          const zipDateString = norm(zipOrderDateRaw);
          const dateParts = zipDateString.split(' ');
          zipOrderDateForCurrentLot = dateParts[0];
        }
      }

      const supervisorMatches = supervisorNormalized === norm(supervisor).toLowerCase().trim();

      if (supervisorMatches && dateOfIssue) {
        let totalPcs = 0;
        if (totalPcsRaw && totalPcsRaw !== '') {
          const cleaned = String(totalPcsRaw).replace(/[^\d.]/g, '');
          totalPcs = parseFloat(cleaned) || 0;
        }

        let isCompleted = false;
        if (statusRaw) {
          const statusNormalized = norm(statusRaw).toLowerCase();
          isCompleted = statusNormalized.includes('complete') ||
            statusNormalized.includes('completed');
        }

        if (!isCompleted) {
          pendingLots++;
          pendingPcs += totalPcs;

          if (garmentType && garmentType.trim() !== '') {
            const key = garmentType.toUpperCase().trim();
            if (!garmentTypeMap.has(key)) {
              garmentTypeMap.set(key, {
                garmentType: key,
                pendingLots: 0,
                pendingPcs: 0
              });
            }
            const data = garmentTypeMap.get(key);
            data.pendingLots++;
            data.pendingPcs += totalPcs;
          }
        }
      }
    }

    const garmentTypeSummary = Array.from(garmentTypeMap.values())
      .sort((a, b) => b.pendingLots - a.pendingLots);

    return {
      pendingLots,
      pendingPcs,
      garmentTypeSummary,
      zipOrderDate: zipOrderDateForCurrentLot
    };

  } catch (error) {
    console.error('❌ Error in fetchPendingLotsForSupervisor:', error);
    return {
      pendingLots: 0,
      pendingPcs: 0,
      garmentTypeSummary: [],
      zipOrderDate: ''
    };
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
  const range = encodeURIComponent('Index!A1:AZ');

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
      parsedAlt.remarks = lotInfo.remarks || '';
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
  item: new Set([
    'item name', 'item', 'item description', 'style', 'style name', 'article', 'article name', 'itemname'
  ]),
  shade: new Set([
    'shade name', 'shade', 'colour', 'color', 'color name', 'shade colour', 'shade color', 'colour name'
  ]),
  qty: new Set([
    'quantity', 'qty', 'pcs', 'qty pcs', 'qtypcs', 'qty pcs', 'qtypcs', 'qty (pcs)', 'qtypcs',
    'issue qty', 'issue quantity', 'total qty', 'total quantity', 'qtypiece', 'pcs qty', 'pcsqty'
  ]),
  lot: new Set([
    'issue lot number', 'lot', 'lot number', 'issued lot', 'issue lot no', 'issue lot no.', 'lotno'
  ]),
  pack: new Set([
    'pack size', 'pack / size', 'pack/size', 'pack', 'size', 'packet size', 'sizes'
  ]),
  cutting: new Set([
    'cutting table', 'cutting', 'ct',
    'issue supplier/worker name', 'supplier/worker name', 'supplier/worker',
    'issue supplier', 'supplier', 'worker', 'karigar', 'issue karigar'
  ])
};

function isMostlyNumeric(colValues) {
  let numeric = 0, total = 0;
  for (const v of colValues) {
    const t = norm(v);
    if (!t) continue;
    total++;
    const n = parseFloat(t.replace(/[, ]/g, ''));
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
        const avgLen = vals.reduce((a, s) => a + s.length, 0) / vals.length;
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
    console.log('🔄 [OLD LOT] Searching for lot:', lotNo);

    const url = new URL(OLD_APPS_SCRIPT_URL);
    url.searchParams.append('lot', lotNo);
    url.searchParams.append('action', 'getLotData');

    const searchTime = new Date().toISOString();
    url.searchParams.append('searchTime', searchTime);
    url.searchParams.append('source', 'issue_stitching_app');

    fetch(url, {
      signal,
      mode: 'no-cors'
    }).then(() => {
      console.log('✅ [OLD LOT] Search logged to Apps Script');
    }).catch(err => {
      console.warn('⚠️ [OLD LOT] Search log failed:', err.message);
    });

  } catch (appsScriptError) {
    console.warn('⚠️ [OLD LOT] Apps Script call failed:', appsScriptError.message);
  }

  console.log('🔄 [OLD LOT] Fetching data from Sheets API...');

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
    const qty = t ? parseFloat(t.replace(/[, ]/g, '')) : 0;
    shadeSum.set(shade, (shadeSum.get(shade) ?? 0) + (Number.isFinite(qty) ? qty : 0));
    if (!firstItem) firstItem = norm(r[map.item]);
    if (cuttingIdx !== -1) {
      const prev = shadeCutting.get(shade) || [];
      prev.push(r[cuttingIdx]);
      shadeCutting.set(shade, prev);
    }
  }

  const rowsOut = Array.from(shadeSum.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
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

  console.log('💾 [OLD LOT] Data ready for display and future issue');

  return {
    source: 'old',
    lotNumber: lot4,
    garmentType: meta.garmentType || '',
    style: meta.style || firstItem.replace(/\b(\d{4})\b/, '').trim(),
    fabric: meta.fabric || '',
    category: meta.category || '',
    imageUrl: '',
    sizes: [],
    rows: rowsOut,
    totals: { perSize: {}, grand: rowsOut.reduce((s, r) => s + (r.totalPcs || 0), 0) },

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

// ============================
// Cutting parsers
// ============================
function parseMatrixWithIndexInfo(rows, lotInfo) {
  console.log('Parsing with index info:', lotInfo);

  let lotNumber = lotInfo.lotNumber;
  let style = lotInfo.style || '';
  let fabric = lotInfo.fabric || '';
  let garmentType = lotInfo.garmentType || '';
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
    garmentType,
    imageUrl: lotInfo.imageUrl || '',
    remarks: lotInfo.remarks || '',
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

  const dateOfIssueCol = headers.findIndex(h => includes(h, 'date of issue'));
  const supervisorCol = headers.findIndex(h => includes(h, 'supervisor'));

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
      const isAlreadyIssued = hasDateOfIssue || hasSupervisor;

      // REMARKS COLUMN logic:
      const remarksCol = headers.findIndex(h => includes(h, 'remarks') || includes(h, 'remark'));
      const finalRemarksCol = remarksCol !== -1 ? remarksCol : 29; // AD column is index 29 (0-indexed)
      const remarks = row[finalRemarksCol] !== undefined ? norm(row[finalRemarksCol]) : '';

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
        dateOfIssue: dateOfIssueCol !== -1 ? norm(row[dateOfIssueCol]) : '',
        supervisor: supervisorCol !== -1 ? norm(row[supervisorCol]) : '',
        remarks: remarks,
        isAlreadyIssued: isAlreadyIssued
      };
    }
  }

  return null;
}

// ============================
async function generateIssuePdf(matrix, {
  issueDate,
  supervisor,
  authorizedBy = '',
  manpower = '0',
  pendingLots = 0,
  pendingPcs = 0,
  garmentTypeSummary = [],
  zipOrderDate = ''
}) {
  if (!matrix) return;

  const sizesRaw = (matrix.source === 'old' ? Array(5).fill('') : (matrix.sizes || []));
  const sizes = sizesRaw.map(s => (s == null || s === 0 || s === '0') ? '' : String(s));
  const orientation = (sizes.length + 7) > 12 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'A4' });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const M = 18;
  const borderPad = 6;
  const line = 0.9;

  doc.setDrawColor(0); doc.setTextColor(0); doc.setLineWidth(line);

  async function addHeader(currentPage) {
    const borderX = 8, borderY = 8, borderW = W - 16, borderH = H - 16;

    if (currentPage === 1) {
      doc.rect(borderX, borderY, borderW, borderH);
    }

    const CM = M + borderPad;
    const headerTop = CM + 12;
    const contentWidth = W - (CM * 2);

    const minSectionW = 120;
    let sectionW = Math.floor(contentWidth / 3);
    if (sectionW < minSectionW) sectionW = minSectionW;
    if (sectionW * 3 > contentWidth) sectionW = Math.floor(contentWidth / 3);

    const s1X = CM;
    const s2X = s1X + sectionW;
    const s3X = s2X + sectionW;
    const sectionH = 80;

    if (currentPage === 1) {
      doc.setLineWidth(0.9);
      doc.rect(CM, headerTop - 6, sectionW * 3, sectionH + 12);
      doc.setLineWidth(0.6);
      doc.rect(s1X, headerTop, sectionW, sectionH);
      doc.rect(s2X, headerTop, sectionW, sectionH);
      doc.rect(s3X, headerTop, sectionW, sectionH);

      doc.setFont('times', 'bold');
      doc.setFontSize(14);
      let headingY = headerTop - 10;
      if (headingY < borderY + 12) headingY = borderY + 12;
      doc.text('Stitching JobOrder', borderX + borderW / 2, headingY, { align: 'center' });
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

    if (currentPage === 1) {
      const s1InnerX = s1X + 6;
      let s1Y = headerTop + 16;

      printLabelValue('Date', printableDate(issueDate), s1InnerX, s1Y);

      s1Y += 16;
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

      s1Y += 16;
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

      s1Y += 16;
      const remarksText = String(matrix.remarks || '');
      const availableRemarksW = sectionW - (s1InnerX - s1X) - doc.getTextWidth('Remarks') - 12;
      let remarksToPrint = remarksText;
      if (doc.getTextWidth(remarksText) > availableRemarksW) {
        while (remarksToPrint.length && doc.getTextWidth(remarksToPrint + '…') > availableRemarksW) {
          remarksToPrint = remarksToPrint.slice(0, -1);
        }
        remarksToPrint += '…';
      }
      printLabelValue('Remarks', remarksToPrint, s1InnerX, s1Y);
    }

    if (currentPage === 1) {
      const s2InnerX = s2X + 6;
      let s2Y = headerTop + 16;

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

      s2Y += 16;
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

      s2Y += 16;
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

      s2Y += 16;
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      const authLabel = 'Authorized By:';
      doc.text(authLabel, s2InnerX, s2Y);
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      const authText = (authorizedBy || matrix?.authorizedBy || '').trim() || '________';
      const authLabelW = doc.getTextWidth(authLabel);
      const authAvailableW = sectionW - (s2InnerX - s2X) - authLabelW - 12;
      let authToPrint = authText;
      if (doc.getTextWidth(authText) > authAvailableW) {
        while (authToPrint.length && doc.getTextWidth(authToPrint + '…') > authAvailableW) {
          authToPrint = authToPrint.slice(0, -1);
        }
        authToPrint += '…';
      }
      doc.text(authToPrint, s2InnerX + authLabelW + 4, s2Y);
    }

    if (currentPage === 1) {
      const s3InnerX = s3X + 6;
      let s3Y = headerTop + 16;

      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text('Quality Approved Signature', s3InnerX, s3Y);

      s3Y += 20;
      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      doc.text('Name:', s3InnerX, s3Y);

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      const nameLineY = s3Y + 2;
      doc.line(s3InnerX + 30, nameLineY, s3X + sectionW - 6, nameLineY);

      s3Y += 16;
      doc.text('Sign:', s3InnerX, s3Y);

      const signLineY = s3Y + 2;
      doc.line(s3InnerX + 30, signLineY, s3X + sectionW - 6, signLineY);

      s3Y += 16;
      doc.text('Date:', s3InnerX, s3Y);

      const dateLineY = s3Y + 2;
      doc.line(s3InnerX + 30, dateLineY, s3X + sectionW - 6, dateLineY);
    }

    return {
      headerBottomY: headerTop + sectionH + 6,
      CM
    };
  }

  // Calculate CM without calling addHeader
  const CM = M + borderPad;
  const tableTop = CM + 12 + 80 + 6 + 8; // headerTop (CM+12) + sectionH (80) + 6 + 8

  const head = [['M.No', 'KARIGAR', 'C.table', 'COLOR', ...sizes, 'PCS', 'BACK', 'FRONT', 'PACKING']];

  const body = (matrix.rows || []).map((r) => ([
    valOrEmpty(r.mNo ?? ''),
    '',
    valOrEmpty(r.cuttingTable),
    valOrEmpty(r.color),
    ...(matrix.source === 'old'
      ? Array(sizes.length).fill('')
      : sizes.map(s => valOrEmpty(r.sizes?.[s]))
    ),
    valOrEmpty(r.totalPcs),
    valOrEmpty(r.back ?? ''),
    valOrEmpty(r.front ?? ''),
    valOrEmpty(r.packing ?? '')
  ]));

  const foot = [[
    '',
    '',
    '—',
    'TOTAL',
    ...sizes.map(s => valOrEmpty(matrix.totals?.perSize?.[s] ?? 0)),
    valOrEmpty(matrix.totals?.grand),
    '',
    '',
    ''
  ]];

  const CM2 = CM;
  const available = W - (CM2 * 2);

  const fixedW = {
    mno: 40,
    kaigar: 85,
    table: 45,
    color: 70,
    pcs: 45,
    back: 45,
    front: 45,
    packing: 60
  };
  const fixedSum = Object.values(fixedW).reduce((a, b) => a + b, 0);

  const sizesCount = sizes.length;
  const desiredSizeW = 12;
  let sizeW = 0;
  if (sizesCount) {
    const candidate = Math.floor((available - fixedSum) / sizesCount);
    sizeW = candidate > desiredSizeW ? candidate : desiredSizeW;
  }

  const idxMno = 0;
  const idxKaigar = 1;
  const idxTable = 2;
  const idxColor = 3;
  const idxFirstSize = 4;
  const idxPcs = idxFirstSize + sizesCount;
  const idxBack = idxPcs + 1;
  const idxFront = idxBack + 1;
  const idxPacking = idxFront + 1;

  const colStyles = {
    [idxMno]: { halign: 'center', cellWidth: fixedW.mno, overflow: 'linebreak' },
    [idxKaigar]: { halign: 'left', cellWidth: fixedW.kaigar, overflow: 'linebreak' },
    [idxTable]: { halign: 'center', cellWidth: fixedW.table, overflow: 'linebreak' },
    [idxColor]: { halign: 'left', cellWidth: fixedW.color, overflow: 'linebreak' },
    [idxPcs]: { halign: 'center', cellWidth: fixedW.pcs, overflow: 'linebreak' },
    [idxBack]: { halign: 'center', cellWidth: fixedW.back, overflow: 'linebreak' },
    [idxFront]: { halign: 'center', cellWidth: fixedW.front, overflow: 'linebreak' },
    [idxPacking]: { halign: 'center', cellWidth: fixedW.packing, overflow: 'linebreak' },
  };
  for (let i = 0; i < sizesCount; i++) {
    colStyles[idxFirstSize + i] = { halign: 'center', cellWidth: sizeW, overflow: 'linebreak' };
  }

  const tableConfig = {
    head,
    body,
    foot,
    startY: tableTop,
    theme: 'grid',
    tableWidth: available,
    styles: {
      font: 'times',
      fontSize: 8,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: line,
      cellPadding: 3,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'center'
    },
    bodyStyles: { fillColor: null },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center'
    },
    columnStyles: colStyles,
    margin: { left: CM2, right: CM2 },
    didDrawPage: async function (data) {
      await addHeader(data.pageNumber);

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

  const afterTableY = doc.lastAutoTable ? (doc.lastAutoTable.finalY + 16) : (tableTop + 200);
  const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
  const totalPages = doc.internal.getNumberOfPages();

  if (currentPage === totalPages && afterTableY < H - 200) {
    await drawBottomSections(doc, afterTableY, W, H, CM2, matrix, {
      issueDate,
      supervisor,
      authorizedBy,
      manpower,
      pendingLots,
      pendingPcs,
      garmentTypeSummary,
      zipOrderDate
    });
  }

  const fname = `Lot_${matrix.lotNumber || 'Unknown'}_Issue_${(issueDate || '').replace(/-/g, '')}.pdf`;
  doc.save(fname);
}

async function drawBottomSections(doc, afterTableY, W, H, CM2, matrix, {
  issueDate = '',
  supervisor = '',
  authorizedBy = '',
  manpower = '0',
  pendingLots = 0,
  pendingPcs = 0,
  garmentTypeSummary = [],
  zipOrderDate = ''
}) {
  const authorizerRaw = (authorizedBy || matrix?.authorizedBy || 'Pintu').trim();
  const authorizerUpper = (authorizerRaw || 'PINTU').toUpperCase();
  const authorizerDisplay = titleCase(authorizerRaw || 'Pintu');

  const leftBoxH = 150;
  const leftBoxX = CM2;
  const leftBoxY = afterTableY;
  const leftBoxW = (W - CM2 * 3) * 0.35;

  const imageBoxW = (W - CM2 * 3) * 0.35;
  const imageBoxX = leftBoxX + leftBoxW + 15;
  const imageBoxY = leftBoxY;
  const imageBoxH = leftBoxH;

  const garmentSummaryBoxW = (W - CM2 * 3) * 0.30;
  const garmentSummaryBoxX = imageBoxX + imageBoxW + 15;
  const garmentSummaryBoxY = leftBoxY;
  const garmentSummaryBoxH = leftBoxH;

  doc.rect(leftBoxX, leftBoxY, leftBoxW, leftBoxH);

  const checklistRows = ['Brand', 'EMB Recd', 'Printing Recd', 'Zip Recd', 'Dori Recd', 'Label', 'Any Other'];
  const headerH2 = 22;
  const rowH = (leftBoxH - headerH2) / checklistRows.length;

  const dateColW = 50;
  doc.line(leftBoxX + dateColW, leftBoxY, leftBoxX + dateColW, leftBoxY + leftBoxH);
  doc.line(leftBoxX, leftBoxY + headerH2, leftBoxX + leftBoxW, leftBoxY + headerH2);

  doc.setFont('times', 'bold'); doc.setFontSize(9);
  doc.text('DATE', leftBoxX + 6, leftBoxY + headerH2 / 2 + 4);

  doc.setFont('times', 'normal'); doc.setFontSize(8);
  for (let i = 0; i < checklistRows.length; i++) {
    const yy = leftBoxY + headerH2 + i * rowH;
    doc.line(leftBoxX, yy + rowH, leftBoxX + leftBoxW, yy + rowH);
    doc.text(checklistRows[i], leftBoxX + dateColW + 4, yy + rowH / 2 + 4);
  }

  const canShowImage = matrix.source !== 'old' && !!matrix.imageUrl;
  if (canShowImage) {
    const fileId = extractDriveId(matrix.imageUrl);
    if (fileId) {
      const urls = candidateDriveImageUrls(fileId);
      try {
        const img = await loadImageForPdf(urls);

        doc.rect(imageBoxX, imageBoxY, imageBoxW, imageBoxH);

        const pad = 6;
        const maxW = imageBoxW - pad * 2;
        const maxH = imageBoxH - pad * 2;

        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;

        let drawW = Math.min(maxW, naturalW);
        let drawH = naturalH * (drawW / naturalW);
        if (drawH > maxH) {
          drawH = maxH;
          drawW = naturalW * (drawH / naturalH);
        }

        const imgX = imageBoxX + (imageBoxW - drawW) / 2;
        const imgY = imageBoxY + (imageBoxH - drawH) / 2;

        doc.addImage(img, 'JPEG', imgX, imgY, drawW, drawH);
      } catch (err) {
        doc.rect(imageBoxX, imageBoxY, imageBoxW, imageBoxH);
        doc.setFont('times', 'bold'); doc.setFontSize(9);
        doc.text('Image failed', imageBoxX + 8, imageBoxY + 18);
        doc.setFont('times', 'normal'); doc.setFontSize(7);
        doc.text(String(matrix.imageUrl || ''), imageBoxX + 8, imageBoxY + 32, { maxWidth: imageBoxW - 16 });
      }
    } else {
      doc.rect(imageBoxX, imageBoxY, imageBoxW, imageBoxH);
      doc.setFont('times', 'bold'); doc.setFontSize(9);
      doc.text('Invalid URL', imageBoxX + 8, imageBoxY + 18);
      doc.setFont('times', 'normal'); doc.setFontSize(7);
      doc.text(String(matrix.imageUrl || ''), imageBoxX + 8, imageBoxY + 32, { maxWidth: imageBoxW - 16 });
    }
  } else {
    doc.rect(imageBoxX, imageBoxY, imageBoxW, imageBoxH);
    doc.setFont('times', 'italic'); doc.setFontSize(8);
    doc.text('No image', imageBoxX + 8, imageBoxY + 20);
  }

  doc.rect(garmentSummaryBoxX, garmentSummaryBoxY, garmentSummaryBoxW, garmentSummaryBoxH);

  doc.setFont('times', 'bold');
  doc.setFontSize(9);
  doc.text('GARMENT TYPE SUMMARY', garmentSummaryBoxX + garmentSummaryBoxW / 2, garmentSummaryBoxY + 14, { align: 'center' });

  doc.setFont('times', 'bold');
  doc.setFontSize(8);
  const totalPendingY = garmentSummaryBoxY + 30;
  doc.text(`Total Pending Lots: ${pendingLots}`, garmentSummaryBoxX + 8, totalPendingY);

  const totalPcsY = totalPendingY + 8;
  doc.text(`Total Pending Pcs: ${pendingPcs.toLocaleString()}`, garmentSummaryBoxX + 8, totalPcsY);

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  const separatorY = totalPcsY + 10;
  doc.line(garmentSummaryBoxX + 8, separatorY, garmentSummaryBoxX + garmentSummaryBoxW - 8, separatorY);

  doc.setFont('times', 'bold');
  doc.setFontSize(7);
  const breakdownY = separatorY + 8;
  doc.text('Breakdown by Garment Type:', garmentSummaryBoxX + 8, breakdownY);

  if (garmentTypeSummary.length > 0) {
    doc.setFont('times', 'normal');
    doc.setFontSize(7);

    const startX = garmentSummaryBoxX + 8;
    let yPos = breakdownY + 12;
    const lineHeight = 10;
    const itemSpacing = 2;

    const sortedTypes = [...garmentTypeSummary].sort((a, b) => b.pendingLots - a.pendingLots);
    const typesToShow = sortedTypes.slice(0, 4);

    const typeColWidth = 60;
    const lotsColWidth = 25;
    const pcsColWidth = 35;

    for (const type of typesToShow) {
      let typeName = type.garmentType;
      const maxTypeChars = 15;

      if (typeName.length > maxTypeChars) {
        typeName = typeName.substring(0, maxTypeChars - 1) + "…";
      }

      const lotsText = `${type.pendingLots} lots`;
      const pcsText = `(${type.pendingPcs.toLocaleString()})`;

      doc.text(typeName, startX, yPos);
      doc.text(lotsText, startX + typeColWidth, yPos);
      doc.text(pcsText, startX + typeColWidth + lotsColWidth, yPos);

      yPos += lineHeight + itemSpacing;
    }

    const remainingTypes = garmentTypeSummary.length - typesToShow.length;
    if (remainingTypes > 0) {
      doc.setFont('times', 'italic');
      doc.setFontSize(5.5);
      const otherPcs = sortedTypes.slice(4).reduce((sum, type) => sum + type.pendingPcs, 0);
      doc.text(`+${remainingTypes} more types (${otherPcs.toLocaleString()} pcs)`, garmentSummaryBoxX + 8, yPos + 2);
    }
  } else {
    doc.setFont('times', 'italic');
    doc.setFontSize(6);
    const noTypesY = breakdownY + 12;
    doc.text('No pending lots for this supervisor', garmentSummaryBoxX + 8, noTypesY);
  }

  function drawStickers() {
    const availableWidth = W - (CM2 * 2);
    const cardGap = 10;
    const totalGaps = cardGap * 3;
    const cardHeight = 70;

    const cardWidth = (availableWidth - totalGaps) / 4;
    const startX = CM2;
    const sigBoxY = H - 140;
    const stickerY = sigBoxY - cardHeight - 8;

    const zipBoxWidth = cardWidth;
    const baseZipBoxHeight = 40;
    const zipBoxX = startX;

    // Calculate remarks lines to determine height dynamically
    const remarksBoxX = zipBoxX + zipBoxWidth + cardGap;
    const remarksBoxW = availableWidth - zipBoxWidth - cardGap;
    const maxRemarksWidth = remarksBoxW - 12;
    const remarksText = String(matrix.remarks || '');
    const remarksLines = remarksText ? doc.splitTextToSize(remarksText, maxRemarksWidth) : [];

    const requiredRemarksH = remarksText ? (18 + remarksLines.length * 10) : baseZipBoxHeight;
    const zipBoxHeight = Math.max(baseZipBoxHeight, requiredRemarksH);
    const zipBoxY = stickerY - zipBoxHeight - 10;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.7);
    doc.rect(zipBoxX, zipBoxY, zipBoxWidth, zipBoxHeight);

    doc.setFont('times', 'bold');
    doc.setFontSize(9);
    doc.text('ZIP ORDER DATE', zipBoxX + zipBoxWidth / 2, zipBoxY + 12, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    const lineY = zipBoxY + 16;
    doc.line(zipBoxX + 10, lineY, zipBoxX + zipBoxWidth - 10, lineY);

    if (zipOrderDate && zipOrderDate.trim() !== '') {
      const formattedDate = printableDate(zipOrderDate);
      doc.setFont('times', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      const dateX = zipBoxX + zipBoxWidth / 2;
      const dateY = zipBoxY + zipBoxHeight / 2 + 5;
      doc.text(formattedDate, dateX, dateY, { align: 'center' });
    } else {
      doc.setFont('times', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(156, 163, 175);
      const noDateX = zipBoxX + zipBoxWidth / 2;
      const noDateY = zipBoxY + zipBoxHeight / 2 + 5;
      doc.text('__________', noDateX, noDateY, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }

    const remarksBoxY = zipBoxY;
    const remarksBoxH = zipBoxHeight;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.7);
    doc.rect(remarksBoxX, remarksBoxY, remarksBoxW, remarksBoxH);

    doc.setFont('times', 'bold');
    doc.setFontSize(8);
    doc.text('SPECIAL REMARKS', remarksBoxX + 6, remarksBoxY + 12);

    if (remarksText) {
      doc.setFont('times', 'normal');
      doc.setFontSize(8);
      const textX = remarksBoxX + 6;
      const textY = remarksBoxY + 23;
      doc.text(remarksLines, textX, textY);
    }

    function drawCard(x, y, width, height, title) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.7);
      doc.rect(x, y, width, height, 'FD');

      const headerHeight = 20;
      doc.setFillColor(255, 255, 255);
      doc.rect(x, y, width, headerHeight, 'F');

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.6);
      doc.line(x, y + headerHeight, x + width, y + headerHeight);

      doc.setFont('times', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      doc.text(title, x + width / 2, y + headerHeight / 2 + 3, { align: 'center', baseline: 'middle' });

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.6);
      doc.line(x, y, x + width, y);

      return headerHeight;
    }

    const manpowerX = startX;
    const manpowerHeaderH = drawCard(manpowerX, stickerY, cardWidth, cardHeight, 'MANPOWER');

    doc.setFont('times', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    const manpowerValue = String(manpower || '0');
    doc.text(manpowerValue, manpowerX + cardWidth / 2, stickerY + manpowerHeaderH + (cardHeight - manpowerHeaderH) / 2 - 5, { align: 'center', baseline: 'middle' });

    doc.setFont('times', 'normal');
    doc.setFontSize(7);
    doc.text('Total Workers', manpowerX + cardWidth / 2, stickerY + cardHeight - 10, { align: 'center' });

    const stitchX = manpowerX + cardWidth + cardGap;
    const stitchHeaderH = drawCard(stitchX, stickerY, cardWidth, cardHeight, 'STITCHING INSPECTION');

    const pad = 8;
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    const checkedY = stickerY + stitchHeaderH + 12;
    doc.text('CHECKED BY PINTU SIR', stitchX + cardWidth / 2, checkedY, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    const lineY2 = checkedY + 6;
    doc.line(stitchX + pad, lineY2, stitchX + cardWidth - pad, lineY2);

    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    const sigLabelY = stickerY + cardHeight - 10;
    doc.text('Pintu Sir', stitchX + cardWidth - pad, sigLabelY, { align: 'right' });

    const workSummaryX = stitchX + cardWidth + cardGap;
    const workHeaderH = drawCard(workSummaryX, stickerY, cardWidth, cardHeight, 'WORK SUMMARY');

    doc.setFont('times', 'bold');
    doc.setFontSize(9);
    const pendingLotsLabelY = stickerY + workHeaderH + 10;
    doc.text('PENDING LOTS:', workSummaryX + pad, pendingLotsLabelY);

    doc.setFont('times', 'bold');
    doc.setFontSize(8);
    const pendingLotsStr = String(pendingLots || 0);
    doc.text(pendingLotsStr, workSummaryX + cardWidth - pad, pendingLotsLabelY, { align: 'right' });

    doc.setFont('times', 'bold');
    doc.setFontSize(8);
    const pendingPcsLabelY = pendingLotsLabelY + 14;
    doc.text('PENDING PCS:', workSummaryX + pad, pendingPcsLabelY);

    let pcsFontSize = 8;
    const pendingPcsStr = String(pendingPcs || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (pendingPcsStr.length > 8) pcsFontSize = 11;
    if (pendingPcsStr.length > 10) pcsFontSize = 10;

    doc.setFont('times', 'bold');
    doc.setFontSize(pcsFontSize);
    doc.text(pendingPcsStr, workSummaryX + cardWidth - pad, pendingPcsLabelY, { align: 'right' });

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    const separatorY2 = pendingLotsLabelY + 6;
    doc.line(workSummaryX + pad, separatorY2, workSummaryX + cardWidth - pad, separatorY2);

    const packingX = workSummaryX + cardWidth + cardGap;
    const packingHeaderH = drawCard(packingX, stickerY, cardWidth, cardHeight, 'PACKING PERSON');

    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    const nameLabelY = stickerY + packingHeaderH + 8;
    doc.text('NAME', packingX + cardWidth / 2, nameLabelY, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    const nameLineY = nameLabelY + 4;
    doc.line(packingX + pad, nameLineY, packingX + cardWidth - pad, nameLineY);

    doc.setFont('times', 'normal');
    doc.setFontSize(8);
    const nameFieldY = nameLineY + 8;
    doc.text('Name:', packingX + pad, nameFieldY);

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.);
    const nameUnderlineY = nameFieldY + 1;
    doc.line(packingX + pad + 20, nameUnderlineY, packingX + cardWidth - pad, nameUnderlineY);

    const signFieldY = nameFieldY + 8;
    doc.text('Sign:', packingX + pad, signFieldY);

    const signUnderlineY = signFieldY + 1;
    doc.line(packingX + pad + 20, signUnderlineY, packingX + cardWidth - pad, signUnderlineY);
  }

  drawStickers();

  const sig1W = 150;
  const sig2W = 120;
  const sig3W = 180;
  const sigGap = 12;
  const totalSigW = sig1W + sig2W + sig3W + 2 * sigGap;
  const sigStartX = (W - totalSigW) / 2;
  const sigBoxH = 54;
  const sigBoxY = H - 140;

  function drawPintuSigBox(x, y, w, h) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.8);
    doc.rect(x, y, w, h);

    doc.setFont('times', 'bold');
    doc.setFontSize(9);
    doc.text(`Lot Allotment & Issue by ${authorizerDisplay}`, x + w / 2, y + 11, { align: 'center' });

    doc.setLineWidth(0.4);
    doc.line(x + 5, y + 14, x + w - 5, y + 14);

    const sigLineY = y + 29;
    doc.setLineWidth(0.5);
    doc.line(x + 10, sigLineY, x + w - 10, sigLineY);

    doc.setFont('times', 'italic');
    doc.setFontSize(7.5);
    doc.text(`${authorizerDisplay} Signature`, x + w / 2, sigLineY + 8, { align: 'center' });

    doc.setFont('times', 'bold');
    doc.setFontSize(8);
    const displayPintuDate = printableDate(issueDate) || printableDate(todayLocalISO());
    doc.text(`${authorizerDisplay} Issue Date: ${displayPintuDate}`, x + w / 2, y + h - 4, { align: 'center' });

    try {
      const stampCanvas = document.createElement('canvas');
      stampCanvas.width = 220;
      stampCanvas.height = 220;
      const sCtx = stampCanvas.getContext('2d');
      sCtx.clearRect(0, 0, 220, 220);

      sCtx.save();
      sCtx.translate(110, 110);
      sCtx.rotate((-8 * Math.PI) / 180);

      const inkColor = '#0f172a';
      sCtx.strokeStyle = inkColor;
      sCtx.fillStyle = inkColor;

      sCtx.lineWidth = 3.5;
      sCtx.beginPath();
      sCtx.arc(0, 0, 92, 0, 2 * Math.PI);
      sCtx.stroke();

      sCtx.lineWidth = 1.2;
      sCtx.beginPath();
      sCtx.arc(0, 0, 85, 0, 2 * Math.PI);
      sCtx.stroke();

      sCtx.lineWidth = 0.8;
      sCtx.beginPath();
      sCtx.arc(0, 0, 80, 0, 2 * Math.PI);
      sCtx.stroke();

      sCtx.textAlign = 'center';
      sCtx.textBaseline = 'middle';

      sCtx.font = 'bold 11px "Arial", sans-serif';
      const topText = "★ STITCHING LOT ISSUE ★";
      const topRadius = 68;
      const topStart = -Math.PI * 0.78;
      const topEnd = -Math.PI * 0.22;
      const topAngleStep = (topEnd - topStart) / (topText.length - 1 || 1);

      for (let i = 0; i < topText.length; i++) {
        const angle = topStart + i * topAngleStep;
        const tx = topRadius * Math.cos(angle);
        const ty = topRadius * Math.sin(angle);
        sCtx.save();
        sCtx.translate(tx, ty);
        sCtx.rotate(angle + Math.PI / 2);
        sCtx.fillText(topText[i], 0, 0);
        sCtx.restore();
      }

      const botText = `${authorizerUpper} AUTHORIZED`;
      const botRadius = 68;
      const botStart = Math.PI * 0.22;
      const botEnd = Math.PI * 0.78;
      const botAngleStep = (botEnd - botStart) / (botText.length - 1 || 1);

      for (let i = 0; i < botText.length; i++) {
        const angle = botStart + i * botAngleStep;
        const tx = botRadius * Math.cos(angle);
        const ty = botRadius * Math.sin(angle);
        sCtx.save();
        sCtx.translate(tx, ty);
        sCtx.rotate(angle - Math.PI / 2);
        sCtx.fillText(botText[botText.length - 1 - i], 0, 0);
        sCtx.restore();
      }

      sCtx.lineWidth = 1.6;
      sCtx.strokeRect(-76, -14, 152, 28);
      sCtx.font = '900 13px "Arial Black", "Arial", sans-serif';
      sCtx.fillText('★ AUTHORIZED ★', 0, 1);

      sCtx.font = 'bold 10px "Courier New", monospace, sans-serif';
      sCtx.fillText(displayPintuDate, 0, 28);

      sCtx.restore();

      const stampDataUrl = stampCanvas.toDataURL('image/png');
      const stampSize = 72;
      const stampX = x + (w - stampSize) / 2;
      const stampY = y + (h - stampSize) / 2;
      doc.addImage(stampDataUrl, 'PNG', stampX, stampY, stampSize, stampSize);
    } catch (e) {
      console.warn('Failed to render circular rubber stamp canvas:', e);
    }
  }

  function drawSigBoxWithLabel(x, y, w, h, label) {
    doc.rect(x, y, w, h);
    const sigLineY = y + Math.round(h * 0.42);
    const sigPad = 10;
    doc.line(x + sigPad, sigLineY, x + w - sigPad, sigLineY);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.text(label, x + w / 2, y + h - 6, { align: 'center' });
  }

  drawPintuSigBox(sigStartX, sigBoxY, sig1W, sigBoxH);
  drawSigBoxWithLabel(sigStartX + sig1W + sigGap, sigBoxY, sig2W, sigBoxH, 'Lot Issue (Cutting Head)');
  drawSigBoxWithLabel(sigStartX + sig1W + sigGap + sig2W + sigGap, sigBoxY, sig3W, sigBoxH, 'Completed Lot (Stitching Supervisor)');

  const hindiParagraphs = [
    `यहाँ ${authorizerDisplay} सर के हस्ताक्षर एवं ${authorizerDisplay} इश्यू डेट (${authorizerDisplay} Issue Date) होना अनिवार्य है। उनके हस्ताक्षर और इश्यू डेट के बिना लॉट जारी नहीं किया जाएगा।`,
    `लॉट की क्वालिटी ${authorizerDisplay} सर से चेक कराना जरूरी है।`,
    `लॉट की क्वालिटी ${authorizerDisplay} सर से चेक कराए बिना लॉट की पेमेंट नहीं होगी।`
  ];

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const fontPx = 11;
    const lineGap = 5;
    const padding = 10;
    const maxTextW = Math.max(120, Math.min(560, W - 2 * CM2 - 40));
    ctx.font = `${fontPx}px "Noto Sans Devanagari", "Mangal", "Arial Unicode MS", sans-serif`;

    function wrapParagraph(paragraph) {
      const words = paragraph.split(' ');
      const lines = [];
      let cur = '';
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const test = cur ? (cur + ' ' + word) : word;
        const w = ctx.measureText(test).width;
        if (w > maxTextW && cur) {
          lines.push(cur);
          cur = word;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    }

    const wrappedLines = [];
    for (let p = 0; p < hindiParagraphs.length; p++) {
      const para = hindiParagraphs[p];
      const lines = wrapParagraph(para);
      if (lines.length > 0) {
        wrappedLines.push('• ' + lines[0]);
        for (let j = 1; j < lines.length; j++) wrappedLines.push('  ' + lines[j]);
      } else {
        wrappedLines.push('• ' + para);
      }
    }

    const maxLineWidth = Math.max(...wrappedLines.map(t => ctx.measureText(t).width));
    canvas.width = Math.ceil(maxLineWidth + padding * 2);
    const lineHeight = Math.ceil(fontPx * 1.2);
    canvas.height = Math.ceil(padding * 2 + wrappedLines.length * lineHeight + (wrappedLines.length - 1) * lineGap);

    const ctx2 = canvas.getContext('2d');
    ctx2.fillStyle = '#000';
    ctx2.font = `${fontPx}px "Noto Sans Devanagari", "Mangal", "Arial Unicode MS", sans-serif`;
    ctx2.textBaseline = 'top';

    let y = padding;
    for (let i = 0; i < wrappedLines.length; i++) {
      ctx2.fillText(wrappedLines[i], padding, y);
      y += lineHeight + lineGap;
    }

    const dataUrl = canvas.toDataURL('image/png');
    const imgMaxW = W - 2 * CM2;
    let imgW = Math.min(canvas.width, imgMaxW);
    let imgH = (canvas.height * imgW) / canvas.width;

    const imgX = (W - imgW) / 2;
    let imgY = sigBoxY + sigBoxH + 15;

    const bottomLimit = H - 20;
    if (imgY + imgH > bottomLimit) {
      const maxAllowedH = bottomLimit - imgY;
      const scale = maxAllowedH / imgH;
      imgH *= scale;
      imgW *= scale;
    }

    doc.addImage(dataUrl, 'PNG', imgX, imgY, imgW, imgH);
  } catch (e) {
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    const fallbackY = sigBoxY + sigBoxH + 15;
    doc.text('NOTE: Get Pintu sir\'s signature. Lot cannot be issued without it.', CM2, fallbackY, { maxWidth: W - 2 * CM2 });
  }
}

// ============================
// STYLES
// ============================
const Wrap = styled.div`
  max-width: 2400px;
  margin: 0 auto;
  padding: 36px 28px 70px;
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #0f172a;
  background: radial-gradient(circle at 15% 15%, rgba(238, 242, 255, 0.7) 0%, rgba(248, 250, 252, 1) 85%);
  min-height: 100vh;
`;

const HeaderPaper = styled.div`
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%);
  border-radius: 24px;
  padding: 36px 40px;
  margin-bottom: 32px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.35), 0 0 25px rgba(99, 102, 241, 0.15);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 36px;
  color: white;
  align-items: center;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, transparent 70%);
    pointer-events: none;
  }

  @media (max-width: 900px) { grid-template-columns: 1fr; gap: 28px; padding: 28px; }
`;

const TitleSection = styled.div`
  display: flex; align-items: center; gap: 24px;
  h1 { margin: 0 0 8px 0; font-size: 2.2rem; font-weight: 800; color: #ffffff; letter-spacing: -0.03em; line-height: 1.2; }
  p { margin: 0; color: #cbd5e1; font-size: 1.05rem; line-height: 1.5; font-weight: 450; }
`;

const TitleIcon = styled.div`
  display: flex; align-items: center; justify-content: center;
  width: 72px; height: 72px; border-radius: 20px;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: white; font-size: 32px;
  box-shadow: 0 12px 24px -6px rgba(99, 102, 241, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
`;

const SearchSection = styled.div` display: flex; flex-direction: column; gap: 18px; `;
const Form = styled.form`
  display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;
const SearchBox = styled.label`
  display: grid; grid-template-columns: 24px 1fr; align-items: center; gap: 12px;
  padding: 16px 22px; border-radius: 16px; background: #ffffff; border: 2px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.15); color: #6366f1; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  &:focus-within { border-color: #6366f1; box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.25), 0 10px 25px -5px rgba(0, 0, 0, 0.2); }
  input { background: transparent; border: none; outline: none; color: #0f172a; font-size: 1.05rem; font-weight: 600; ::placeholder { color: #94a3b8; } }
`;

const BtnRow = styled.div` display: flex; gap: 12px; align-items: center; flex-wrap: wrap; `;
const BaseBtn = styled.button`
  border-radius: 16px; padding: 14px 24px; font-weight: 650; display: inline-flex;
  align-items: center; gap: 10px; cursor: pointer; border: none; transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1); font-size: 0.95rem;
  letter-spacing: -0.01em;
`;
const PrimaryBtn = styled(BaseBtn)`
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white;
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.45);
  &:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(99, 102, 241, 0.55); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const GhostBtn = styled(BaseBtn)`
  background: rgba(255, 255, 255, 0.95); border: 2px solid #e2e8f0; color: #334155;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.04);
  &:hover { background: #ffffff; border-color: #cbd5e1; color: #0f172a; transform: translateY(-1px); box-shadow: 0 6px 15px rgba(0, 0, 0, 0.08); }
`;

const Spinner = styled.div`
  width: ${props => props.size || '18px'};
  height: ${props => props.size || '18px'};
  border: 2.5px solid ${props => props.trackColor || 'rgba(255, 255, 255, 0.3)'};
  border-top: 2.5px solid ${props => props.spinColor || 'white'};
  border-radius: 50%;
  animation: spin ${props => props.speed || '0.8s'} linear infinite;
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const InstructionsSection = styled.div`
  background: white;
  border-radius: 24px;
  padding: 36px;
  margin-top: 28px;
  box-shadow: 0 12px 30px -8px rgba(15, 23, 42, 0.06);
  border: 1px solid #e2e8f0;
`;

const InstructionsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid #f1f5f9;
  
  h2 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 750;
    color: #0f172a;
    letter-spacing: -0.02em;
  }
  
  svg {
    color: #6366f1;
    font-size: 1.8rem;
  }
`;

const InstructionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
`;

const InstructionCard = styled.div`
  background: #f8fafc;
  border-radius: 18px;
  padding: 28px;
  border: 1px solid #e2e8f0;
  border-left: 5px solid #6366f1;
  transition: all 0.25s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px -5px rgba(99, 102, 241, 0.1);
  }
  
  .instruction-icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: rgba(99, 102, 241, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #4f46e5;
    font-size: 1.6rem;
    margin-bottom: 18px;
  }
  
  .instruction-title {
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 12px;
    font-size: 1.15rem;
  }
  
  .instruction-desc {
    color: #475569;
    line-height: 1.65;
    font-size: 0.95rem;
  }
`;

const LanguageBtn = styled(BaseBtn)`
  background: ${props => props.$isHindi ? '#dc2626' : '#059669'};
  color: white;
  border: 2px solid ${props => props.$isHindi ? '#dc2626' : '#059669'};
  box-shadow: 0 4px 12px ${props => props.$isHindi ? 'rgba(220, 38, 38, 0.3)' : 'rgba(5, 150, 105, 0.3)'};
  
  &:hover:not(:disabled) {
    background: ${props => props.$isHindi ? '#b91c1c' : '#047857'};
    border-color: ${props => props.$isHindi ? '#b91c1c' : '#047857'};
    transform: translateY(-2px);
    box-shadow: 0 6px 18px ${props => props.$isHindi ? 'rgba(220, 38, 38, 0.4)' : 'rgba(5, 150, 105, 0.4)'};
  }
`;

const FeaturesList = styled.div`
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 18px;
  padding: 28px;
  margin-top: 24px;
  border: 1px solid #e2e8f0;
`;

const FeatureItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
  
  &:last-child {
    margin-bottom: 0;
  }
  
  .feature-check {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #10b981;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.75rem;
    margin-top: 2px;
    flex-shrink: 0;
    box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
  }
  
  .feature-text {
    color: #334155;
    line-height: 1.6;
    font-size: 0.95rem;
  }
`;

const QuickTips = styled.div`
  background: linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);
  border: 1px solid #fed7aa;
  border-radius: 18px;
  padding: 24px;
  margin-top: 24px;
`;

const TipsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  
  h4 {
    margin: 0;
    color: #c2410c;
    font-size: 1.05rem;
    font-weight: 700;
  }
  
  svg {
    color: #ea580c;
    font-size: 1.2rem;
  }
`;

const TipItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
  
  &:last-child {
    margin-bottom: 0;
  }
  
  .tip-bullet {
    color: #ea580c;
    font-size: 0.85rem;
    margin-top: 2px;
    flex-shrink: 0;
  }
  
  .tip-text {
    color: #9a3412;
    font-size: 0.92rem;
    line-height: 1.5;
  }
`;

const ErrorCard = styled.div`
  margin-bottom: 28px; display: grid; grid-template-columns: 24px 1fr; gap: 12px; align-items: center;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  padding: 16px 20px; border-radius: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.06);
`;

const RemarksCard = styled.div`
  margin-bottom: 28px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #b45309;
  padding: 18px 24px;
  border-radius: 18px;
  font-weight: 500;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.08);
  border-left: 5px solid #f59e0b;

  .remarks-header {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 750;
    color: #b45309;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .remarks-text {
    font-size: 1rem;
    color: #78350f;
    line-height: 1.55;
    font-weight: 500;
  }
`;

const HintCard = styled.div`
  margin-top: 28px; padding: 18px 24px; border-radius: 16px; background: white; border: 2px dashed #cbd5e1;
  color: #1e3a8a; font-size: 0.98rem; line-height: 1.55; display: flex; align-items: center; gap: 14px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.03);
  code { background: #f1f5f9; padding: 4px 8px; border-radius: 8px; font-family: monospace; color: #475569; font-size: 0.92rem; font-weight: 600; }
`;

const ContentGrid = styled.div`
  display: grid; grid-template-columns: 1fr 2fr; gap: 28px;
  @media (max-width: 1100px) { grid-template-columns: 1fr; }
`;

const InfoPanel = styled.div`
  background: white; border-radius: 24px; padding: 32px; box-shadow: 0 12px 30px -8px rgba(15, 23, 42, 0.06);
  display: flex; flex-direction: column; height: fit-content; border: 1px solid #e2e8f0;
`;

const TablePanel = styled.div`
  background: white; border-radius: 24px; padding: 32px; box-shadow: 0 12px 30px -8px rgba(15, 23, 42, 0.06);
  overflow: hidden; display: flex; flex-direction: column; border: 1px solid #e2e8f0;
`;

const PanelHeader = styled.div`
  display: flex; align-items: center; gap: 12px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid #f1f5f9;
  h3 { margin: 0; font-size: 1.35rem; font-weight: 750; color: #0f172a; letter-spacing: -0.02em; }
  svg { color: #6366f1; font-size: 1.35rem; }
`;

const InfoGrid = styled.div` display: grid; gap: 16px; margin-bottom: 28px; `;
const InfoItem = styled.div`
  display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center; padding: 16px 18px;
  background: #f8fafc; border-radius: 16px; border: 1px solid #f1f5f9; transition: all 0.2s ease;
  &:hover { background: #ffffff; border-color: #e2e8f0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04); }
`;
const InfoIcon = styled.div`
  display: flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 14px;
  background: rgba(99, 102, 241, 0.12); color: #4f46e5; font-size: 1.2rem;
`;
const InfoLabel = styled.div` font-size: 0.78rem; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; `;
const InfoValue = styled.div` font-weight: 750; color: #0f172a; font-size: 1.1rem; `;

const SummaryCard = styled.div` display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; padding: 18px; background: #f8fafc; border-radius: 18px; border: 1px solid #f1f5f9; `;
const SummaryItem = styled.div` text-align: center; padding: 14px 8px; border-bottom: 4px solid #6366f1; border-radius: 8px; background: white; box-shadow: 0 4px 8px rgba(0,0,0,0.03); `;
const SummaryLabel = styled.div` font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; `;
const SummaryValue = styled.div` font-weight: 850; color: #0f172a; font-size: 1.6rem; `;

const ActionsRow = styled.div` display: flex; justify-content: flex-end; margin-top: auto; `;
const TableContainer = styled.div` width: 100%; overflow: auto; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02); `;

const Table = styled.table`
  width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.92rem;
  thead th { position: sticky; top: 0; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); text-align: center; padding: 16px 18px; border-bottom: 2px solid #334155; font-weight: 700; color: #ffffff; white-space: nowrap; font-size: 0.95rem; }
  tbody td, tfoot td { padding: 14px 18px; color: #334155; border: none; border-bottom: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; }
  tbody td:last-child, tfoot td:last-child { border-right: none; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr { transition: background 0.2s ease; &:hover { background: #f8fafc; } }
  tbody tr:nth-child(even) { background: #fafafa; }
  td.num { text-align: center; font-variant-numeric: tabular-nums; }
  td.strong, th.strong { font-weight: 750; color: #0f172a; }
  tfoot td { background: #f1f5f9; font-weight: 800; color: #0f172a; border-top: 2px solid #cbd5e1; font-size: 0.95rem; }
`;

const DialogOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
`;

const DialogContainer = styled.div`
  background: white;
  border-radius: 24px;
  padding: 0;
  width: 100%;
  max-width: 880px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
`;

const DialogHeader = styled.div`
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
  padding: 24px 28px;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 24px 24px 0 0;
  
  h3 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
  }
`;

const ProgressCard = styled.div`
  margin: 24px 0;
  padding: 24px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 20px;
  border: 1px solid #e2e8f0;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);
`;

const ProgressHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  font-weight: 750;
  font-size: 1rem;
  color: #0f172a;
`;

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const StepRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 0.95rem;
  font-weight: 650;
  color: ${props => props.$status === 'active' ? '#4f46e5' : props.$status === 'done' ? '#16a34a' : '#94a3b8'};
  transition: all 0.3s ease;

  .step-icon-box {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    font-weight: 750;
    background: ${props => props.$status === 'active' ? '#e0e7ff' : props.$status === 'done' ? '#dcfce7' : '#ffffff'};
    border: 2px solid ${props => props.$status === 'active' ? '#6366f1' : props.$status === 'done' ? '#22c55e' : '#cbd5e1'};
    color: ${props => props.$status === 'active' ? '#4f46e5' : props.$status === 'done' ? '#15803d' : '#94a3b8'};
    box-shadow: ${props => props.$status === 'active' ? '0 0 12px rgba(99, 102, 241, 0.35)' : 'none'};
    flex-shrink: 0;
  }
`;

const SuccessBanner = styled(motion.div)`
  margin: 24px 0;
  padding: 24px;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border: 2px solid #86efac;
  border-radius: 20px;
  color: #14532d;
  box-shadow: 0 12px 30px -8px rgba(22, 163, 74, 0.3);
  display: flex;
  flex-direction: column;
  gap: 14px;

  .success-top {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .success-icon-badge {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: #22c55e;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.8rem;
    box-shadow: 0 6px 18px rgba(34, 197, 94, 0.4);
    flex-shrink: 0;
  }

  .success-title {
    font-size: 1.3rem;
    font-weight: 800;
    color: #14532d;
    margin: 0;
  }

  .success-desc {
    font-size: 0.95rem;
    color: #166534;
    margin: 3px 0 0 0;
    line-height: 1.45;
  }

  .success-details {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid #bbf7d0;
  }

  .detail-pill {
    background: white;
    border: 1px solid #86efac;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 700;
    color: #15803d;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
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
  
  input, select {
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

const FieldLabel = styled.div` display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #475569; font-weight: 500; `;
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

// ============================
// REACT COMPONENT
// ============================
export default function IssueStitching() {
  const [lotInput, setLotInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const [alreadyIssued, setAlreadyIssued] = useState(false);
  const [preGeneratedPdf, setPreGeneratedPdf] = useState(null);
  const [language, setLanguage] = useState('en');
  const t = translations[language];
  const [attendanceCount, setAttendanceCount] = useState('');
  const [pendingData, setPendingData] = useState({ pendingLots: 0, pendingPcs: 0 });

  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [issueDate, setIssueDate] = useState(() => todayLocalISO());
  const [supervisor, setSupervisor] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState('');

  // State for supervisors from Google Sheet
  const [supervisorOptions, setSupervisorOptions] = useState([]);
  const [loadingSupervisors, setLoadingSupervisors] = useState(false);

  // State for Lot Eligibility Verification Window
  const [showEligibilityModal, setShowEligibilityModal] = useState(true);
  const [eligibilityLot, setEligibilityLot] = useState('');
  const [eligibilitySupervisor, setEligibilitySupervisor] = useState('');
  const [verifyingEligibility, setVerifyingEligibility] = useState(false);
  const [eligibilityError, setEligibilityError] = useState('');
  const [verifiedLotData, setVerifiedLotData] = useState(null);
  const [isVerified, setIsVerified] = useState(false);

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'hi' : 'en');
  };

  // Cache cleanup on component mount
  useEffect(() => {
    const interval = setInterval(() => {
      sheetDataCache.cleanup();
      lotMatrixCache.cleanup();
      issueStatusCache.cleanup();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Fetch supervisors from Google Sheet
  useEffect(() => {
    let isMounted = true;
    let intervalId;

    const fetchSupervisors = async () => {
      if (!isMounted) return;
      setLoadingSupervisors(true);
      try {
        const supervisors = await fetchSupervisorsFromSheet(abortRef.current?.signal);
        if (isMounted) {
          setSupervisorOptions(supervisors);
          console.log('Supervisors loaded:', supervisors);
        }
      } catch (error) {
        console.error('Failed to fetch supervisors:', error);
        if (isMounted) {
          setSupervisorOptions(DEFAULT_SUPERVISORS);
        }
      } finally {
        if (isMounted) {
          setLoadingSupervisors(false);
        }
      }
    };

    fetchSupervisors();
    intervalId = setInterval(fetchSupervisors, 5 * 60 * 1000);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const canSearch = useMemo(() => norm(lotInput).length > 0 && !loading, [lotInput, loading]);

  // Pre-generate PDF in background when matrix loads
  useEffect(() => {
    if (matrix && !alreadyIssued) {
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
  }, [matrix, alreadyIssued]);

  // Fetch pending data when supervisor is selected
  useEffect(() => {
    const fetchPendingData = async () => {
      if (supervisor && showIssueDialog && matrix?.lotNumber) {
        console.log('🔄 Fetching pending data for supervisor:', supervisor, 'and lot:', matrix.lotNumber);
        const data = await fetchPendingLotsForSupervisor(supervisor, abortRef.current?.signal, matrix.lotNumber);
        setPendingData(data);
        console.log('📊 Pending data fetched:', {
          pendingLots: data.pendingLots,
          pendingPcs: data.pendingPcs,
          zipOrderDate: data.zipOrderDate
        });
      }
    };

    const timeoutId = setTimeout(fetchPendingData, 500);
    return () => clearTimeout(timeoutId);
  }, [supervisor, showIssueDialog, matrix?.lotNumber]);

  // OPTIMIZED SEARCH WITH CACHE
  const handleSearch = async (e) => {
    e?.preventDefault?.();
    if (!canSearch) return;

    setError('');
    setMatrix(null);
    setPreGeneratedPdf(null);
    setSubmissionStatus('');
    setAlreadyIssued(false);
    setLoading(true);

    abortRef.current?.abort?.();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const issueCacheKey = generateIssueStatusCacheKey(lotInput);
      issueStatusCache.delete(issueCacheKey);

      const cacheKey = generateLotMatrixCacheKey(lotInput);
      const cachedMatrix = lotMatrixCache.get(cacheKey);

      if (cachedMatrix) {
        const authDetails = await fetchAuthorizedPersonForLot(cachedMatrix.lotNumber, ctrl.signal);
        if (authDetails) {
          cachedMatrix.authorizedBy = authDetails.authorizedBy;
          cachedMatrix.partyName = authDetails.partyName;
          cachedMatrix.specialRemarks = authDetails.specialRemarks;
          cachedMatrix.assignedSupervisor = authDetails.supervisor;
        }

        setMatrix(cachedMatrix);
        const isIssued = await isLotAlreadyIssued(cachedMatrix.lotNumber, ctrl.signal);
        setAlreadyIssued(isIssued);

        if (isIssued) {
          const errorMsg = `❌ Lot ${cachedMatrix.lotNumber} is already issued. Cannot re-issue.`;
          console.log(errorMsg);
          setError(errorMsg);
        }
      } else {
        const data = await fetchLotMatrixViaSheetsApi(norm(lotInput), ctrl.signal);

        const authDetails = await fetchAuthorizedPersonForLot(data?.lotNumber || lotInput, ctrl.signal);
        if (authDetails && data) {
          data.authorizedBy = authDetails.authorizedBy;
          data.partyName = authDetails.partyName;
          data.specialRemarks = authDetails.specialRemarks;
          data.assignedSupervisor = authDetails.supervisor;
        }

        setMatrix(data);
        const isIssued = await isLotAlreadyIssued(data.lotNumber, ctrl.signal);
        setAlreadyIssued(isIssued);

        if (isIssued) {
          const errorMsg = `❌ Lot ${data.lotNumber} is already issued. Cannot re-issue.`;
          console.log(errorMsg);
          setError(errorMsg);
        }
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
    abortRef.current?.abort?.();
  };

  const handleBack = () => {
    if (window.history?.length > 1) window.history.back();
    else window.close?.();
  };

  const handleVerifyEligibility = async (e) => {
    e?.preventDefault?.();
    if (!norm(eligibilityLot) || !norm(eligibilitySupervisor)) {
      setEligibilityError('Please enter Lot Number and select Supervisor Name.');
      return;
    }

    setVerifyingEligibility(true);
    setEligibilityError('');

    try {
      const res = await checkLotEligibility(eligibilityLot, eligibilitySupervisor, abortRef.current?.signal);
      if (res.eligible) {
        setIsVerified(true);
        setVerifiedLotData(res);
        setShowEligibilityModal(false);
        setLotInput(eligibilityLot);
        setSupervisor(eligibilitySupervisor);

        // Perform lot search automatically
        setError('');
        setMatrix(null);
        setPreGeneratedPdf(null);
        setSubmissionStatus('');
        setAlreadyIssued(false);
        setLoading(true);

        abortRef.current?.abort?.();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        try {
          const data = await fetchLotMatrixViaSheetsApi(norm(eligibilityLot), ctrl.signal);
          if (data) {
            data.authorizedBy = res.authorizedBy;
            data.partyName = res.partyName;
            data.specialRemarks = res.specialRemarks;
            data.assignedSupervisor = res.supervisor;
          }
          setMatrix(data);
          const isIssued = await isLotAlreadyIssued(data.lotNumber, ctrl.signal);
          setAlreadyIssued(isIssued);
          if (isIssued) {
            setError(`❌ Lot ${data.lotNumber} is already issued. Cannot re-issue.`);
          }
        } catch (searchErr) {
          setError(searchErr?.message || `Lot ${eligibilityLot} verified in Stitching Issues Sheet, but failed to fetch cutting matrix.`);
        } finally {
          setLoading(false);
        }
      } else {
        setIsVerified(false);
        setVerifiedLotData(null);
        setEligibilityError(res.message || 'Authorization failed.');
      }
    } catch (err) {
      console.error('Error verifying lot eligibility:', err);
      setEligibilityError(err?.message || 'Failed to verify lot eligibility.');
    } finally {
      setVerifyingEligibility(false);
    }
  };

  const openIssueDialog = () => {
    if (!isVerified || norm(lotInput) !== norm(eligibilityLot)) {
      setEligibilityLot(lotInput || eligibilityLot);
      setShowEligibilityModal(true);
      setError("Please verify Lot Eligibility first before issuing.");
      return;
    }

    if (alreadyIssued) {
      const errorMsg = `This lot ${matrix?.lotNumber} is already issued and cannot be re-issued.`;
      setError(errorMsg);
      return;
    }

    if (!matrix) {
      setError("No lot data available. Please search for a lot first.");
      return;
    }

    setDialogError('');
    setIssueDate(todayLocalISO());
    setSubmissionStatus('');
    setShowIssueDialog(true);
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

    setDialogError('');
    setConfirming(true);
    setSubmissionStatus('submitting');

    try {
      const totalQty = matrix?.totals?.grand || 0;

      if (matrix?.source === 'old') {
        const payload = matrix._payloadForIssue || {
          meta: {
            issueDate: issueDate,
            supervisor: supervisor,
            sourceType: 'old',
            lotNumber: matrix.lotNumber,
            style: matrix.style || '',
            fabric: matrix.fabric || '',
            garmentType: matrix.garmentType || ''
          },
          shades: matrix.rows.map(row => row.color),
          sizes: [],
          cells: {},
          cutting: matrix.rows.reduce((acc, row) => {
            acc[row.color] = row.cuttingTable || '';
            return acc;
          }, {}),
          rowTotals: matrix.rows.reduce((acc, row) => {
            acc[row.color] = row.totalPcs;
            return acc;
          }, {})
        };

        payload.meta.supervisor = supervisor;
        payload.meta.issueDate = issueDate;

        const formData = new URLSearchParams();
        formData.append('payload', JSON.stringify(payload));

        await fetch(OLD_APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString()
        });
      } else {
        const url = new URL('https://script.google.com/macros/s/AKfycbz9ofgmid-74YQ61oRUN6d4crBlF5FfG5qjeXDg2bUoLoZ7eBWkRVx58t4UzfNODuuzfA/exec');

        const params = {
          action: 'issue',
          lot: matrix.lotNumber,
          supervisor: supervisor,
          issueDate: issueDate,
          manpower: attendanceCount,
          stitchingIssueQty: totalQty,
          pendingLots: pendingData.pendingLots,
          pendingPcs: pendingData.pendingPcs
        };

        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });

        await fetch(url, {
          method: 'GET',
          mode: 'no-cors'
        });
      }

      setSubmissionStatus('generating');
      try {
        await generateIssuePdf(matrix, {
          issueDate,
          supervisor,
          authorizedBy: verifiedLotData?.authorizedBy || matrix?.authorizedBy || '',
          manpower: attendanceCount || '0',
          pendingLots: pendingData.pendingLots || 0,
          pendingPcs: pendingData.pendingPcs || 0,
          garmentTypeSummary: pendingData.garmentTypeSummary || [],
          zipOrderDate: pendingData.zipOrderDate || ''
        });
      } catch (pdfError) {
        console.warn('⚠️ PDF generation warning:', pdfError);
      }

      setSubmissionStatus('success');
      setAttendanceCount('');

      const issueCacheKey = generateIssueStatusCacheKey(matrix.lotNumber);
      issueStatusCache.delete(issueCacheKey);

      const matrixCacheKey = generateLotMatrixCacheKey(matrix.lotNumber);
      lotMatrixCache.delete(matrixCacheKey);

      setTimeout(() => {
        setShowIssueDialog(false);
        setSubmissionStatus('');
        setConfirming(false);
        setAlreadyIssued(true);
        setError(`✅ Lot ${matrix.lotNumber} issued to ${supervisor}.`);

        setTimeout(() => {
          if (lotInput) {
            handleSearch({ preventDefault: () => { } });
          }
        }, 1000);
      }, 1500);

    } catch (e) {
      console.error('❌ Error:', e);
      setSubmissionStatus('error');
      setDialogError('Data submitted and PDF generated. Please check your sheet.');
      setConfirming(false);

      try {
        await generateIssuePdf(matrix, {
          issueDate,
          supervisor,
          authorizedBy: verifiedLotData?.authorizedBy || matrix?.authorizedBy || '',
          manpower: attendanceCount || '0',
          pendingLots: 0,
          pendingPcs: 0,
          garmentTypeSummary: []
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

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      <Wrap>
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

            <div style={{
              marginTop: '16px',
              padding: '14px 20px',
              background: isVerified
                ? 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)'
                : 'linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)',
              borderRadius: '16px',
              border: `1.5px solid ${isVerified ? '#86efac' : '#93c5fd'}`,
              boxShadow: isVerified
                ? '0 4px 15px rgba(22, 163, 74, 0.08)'
                : '0 4px 15px rgba(37, 99, 235, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '14px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {isVerified ? (
                  <>
                    <div style={{
                      background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                      color: 'white',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)'
                    }}>
                      <FiCheck style={{ fontSize: '18px' }} />
                    </div>
                    <div style={{ fontSize: '0.92rem', color: '#14532d' }}>
                      <span style={{ fontWeight: '700' }}>Verified Authorized Lot:</span>{' '}
                      <strong style={{ color: '#0f172a', background: '#dcfce7', padding: '2px 8px', borderRadius: '6px' }}>#{eligibilityLot}</strong>
                      <span style={{ margin: '0 8px', color: '#86efac' }}>|</span>
                      <span>Supervisor: <strong style={{ color: '#0f172a' }}>{eligibilitySupervisor}</strong></span>
                      {(verifiedLotData?.authorizedBy || matrix?.authorizedBy) && (
                        <>
                          <span style={{ margin: '0 8px', color: '#86efac' }}>|</span>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                            color: '#92400e',
                            border: '1px solid #f59e0b',
                            padding: '3px 10px',
                            borderRadius: '20px',
                            fontWeight: '700',
                            fontSize: '0.82rem',
                            boxShadow: '0 2px 6px rgba(245, 158, 11, 0.15)'
                          }}>
                            <FiAward style={{ color: '#d97706', fontSize: '14px' }} />
                            Authorized By: {verifiedLotData?.authorizedBy || matrix?.authorizedBy}
                          </span>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{
                      background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      color: 'white',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
                    }}>
                      <FiShield style={{ fontSize: '18px' }} />
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#1e40af', fontWeight: '500' }}>
                      <span>Lot authorization verification required from Stitching Issues Sheet before issuing.</span>
                      {(matrix?.authorizedBy || verifiedLotData?.authorizedBy) && (
                        <div style={{ marginTop: '4px', fontSize: '0.83rem', color: '#0369a1', fontWeight: '600' }}>
                          ℹ️ Sheet Record Found: Authorized by <strong>{matrix?.authorizedBy || verifiedLotData?.authorizedBy}</strong> for Supervisor <strong>{matrix?.assignedSupervisor || verifiedLotData?.supervisor}</strong>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowEligibilityModal(true)}
                style={{
                  padding: '8px 18px',
                  borderRadius: '20px',
                  border: `1.5px solid ${isVerified ? '#16a34a' : '#2563eb'}`,
                  background: isVerified ? 'white' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: isVerified ? '#15803d' : 'white',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  transition: 'all 0.2s ease'
                }}
              >
                <FiShield style={{ fontSize: '15px' }} />
                {isVerified ? 'Re-verify / Change Authorization' : 'Verify Lot Authorization'}
              </button>
            </div>
          </SearchSection>
        </HeaderPaper>

        {error && (
          <ErrorCard>
            <FiAlertTriangle />
            <span>{error}</span>
          </ErrorCard>
        )}

        {matrix ? (
          <>
            {matrix.remarks && (
              <RemarksCard>
                <div className="remarks-header">
                  <FiInfo /> {t.remarks}
                </div>
                <div className="remarks-text">{matrix.remarks}</div>
              </RemarksCard>
            )}
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
                  <InfoItem style={{ gridColumn: 'span 2', background: 'linear-gradient(135deg, #fffbebf5 0%, #fef3c7f5 100%)', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '10px 14px' }}>
                    <InfoIcon style={{ background: '#f59e0b', color: 'white' }}>
                      <FiAward />
                    </InfoIcon>
                    <div>
                      <InfoLabel style={{ color: '#92400e', fontWeight: '700' }}>Authorized By (Spreadsheet Record)</InfoLabel>
                      <InfoValue style={{ color: '#78350f', fontWeight: '800', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{verifiedLotData?.authorizedBy || matrix?.authorizedBy || 'Pending Verification'}</span>
                        {(verifiedLotData?.authorizedBy || matrix?.authorizedBy) && (
                          <span style={{ fontSize: '0.72rem', background: '#16a34a', color: 'white', padding: '2px 8px', borderRadius: '10px', fontWeight: '700' }}>
                            VERIFIED
                          </span>
                        )}
                      </InfoValue>
                    </div>
                  </InfoItem>
                  {(verifiedLotData?.partyName || matrix?.partyName) && (
                    <InfoItem>
                      <InfoIcon><FiUserCheck /></InfoIcon>
                      <div><InfoLabel>Party Name</InfoLabel><InfoValue>{verifiedLotData?.partyName || matrix?.partyName}</InfoValue></div>
                    </InfoItem>
                  )}
                  {(verifiedLotData?.specialRemarks || matrix?.specialRemarks) && (
                    <InfoItem>
                      <InfoIcon><FiTag /></InfoIcon>
                      <div><InfoLabel>Special Remarks</InfoLabel><InfoValue>{verifiedLotData?.specialRemarks || matrix?.specialRemarks}</InfoValue></div>
                    </InfoItem>
                  )}
                </InfoGrid>
                <SummaryCard>
                  <SummaryItem><SummaryLabel>{t.totalPieces}</SummaryLabel><SummaryValue>{matrix.totals.grand}</SummaryValue></SummaryItem>
                  <SummaryItem><SummaryLabel>{t.colors}</SummaryLabel><SummaryValue>{matrix.rows.length}</SummaryValue></SummaryItem>
                  <SummaryItem><SummaryLabel>{t.sizes}</SummaryLabel><SummaryValue>{matrix.sizes.length}</SummaryValue></SummaryItem>
                </SummaryCard>
                <ActionsRow>
                  <PrimaryBtn
                    as={motion.button}
                    type="button"
                    onClick={openIssueDialog}
                    whileTap={{ scale: alreadyIssued ? 1 : 0.98 }}
                    whileHover={{ scale: alreadyIssued ? 1 : 1.02 }}
                    disabled={alreadyIssued || !matrix}
                    style={{
                      opacity: (alreadyIssued || !matrix) ? 0.6 : 1,
                      cursor: (alreadyIssued || !matrix) ? 'not-allowed' : 'pointer',
                      background: alreadyIssued ? '#6b7280' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                    }}
                  >
                    <FiCheck />
                    {alreadyIssued ? t.alreadyIssued : t.submitToStitching}
                  </PrimaryBtn>
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
                        {displaySizes.map((s, i) => (
                          <th key={`${s || 'size'}-${i}`}>{s || '\u00A0'}</th>
                        ))}
                        <th>{t.totalPcs}</th>
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
                        <td className="strong">{t.total}</td>
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
          </>
        ) : (
          !loading && !error && (
            <>
              <HintCard>
                <FiInfo />
                <span>
                  {t.tip} <code>Cutting Matrix — Lot 64003</code> {t.or} <code>Cutting Matrix - Lot 64003</code>.
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
                    <div className="tip-text">{t.tip1}</div>
                  </TipItem>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">{t.tip2}</div>
                  </TipItem>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">{t.tip3}</div>
                  </TipItem>
                  <TipItem>
                    <div className="tip-bullet">•</div>
                    <div className="tip-text">{t.tip4}</div>
                  </TipItem>
                </QuickTips>
              </InstructionsSection>
            </>
          )
        )}

        {/* Dialog with Supervisor Dropdown from Google Sheet */}
        {showIssueDialog && (
          <DialogOverlay onClick={closeIssueDialog}>
            <DialogContainer onClick={(e) => e.stopPropagation()}>
              <DialogHeader>
                <h3><FiCheck /> {t.issueToStitching}</h3>
                <CloseButton onClick={closeIssueDialog} disabled={confirming}>
                  <FiX />
                </CloseButton>
              </DialogHeader>

              <DialogContent>
                <div style={{
                  margin: '-4px 0 18px 0',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: '1.5px solid #6ee7b7',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.12)'
                }}>
                  <div style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    flexShrink: 0,
                    boxShadow: '0 4px 10px rgba(5, 150, 105, 0.25)'
                  }}>
                    <FiHeart />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: '800', color: '#065f46', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>Lot #{matrix?.lotNumber} Official Stitching Issuance</span>
                    </h4>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#047857', lineHeight: '1.4' }}>
                      Authorized with gratitude by <strong style={{ color: '#064e3b', background: '#a7f3d0', padding: '1px 7px', borderRadius: '5px' }}>{verifiedLotData?.authorizedBy || matrix?.authorizedBy || 'Authorized Official'}</strong> for Supervisor <strong style={{ color: '#064e3b' }}>{supervisor}</strong>.
                    </p>
                  </div>
                </div>

                <SimpleField>
                  <FieldLabel><FiCalendar /> {t.dateOfIssue}</FieldLabel>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    disabled={confirming}
                  />
                </SimpleField>

                {supervisor && (
                  <SimpleField>
                    <FieldLabel>
                      <FiAlertTriangle /> Pending Work
                    </FieldLabel>
                    <input
                      type="text"
                      value={`${pendingData.pendingLots} lots pending (${pendingData.pendingPcs} pcs)`}
                      disabled
                      readOnly
                      style={{
                        background: pendingData.pendingLots > 0 ? '#fff7ed' : '#f0f9ff',
                        color: pendingData.pendingLots > 0 ? '#9a3412' : '#075985',
                        fontWeight: 'bold',
                        cursor: 'default',
                        borderColor: pendingData.pendingLots > 0 ? '#fdba74' : '#7dd3fc'
                      }}
                    />
                  </SimpleField>
                )}

                <SimpleField>
                  <FieldLabel>
                    <FiUser /> {t.supervisor}
                    <span style={{ fontSize: '0.75rem', color: '#16a34a', marginLeft: '8px', fontWeight: 'bold' }}>
                      🔒 (Verified & Fixed from Sheet)
                    </span>
                  </FieldLabel>
                  <input
                    type="text"
                    value={supervisor}
                    disabled
                    readOnly
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: '2px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#0f172a',
                      fontWeight: 'bold',
                      outline: 'none',
                      fontSize: '1rem',
                      cursor: 'not-allowed',
                      width: '100%'
                    }}
                  />
                </SimpleField>

                <SimpleField>
                  <FieldLabel>
                    <FiAward style={{ color: '#d97706' }} /> Authorized By (Issuer / Approver)
                    <span style={{ fontSize: '0.75rem', color: '#059669', marginLeft: '8px', fontWeight: 'bold' }}>
                      🔒 (Verified from Sheet)
                    </span>
                  </FieldLabel>
                  <input
                    type="text"
                    value={verifiedLotData?.authorizedBy || matrix?.authorizedBy || 'Authorized Officer'}
                    disabled
                    readOnly
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: '2px solid #fde68a',
                      background: '#fffbebf5',
                      color: '#92400e',
                      fontWeight: 'bold',
                      outline: 'none',
                      fontSize: '1rem',
                      cursor: 'not-allowed',
                      width: '100%'
                    }}
                  />
                </SimpleField>

                <SimpleField>
                  <FieldLabel>
                    <FiUsers /> Manpower (Daily Attendance)
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
                    disabled={confirming}
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

                {submissionStatus && submissionStatus !== 'success' && submissionStatus !== 'error' && (
                  <ProgressCard>
                    <ProgressHeader>
                      <Spinner size="20px" trackColor="#cbd5e1" spinColor="#4f46e5" />
                      <span>Processing Stitching Issue...</span>
                    </ProgressHeader>
                    <StepList>
                      <StepRow $status={submissionStatus === 'submitting' ? 'active' : 'done'}>
                        <div className="step-icon-box">
                          {submissionStatus === 'submitting' ? <Spinner size="14px" trackColor="#c7d2fe" spinColor="#4f46e5" /> : <FiCheck />}
                        </div>
                        <span>1. Preparing Issue Data & Quantities</span>
                      </StepRow>
                      <StepRow $status={submissionStatus === 'saving' ? 'active' : (submissionStatus === 'generating' ? 'done' : 'pending')}>
                        <div className="step-icon-box">
                          {submissionStatus === 'saving' ? <Spinner size="14px" trackColor="#c7d2fe" spinColor="#4f46e5" /> : (submissionStatus === 'generating' ? <FiCheck /> : '2')}
                        </div>
                        <span>2. Syncing with Google Sheets & Index Log</span>
                      </StepRow>
                      <StepRow $status={submissionStatus === 'generating' ? 'active' : 'pending'}>
                        <div className="step-icon-box">
                          {submissionStatus === 'generating' ? <Spinner size="14px" trackColor="#c7d2fe" spinColor="#4f46e5" /> : '3'}
                        </div>
                        <span>3. Generating PDF & Circular Rubber Seal Stamp</span>
                      </StepRow>
                    </StepList>
                  </ProgressCard>
                )}

                {submissionStatus === 'success' && (
                  <SuccessBanner
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', border: '2px solid #86efac' }}
                  >
                    <div className="success-top">
                      <div className="success-icon-badge" style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}>
                        <FiCheck />
                      </div>
                      <div>
                        <h4 className="success-title" style={{ color: '#14532d', fontSize: '1.15rem' }}>
                          🎉 Lot Issued Successfully with Gratitude!
                        </h4>
                        <p className="success-desc" style={{ color: '#166534', marginTop: '4px' }}>
                          Lot <strong>#{matrix?.lotNumber}</strong> has been assigned to <strong>{supervisor}</strong>.
                          <br />
                          <span style={{ fontWeight: '700', color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '6px' }}>
                            <FiAward /> Authorized By: {verifiedLotData?.authorizedBy || matrix?.authorizedBy || 'Authorized Officer'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="success-details">
                      <span className="detail-pill"><FiPackage /> Total: {matrix?.totals?.grand || 0} Pcs</span>
                      <span className="detail-pill"><FiUsers /> Workers: {attendanceCount || 0}</span>
                      <span className="detail-pill"><FiCalendar /> Issue Date: {printableDate(issueDate)}</span>
                    </div>
                  </SuccessBanner>
                )}

                {submissionStatus === 'error' && (
                  <div style={{ margin: '20px 0', padding: '18px 20px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '16px', color: '#b91c1c', fontWeight: '600', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <FiAlertTriangle style={{ flexShrink: 0, fontSize: '20px', marginTop: '2px' }} />
                    <div>{dialogError || 'An error occurred during submission. Please try again.'}</div>
                  </div>
                )}

                <DialogActions>
                  <SimpleGhostBtn
                    type="button"
                    onClick={closeIssueDialog}
                    disabled={confirming}
                  >
                    {t.cancel}
                  </SimpleGhostBtn>
                  <SimplePrimaryBtn
                    type="button"
                    onClick={handleConfirmIssue}
                    disabled={confirming}
                  >
                    {confirming ? (
                      <>
                        <Spinner size="16px" spinColor="white" /> {t.processing}
                      </>
                    ) : (
                      <>
                        <FiCheck /> {t.confirmIssue}
                      </>
                    )}
                  </SimplePrimaryBtn>
                </DialogActions>
              </DialogContent>
            </DialogContainer>
          </DialogOverlay>
        )}

        {/* ============================ */}
        {/* LOT ELIGIBILITY VERIFICATION MODAL */}
        {/* ============================ */}
        {showEligibilityModal && (
          <DialogOverlay style={{ background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)' }}>
            <DialogContainer style={{ maxWidth: '540px', borderRadius: '24px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35)' }}>
              <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E40AF 50%, #2563EB 100%)', padding: '24px 28px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ background: 'rgba(255, 255, 255, 0.15)', width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                    🔒
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'white' }}>Lot Eligibility Verification</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', opacity: 0.9 }}>Check authorization in Stitching Issues Sheet</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleBack}
                  title="Back to previous page"
                  style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255, 255, 255, 0.3)', borderRadius: '10px', color: 'white', padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '600' }}
                >
                  <FiArrowLeft /> Back
                </button>
              </div>

              <form onSubmit={handleVerifyEligibility} style={{ padding: '28px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <SimpleField>
                    <FieldLabel style={{ color: '#0F172A', fontWeight: '600' }}>
                      <FiTag /> Lot Number
                    </FieldLabel>
                    <input
                      type="text"
                      placeholder="Enter Lot No (e.g., 11251)"
                      value={eligibilityLot}
                      onChange={(e) => setEligibilityLot(e.target.value)}
                      autoFocus
                      required
                      style={{ border: '2px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', fontSize: '15px', background: '#f8fafc', width: '100%', outline: 'none' }}
                    />
                  </SimpleField>

                  <SimpleField>
                    <FieldLabel style={{ color: '#0F172A', fontWeight: '600' }}>
                      <FiUser /> Stitching Supervisor Name
                    </FieldLabel>
                    <select
                      value={eligibilitySupervisor}
                      onChange={(e) => setEligibilitySupervisor(e.target.value)}
                      required
                      style={{ border: '2px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', fontSize: '15px', background: '#f8fafc', width: '100%', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="">-- Select Stitching Supervisor --</option>
                      {supervisorOptions.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </SimpleField>

                  {eligibilityError && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '14px 16px', color: '#dc2626', fontSize: '0.9rem', display: 'flex', alignItems: 'flex-start', gap: '10px', lineHeight: '1.4' }}>
                      <FiAlertTriangle style={{ flexShrink: 0, marginTop: '2px', fontSize: '18px' }} />
                      <div>{eligibilityError}</div>
                    </div>
                  )}

                  {isVerified && verifiedLotData && (
                    <div style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', border: '2px solid #86efac', borderRadius: '16px', padding: '16px 20px', color: '#15803d' }}>
                      <div style={{ fontWeight: '800', fontSize: '1rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#14532d' }}>
                        <FiCheckCircle style={{ color: '#16a34a', fontSize: '20px' }} />
                        <span>Lot Authorized for Stitching Issue!</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem', marginTop: '8px' }}>
                        <div style={{ background: 'white', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                          <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Authorized By</span>
                          <strong style={{ color: '#b45309', fontSize: '0.95rem' }}>{verifiedLotData.authorizedBy || '—'}</strong>
                        </div>
                        <div style={{ background: 'white', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                          <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Supervisor</span>
                          <strong style={{ color: '#0f172a', fontSize: '0.95rem' }}>{verifiedLotData.supervisor || '—'}</strong>
                        </div>
                        <div style={{ background: 'white', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                          <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Fabric & Style</span>
                          <strong style={{ color: '#0f172a' }}>{verifiedLotData.fabric} ({verifiedLotData.style})</strong>
                        </div>
                        <div style={{ background: 'white', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                          <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Total Quantity</span>
                          <strong style={{ color: '#0f172a' }}>{verifiedLotData.totalPcs} Pcs</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                    <button
                      type="button"
                      onClick={handleBack}
                      style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '2px solid #cbd5e1', background: 'white', color: '#0F172A', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      <FiArrowLeft /> Back
                    </button>
                    {isVerified && (
                      <button
                        type="button"
                        onClick={() => setShowEligibilityModal(false)}
                        style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '2px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: '600', cursor: 'pointer' }}
                      >
                        Close
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={verifyingEligibility}
                      style={{ flex: 2, padding: '14px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, #0F172A 0%, #2563EB 100%)', color: 'white', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)' }}
                    >
                      {verifyingEligibility ? (
                        <>
                          <Spinner size="18px" spinColor="white" /> Checking Credentials Sheet...
                        </>
                      ) : (
                        <>
                          <FiCheck /> Verify Authorization
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </DialogContainer>
          </DialogOverlay>
        )}
      </Wrap>
    </LanguageContext.Provider>
  );
}
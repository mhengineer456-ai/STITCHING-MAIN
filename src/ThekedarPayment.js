import React, { useState, useEffect } from 'react';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import './ThekedarPayment.css';

// Helper function for name normalization
const normalizeName = (name) => {
  if (!name) return '';
  return name.toString().toLowerCase().trim();
};

// Helper function for case-insensitive string comparison
const isSameName = (name1, name2) => {
  if (!name1 || !name2) return false;
  return normalizeName(name1) === normalizeName(name2);
};

// Helper function for lot number normalization
const normalizeLotNumber = (lotNo) => {
  if (lotNo === null || lotNo === undefined) return '';
  return lotNo.toString().trim().toLowerCase();
};

// Google Sheets configuration
const GOOGLE_SHEETS_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "17qqixpHOXvG1U3RlRwaHON5JCkugpy4RIu5N9zR9ScM",
  KARIGAR_ASSIGNMENTS_RANGE: "KarigarAssignments!A:Z",
  KARIGAR_PROFILE_RANGE: "KarigarProfiles!A:Q",
  SUPPLIERS_RANGE: "Suppliers!A:F",
};

// Separate workbook for rate list
const RATE_LIST_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "1AhDU_LPVXJB-jZoeJ7gt7uZ2r1lLMRG5AJdZkYGVaUs",
  RANGE: "'Master List'!A:K",
};

// New Thekedar Payments sheet configuration
const THEKEDAR_PAYMENTS_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "1dfcyjdDY-_C_WWMpfjDOwYZj4V7y3FqEYieTnITGRlc",
  RANGE: "ThekedarPayments!A:Z",
};

// Apps Script Web App URL
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxA8VSuaQklCatCZrYEOS9e28VDN1FxMbKjbUeh3aaMfqakk_nIXwKWfqIYvOUxq8s/exec";

export default function ThekedarPayment({ onBack, supervisor, onNavigate }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [karigarAssignments, setKarigarAssignments] = useState([]);
  const [karigarProfiles, setKarigarProfiles] = useState([]);
  const [rateList, setRateList] = useState([]);
  const [thekedarPayments, setThekedarPayments] = useState([]);
  
  // Use the logged-in supervisor directly - no selection dropdown
  const selectedSupervisor = supervisor?.name || '';
  const [groupedLots, setGroupedLots] = useState([]);
  const [filteredLots, setFilteredLots] = useState([]);
  const [selectedLots, setSelectedLots] = useState([]);
  const [supervisorSummary, setSupervisorSummary] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('lotNumber');
  const [sortOrder, setSortOrder] = useState('asc');
  const [lotCompletionMap, setLotCompletionMap] = useState(new Map());
  const [expandedLots, setExpandedLots] = useState(new Set());
  const [paidLotNumbers, setPaidLotNumbers] = useState(new Set());
  const [currentStep, setCurrentStep] = useState(1);
  
  const [showSuccess, setShowSuccess] = useState(false);
  const [showStorageSuccess, setShowStorageSuccess] = useState(false);
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [authorized, setAuthorized] = useState(true);

  const [formData, setFormData] = useState({
    payableId: '',
    payableType: 'supplier',
    payeeId: '',
    payeeName: '',
    amount: '',
    dueDate: new Date().toISOString().split('T')[0],
    paymentDate: '',
    status: 'pending',
    category: 'Supervisor Payment',
    description: '',
    reference: '',
    notes: '',
    createdBy: supervisor?.name || 'Unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Helper function for case-insensitive supervisor comparison
  const isSameSupervisor = (profileSupervisor, loggedInSupervisor) => {
    return isSameName(profileSupervisor, loggedInSupervisor);
  };

  useEffect(() => {
    loadKarigarProfiles();
    loadRateList();
    loadThekedarPayments();
  }, []);

  useEffect(() => {
    if (karigarProfiles.length > 0) {
      loadKarigarAssignments();
    }
  }, [karigarProfiles]);

  // Check if logged-in supervisor is authorized
  useEffect(() => {
    if (karigarProfiles.length > 0 && selectedSupervisor) {
      const hasKarigars = karigarProfiles.some(profile => 
        isSameSupervisor(profile.supervisorName, selectedSupervisor)
      );
      
      if (!hasKarigars && karigarProfiles.length > 0) {
        setAuthorized(false);
        setError(`No authorization: "${selectedSupervisor}" is not registered as a supervisor in the system.`);
      } else {
        setAuthorized(true);
        setError('');
      }
    }
  }, [karigarProfiles, selectedSupervisor]);

  // Recursively extract lot numbers from any parsed object or array
  const extractLotNumbersFromObject = (obj, set) => {
    if (!obj) return;
    if (Array.isArray(obj)) {
      obj.forEach(item => extractLotNumbersFromObject(item, set));
    } else if (typeof obj === 'object') {
      if (obj.lotNumber !== undefined && obj.lotNumber !== null) {
        set.add(normalizeLotNumber(obj.lotNumber));
      }
      if (obj.lotNo !== undefined && obj.lotNo !== null) {
        set.add(normalizeLotNumber(obj.lotNo));
      }
      if (obj.lots && Array.isArray(obj.lots)) {
        obj.lots.forEach(item => extractLotNumbersFromObject(item, set));
      }
      if (obj.paidLots && Array.isArray(obj.paidLots)) {
        obj.paidLots.forEach(l => set.add(normalizeLotNumber(l)));
      }
    }
  };

  // Strictly fetch paid lot numbers from all available columns and fields in ThekedarPayments sheet
  const fetchPaidLotNumbers = async () => {
    const paidLots = new Set();
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${THEKEDAR_PAYMENTS_CONFIG.SPREADSHEET_ID}/values/${THEKEDAR_PAYMENTS_CONFIG.RANGE}?key=${THEKEDAR_PAYMENTS_CONFIG.API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn('ThekedarPayments sheet not available');
        return paidLots;
      }
      
      const data = await response.json();

      if (data.values && data.values.length > 1) {
        const rows = data.values.slice(1);
        
        rows.forEach(row => {
          if (!row || row.length === 0) return;
          
          // 1. Parse JSON objects/arrays from all cells in the row
          row.forEach(cell => {
            if (!cell || typeof cell !== 'string') return;
            const strCell = cell.trim();
            if (strCell.startsWith('[') || strCell.startsWith('{')) {
              try {
                const parsed = JSON.parse(strCell);
                extractLotNumbersFromObject(parsed, paidLots);
              } catch (e) {
                // Ignore non-JSON cell contents
              }
            }
          });

          // 2. Regex matching across row contents for lotNumber key values
          const rowStr = row.join(' ');
          const lotMatches = rowStr.matchAll(/"lotNumber"\s*:\s*"([^"]+)"/g);
          for (const match of lotMatches) {
            if (match[1]) paidLots.add(normalizeLotNumber(match[1]));
          }
          
          const lotNumMatches = rowStr.matchAll(/"lotNumber"\s*:\s*(\d+)/g);
          for (const match of lotNumMatches) {
            if (match[1]) paidLots.add(normalizeLotNumber(match[1]));
          }

          // 3. Extract from description pattern (e.g. "Lots: 101, 102")
          const descMatch = rowStr.match(/Lots:\s*([0-9a-zA-Z,\s-]+)/i);
          if (descMatch && descMatch[1]) {
            const lotsInDesc = descMatch[1].split(',');
            lotsInDesc.forEach(l => {
              const cleaned = normalizeLotNumber(l);
              if (cleaned && !cleaned.includes('payment') && !cleaned.includes('under')) {
                paidLots.add(cleaned);
              }
            });
          }
        });
      }
    } catch (err) {
      console.error('Error fetching paid lot numbers:', err);
    }
    return paidLots;
  };

  // Load Thekedar Payments to track already paid lots
  const loadThekedarPayments = async () => {
    try {
      const paidLots = await fetchPaidLotNumbers();
      setPaidLotNumbers(paidLots);
      console.log(`Loaded ${paidLots.size} unique lots already paid`);
      
      if (karigarAssignments.length > 0) {
        analyzeLotCompletion(karigarAssignments, paidLots);
      }
    } catch (err) {
      console.error('Error loading Thekedar payments:', err);
      setThekedarPayments([]);
    }
  };

  const loadKarigarProfiles = async () => {
    try {
      setLoading(true);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.KARIGAR_PROFILE_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn('KarigarProfile sheet not available');
        setKarigarProfiles([]);
        return;
      }
      
      const data = await response.json();

      if (data.values && data.values.length > 0) {
        const headers = data.values[0];
        const rows = data.values.slice(1);
        
        const profiles = rows.map(row => ({
          timestamp: row[0] || '',
          karigarId: row[1] ? row[1].trim() : '',
          karigarName: row[2] ? row[2].trim() : '',
          dateOfBirth: row[3] || '',
          age: row[4] || '',
          gender: row[5] || '',
          floorArea: row[6] || '',
          skillType: row[7] || '',
          dateOfJoining: row[8] || '',
          supervisorType: row[9] || '',
          supervisorName: row[10] ? row[10].trim() : ''
        })).filter(p => p.karigarId && p.karigarName);
        
        setKarigarProfiles(profiles);
      }
    } catch (err) {
      console.error('Error loading karigar profiles:', err);
      setKarigarProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  const analyzeLotCompletion = (assignments, paidLotsSet = paidLotNumbers) => {
    const lotMap = new Map();
    
    assignments.forEach(assignment => {
      if (!lotMap.has(assignment.lotNumber)) {
        lotMap.set(assignment.lotNumber, {
          lotNumber: assignment.lotNumber,
          totalAssignments: 0,
          completedAssignments: 0,
          shades: new Set(),
          completedShades: new Set(),
          karigars: new Set(),
          assignments: [],
          brands: new Set(),
          fabrics: new Set(),
          styles: new Set(),
          totalQuantity: 0,
          completedQuantity: 0,
          totalAmount: 0,
          isPaid: false
        });
      }
      const lotInfo = lotMap.get(assignment.lotNumber);
      lotInfo.totalAssignments++;
      lotInfo.shades.add(assignment.shade);
      lotInfo.karigars.add(assignment.karigarName);
      lotInfo.assignments.push(assignment);
      lotInfo.brands.add(assignment.brand);
      lotInfo.fabrics.add(assignment.fabric);
      lotInfo.styles.add(assignment.style);
      lotInfo.totalQuantity += assignment.quantity || 0;
      
      if (assignment.status === 'completed') {
        lotInfo.completedAssignments++;
        lotInfo.completedShades.add(assignment.shade);
        lotInfo.completedQuantity += assignment.completedQuantity || assignment.quantity || 0;
      }
    });
    
    lotMap.forEach((value) => {
      const normLot = normalizeLotNumber(value.lotNumber);
      value.isFullyCompleted = value.shades.size === value.completedShades.size;
      value.completionPercentage = Math.round((value.completedShades.size / value.shades.size) * 100);
      value.totalKarigars = value.karigars.size;
      value.isPaid = paidLotsSet.has(normLot);
      
      const firstAssignment = value.assignments.find(a => a.status === 'completed') || value.assignments[0];
      if (firstAssignment) {
        const rateInfo = getRateFromList(firstAssignment);
        value.rate = rateInfo.rate;
        value.rateInfo = rateInfo;
        value.totalAmount = value.completedQuantity * rateInfo.rate;
      }
    });
    
    setLotCompletionMap(lotMap);
    return lotMap;
  };

  const loadKarigarAssignments = async () => {
    try {
      setLoading(true);
      
      let currentProfiles = karigarProfiles;
      if (currentProfiles.length === 0) {
        const profilesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.KARIGAR_PROFILE_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
        const profilesResponse = await fetch(profilesUrl);
        
        if (profilesResponse.ok) {
          const profilesData = await profilesResponse.json();
          if (profilesData.values && profilesData.values.length > 0) {
            const headers = profilesData.values[0];
            const rows = profilesData.values.slice(1);
            
            currentProfiles = rows.map(row => ({
              timestamp: row[0] || '',
              karigarId: row[1] ? row[1].trim() : '',
              karigarName: row[2] ? row[2].trim() : '',
              dateOfBirth: row[3] || '',
              age: row[4] || '',
              gender: row[5] || '',
              floorArea: row[6] || '',
              skillType: row[7] || '',
              dateOfJoining: row[8] || '',
              supervisorType: row[9] || '',
              supervisorName: row[10] ? row[10].trim() : ''
            })).filter(p => p.karigarId && p.karigarName);
            
            setKarigarProfiles(currentProfiles);
          }
        }
      }
      
      const karigarNameMap = new Map();
      currentProfiles.forEach(profile => {
        karigarNameMap.set(profile.karigarId, profile.karigarName);
      });
      
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.KARIGAR_ASSIGNMENTS_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch karigar assignments');
      const data = await response.json();

      if (data.values && data.values.length > 0) {
        const headers = data.values[0];
        const rows = data.values.slice(1);
        
        const timestampIdx = headers.findIndex(h => h === 'Timestamp');
        const lotNumberIdx = headers.findIndex(h => h === 'Lot Number');
        const brandIdx = headers.findIndex(h => h === 'Brand');
        const fabricIdx = headers.findIndex(h => h === 'Fabric');
        const styleIdx = headers.findIndex(h => h === 'Style');
        const garmentTypeIdx = headers.findIndex(h => h === 'Garment Type');
        const assignmentsJsonIdx = headers.findIndex(h => h === 'Assignments JSON');
        const supervisorIdx = headers.findIndex(h => h === 'Supervisor');
        
        const assignments = [];
        
        for (const row of rows) {
          const lotNumber = row[lotNumberIdx] ? row[lotNumberIdx].toString().trim() : '';
          if (!lotNumber) continue;
          
          const brand = row[brandIdx] || '';
          const fabric = row[fabricIdx] || '';
          const style = row[styleIdx] || '';
          const garmentType = row[garmentTypeIdx] || '';
          const supervisor = row[supervisorIdx] || '';
          
          let assignmentsJson = {};
          try {
            if (row[assignmentsJsonIdx]) {
              assignmentsJson = JSON.parse(row[assignmentsJsonIdx]);
            }
          } catch (e) {
            console.error(`Error parsing JSON for lot ${lotNumber}:`, e);
          }
          
          for (const [shade, shadeData] of Object.entries(assignmentsJson)) {
            let karigarEntries = [];
            
            if (shadeData.karigars && Array.isArray(shadeData.karigars)) {
              karigarEntries = shadeData.karigars;
            } else if (shadeData.karigarId) {
              karigarEntries = [{
                karigarId: shadeData.karigarId,
                pcs: shadeData.pcs,
                status: shadeData.status,
                completedAt: shadeData.completedAt
              }];
            }
            
            for (const karigarData of karigarEntries) {
              const karigarId = karigarData.karigarId || '';
              const karigarName = karigarNameMap.get(karigarId) || karigarId;
              const quantity = karigarData.pcs || 0;
              const shadeStatus = karigarData.status || shadeData.status || 'pending';
              const completedAt = karigarData.completedAt || shadeData.completedAt || '';
              
              assignments.push({
                timestamp: row[timestampIdx] || '',
                lotNumber: lotNumber,
                brand: brand,
                fabric: fabric,
                style: style,
                garmentType: garmentType,
                shade: shade,
                karigarName: karigarName,
                karigarId: karigarId,
                quantity: quantity,
                savedBy: '',
                supervisor: supervisor,
                savedAt: '',
                status: shadeStatus.toLowerCase(),
                rate: 0,
                completedQuantity: shadeStatus === 'completed' ? quantity : 0,
                paymentStatus: 'pending',
                notes: '',
                completedAt: completedAt
              });
            }
          }
        }
        
        setKarigarAssignments(assignments);
        let currentPaidLots = paidLotNumbers;
        if (currentPaidLots.size === 0) {
          currentPaidLots = await fetchPaidLotNumbers();
          setPaidLotNumbers(currentPaidLots);
        }
        analyzeLotCompletion(assignments, currentPaidLots);
      }
    } catch (err) {
      console.error('Error loading karigar assignments:', err);
      setError('Failed to load karigar assignments');
    } finally {
      setLoading(false);
    }
  };

  const loadRateList = async () => {
    try {
      setLoading(true);
      
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${RATE_LIST_CONFIG.SPREADSHEET_ID}/values/'Master List'!A:K?key=${RATE_LIST_CONFIG.API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error('Failed to fetch rate list:', response.status);
        setRateList([]);
        return;
      }
      
      const data = await response.json();

      if (!data.values || data.values.length === 0) {
        console.warn('No data found in rate list sheet');
        setRateList([]);
        return;
      }

      const headers = data.values[0];
      const rows = data.values.slice(1);
      
      const rates = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) continue;
        
        const lotNo = row[8] ? row[8].toString().trim() : '';
        const rateStr = row[9] ? row[9].toString().replace('₹', '').replace(/,/g, '').trim() : '';
        const rate = parseFloat(rateStr) || 0;
        
        if (!lotNo && rate === 0) continue;
        
        let timestamp = null;
        const timestampStr = row[2] || '';
        if (timestampStr) {
          const dateParts = timestampStr.split(' ')[0].split('/');
          if (dateParts.length === 3) {
            const [day, month, year] = dateParts;
            timestamp = `${year}-${month}-${day}`;
          }
        }
        
        const rateEntry = {
          submissionId: row[1] || '',
          timestamp: timestamp,
          originalTimestamp: row[2] || '',
          submitter: row[3] || '',
          category: row[4] ? row[4].toString().trim() : '',
          displayCategory: row[5] ? row[5].toString().trim() : '',
          subcategory: row[6] ? row[6].toString().trim() : '',
          jacketType: row[7] ? row[7].toString().trim() : '',
          lotNo: lotNo,
          rate: rate,
          itemCount: parseInt(row[10]) || 0,
          srNo: row[0] || ''
        };
        
        if (rate > 0) {
          rates.push(rateEntry);
        }
      }
      
      const sortedRates = rates.sort((a, b) => {
        const aNum = parseInt(a.lotNo) || 0;
        const bNum = parseInt(b.lotNo) || 0;
        return aNum - bNum;
      });
      
      setRateList(sortedRates);
      
      if (sortedRates.length === 0) {
        setError('No valid rates found. Please check the Master List sheet structure.');
      }
      
    } catch (err) {
      console.error('Error loading rate list:', err);
      setRateList([]);
      setError('Failed to load rate list: ' + err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // Filter assignments for logged-in supervisor only
  useEffect(() => {
    if (selectedSupervisor && karigarAssignments.length > 0 && lotCompletionMap.size > 0) {
      // Find karigars under logged-in supervisor (CASE-INSENSITIVE)
      const karigarsUnderSupervisor = karigarProfiles
        .filter(profile => isSameSupervisor(profile.supervisorName, selectedSupervisor))
        .map(profile => profile.karigarId);

      console.log(`Karigars under ${selectedSupervisor}:`, karigarsUnderSupervisor);

      const supervisorAssignments = karigarAssignments.filter(
        assignment => karigarsUnderSupervisor.includes(assignment.karigarId)
      );

      console.log(`Assignments for supervisor: ${supervisorAssignments.length}`);

      const lotGroups = new Map();
      
      supervisorAssignments.forEach(assignment => {
        if (!lotGroups.has(assignment.lotNumber)) {
          lotGroups.set(assignment.lotNumber, []);
        }
        lotGroups.get(assignment.lotNumber).push(assignment);
      });

      const groupedLotsList = [];
      
      lotGroups.forEach((assignments, lotNumber) => {
        const lotInfo = lotCompletionMap.get(lotNumber);
        const normLot = normalizeLotNumber(lotNumber);
        const isPaid = paidLotNumbers.has(normLot) || (lotInfo && (lotInfo.isPaid || paidLotNumbers.has(normalizeLotNumber(lotInfo.lotNumber))));
        
        // Only include lots that are fully completed AND NOT PAID
        if (lotInfo && lotInfo.isFullyCompleted && !isPaid) {
          const completedAssignments = assignments.filter(a => a.status === 'completed');
          
          if (completedAssignments.length > 0) {
            const rateInfo = getRateFromList(completedAssignments[0]);
            const rate = rateInfo.rate;
            
            const totalQuantity = completedAssignments.reduce((sum, a) => sum + (a.completedQuantity || a.quantity), 0);
            const totalAmount = totalQuantity * rate;
            
            const shadesByKarigar = {};
            const karigarWageDetails = {};
            
            completedAssignments.forEach(a => {
              const normalizedKarigarName = normalizeName(a.karigarName);
              
              if (!shadesByKarigar[normalizedKarigarName]) {
                shadesByKarigar[normalizedKarigarName] = [];
                karigarWageDetails[normalizedKarigarName] = {
                  karigarId: a.karigarId,
                  karigarName: a.karigarName, // Keep original for display
                  totalQuantity: 0,
                  totalAmount: 0,
                  lots: []
                };
              }
              
              const quantity = a.completedQuantity || a.quantity;
              const amount = quantity * rate;
              
              shadesByKarigar[normalizedKarigarName].push({
                shade: a.shade,
                quantity: quantity,
                amount: amount
              });
              
              karigarWageDetails[normalizedKarigarName].totalQuantity += quantity;
              karigarWageDetails[normalizedKarigarName].totalAmount += amount;
              karigarWageDetails[normalizedKarigarName].lots.push({
                lotNumber: lotNumber,
                shade: a.shade,
                quantity: quantity,
                amount: amount,
                completedAt: a.completedAt
              });
            });
            
            groupedLotsList.push({
              lotNumber: lotNumber,
              brand: [...new Set(completedAssignments.map(a => a.brand))].filter(Boolean).join(', '),
              fabric: [...new Set(completedAssignments.map(a => a.fabric))].filter(Boolean).join(', '),
              style: [...new Set(completedAssignments.map(a => a.style))].filter(Boolean).join(', '),
              garmentType: [...new Set(completedAssignments.map(a => a.garmentType))].filter(Boolean).join(', '),
              rate: rate,
              rateInfo: rateInfo,
              totalQuantity: totalQuantity,
              totalAmount: totalAmount,
              karigarCount: lotInfo.karigars.size,
              shadeCount: lotInfo.completedShades.size,
              totalShades: lotInfo.shades.size,
              completedAssignments: completedAssignments,
              shadesByKarigar: shadesByKarigar,
              karigarWageDetails: karigarWageDetails,
              assignments: completedAssignments
            });
          }
        }
      });

      setGroupedLots(groupedLotsList);
      
      const totalLots = groupedLotsList.length;
      const totalAmount = groupedLotsList.reduce((sum, lot) => sum + lot.totalAmount, 0);
      const totalQuantity = groupedLotsList.reduce((sum, lot) => sum + lot.totalQuantity, 0);
      const uniqueKarigars = new Set();
      groupedLotsList.forEach(lot => {
        lot.assignments.forEach(a => uniqueKarigars.add(normalizeName(a.karigarName)));
      });
      
      const paidCount = Array.from(lotCompletionMap.values()).filter(lot => {
        const normLot = normalizeLotNumber(lot.lotNumber);
        return lot.isFullyCompleted && (lot.isPaid || paidLotNumbers.has(normLot));
      }).length;
      
      const fullyCompletedCount = Array.from(lotCompletionMap.values()).filter(lot => lot.isFullyCompleted).length;
      
      setDebugInfo(`Supervisor: ${selectedSupervisor}
Fully completed lots: ${fullyCompletedCount}
Already paid lots: ${paidCount}
Available lots for payment: ${totalLots}`);
      
      setSupervisorSummary({
        totalLots,
        totalAmount,
        totalQuantity,
        totalKarigars: uniqueKarigars.size,
        karigars: Array.from(uniqueKarigars),
        totalAssignments: groupedLotsList.reduce((sum, lot) => sum + lot.assignments.length, 0)
      });

      setSelectedLots([]);
      setExpandedLots(new Set());
    } else {
      setGroupedLots([]);
      setSupervisorSummary(null);
      setSelectedLots([]);
      setExpandedLots(new Set());
    }
  }, [selectedSupervisor, karigarAssignments, karigarProfiles, rateList, lotCompletionMap, paidLotNumbers]);

  useEffect(() => {
    let filtered = [...groupedLots];
    
    if (searchQuery) {
      filtered = filtered.filter(lot => 
        lot.lotNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.fabric.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.style.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    filtered.sort((a, b) => {
      let aVal = a[sortBy] || '';
      let bVal = b[sortBy] || '';
      
      if (sortBy === 'totalAmount' || sortBy === 'totalQuantity' || sortBy === 'rate') {
        aVal = Number(aVal);
        bVal = Number(bVal);
      }
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    setFilteredLots(filtered);
  }, [groupedLots, searchQuery, sortBy, sortOrder]);

  useEffect(() => {
    if (karigarProfiles.length > 0 && karigarAssignments.length === 0) {
      loadKarigarAssignments();
    }
  }, [karigarProfiles]);

  const getRateFromList = (assignment) => {
    if (!rateList || rateList.length === 0) {
      return { rate: 0, source: 'none', matchedFrom: 'No rate list available' };
    }

    const assignmentLotNo = assignment.lotNumber ? assignment.lotNumber.toString().trim() : '';
    
    let matchedRate = rateList.find(r => {
      const rateLotNo = r.lotNo ? r.lotNo.toString().trim() : '';
      return rateLotNo === assignmentLotNo;
    });

    if (matchedRate) {
      return { rate: matchedRate.rate, source: 'rateList', matchedFrom: `Exact lot match: ${matchedRate.lotNo}`, rateDetails: matchedRate };
    }

    const numericAssignmentLot = parseInt(assignmentLotNo);
    if (!isNaN(numericAssignmentLot)) {
      matchedRate = rateList.find(r => {
        const numericRateLot = parseInt(r.lotNo);
        return !isNaN(numericRateLot) && numericRateLot === numericAssignmentLot;
      });
      
      if (matchedRate) {
        return { rate: matchedRate.rate, source: 'rateList', matchedFrom: `Numeric lot match: ${matchedRate.lotNo}`, rateDetails: matchedRate };
      }
    }

    return { rate: 0, source: 'none', matchedFrom: `No rate found for lot ${assignment.lotNumber}` };
  };

  const generatePayableId = () => {
    const prefix = 'PAY';
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}${year}${month}${random}`;
  };

  const generateThekedarPaymentId = () => {
    const prefix = 'THEKPAY';
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}_${timestamp}_${random}`;
  };

  const handleSelectAllLots = () => {
    if (selectedLots.length === filteredLots.length) {
      setSelectedLots([]);
    } else {
      setSelectedLots(filteredLots.map(lot => lot.lotNumber));
    }
  };

  const handleLotSelection = (lotNumber) => {
    setSelectedLots(prev => {
      if (prev.includes(lotNumber)) {
        return prev.filter(l => l !== lotNumber);
      } else {
        return [...prev, lotNumber];
      }
    });
  };

  const toggleLotExpand = (lotNumber) => {
    const newExpanded = new Set(expandedLots);
    if (newExpanded.has(lotNumber)) {
      newExpanded.delete(lotNumber);
    } else {
      newExpanded.add(lotNumber);
    }
    setExpandedLots(newExpanded);
  };

  const calculateTotalAmount = () => {
    return filteredLots
      .filter(lot => selectedLots.includes(lot.lotNumber))
      .reduce((sum, lot) => sum + lot.totalAmount, 0);
  };

  const calculateTotalQuantity = () => {
    return filteredLots
      .filter(lot => selectedLots.includes(lot.lotNumber))
      .reduce((sum, lot) => sum + lot.totalQuantity, 0);
  };

  const getSelectedLotsData = () => {
    const selected = filteredLots.filter(lot => selectedLots.includes(lot.lotNumber));
    return selected;
  };

  const handleCreatePayment = () => {
    const totalAmount = calculateTotalAmount();
    const lotNumbers = selectedLots.join(', ');
    
    setFormData({
      ...formData,
      payeeId: selectedSupervisor,
      payeeName: selectedSupervisor,
      amount: totalAmount,
      category: 'Supervisor Payment',
      description: `Payment for completed lots under supervisor ${selectedSupervisor}. Lots: ${lotNumbers}`,
    });
    setCurrentStep(3);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const saveToThekedarPaymentsSheet = async (paymentData, selectedLotsData, supervisorSummaryData) => {
    try {
      const thekedarPaymentId = generateThekedarPaymentId();
      const currentTimestamp = new Date().toISOString();
      
      const lotsData = [];
      selectedLotsData.forEach(lot => {
        lotsData.push({
          lotNumber: lot.lotNumber,
          brand: lot.brand,
          fabric: lot.fabric,
          style: lot.style,
          garmentType: lot.garmentType,
          totalQuantity: lot.totalQuantity,
          totalAmount: lot.totalAmount,
          rate: lot.rate,
          karigars: Object.keys(lot.karigarWageDetails || {}),
          shades: Array.from(lot.completedAssignments?.map(a => a.shade) || []),
          assignments: lot.assignments
        });
      });
      
      const assignmentsData = selectedLotsData.flatMap(lot => 
        lot.assignments.map(assignment => ({
          ...assignment,
          paymentId: paymentData.payableId,
          savedAt: currentTimestamp
        }))
      );
      
      const karigarDetails = [];
      selectedLotsData.forEach(lot => {
        if (lot.karigarWageDetails) {
          Object.values(lot.karigarWageDetails).forEach(karigar => {
            karigarDetails.push(karigar);
          });
        }
      });
      
      const rateDetails = {
        totalAmount: calculateTotalAmount(),
        totalQuantity: calculateTotalQuantity(),
        totalLots: selectedLots.length,
        totalKarigars: new Set(karigarDetails.map(k => k.karigarId)).size,
        rateInfo: selectedLotsData[0]?.rateInfo || null
      };
      
      const paymentSummary = {
        totalLots: selectedLots.length,
        totalAmount: calculateTotalAmount(),
        totalQuantity: calculateTotalQuantity(),
        totalKarigars: new Set(karigarDetails.map(k => k.karigarId)).size,
        karigars: [...new Set(karigarDetails.map(k => k.karigarId))],
        totalAssignments: assignmentsData.length,
        savedAt: currentTimestamp,
        supervisorName: selectedSupervisor,
        timestamp: currentTimestamp
      };
      
      const completePaymentData = {
        payment: paymentData,
        lots: lotsData,
        assignments: assignmentsData,
        karigars: karigarDetails,
        summary: paymentSummary
      };
      
      const newPaymentRow = [
        currentTimestamp,
        thekedarPaymentId,
        paymentData.payableId,
        selectedSupervisor,
        selectedSupervisor,
        calculateTotalAmount(),
        'paid',
        paymentData.dueDate,
        paymentData.paymentDate || '',
        'Supervisor Payment',
        paymentData.description,
        paymentData.reference || '',
        paymentData.notes || '',
        supervisor?.name || 'Unknown',
        currentTimestamp,
        currentTimestamp,
        calculateTotalQuantity(),
        selectedLots.length,
        new Set(karigarDetails.map(k => k.karigarId)).size,
        JSON.stringify(lotsData),
        JSON.stringify(assignmentsData),
        JSON.stringify(karigarDetails),
        JSON.stringify(rateDetails),
        JSON.stringify(paymentSummary),
        JSON.stringify(completePaymentData),
        paymentData.payableId,
        'URL-Encoded API',
        supervisor?.name || 'Unknown'
      ];
      
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${THEKEDAR_PAYMENTS_CONFIG.SPREADSHEET_ID}/values/${THEKEDAR_PAYMENTS_CONFIG.RANGE}:append?valueInputOption=USER_ENTERED&key=${THEKEDAR_PAYMENTS_CONFIG.API_KEY}`;
      
      const response = await fetch(appendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [newPaymentRow]
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save to ThekedarPayments sheet');
      }
      
      const newPaidLots = new Set(paidLotNumbers);
      selectedLots.forEach(lotNumber => {
        newPaidLots.add(normalizeLotNumber(lotNumber));
      });
      setPaidLotNumbers(newPaidLots);
      
      await loadThekedarPayments();
      
      return { success: true, paymentId: thekedarPaymentId };
      
    } catch (err) {
      console.error('Error saving to ThekedarPayments:', err);
      return { success: false, error: err.message };
    }
  };

  const savePaymentToGoogleSheets = async (paymentData, selectedLotsData, supervisorSummaryData) => {
    try {
      const thekedarResult = await saveToThekedarPaymentsSheet(paymentData, selectedLotsData, supervisorSummaryData);
      
      if (!thekedarResult.success) {
        console.warn('Warning: Could not save to ThekedarPayments sheet:', thekedarResult.error);
      }
      
      const dataPackage = {
        action: 'saveThekedarPayment',
        paymentData: {
          ...paymentData,
          payableId: paymentData.payableId,
          voucherNumber: paymentData.payableId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        selectedLotsData: selectedLotsData.flatMap(lot => lot.assignments.map(assignment => ({
          ...assignment,
          savedAt: new Date().toISOString(),
          paymentId: paymentData.payableId
        }))),
        karigarWageDetails: selectedLotsData.flatMap(lot => 
          Object.values(lot.karigarWageDetails || {})
        ),
        supervisorSummary: {
          ...supervisorSummaryData,
          savedAt: new Date().toISOString(),
          supervisorName: selectedSupervisor,
          paidLots: selectedLots
        },
        metadata: {
          generatedBy: supervisor?.name || 'Unknown',
          generatedAt: new Date().toISOString(),
          source: 'ThekedarPaymentComponent',
          paymentMethod: 'URL-Encoded API',
          timestamp: new Date().toISOString()
        }
      };
      
      const formBody = new URLSearchParams({
        action: 'saveThekedarPayment',
        data: JSON.stringify(dataPackage),
        timestamp: new Date().toISOString(),
        supervisor: selectedSupervisor || '',
        amount: paymentData.amount || '0',
        voucherNumber: paymentData.payableId || ''
      }).toString();
      
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody
      });
      
      let result;
      const responseText = await response.text();
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        console.warn('Could not parse JSON response:', responseText);
        result = { success: false, error: 'Invalid response from server' };
      }
      
      if (result.success || thekedarResult.success) {
        console.log('✅ Payment data saved successfully');
        return { success: true, paymentId: result.paymentId || thekedarResult.paymentId, voucherNumber: result.voucherNumber };
      } else {
        console.error('❌ Failed to save payment data:', result.error);
        return { success: false, error: result.error };
      }
      
    } catch (err) {
      console.error('Error saving to Google Sheets:', err);
      return { success: false, error: err.message };
    }
  };

  const generatePaymentSlipPDF = (payableData, selectedLotsData) => {
    const payableId = payableData.payableId || generatePayableId();
    
    const numberToWords = (num) => {
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      
      const numToWords = (n) => {
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
        if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + numToWords(n%100) : '');
        if (n < 100000) return numToWords(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + numToWords(n%1000) : '');
        if (n < 10000000) return numToWords(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + numToWords(n%100000) : '');
        return numToWords(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + numToWords(n%10000000) : '');
      };
      
      const whole = Math.floor(num);
      const words = numToWords(whole);
      return words;
    };

    const amountInWords = numberToWords(payableData.amount);
    const supervisorName = selectedSupervisor || payableData.createdBy || 'Supervisor';
    
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 8;
    let yPos = 18;

    const formatNumber = (num) => {
      return parseFloat(num || 0).toLocaleString('en-IN');
    };

    const currentDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const allKarigarWages = new Map();
    
    selectedLotsData.forEach(lot => {
      if (lot.karigarWageDetails) {
        Object.entries(lot.karigarWageDetails).forEach(([normalizedKarigar, karigar]) => {
          // Use normalized name as key for consistent grouping
          const key = normalizedKarigar;
          if (!allKarigarWages.has(key)) {
            allKarigarWages.set(key, {
              karigarId: karigar.karigarId,
              karigarName: karigar.karigarName, // Keep original for display
              totalQuantity: 0,
              totalAmount: 0,
              supervisor: supervisorName,
              lots: []
            });
          }
          const existing = allKarigarWages.get(key);
          existing.totalQuantity += karigar.totalQuantity;
          existing.totalAmount += karigar.totalAmount;
          existing.lots.push(...karigar.lots);
        });
      }
    });
    
    const karigarWageArray = Array.from(allKarigarWages.values()).sort((a, b) => 
      normalizeName(a.karigarName).localeCompare(normalizeName(b.karigarName))
    );
    
    // Calculate grand totals
    const grandTotalQuantity = selectedLotsData.reduce((sum, lot) => sum + lot.totalQuantity, 0);
    const grandTotalAmount = selectedLotsData.reduce((sum, lot) => sum + lot.totalAmount, 0);
    
    // Calculate karigar summary totals
    const karigarTotalQuantity = karigarWageArray.reduce((sum, k) => sum + k.totalQuantity, 0);
    const karigarTotalAmount = karigarWageArray.reduce((sum, k) => sum + k.totalAmount, 0);

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(5, 5, pageWidth - 10, pageHeight - 10);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("PAYMENT VOUCHER", pageWidth / 2, yPos, { align: "center" });
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("THEKEDAR SUPERVISOR PAYMENT SLIP", pageWidth / 2, yPos + 6, { align: "center" });
    
    doc.setFont("helvetica", "bold");
    doc.text("VOUCHER NUMBER: " + payableId, pageWidth - margin - 2, yPos, { align: "right" });

    yPos += 12;

    doc.setLineWidth(0.3);
    doc.rect(margin, yPos, pageWidth - (margin * 2), 28);
    doc.line(pageWidth / 2 + 5, yPos, pageWidth / 2 + 5, yPos + 28);

    doc.setFontSize(9);
    const leftX = margin + 3;
    const rightX = pageWidth / 2 + 8;

    doc.setFont("helvetica", "bold"); doc.text("DATE:", leftX, yPos + 6);
    doc.setFont("helvetica", "normal"); doc.text(currentDate, leftX + 15, yPos + 6);
    doc.setFont("helvetica", "bold"); doc.text("PAYEE:", leftX, yPos + 12);
    doc.setFont("helvetica", "normal"); doc.text(payableData.payeeName || '', leftX + 18, yPos + 12);
    doc.setFont("helvetica", "bold"); doc.text("CATEGORY:", leftX, yPos + 18);
    doc.setFont("helvetica", "normal"); doc.text(payableData.category || '', leftX + 22, yPos + 18);
    doc.setFont("helvetica", "bold"); doc.text("STATUS:", leftX, yPos + 24);
    doc.setFont("helvetica", "normal"); doc.text(payableData.status || '', leftX + 18, yPos + 24);

    doc.setFont("helvetica", "bold"); doc.text("DUE DATE:", rightX, yPos + 6);
    doc.setFont("helvetica", "normal"); doc.text(new Date(payableData.dueDate).toLocaleDateString('en-IN'), rightX + 20, yPos + 6);
    doc.setFont("helvetica", "bold"); doc.text("PAYEE ID:", rightX, yPos + 12);
    doc.setFont("helvetica", "normal"); doc.text(payableData.payeeId || '', rightX + 20, yPos + 12);
    doc.setFont("helvetica", "bold"); doc.text("TOTAL QTY:", rightX, yPos + 18);
    doc.setFont("helvetica", "normal"); doc.text(Math.round(grandTotalQuantity).toString(), rightX + 22, yPos + 18);
    doc.setFont("helvetica", "bold"); doc.text("THEKEDAR:", rightX, yPos + 24);
    doc.setFont("helvetica", "normal"); doc.text(supervisorName, rightX + 22, yPos + 24);

    yPos += 28;

    doc.setLineWidth(0.3);
    doc.rect(margin, yPos, pageWidth - (margin * 2), 10);
    doc.setFont("helvetica", "bold");
    doc.text("Amount in Words :", margin + 3, yPos + 6.5);
    doc.setFont("helvetica", "normal");
    doc.text(amountInWords + " Rupees Only", margin + 35, yPos + 6.5);

    yPos += 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("LOT SUMMARY", margin, yPos);
    yPos += 5;

    const lotTableBody = selectedLotsData.map((lot, idx) => [
      (idx + 1).toString(),
      lot.lotNumber || '',
      lot.brand || '',
      lot.fabric || '',
      lot.garmentType || '',
      lot.karigarCount.toString(),
      lot.totalQuantity.toString(),
      lot.rate.toFixed(2),
      formatNumber(lot.totalAmount)
    ]);

    // Add total row to LOT SUMMARY table
    lotTableBody.push([
      '',
      '',
      '',
      '',
      '',
      'TOTAL',
      grandTotalQuantity.toString(),
      '',
      formatNumber(grandTotalAmount)
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['NO', 'LOT NO', 'BRAND', 'FABRIC', 'GARMENT TYPE', 'KARIGARS', 'QTY', 'RATE', 'AMOUNT']],
      body: lotTableBody,
      theme: 'grid',
      styles: { 
        lineColor: [0, 0, 0], 
        lineWidth: 0.2, 
        textColor: [0, 0, 0], 
        halign: 'center',
        fontSize: 8,
        cellPadding: 2
      },
      headStyles: { 
        fillColor: [240, 240, 240], 
        textColor: [0, 0, 0], 
        fontStyle: 'bold',
        lineWidth: 0.2
      },
      bodyStyles: (data) => {
        // Style the total row (last row) with header-style background and bold
        if (data.row.index === lotTableBody.length - 1) {
          return {
            fontStyle: 'bold',
            fillColor: [240, 240, 240], // Same as header background
            textColor: [0, 0, 0],
            halign: 'center'
          };
        }
        return {};
      },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 30, halign: 'center' },
        4: { cellWidth: 28, halign: 'center' },
        5: { cellWidth: 25, halign: 'center' },
        6: { cellWidth: 15, halign: 'center' },
        7: { cellWidth: 18, halign: 'center' },
        8: { cellWidth: 25, halign: 'center' }
      }
    });

    yPos = doc.lastAutoTable.finalY + 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("KARIGAR WISE SUMMARY", margin, yPos);
    yPos += 5;

    const karigarSummaryBody = [
      ...karigarWageArray.map((karigar, idx) => [
        (idx + 1).toString(),
        karigar.karigarId,
        karigar.karigarName,
        supervisorName,
        formatNumber(karigar.totalQuantity),
        formatNumber(karigar.totalAmount)
      ]),
      [
        '',
        '',
        '',
        'TOTAL',
        formatNumber(karigarTotalQuantity),
        formatNumber(karigarTotalAmount)
      ]
    ];

    autoTable(doc, {
      startY: yPos,
      head: [['NO', 'KARIGAR ID', 'KARIGAR NAME', 'SUPERVISOR/THEKEDAR', 'TOTAL QTY', 'TOTAL AMOUNT']],
      body: karigarSummaryBody,
      theme: 'grid',
      styles: { 
        lineColor: [0, 0, 0], 
        lineWidth: 0.2, 
        textColor: [0, 0, 0], 
        halign: 'center',
        fontSize: 8,
        cellPadding: 2
      },
      headStyles: { 
        fillColor: [240, 240, 240], 
        textColor: [0, 0, 0], 
        fontStyle: 'bold',
        lineWidth: 0.2
      },
      bodyStyles: (data) => {
        if (data.row.index === karigarSummaryBody.length - 1) {
          return {
            fontStyle: 'bold',
            fillColor: [240, 240, 240], // Same as header background
            textColor: [0, 0, 0]
          };
        }
        return {};
      },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 35, halign: 'center' },
        2: { cellWidth: 45, halign: 'center' },
        3: { cellWidth: 45, halign: 'center' },
        4: { cellWidth: 25, halign: 'center' },
        5: { cellWidth: 32, halign: 'center' }
      }
    });

    yPos = doc.lastAutoTable.finalY + 12;

    const lotDetailsMap = new Map();
    selectedLotsData.forEach(lot => {
      lotDetailsMap.set(lot.lotNumber, {
        garmentType: lot.garmentType || '',
        brand: lot.brand || '',
        rate: lot.rate
      });
    });

    for (let kIdx = 0; kIdx < karigarWageArray.length; kIdx++) {
      const karigar = karigarWageArray[kIdx];
      
      if (yPos + 60 > pageHeight - 35) {
        doc.addPage();
        yPos = 20;
        
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("DETAILED KARIGAR WAGE BREAKDOWN (Continued)", margin, yPos);
        yPos += 5;
      }
      
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.rect(margin, yPos, pageWidth - (margin * 2), 12);
      doc.setFillColor(230, 230, 230);
      doc.rect(margin, yPos, pageWidth - (margin * 2), 12, 'F');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("KARIGAR ID: " + karigar.karigarId, margin + 3, yPos + 5);
      doc.text("NAME: " + karigar.karigarName, margin + 65, yPos + 5);
      doc.text("SUPERVISOR: " + supervisorName, margin + 130, yPos + 5);
      
      yPos += 16;
      
      const karigarTableBody = [];
      
      karigar.lots.forEach((lot, lotIdx) => {
        const lotDetails = lotDetailsMap.get(lot.lotNumber) || {};
        const garmentType = lotDetails.garmentType || '';
        const rate = lotDetails.rate || 0;
        
        karigarTableBody.push([
          (lotIdx + 1).toString(),
          lot.lotNumber,
          garmentType,
          lot.shade,
          lot.quantity.toString(),
          rate.toFixed(2),
          formatNumber(lot.amount)
        ]);
      });
      
      const dataRowsLength = karigarTableBody.length;
      
      // Add empty rows for spacing
      karigarTableBody.push(['', '', '', '', '', '', '']);
      karigarTableBody.push(['', '', '', '', '', '', '']);
      
      // Add total row with both quantity and amount
      karigarTableBody.push([
        '',
        '',
        '',
        'TOTAL QTY',
        karigar.totalQuantity.toString(),
        'TOTAL',
        formatNumber(karigar.totalAmount)
      ]);
      
      // Add ADVANCE row below total
      karigarTableBody.push([
        '',
        '',
        '',
        '',
        '',
        'ADVANCE',
        ''
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [['NO', 'LOT NO', 'GARMENT TYPE', 'SHADE', 'QTY', 'RATE', 'AMOUNT']],
        body: karigarTableBody,
        theme: 'grid',
        styles: { 
          lineColor: [0, 0, 0], 
          lineWidth: 0.2, 
          textColor: [0, 0, 0], 
          halign: 'center',
          fontSize: 8,
          cellPadding: 2
        },
        headStyles: { 
          fillColor: [245, 245, 245], 
          textColor: [0, 0, 0], 
          fontStyle: 'bold',
          lineWidth: 0.2
        },
        bodyStyles: (data) => {
          if (data.row.index === karigarTableBody.length - 2) { // Total row
            return {
              fontStyle: 'bold',
              fillColor: [240, 240, 240],
              textColor: [0, 0, 0]
            };
          }
          if (data.row.index === karigarTableBody.length - 1) { // Advance row
            return {
              fontStyle: 'bold',
              fillColor: [255, 245, 235],
              textColor: [0, 0, 0]
            };
          }
          if (data.row.index >= dataRowsLength && data.row.index < dataRowsLength + 2) {
            return {
              fillColor: [255, 255, 240]
            };
          }
          return {};
        },
        margin: { left: margin, right: margin },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          1: { cellWidth: 22, halign: 'center' },
          2: { cellWidth: 38, halign: 'center' },
          3: { cellWidth: 45, halign: 'center' },
          4: { cellWidth: 20, halign: 'center' },
          5: { cellWidth: 22, halign: 'center' },
          6: { cellWidth: 35, halign: 'center' }
        }
      });
      
      yPos = doc.lastAutoTable.finalY + 8;
      
      // Simple RECD SIGN on the RIGHT side - no box, just text with signature line
      const recdSignText = "RECD SIGN ____________________";
      const textWidth = doc.getTextWidth(recdSignText);
      const rightMarginX = pageWidth - margin - 10;
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(recdSignText, rightMarginX - textWidth, yPos + 5);
      
      yPos += 12;
      
      if (kIdx < karigarWageArray.length - 1) {
        doc.setDrawColor(150, 150, 150);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 8;
      }
    }

    // ========== SIMPLIFIED PAYMENT SLIP PAGE ==========
    doc.addPage();
    yPos = 20;
    
    // Main page border
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(5, 5, pageWidth - 10, pageHeight - 10);
    
    // 1. Header Titles
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("PAYMENT SLIP", pageWidth / 2, yPos, { align: "center" });
    yPos += 7;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("THEKEDAR / SUPERVISOR PAYMENT SLIP", pageWidth / 2, yPos, { align: "center" });
    yPos += 10;
    
    // 2. Info Box Section
    const infoBoxHeight = 25;
    const infoBoxWidth = pageWidth - (margin * 2);
    const splitPoint = infoBoxWidth * 0.6;

    doc.setLineWidth(0.3);
    doc.rect(margin, yPos, infoBoxWidth, infoBoxHeight);
    doc.line(margin + splitPoint, yPos, margin + splitPoint, yPos + infoBoxHeight);

    // Left Side Details
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("VCH NO:", margin + 5, yPos + 7);
    doc.setFont("helvetica", "normal");
    doc.text(payableId, margin + 25, yPos + 7);

    doc.setFont("helvetica", "bold");
    doc.text("DATE:", margin + 5, yPos + 13);
    doc.setFont("helvetica", "normal");
    doc.text(currentDate, margin + 25, yPos + 13);

    doc.setFont("helvetica", "bold");
    doc.text("PAYEE NAME:", margin + 5, yPos + 19);
    doc.setFont("helvetica", "normal");
    doc.text(payableData.payeeName || '', margin + 35, yPos + 19);

    // Right Side Amount Box
    doc.setFont("helvetica", "bold");
    doc.text("AMOUNT", margin + splitPoint + (infoBoxWidth - splitPoint) / 2, yPos + 6, { align: "center" });
    
    const innerBoxW = (infoBoxWidth - splitPoint) - 10;
    doc.rect(margin + splitPoint + 5, yPos + 8, innerBoxW, 12);
    doc.setFontSize(11);
    doc.text("Rs. " + formatNumber(payableData.amount), margin + splitPoint + (infoBoxWidth - splitPoint) / 2, yPos + 16, { align: "center" });

    yPos += infoBoxHeight + 10;
    
    // 3. LOT SUMMARY Table
    const paymentSlipLotBody = selectedLotsData.map((lot, idx) => [
      (idx + 1).toString(),
      lot.lotNumber || '',
      lot.garmentType || '',
      lot.totalQuantity.toString(),
      lot.rate.toFixed(2),
      formatNumber(lot.totalAmount)
    ]);
    
    paymentSlipLotBody.push([
      '', '', 'TOTAL', 
      grandTotalQuantity.toString(), 
      '', 
      formatNumber(grandTotalAmount)
    ]);
    
    autoTable(doc, {
      startY: yPos,
      head: [['NO', 'LOT NUMBER', 'GARMENT TYPE', 'QTY', 'RATE', 'AMOUNT']],
      body: paymentSlipLotBody,
      theme: 'grid',
      styles: { 
        lineColor: [0, 0, 0], 
        lineWidth: 0.2, 
        textColor: [0, 0, 0], 
        halign: 'center',
        fontSize: 9,
        cellPadding: 1.5
      },
      headStyles: { 
        fillColor: [240, 240, 240], 
        textColor: [0, 0, 0], 
        fontStyle: 'bold'
      },
      bodyStyles: (data) => {
        if (data.row.index === paymentSlipLotBody.length - 1) {
          return { 
            fontStyle: 'bold', 
            fillColor: [240, 240, 240]
          };
        }
        return {};
      },
      margin: { left: margin, right: margin }
    });
    
    yPos = doc.lastAutoTable.finalY + 15;

    // 4. Triple Signature Footer
    const sigWidth = (pageWidth - (margin * 2) - 20) / 3;
    const sigY = pageHeight - 35;

    const drawSig = (x, label) => {
      doc.line(x, sigY, x + sigWidth, sigY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(label, x + (sigWidth / 2), sigY + 5, { align: "center" });
    };

    drawSig(margin, "VERIFICATION (CHECKED)");
    drawSig(margin + sigWidth + 10, "MOHIT SIR");
    drawSig(margin + (sigWidth * 2) + 20, "SAHIL SIR");

    // Page numbering logic
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text("Page " + i + " of " + pageCount, pageWidth / 2, pageHeight - 8, { align: "center" });
    }
    doc.save("Thekedar_Voucher_" + payableId + ".pdf");
    
    return payableId;
  };

  const submitPayable = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setShowStorageSuccess(false);

    try {
      if (!formData.payeeName || !formData.amount || !formData.dueDate) {
        throw new Error('Please fill all required fields');
      }

      const payableId = generatePayableId();
      const selectedLotsData = getSelectedLotsData();
      
      const paymentData = {
        ...formData,
        payableId: payableId,
        voucherNumber: payableId,
        payableType: 'supplier',
        supervisor: selectedSupervisor || supervisor?.name || 'Supervisor',
        processedAt: new Date().toISOString(),
        status: 'paid'
      };

      generatePaymentSlipPDF(paymentData, selectedLotsData);
      
      const saved = await savePaymentToGoogleSheets(paymentData, selectedLotsData, supervisorSummary);
      
      if (saved.success) {
        setShowStorageSuccess(true);
        setTimeout(() => setShowStorageSuccess(false), 5000);
        
        await loadKarigarAssignments();
        await loadThekedarPayments();
        
        // Refresh current supervisor view
        if (selectedSupervisor) {
          // Force refresh by re-triggering the useEffect
          setSelectedLots([]);
          setCurrentStep(2);
        }
      } else {
        setError(`PDF generated but could not save to Google Sheets: ${saved.error}`);
        setTimeout(() => setError(''), 8000);
      }
      
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      
      resetForm();

    } catch (err) {
      console.error('Error in payment process:', err);
      setError(err.message || 'Failed to process payment');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      payableId: '',
      payableType: 'supplier',
      payeeId: '',
      payeeName: '',
      amount: '',
      dueDate: new Date().toISOString().split('T')[0],
      paymentDate: '',
      status: 'pending',
      category: 'Supervisor Payment',
      description: '',
      reference: '',
      notes: '',
      createdBy: supervisor?.name || 'Unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setSelectedLots([]);
    setCurrentStep(1);
  };

  const StepIndicator = () => (
    <div className="tp-step-indicator">
      <div className={`tp-step ${currentStep >= 1 ? 'tp-step-active' : ''}`}>
        <div className="tp-step-number">1</div>
        <div className="tp-step-label">Verify Thekedar</div>
        {currentStep > 1 && <div className="tp-step-check">✓</div>}
      </div>
      <div className={`tp-step-connector ${currentStep >= 2 ? 'tp-step-connector-active' : ''}`}></div>
      <div className={`tp-step ${currentStep >= 2 ? 'tp-step-active' : ''}`}>
        <div className="tp-step-number">2</div>
        <div className="tp-step-label">Select Lots</div>
        {currentStep > 2 && <div className="tp-step-check">✓</div>}
      </div>
      <div className={`tp-step-connector ${currentStep >= 3 ? 'tp-step-connector-active' : ''}`}></div>
      <div className={`tp-step ${currentStep >= 3 ? 'tp-step-active' : ''}`}>
        <div className="tp-step-number">3</div>
        <div className="tp-step-label">Payment Details</div>
      </div>
    </div>
  );

  const EducationalInfo = () => (
    <div className="tp-educational-section">
      <div className="tp-educational-card">
        <div className="tp-educational-icon">📋</div>
        <h3>What is Thekedar Payment?</h3>
        <p>Thekedar (Supervisor) Payment allows you to process payments to supervisors for completed production lots. When all karigars under your supervision complete their assigned work for a lot, you can generate payment vouchers.</p>
      </div>

      <div className="tp-educational-card">
        <div className="tp-educational-icon">✅</div>
        <h3>How It Works</h3>
        <ol className="tp-educational-list">
          <li><strong>View Completed Lots:</strong> Only lots where ALL shades are completed AND not yet paid appear</li>
          <li><strong>Select Lots:</strong> Choose the fully completed lots for payment</li>
          <li><strong>Generate Voucher:</strong> Create an official payment slip with all details</li>
        </ol>
      </div>

      <div className="tp-educational-card">
        <div className="tp-educational-icon">💰</div>
        <h3>Karigar Wages in PDF</h3>
        <p>The payment voucher now includes:</p>
        <ul className="tp-educational-list">
          <li><strong>Karigar-wise wage summary</strong> - Each karigar's total earnings</li>
          <li><strong>Lot-wise breakdown</strong> - Which lots contributed to each karigar's wages</li>
          <li><strong>Shade-wise details</strong> - Individual shade quantities and amounts</li>
        </ul>
      </div>

      <div className="tp-educational-card">
        <div className="tp-educational-icon">🚀</div>
        <h3>Ready to Start?</h3>
        <p>Select completed lots below to process your payment.</p>
      </div>
    </div>
  );

  const UnauthorizedMessage = () => (
    <div className="tp-empty-state">
      <div className="tp-empty-icon">🔒</div>
      <h3>Unauthorized Access</h3>
      <p>You are not authorized to view thekedar payment information.</p>
      <p>Please contact the administrator if you believe this is an error.</p>
      <button onClick={onBack} className="tp-btn tp-btn-primary" style={{ marginTop: '20px' }}>
        Go Back
      </button>
    </div>
  );

  const NoLotsFound = () => (
    <div className="tp-info-banner">
      <div className="tp-info-icon">ℹ️</div>
      <div className="tp-info-content">
        <strong>No unpaid completed lots found</strong>
        <p>You don't have any unpaid fully completed lots. Lots appear here only when ALL shades assigned to karigars under your supervision are marked as completed AND not yet paid.</p>
        {paidLotNumbers.size > 0 && <p><strong>Note:</strong> {paidLotNumbers.size} lot(s) have already been paid and are not shown.</p>}
      </div>
    </div>
  );

  return (
    <div className="tp-container">
      {/* Header */}
      <div className="tp-header">
        <button onClick={onBack} className="tp-back-btn">← Back</button>
        <div className="tp-header-center">
          <h1 className="tp-title">Thekedar Payment</h1>
          <p className="tp-subtitle">Process payments for completed lots under your supervision</p>
        </div>
        <div className="tp-user">
          <div className="tp-avatar">{selectedSupervisor?.charAt(0) || 'U'}</div>
          <div>
            <div className="tp-user-name">{selectedSupervisor || 'Unknown'}</div>
            <div className="tp-user-role">Thekedar / Supervisor</div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {showSuccess && <div className="tp-alert tp-alert-success">✓ Payment slip generated successfully!</div>}
      {showStorageSuccess && <div className="tp-alert tp-alert-success">💾 Payment data saved to Google Sheets!</div>}
      {error && !error.includes('unauthorized') && <div className="tp-alert tp-alert-error">⚠ {error}</div>}
      {debugInfo && <div className="tp-alert tp-alert-info">ℹ️ {debugInfo}</div>}
      
      {/* Paid Lots Info Alert */}
      {paidLotNumbers.size > 0 && selectedSupervisor && groupedLots.length === 0 && (
        <div className="tp-alert tp-alert-info">
          ℹ️ {paidLotNumbers.size} lot(s) have already been paid. Check completed lots above for pending payments.
        </div>
      )}

      {/* Authorization Check */}
      {!authorized && !loading && <UnauthorizedMessage />}

      {/* Loading State */}
      {loading && (
        <div className="tp-loading">
          <div className="tp-spinner"></div>
          <p>Loading data from Google Sheets...</p>
        </div>
      )}

      {/* Main Content - Only show if authorized */}
      {!loading && authorized && (
        <>
          {/* Step Indicator */}
          {selectedSupervisor && currentStep > 1 && <StepIndicator />}

          {/* Step 1: Verify Thekedar / Welcome Screen */}
          {currentStep === 1 && (
            <div className="tp-card">
              <div className="tp-card-header">
                <h2 className="tp-card-title">Welcome, {selectedSupervisor}</h2>
                <p className="tp-card-subtitle">You are logged in as a thekedar/supervisor</p>
              </div>
              <div className="tp-card-body">
                <div className="tp-welcome-section">
                  <div className="tp-welcome-icon">👋</div>
                  <p>You can view and process payments for lots that have been fully completed under your supervision.</p>
                  <button 
                    className="tp-proceed-btn" 
                    onClick={() => setCurrentStep(2)}
                    style={{ marginTop: '20px', minWidth: '200px' }}
                  >
                    View My Completed Lots →
                  </button>
                </div>
                
                <EducationalInfo />
              </div>
            </div>
          )}

          {/* Step 2: Select Lots */}
          {currentStep === 2 && selectedSupervisor && (
            <div className="tp-card">
              <div className="tp-card-header">
                <div>
                  <h2 className="tp-card-title">Step 1: Select Completed Lots (Unpaid Only)</h2>
                  <p className="tp-card-subtitle">Thekedar: <strong>{selectedSupervisor}</strong></p>
                </div>
                <div className="tp-stats">
                  <div className="tp-stat">
                    <div className="tp-stat-value">{supervisorSummary?.totalLots || 0}</div>
                    <div className="tp-stat-label">Completed (Unpaid) Lots</div>
                  </div>
                  {/* <div className="tp-stat">
                    <div className="tp-stat-value">₹{(supervisorSummary?.totalAmount || 0).toLocaleString()}</div>
                    <div className="tp-stat-label">Total Value</div>
                  </div> */}
                  <div className="tp-stat">
                    <div className="tp-stat-value">{supervisorSummary?.totalKarigars || 0}</div>
                    <div className="tp-stat-label">Active Karigars</div>
                  </div>
                </div>
              </div>

              <div className="tp-card-body">
                {groupedLots.length === 0 && <NoLotsFound />}

                {groupedLots.length > 0 && (
                  <>
                    <div className="tp-filters">
                      <div className="tp-search">
                        <span className="tp-search-icon">🔍</span>
                        <input 
                          type="text" 
                          className="tp-search-input" 
                          placeholder="Search by lot, brand, fabric, or style..." 
                          value={searchQuery} 
                          onChange={(e) => setSearchQuery(e.target.value)} 
                        />
                      </div>
                      <div className="tp-sort">
                        <select className="tp-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                          <option value="lotNumber">Sort by Lot Number</option>
                          <option value="totalAmount">Sort by Amount (High to Low)</option>
                          <option value="totalQuantity">Sort by Quantity</option>
                        </select>
                        <button className="tp-sort-btn" onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>
                          {sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending'}
                        </button>
                        <button className="tp-select-all" onClick={handleSelectAllLots}>
                          {selectedLots.length === filteredLots.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                    </div>

                    {selectedLots.length > 0 && (
                      <div className="tp-selection-summary">
                        ✓ {selectedLots.length} lot(s) selected | Total Quantity: {calculateTotalQuantity()} pcs | Total Amount: ₹{calculateTotalAmount().toLocaleString()}
                      </div>
                    )}

                    <div className="tp-table-container">
                      <table className="tp-table">
                        <thead>
                          <tr>
                            <th className="tp-table-checkbox-col">
                              <input 
                                type="checkbox" 
                                checked={selectedLots.length === filteredLots.length && filteredLots.length > 0} 
                                onChange={handleSelectAllLots} 
                                className="tp-checkbox" 
                              />
                            </th>
                            <th>Lot No.</th>
                            <th>Brand</th>
                            <th>Fabric</th>
                            <th>Style</th>
                            <th>Karigars</th>
                            <th>Shades</th>
                            <th>Quantity</th>
                            <th>Rate (₹)</th>
                            <th>Amount (₹)</th>
                            <th>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLots.map(lot => (
                            <React.Fragment key={lot.lotNumber}>
                              <tr className={selectedLots.includes(lot.lotNumber) ? 'tp-table-row-selected' : ''}>
                                <td className="tp-table-checkbox-col">
                                  <input 
                                    type="checkbox" 
                                    checked={selectedLots.includes(lot.lotNumber)} 
                                    onChange={() => handleLotSelection(lot.lotNumber)} 
                                    className="tp-checkbox" 
                                  />
                                </td>
                                <td className="tp-lot-link">{lot.lotNumber}</td>
                                <td>{lot.brand || '—'}</td>
                                <td>{lot.fabric || '—'}</td>
                                <td>{lot.style || '—'}</td>
                                <td><span className="tp-badge tp-badge-gray">{lot.karigarCount}</span></td>
                                <td><span className="tp-badge tp-badge-blue">{lot.shadeCount}/{lot.totalShades}</span></td>
                                <td className="tp-text-right">{lot.totalQuantity}</td>
                                <td className="tp-text-right">₹{lot.rate.toFixed(2)}</td>
                                <td className="tp-text-right tp-amount">₹{lot.totalAmount.toLocaleString()}</td>
                                <td>
                                  <button className="tp-expand-btn-sm" onClick={() => toggleLotExpand(lot.lotNumber)}>
                                    {expandedLots.has(lot.lotNumber) ? '▼ Hide' : '▶ View'} Details
                                  </button>
                                </td>
                              </tr>
                              {expandedLots.has(lot.lotNumber) && (
                                <tr className="tp-expanded-row">
                                  <td colSpan="11">
                                    <div className="tp-expanded-content">
                                      <div className="tp-expanded-title">Karigar-wise Breakdown - Lot {lot.lotNumber}</div>
                                      <table className="tp-subtable">
                                        <thead>
                                          <tr>
                                            <th>Karigar Name</th>
                                            <th>Shades & Quantities</th>
                                            <th>Total Quantity</th>
                                            <th>Amount (₹)</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {Object.entries(lot.shadesByKarigar).map(([normalizedKarigar, shades]) => {
                                            // Find the original name from karigarWageDetails
                                            const originalKarigar = lot.karigarWageDetails[normalizedKarigar];
                                            const displayName = originalKarigar?.karigarName || normalizedKarigar;
                                            const quantity = shades.reduce((sum, s) => sum + s.quantity, 0);
                                            const amount = quantity * lot.rate;
                                            return (
                                              <tr key={normalizedKarigar}>
                                                <td><strong>{displayName}</strong></td>
                                                <td>{shades.map(s => `${s.shade} (${s.quantity} pcs)`).join(', ')}</td>
                                                <td className="tp-text-right">{quantity}</td>
                                                <td className="tp-text-right tp-amount">₹{amount.toLocaleString()}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                        <tfoot>
                                          <tr>
                                            <td colSpan="2" className="tp-text-right"><strong>Total:</strong></td>
                                            <td className="tp-text-right"><strong>{lot.totalQuantity} pcs</strong></td>
                                            <td className="tp-text-right tp-amount"><strong>₹{lot.totalAmount.toLocaleString()}</strong></td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                   </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                        {filteredLots.length > 0 && (
                          <tfoot>
                            <tr className="tp-table-footer">
                              <td colSpan="7" className="tp-text-right"><strong>Total Selected:</strong></td>
                              <td className="tp-text-right"><strong>{calculateTotalQuantity()} pcs</strong></td>
                              <td></td>
                              <td className="tp-text-right"><strong className="tp-grand-total">₹{calculateTotalAmount().toLocaleString()}</strong></td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </>
                )}

                {selectedLots.length > 0 && (
                  <div className="tp-proceed-section">
                    <div className="tp-proceed-info">
                      <strong>Ready to Process Payment</strong>
                      <p>You have selected {selectedLots.length} lot(s) with total value of ₹{calculateTotalAmount().toLocaleString()}</p>
                    </div>
                    <button className="tp-proceed-btn" onClick={handleCreatePayment}>
                      Proceed to Payment Details →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Payment Details */}
          {currentStep === 3 && formData.payeeName && (
            <div className="tp-card">
              <div className="tp-card-header">
                <h2 className="tp-card-title">Step 2: Payment Details</h2>
                <p className="tp-card-subtitle">Review and generate payment voucher</p>
              </div>
              <div className="tp-card-body">
                <form onSubmit={submitPayable}>
                  <div className="tp-form-grid">
                    <div className="tp-form-field">
                      <label className="tp-label">Thekedar Name *</label>
                      <input type="text" className="tp-input" value={formData.payeeName} disabled />
                    </div>
                    <div className="tp-form-field">
                      <label className="tp-label">Amount (₹) *</label>
                      <input type="number" name="amount" className="tp-input" value={formData.amount} onChange={handleInputChange} required />
                    </div>
                    <div className="tp-form-field">
                      <label className="tp-label">Due Date *</label>
                      <input type="date" name="dueDate" className="tp-input" value={formData.dueDate} onChange={handleInputChange} required />
                    </div>
                    <div className="tp-form-field">
                      <label className="tp-label">Reference Number</label>
                      <input type="text" name="reference" className="tp-input" value={formData.reference} onChange={handleInputChange} placeholder="Optional reference/invoice number" />
                    </div>
                    <div className="tp-form-field">
                      <label className="tp-label">Payment Status</label>
                      <select name="status" className="tp-select" value={formData.status} onChange={handleInputChange}>
                        <option value="paid">Paid</option>
                      </select>
                    </div>
                    <div className="tp-form-field tp-full-width">
                      <label className="tp-label">Description / Notes</label>
                      <textarea name="description" className="tp-textarea" value={formData.description} onChange={handleInputChange} rows="3" placeholder="Add any additional notes or terms..." />
                    </div>
                  </div>
                  <div className="tp-form-actions">
                    <button type="button" className="tp-btn tp-btn-secondary" onClick={resetForm}>
                      Cancel & Start Over
                    </button>
                    <button type="submit" className="tp-btn tp-btn-primary" disabled={submitting}>
                      {submitting ? 'Processing...' : 'Generate Payment Voucher'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
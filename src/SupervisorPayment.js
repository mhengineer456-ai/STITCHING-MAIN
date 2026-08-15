// src/SupervisorPayment.js
import React, { useState, useEffect } from 'react';

// Google Sheets configuration
const GOOGLE_SHEETS_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "17qqixpHOXvG1U3RlRwaHON5JCkugpy4RIu5N9zR9ScM",
  KARIGAR_ASSIGNMENTS_RANGE: "KarigarAssignments!A:Z",
  KARIGAR_PROFILE_RANGE: "KarigarProfiles!A:Q",
  PAYABLES_RANGE: "Payables!A:J",
  SUPPLIERS_RANGE: "Suppliers!A:F",
};

// Separate workbook for rate list
const RATE_LIST_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "18KNc9xYqv-vnFFiIkot2Q1MoLvB0n4RukELnQUz-wtQ",
  RANGE: "Master List!A:J",
};

export default function SupervisorPayment({ onBack, supervisor, onNavigate }) {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payables, setPayables] = useState([]);
  const [karigarAssignments, setKarigarAssignments] = useState([]);
  const [karigarProfiles, setKarigarProfiles] = useState([]);
  const [rateList, setRateList] = useState([]);
  
  // State for supervisor filtering
  const [selectedSupervisor, setSelectedSupervisor] = useState('');
  const [supervisors, setSupervisors] = useState([]);
  const [groupedLots, setGroupedLots] = useState([]);
  const [filteredLots, setFilteredLots] = useState([]);
  const [selectedLots, setSelectedLots] = useState([]);
  const [supervisorSummary, setSupervisorSummary] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('lotNumber');
  const [sortOrder, setSortOrder] = useState('asc');
  const [lotCompletionMap, setLotCompletionMap] = useState(new Map());
  const [expandedLots, setExpandedLots] = useState(new Set());
  
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');
  const [selectedPayable, setSelectedPayable] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showPaymentSlipModal, setShowPaymentSlipModal] = useState(false);
  const [paymentSlipData, setPaymentSlipData] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [debugInfo, setDebugInfo] = useState('');

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

  useEffect(() => {
    loadKarigarProfiles();
    loadKarigarAssignments();
    loadPayables();
    loadRateList();
  }, []);

  // Load karigar profiles from the KarigarProfile sheet
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
        
        // Extract unique supervisors from the profiles
        const uniqueSupervisors = [...new Set(profiles.map(p => p.supervisorName))].filter(Boolean);
        setSupervisors(uniqueSupervisors);
      }
    } catch (err) {
      console.error('Error loading karigar profiles:', err);
      setKarigarProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  // Function to check if a lot is fully completed
 const analyzeLotCompletion = (assignments) => {
  const lotMap = new Map();
  
  assignments.forEach(assignment => {
    if (!lotMap.has(assignment.lotNumber)) {
      lotMap.set(assignment.lotNumber, {
        lotNumber: assignment.lotNumber,
        totalAssignments: 0,
        completedAssignments: 0,
        shades: new Set(),
        completedShades: new Set(),
        karigars: new Map(), // Map to store karigar info
        assignments: [],
        brands: new Set(),
        fabrics: new Set(),
        styles: new Set(),
        totalQuantity: 0,
        completedQuantity: 0,
        totalAmount: 0,
        lotStatus: assignment.lotStatus,
        totalShadesInLot: assignment.totalShadesInLot,
        completedShadesInLot: assignment.completedShadesInLot,
        isLotFullyCompleted: false
      });
    }
    
    const lotInfo = lotMap.get(assignment.lotNumber);
    lotInfo.totalAssignments++;
    lotInfo.shades.add(assignment.shade);
    lotInfo.brands.add(assignment.brand);
    lotInfo.fabrics.add(assignment.fabric);
    lotInfo.styles.add(assignment.style);
    lotInfo.karigars.set(assignment.karigarId, {
      name: assignment.karigarName,
      id: assignment.karigarId,
      quantity: assignment.quantity,
      shades: []
    });
    lotInfo.assignments.push(assignment);
    lotInfo.totalQuantity += assignment.quantity || 0;
    
    if (assignment.status === 'completed') {
      lotInfo.completedAssignments++;
      lotInfo.completedShades.add(assignment.shade);
      lotInfo.completedQuantity += assignment.completedQuantity || assignment.quantity || 0;
    }
  });
  
  // Calculate completion status for each lot
  lotMap.forEach((value, key) => {
    // Use isLotFullyCompleted from the assignment data
    value.isFullyCompleted = value.completedShades.size === value.shades.size;
    value.completionPercentage = Math.round((value.completedShades.size / value.shades.size) * 100);
    value.totalKarigars = value.karigars.size;
    
    // Get rate from the first completed assignment or first assignment
    const firstAssignment = value.assignments.find(a => a.status === 'completed') || value.assignments[0];
    if (firstAssignment) {
      const rateInfo = getRateFromList({
        lotNumber: firstAssignment.lotNumber,
        garmentType: firstAssignment.garmentType,
        fabric: firstAssignment.fabric,
        style: firstAssignment.style,
        brand: firstAssignment.brand
      });
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
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.KARIGAR_ASSIGNMENTS_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch karigar assignments');
    const data = await response.json();

    if (data.values && data.values.length > 0) {
      const headers = data.values[0];
      const rows = data.values.slice(1);
      
      // Find column indices
      const timestampIdx = headers.findIndex(h => h === 'Timestamp');
      const lotNumberIdx = headers.findIndex(h => h === 'Lot Number');
      const brandIdx = headers.findIndex(h => h === 'Brand');
      const fabricIdx = headers.findIndex(h => h === 'Fabric');
      const styleIdx = headers.findIndex(h => h === 'Style');
      const garmentTypeIdx = headers.findIndex(h => h === 'Garment Type');
      const assignmentsJsonIdx = headers.findIndex(h => h === 'Assignments JSON');
      const supervisorIdx = headers.findIndex(h => h === 'Supervisor');
      const statusIdx = headers.findIndex(h => h === 'Status');
      const lastUpdatedIdx = headers.findIndex(h => h === 'Last Updated');
      const completionDateIdx = headers.findIndex(h => h === 'Completion Date/Time');
      
      const allAssignments = [];
      
      rows.forEach((row, index) => {
        const lotNumber = row[lotNumberIdx] ? row[lotNumberIdx].toString().trim() : '';
        if (!lotNumber) return;
        
        const brand = row[brandIdx] || '';
        const fabric = row[fabricIdx] || '';
        const style = row[styleIdx] || '';
        const garmentType = row[garmentTypeIdx] || '';
        const supervisor = row[supervisorIdx] || '';
        const lotStatus = row[statusIdx] ? row[statusIdx].toLowerCase() : 'pending';
        const lastUpdated = row[lastUpdatedIdx] || '';
        const completionDate = row[completionDateIdx] || '';
        
        // Parse Assignments JSON
        let assignmentsJson = {};
        try {
          if (row[assignmentsJsonIdx]) {
            assignmentsJson = JSON.parse(row[assignmentsJsonIdx]);
          }
        } catch (e) {
          console.error(`Error parsing JSON for lot ${lotNumber}:`, e);
        }
        
        // For each shade in the assignments JSON, create an assignment object
        const shadeEntries = Object.entries(assignmentsJson);
        const totalShades = shadeEntries.length;
        const completedShades = shadeEntries.filter(([_, data]) => data.status === 'Completed').length;
        const isFullyCompleted = completedShades === totalShades && totalShades > 0;
        
        // Create a mapping of shade to assignment for lot completion tracking
        shadeEntries.forEach(([shade, shadeData]) => {
          const karigarId = shadeData.karigarId || '';
          const karigarName = shadeData.karigarName || '';
          const quantity = shadeData.pcs || 0;
          const shadeStatus = shadeData.status || 'pending';
          const completedAt = shadeData.completedAt || '';
          
          allAssignments.push({
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
            savedBy: row[10] || '',
            supervisor: supervisor,
            savedAt: row[12] || '',
            status: shadeStatus.toLowerCase(), // Individual shade status
            lotStatus: lotStatus, // Overall lot status from sheet
            rate: 0,
            completedQuantity: shadeStatus === 'Completed' ? quantity : 0,
            paymentStatus: 'pending',
            notes: '',
            completedAt: completedAt,
            lastUpdated: lastUpdated,
            completionDate: completionDate,
            // Store lot-level info
            totalShadesInLot: totalShades,
            completedShadesInLot: completedShades,
            isLotFullyCompleted: isFullyCompleted
          });
        });
      });
      
      setKarigarAssignments(allAssignments);
      
      // Analyze lot completion using the new data
      analyzeLotCompletion(allAssignments);
    }
  } catch (err) {
    console.error('Error loading karigar assignments:', err);
    setError('Failed to load karigar assignments');
  } finally {
    setLoading(false);
  }
};

  // Load rate list from separate workbook
  const loadRateList = async () => {
    try {
      setLoading(true);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${RATE_LIST_CONFIG.SPREADSHEET_ID}/values/${RATE_LIST_CONFIG.RANGE}?key=${RATE_LIST_CONFIG.API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn('Rate list not available, using fallback rates');
        setRateList([]);
        return;
      }
      
      const data = await response.json();

      if (data.values && data.values.length > 0) {
        const headers = data.values[0];
        const rows = data.values.slice(1);
        
        const rates = rows.map(row => {
          let rate = 0;
          if (row[8]) {
            const rateStr = row[8].toString().replace('₹', '').replace(/,/g, '').trim();
            rate = parseFloat(rateStr) || 0;
          }

          let timestamp = null;
          if (row[1]) {
            const dateParts = row[1].split(' ')[0].split('/');
            if (dateParts.length === 3) {
              const [day, month, year] = dateParts;
              timestamp = `${year}-${month}-${day}`;
            }
          }

          return {
            submissionId: row[0] || '',
            timestamp: timestamp,
            originalTimestamp: row[1] || '',
            submitter: row[2] || '',
            category: row[3] ? row[3].toString().trim() : '',
            displayCategory: row[4] ? row[4].toString().trim() : '',
            subcategory: row[5] ? row[5].toString().trim() : '',
            jacketType: row[6] ? row[6].toString().trim() : '',
            lotNo: row[7] ? row[7].toString().trim() : '',
            rate: rate,
            itemCount: parseInt(row[9]) || 0,
            selectionsSummary: row[10] || ''
          };
        }).filter(r => r.rate > 0);
        
        setRateList(rates);
      }
    } catch (err) {
      console.error('Error loading rate list:', err);
      setRateList([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPayables = async () => {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.PAYABLES_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) {
        setPayables([]);
        return;
      }
      const data = await response.json();

      if (data.values && data.values.length > 0) {
        const rows = data.values.slice(1);
        const payablesList = rows.map(row => ({
          id: row[0] || '',
          payableId: row[1] || '',
          payableType: row[2] || '',
          payeeId: row[3] || '',
          payeeName: row[4] || '',
          amount: parseFloat(row[5]) || 0,
          dueDate: row[6] || '',
          paymentDate: row[7] || '',
          status: row[8] || 'pending',
          category: row[9] || '',
          description: row[10] || '',
          reference: row[11] || '',
          notes: row[12] || '',
          createdBy: row[13] || '',
          createdAt: row[14] || '',
          updatedAt: row[15] || ''
        }));
        
        setPayables(payablesList);
      }
    } catch (err) {
      console.error('Error loading payables:', err);
      setPayables([]);
    }
  };

  // Filter completed lots by supervisor - ONLY FULLY COMPLETED LOTS
  useEffect(() => {
    if (selectedSupervisor && karigarAssignments.length > 0 && lotCompletionMap.size > 0) {
      // Get all karigars under this supervisor
      const karigarsUnderSupervisor = karigarProfiles
        .filter(profile => profile.supervisorName === selectedSupervisor)
        .map(profile => profile.karigarId);

      // Get assignments for these karigars
      const supervisorAssignments = karigarAssignments.filter(
        assignment => karigarsUnderSupervisor.includes(assignment.karigarId)
      );

      // Group by lot number and check if fully completed
      const lotGroups = new Map();
      
      supervisorAssignments.forEach(assignment => {
        if (!lotGroups.has(assignment.lotNumber)) {
          lotGroups.set(assignment.lotNumber, []);
        }
        lotGroups.get(assignment.lotNumber).push(assignment);
      });

      // Create grouped lot objects
      const groupedLotsList = [];
      
      lotGroups.forEach((assignments, lotNumber) => {
        const lotInfo = lotCompletionMap.get(lotNumber);
        
        // Only include lots that are fully completed (all shades done)
        if (lotInfo && lotInfo.isFullyCompleted) {
          // Get completed assignments for this lot
          const completedAssignments = assignments.filter(a => a.status === 'completed');
          
          if (completedAssignments.length > 0) {
            // Get rate from the first completed assignment
            const rateInfo = getRateFromList(completedAssignments[0]);
            const rate = rateInfo.rate;
            
            // Calculate totals
            const totalQuantity = completedAssignments.reduce((sum, a) => sum + (a.completedQuantity || a.quantity), 0);
            const totalAmount = totalQuantity * rate;
            
            // Group shades by karigar for display
            const shadesByKarigar = {};
            completedAssignments.forEach(a => {
              if (!shadesByKarigar[a.karigarName]) {
                shadesByKarigar[a.karigarName] = [];
              }
              shadesByKarigar[a.karigarName].push({
                shade: a.shade,
                quantity: a.completedQuantity || a.quantity
              });
            });
            
            groupedLotsList.push({
              lotNumber: lotNumber,
              brand: [...new Set(completedAssignments.map(a => a.brand))].filter(Boolean).join(', '),
              fabric: [...new Set(completedAssignments.map(a => a.fabric))].filter(Boolean).join(', '),
              style: [...new Set(completedAssignments.map(a => a.style))].filter(Boolean).join(', '),
              rate: rate,
              rateInfo: rateInfo,
              totalQuantity: totalQuantity,
              totalAmount: totalAmount,
              karigarCount: lotInfo.karigars.size,
              shadeCount: lotInfo.completedShades.size,
              totalShades: lotInfo.shades.size,
              completedAssignments: completedAssignments,
              shadesByKarigar: shadesByKarigar,
              assignments: completedAssignments
            });
          }
        }
      });

      setGroupedLots(groupedLotsList);
      
      // Calculate summary
      const totalLots = groupedLotsList.length;
      const totalAmount = groupedLotsList.reduce((sum, lot) => sum + lot.totalAmount, 0);
      const totalQuantity = groupedLotsList.reduce((sum, lot) => sum + lot.totalQuantity, 0);
      const uniqueKarigars = new Set();
      groupedLotsList.forEach(lot => {
        lot.assignments.forEach(a => uniqueKarigars.add(a.karigarName));
      });
      
      setSupervisorSummary({
        totalLots,
        totalAmount,
        totalQuantity,
        totalKarigars: uniqueKarigars.size,
        karigars: Array.from(uniqueKarigars),
        totalAssignments: groupedLotsList.reduce((sum, lot) => sum + lot.assignments.length, 0)
      });

      setDebugInfo(`Supervisor: ${selectedSupervisor}
Total Karigars under supervisor: ${karigarsUnderSupervisor.length}
Total assignments for these karigars: ${supervisorAssignments.length}
Fully completed lots: ${totalLots}
Individual completed assignments: ${groupedLotsList.reduce((sum, lot) => sum + lot.assignments.length, 0)}`);

      // Reset selections
      setSelectedLots([]);
      setExpandedLots(new Set());
    } else {
      setGroupedLots([]);
      setSupervisorSummary(null);
      setSelectedLots([]);
      setExpandedLots(new Set());
    }
  }, [selectedSupervisor, karigarAssignments, karigarProfiles, rateList, lotCompletionMap]);

  // Apply search and sort filters
  useEffect(() => {
    let filtered = [...groupedLots];
    
    if (searchQuery) {
      filtered = filtered.filter(lot => 
        lot.lotNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.fabric.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.style.toLowerCase().includes(searchQuery.toLowerCase()) ||
        Object.keys(lot.shadesByKarigar).some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
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

  // Function to get rate from rate list based on garment details
const getRateFromList = (assignment) => {
  if (!rateList || rateList.length === 0) {
    return {
      rate: 0,
      source: 'none',
      matchedFrom: 'No rate list available'
    };
  }

  // Try to match by Lot Number first (most accurate)
  let matchedRate = rateList.find(r => 
    r.lotNo && r.lotNo.toString().trim() === assignment.lotNumber.toString().trim()
  );

  if (matchedRate) {
    return {
      rate: matchedRate.rate,
      source: 'rateList',
      matchedFrom: `Exact lot match: ${matchedRate.lotNo}`,
      rateDetails: matchedRate
    };
  }

  // Try to match by Garment Type, Fabric, Style combination
  const garmentType = (assignment.garmentType || '').toLowerCase().trim();
  const fabric = (assignment.fabric || '').toLowerCase().trim();
  const style = (assignment.style || '').toLowerCase().trim();
  const brand = (assignment.brand || '').toLowerCase().trim();

  const possibleMatches = rateList.filter(r => {
    const rCategory = (r.category || '').toLowerCase().trim();
    const rDisplayCategory = (r.displayCategory || '').toLowerCase().trim();
    const rSubcategory = (r.subcategory || '').toLowerCase().trim();
    const rJacketType = (r.jacketType || '').toLowerCase().trim();

    return (
      (garmentType && (rCategory === garmentType || rDisplayCategory === garmentType)) ||
      (fabric && rSubcategory === fabric) ||
      (style && rJacketType === style) ||
      (brand && (rCategory === brand || rDisplayCategory === brand))
    );
  });

  if (possibleMatches.length > 0) {
    // Sort by timestamp to get the most recent rate
    const sortedMatches = possibleMatches.sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      }
      return 0;
    });

    matchedRate = sortedMatches[0];
    return {
      rate: matchedRate.rate,
      source: 'rateList',
      matchedFrom: `Matched by details: ${matchedRate.category || matchedRate.displayCategory} / ${matchedRate.subcategory} / ${matchedRate.jacketType}`,
      rateDetails: matchedRate
    };
  }

  return {
    rate: 0,
    source: 'none',
    matchedFrom: `No rate found for lot ${assignment.lotNumber} or similar items`
  };
};

  const generatePayableId = () => {
    const prefix = 'PAY';
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}${year}${month}${random}`;
  };

  const handleSupervisorChange = (e) => {
    setSelectedSupervisor(e.target.value);
    setSearchQuery('');
    setCurrentStep(2);
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
    // Return all assignments from selected lots with their rates
    return selected.flatMap(lot => {
      // Ensure each assignment has the rate from the lot
      return lot.assignments.map(assignment => ({
        ...assignment,
        rate: lot.rate // Make sure rate is passed to each assignment
      }));
    });
  };

  const handleCreatePayment = () => {
    const selectedLotsData = getSelectedLotsData();
    const totalAmount = calculateTotalAmount();
    const lotNumbers = selectedLots.join(', ');
    
    // Get detailed lot information
    const lotDetails = filteredLots
      .filter(lot => selectedLots.includes(lot.lotNumber))
      .map(lot => {
        const karigarList = Object.entries(lot.shadesByKarigar)
          .map(([karigar, shades]) => `${karigar}: ${shades.map(s => `${s.shade} (${s.quantity})`).join(', ')}`)
          .join('; ');
        return `Lot ${lot.lotNumber}: ${lot.shadeCount}/${lot.totalShades} shades, ${lot.karigarCount} karigars (${karigarList})`;
      }).join('\n');
    
    setFormData({
      ...formData,
      payeeId: selectedSupervisor,
      payeeName: selectedSupervisor,
      amount: totalAmount,
      category: 'Supervisor Payment',
      description: `Payment for completed lots under supervisor ${selectedSupervisor}:\nLots: ${lotNumbers}\n\nLot Details:\n${lotDetails}`,
    });
    setCurrentStep(3);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };

  const generatePaymentSlipHTML = (payableData, selectedLotsData) => {
    const currentDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    
    const payableId = payableData.payableId || generatePayableId();
    const amountInWords = numberToWords(payableData.amount);
    const supervisorName = selectedSupervisor || payableData.createdBy || 'Supervisor';
    
    // Group by lot number for lot-wise totals
    const lotsByNumber = {};
    selectedLotsData.forEach(assignment => {
      if (!lotsByNumber[assignment.lotNumber]) {
        lotsByNumber[assignment.lotNumber] = {
          lotNumber: assignment.lotNumber,
          brand: assignment.brand || '',
          fabric: assignment.fabric || '',
          style: assignment.style || '',
          totalQuantity: 0,
          totalAmount: 0,
          rate: 0,
          karigarCount: new Set()
        };
      }
      
      const quantity = assignment.completedQuantity || assignment.quantity || 0;
      const rate = assignment.rate || 0;
      const amount = quantity * rate;
      
      lotsByNumber[assignment.lotNumber].totalQuantity += quantity;
      lotsByNumber[assignment.lotNumber].totalAmount += amount;
      lotsByNumber[assignment.lotNumber].karigarCount.add(assignment.karigarName);
      
      // Set the rate (all assignments in same lot should have same rate)
      if (rate > 0) {
        lotsByNumber[assignment.lotNumber].rate = rate;
      }
    });
    
    // Calculate grand totals
    const grandTotalQuantity = Object.values(lotsByNumber).reduce((sum, lot) => sum + lot.totalQuantity, 0);
    const grandTotalAmount = Object.values(lotsByNumber).reduce((sum, lot) => sum + lot.totalAmount, 0);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Slip - ${payableId}</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 15px;
            background: #f5f5f5;
          }
          .payment-slip {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border: 2px solid #000;
            padding: 20px;
            position: relative;
            font-size: 12px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #000;
            padding-bottom: 12px;
            margin-bottom: 15px;
            position: relative;
          }
          .header h1 {
            margin: 0;
            color: #000;
            font-size: 24px;
            text-transform: uppercase;
            font-weight: 800;
            letter-spacing: 1px;
          }
          .slip-title {
            text-align: center;
            margin: 15px 0;
          }
          .slip-title h3 {
            display: inline-block;
            border: 2px solid #000;
            padding: 6px 30px;
            margin: 0;
            font-size: 16px;
            text-transform: uppercase;
            background: #f0f0f0;
            color: #000;
            font-weight: 700;
            letter-spacing: 1px;
          }
          .voucher-section {
            position: absolute;
            top: 15px;
            right: 15px;
            text-align: right;
          }
          .voucher-label {
            font-size: 10px;
            color: #666;
            text-transform: uppercase;
          }
          .voucher-number {
            font-size: 14px;
            font-weight: 700;
            color: #000;
            font-family: monospace;
            letter-spacing: 1px;
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin: 15px 0;
            padding: 12px;
            border: 1px solid #000;
            background: #fafafa;
          }
          .info-item {
            display: flex;
            align-items: baseline;
          }
          .info-label {
            width: 90px;
            font-weight: 600;
            color: #000;
            font-size: 11px;
            text-transform: uppercase;
          }
          .info-value {
            flex: 1;
            color: #000;
            font-weight: 500;
            font-size: 12px;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            font-size: 12px;
            border: 1px solid #000;
          }
          .items-table th {
            background: #000;
            color: white;
            padding: 10px 8px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            border-right: 1px solid #333;
          }
          .items-table th:last-child {
            border-right: none;
          }
          .items-table td {
            padding: 10px 8px;
            border: 1px solid #000;
            color: #000;
          }
          .lot-row {
            background: #f0f9ff;
            font-weight: 600;
          }
          .lot-row td {
            background: #f0f9ff;
          }
          .amount-in-words {
            margin: 15px 0;
            padding: 12px;
            background: #f0f0f0;
            border-left: 4px solid #000;
            font-style: italic;
            font-size: 12px;
            color: #000;
            font-weight: 500;
          }
          .total-section {
            text-align: right;
            font-size: 16px;
            font-weight: 800;
            margin: 15px 0;
            padding: 12px 15px;
            background: #e8f4f8;
            border: 2px solid #000;
            color: #000;
          }
          .total-section .total-label {
            margin-right: 15px;
            text-transform: uppercase;
          }
          .total-section .total-amount {
            font-size: 18px;
          }
          .footer {
            margin-top: 30px;
            display: flex;
            justify-content: space-between;
            position: relative;
          }
          .signature {
            text-align: center;
            width: 200px;
          }
          .signature-line {
            border-top: 2px solid #000;
            margin-top: 35px;
            padding-top: 6px;
            font-size: 11px;
            color: #000;
            font-weight: 500;
          }
          .supervisor-signature {
            text-align: center;
            width: 200px;
            margin-top: 20px;
          }
          .supervisor-name {
            font-weight: 700;
            color: #000;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 5px;
          }
          .supervisor-line {
            border-top: 2px solid #000;
            margin-top: 25px;
            padding-top: 6px;
            font-size: 11px;
            color: #000;
            font-weight: 500;
          }
          .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 60px;
            color: rgba(0, 0, 0, 0.03);
            white-space: nowrap;
            pointer-events: none;
            z-index: 0;
            font-weight: 800;
            text-transform: uppercase;
          }
          .footer-note {
            margin-top: 10px;
            font-size: 9px;
            text-align: center;
            color: #666;
            border-top: 1px dashed #000;
            padding-top: 8px;
          }
          .payment-type-badge {
            display: inline-block;
            padding: 3px 10px;
            background: #000;
            color: white;
            font-size: 10px;
            font-weight: 600;
            border-radius: 15px;
            margin-left: 10px;
          }
          .text-right {
            text-align: right;
          }
          .text-center {
            text-align: center;
          }
          .font-bold {
            font-weight: 700;
          }
          .karigar-count {
            font-size: 11px;
            color: #4b5563;
            font-weight: normal;
          }
          @media print {
            body { background: white; }
            .payment-slip { 
              border: 2px solid #000;
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="payment-slip">
          <div class="watermark">${payableData.status.toUpperCase()}</div>
          
          <div class="voucher-section">
            <div class="voucher-label">VOUCHER NUMBER</div>
            <div class="voucher-number">${payableId}</div>
          </div>
          
          <div class="header">
            <h1>SUPERVISOR PAYMENT VOUCHER</h1>
            <div class="payment-type-badge" style="margin-top: 5px;">THEKEDAR PAYMENT</div>
          </div>

          <div class="slip-title">
            <h3>KARIGAR WAGES PAYMENT SLIP</h3>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Date:</span>
              <span class="info-value">${currentDate}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Due Date:</span>
              <span class="info-value">${new Date(payableData.dueDate).toLocaleDateString('en-IN')}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Payee:</span>
              <span class="info-value">${payableData.payeeName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Payee Type:</span>
              <span class="info-value">Thekedar/Supervisor</span>
            </div>
            <div class="info-item">
              <span class="info-label">Category:</span>
              <span class="info-value">${payableData.category}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Status:</span>
              <span class="info-value" style="font-weight: 700; text-transform: uppercase;">${payableData.status}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Ref No:</span>
              <span class="info-value">${payableData.reference || 'N/A'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Supervisor:</span>
              <span class="info-value" style="font-weight: 700;">${supervisorName}</span>
            </div>
          </div>

          ${Object.keys(lotsByNumber).length > 0 ? `
            <table class="items-table">
              <thead>
                <tr>
                  <th>Lot No</th>
                  <th>Brand</th>
                  <th>Fabric</th>
                  <th>Style</th>
                  <th>Karigars</th>
                  <th>Qty</th>
                  <th>Rate (₹)</th>
                  <th>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(lotsByNumber).map(lot => {
                  const rate = lot.rate || 0;
                  const amount = lot.totalAmount || (lot.totalQuantity * rate);
                  
                  return `
                    <tr class="lot-row">
                      <td class="font-bold">${lot.lotNumber}</td>
                      <td>${lot.brand || '—'}</td>
                      <td>${lot.fabric || '—'}</td>
                      <td>${lot.style || '—'}</td>
                      <td>${lot.karigarCount.size} karigar(s)</td>
                      <td class="text-right">${lot.totalQuantity}</td>
                      <td class="text-right">₹${rate.toFixed(2)}</td>
                      <td class="text-right">₹${amount.toLocaleString('en-IN')}</td>
                    </tr>
                  `;
                }).join('')}
                
                <!-- Grand Total Row -->
                <tr style="background: #000; color: white; font-weight: 700;">
                  <td colspan="5" style="text-align: right; border-right: 1px solid #333;">GRAND TOTAL:</td>
                  <td style="text-align: right; border-right: 1px solid #333;">${grandTotalQuantity}</td>
                  <td style="text-align: right; border-right: 1px solid #333;">—</td>
                  <td style="text-align: right;">₹${grandTotalAmount.toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>
          ` : ''}

          <div class="amount-in-words">
            <strong>Amount in words:</strong> ${amountInWords} Rupees Only
          </div>

          <div class="total-section">
            <span class="total-label">Total Payable Amount:</span>
            <span class="total-amount">₹ ${grandTotalAmount.toFixed(2)}</span>
          </div>

          <div class="footer">
            <div class="signature">
              <div class="signature-line">Receiver's Signature</div>
            </div>
            <div class="supervisor-signature">
              <div class="supervisor-name">${supervisorName}</div>
              <div class="supervisor-line">Supervisor/Thekedar</div>
            </div>
          </div>

          <div class="footer-note">
            This is a computer generated payment voucher • Valid only with authorized signature
          </div>
        </div>
      </body>
      </html>
    `;
  };

  // Helper function to convert number to words
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
    const decimal = Math.round((num - whole) * 100);
    
    let words = numToWords(whole);
    if (decimal > 0) {
      words += ' and ' + numToWords(decimal) + ' Paise';
    }
    
    return words;
  };

  // Function to download payment slip as HTML file
  const downloadPaymentSlip = (payableData, selectedLotsData) => {
    const slipHTML = generatePaymentSlipHTML(payableData, selectedLotsData);
    const blob = new Blob([slipHTML], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Payment_Slip_${payableData.payableId || generatePayableId()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Function to download payment slip as PDF (requires browser print)
  const downloadPaymentSlipAsPDF = (payableData, selectedLotsData) => {
    const slipHTML = generatePaymentSlipHTML(payableData, selectedLotsData);
    const printWindow = window.open('', '_blank');
    printWindow.document.write(slipHTML);
    printWindow.document.close();
    printWindow.focus();
    
    // Add a small delay to ensure styles are loaded
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  const submitPayable = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (!formData.payeeName || !formData.amount || !formData.dueDate) {
        throw new Error('Please fill all required fields');
      }

      const payableId = generatePayableId();

      const newPayable = [
        Date.now().toString(),
        payableId,
        'supplier',
        formData.payeeId,
        formData.payeeName,
        formData.amount,
        formData.dueDate,
        formData.paymentDate || '',
        formData.status,
        formData.category,
        formData.description,
        formData.reference,
        formData.notes,
        supervisor?.name || 'Unknown',
        new Date().toISOString(),
        new Date().toISOString()
      ];

      const selectedLotsData = getSelectedLotsData();
      const paymentData = {
        ...formData,
        payableId: payableId,
        payableType: 'supplier',
      };

      let saveSuccess = false;
      
      try {
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.PAYABLES_RANGE}:append?valueInputOption=USER_ENTERED&key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
        
        const response = await fetch(appendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [newPayable]
          })
        });

        if (!response.ok) throw new Error('Failed to save payable');
        saveSuccess = true;
        
      } catch (saveError) {
        console.error('Error saving to Google Sheets:', saveError);
      }

      setPaymentSlipData({
        payable: paymentData,
        lots: selectedLotsData,
        totalAmount: calculateTotalAmount(),
        totalQuantity: calculateTotalQuantity(),
        saveSuccess: saveSuccess,
      });
      setShowPaymentSlipModal(true);
      
      if (saveSuccess) {
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
        loadPayables();
        loadKarigarAssignments();
        
        // Refresh the current supervisor's lots
        if (selectedSupervisor) {
          handleSupervisorChange({ target: { value: selectedSupervisor } });
        }
      } else {
        setError('Payment created but failed to save to database. You can still download the slip.');
      }

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

  const filteredPayables = payables.filter(payable => {
    const matchesSearch = (payable.payeeName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (payable.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (payable.reference || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSearch;
  });

  const getStatusColor = (status) => {
    switch(status) {
      case 'paid': return '#10b981';
      case 'pending': return '#f59e0b';
      case 'overdue': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusBgColor = (status) => {
    switch(status) {
      case 'paid': return '#d1fae5';
      case 'pending': return '#fef3c7';
      case 'overdue': return '#fee2e2';
      default: return '#f3f4f6';
    }
  };

  const getTypeIcon = (type) => {
    switch(type) {
      case 'karigar': return '👤';
      case 'supplier': return '🏭';
      case 'operational': return '⚡';
      default: return '📄';
    }
  };

  const totals = {
    total: filteredPayables.reduce((sum, p) => sum + (p.amount || 0), 0),
    pending: filteredPayables.filter(p => p.status === 'pending').reduce((sum, p) => sum + (p.amount || 0), 0),
    paid: filteredPayables.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.amount || 0), 0),
    overdue: filteredPayables.filter(p => p.status === 'overdue').reduce((sum, p) => sum + (p.amount || 0), 0)
  };

  const tabs = [
    { id: 'create', label: 'Create Payment', icon: '💰', description: 'Create new thekedar payment' },
    { id: 'view', label: 'View Payments', icon: '📋', description: 'View payment history' }
  ];

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={onBack} style={styles.backButton}>
            ←
          </button>
          <div>
            <h1 style={styles.title}>Thekedar Payment</h1>
            <p style={styles.subtitle}>Manage payments to thekedars based on completed lots</p>
          </div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.userBadge}>
            <span style={styles.userAvatar}>
              {supervisor?.name?.charAt(0) || 'U'}
            </span>
            <div style={styles.userInfo}>
              <span style={styles.userName}>{supervisor?.name || 'Unknown'}</span>
              <span style={styles.userRole}>Supervisor</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {showSuccess && (
        <div style={styles.successAlert}>
          <span>✓ Payment created successfully!</span>
        </div>
      )}
      {error && (
        <div style={styles.errorAlert}>
          <span>⚠ {error}</span>
        </div>
      )}
      {rateList.length === 0 && (
        <div style={styles.warningAlert}>
          <span>⚠ Rate list not loaded. Using default rates from assignments.</span>
        </div>
      )}

      {/* Debug Info - Remove in production */}
      {debugInfo && (
        <div style={styles.debugInfo}>
          <pre>{debugInfo}</pre>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabsContainer}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            <span style={styles.tabIcon}>{tab.icon}</span>
            <div style={styles.tabContent}>
              <span style={styles.tabLabel}>{tab.label}</span>
              <span style={styles.tabDescription}>{tab.description}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={styles.content}>
        {activeTab === 'create' ? (
          <div style={styles.createLayout}>
            {/* Left Column - Steps Progress */}
            <div style={styles.leftColumn}>
              <div style={styles.stepsCard}>
                <h3 style={styles.stepsTitle}>Payment Process</h3>
                
                <div style={styles.stepsList}>
                  <div style={{
                    ...styles.stepItem,
                    ...(currentStep >= 1 ? styles.stepActive : {}),
                    ...(currentStep === 1 ? styles.stepCurrent : {})
                  }}>
                    <div style={styles.stepIndicator}>
                      <span style={styles.stepNumber}>1</span>
                      {currentStep > 1 && <span style={styles.stepCheck}>✓</span>}
                    </div>
                    <div style={styles.stepInfo}>
                      <span style={styles.stepLabel}>Select Thekedar</span>
                      <span style={styles.stepStatus}>
                        {currentStep > 1 ? 'Completed' : currentStep === 1 ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                  </div>

                  <div style={{
                    ...styles.stepItem,
                    ...(currentStep >= 2 ? styles.stepActive : {}),
                    ...(currentStep === 2 ? styles.stepCurrent : {})
                  }}>
                    <div style={styles.stepIndicator}>
                      <span style={styles.stepNumber}>2</span>
                      {currentStep > 2 && <span style={styles.stepCheck}>✓</span>}
                    </div>
                    <div style={styles.stepInfo}>
                      <span style={styles.stepLabel}>Select Lots</span>
                      <span style={styles.stepStatus}>
                        {currentStep > 2 ? 'Completed' : currentStep === 2 ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                  </div>

                  <div style={{
                    ...styles.stepItem,
                    ...(currentStep >= 3 ? styles.stepActive : {}),
                    ...(currentStep === 3 ? styles.stepCurrent : {})
                  }}>
                    <div style={styles.stepIndicator}>
                      <span style={styles.stepNumber}>3</span>
                      {currentStep > 3 && <span style={styles.stepCheck}>✓</span>}
                    </div>
                    <div style={styles.stepInfo}>
                      <span style={styles.stepLabel}>Payment Details</span>
                      <span style={styles.stepStatus}>
                        {currentStep > 3 ? 'Completed' : currentStep === 3 ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedSupervisor && supervisorSummary && (
                  <div style={styles.summaryCard}>
                    <h4 style={styles.summaryCardTitle}>Quick Summary</h4>
                    <div style={styles.summaryCardContent}>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Karigars</span>
                        <span style={styles.summaryCardValue}>{supervisorSummary.totalKarigars}</span>
                      </div>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Completed Lots</span>
                        <span style={styles.summaryCardValue}>{supervisorSummary.totalLots}</span>
                      </div>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Total Assignments</span>
                        <span style={styles.summaryCardValue}>{supervisorSummary.totalAssignments}</span>
                      </div>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Total Quantity</span>
                        <span style={styles.summaryCardValue}>{supervisorSummary.totalQuantity}</span>
                      </div>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Total Amount</span>
                        <span style={{...styles.summaryCardValue, color: '#059669', fontWeight: '600'}}>
                          ₹{supervisorSummary.totalAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedLots.length > 0 && (
                  <div style={styles.selectionSummaryCard}>
                    <h4 style={styles.summaryCardTitle}>Selected Items</h4>
                    <div style={styles.summaryCardContent}>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Lots</span>
                        <span style={styles.summaryCardValue}>{selectedLots.length}</span>
                      </div>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Quantity</span>
                        <span style={styles.summaryCardValue}>{calculateTotalQuantity()}</span>
                      </div>
                      <div style={styles.summaryCardItem}>
                        <span style={styles.summaryCardLabel}>Total Amount</span>
                        <span style={{...styles.summaryCardValue, color: '#059669', fontWeight: '600'}}>
                          ₹{calculateTotalAmount().toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Main Content */}
            <div style={styles.rightColumn}>
              {/* Step 1: Select Thekedar */}
              <div style={styles.sectionCard}>
                <div style={styles.sectionHeader}>
                  <h2 style={styles.sectionTitle}>Step 1: Select Thekedar</h2>
                  <span style={{
                    ...styles.sectionBadge,
                    ...(currentStep >= 1 ? styles.sectionBadgeActive : {})
                  }}>
                    {currentStep > 1 ? 'Completed' : currentStep === 1 ? 'Current' : 'Pending'}
                  </span>
                </div>
                
                <div style={styles.sectionContent}>
                  <select
                    style={styles.select}
                    value={selectedSupervisor}
                    onChange={handleSupervisorChange}
                  >
                    <option value="">Choose a thekedar...</option>
                    {supervisors.map(sup => (
                      <option key={sup} value={sup}>
                        {sup}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Step 2: Select Lots - Only shown when supervisor selected */}
              {selectedSupervisor && (
                <div style={styles.sectionCard}>
                  <div style={styles.sectionHeader}>
                    <h2 style={styles.sectionTitle}>Step 2: Select Completed Lots</h2>
                    <span style={{
                      ...styles.sectionBadge,
                      ...(currentStep >= 2 ? styles.sectionBadgeActive : {})
                    }}>
                      {currentStep > 2 ? 'Completed' : currentStep === 2 ? 'Current' : 'Pending'}
                    </span>
                  </div>
                  
                  <div style={styles.sectionContent}>
                    {/* Controls */}
                    <div style={styles.controls}>
                      <div style={styles.searchWrapper}>
                        <span style={styles.searchIcon}>🔍</span>
                        <input
                          type="text"
                          style={styles.searchInput}
                          placeholder="Search lots, brands, fabrics..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                      
                      <div style={styles.controlsRight}>
                        <select
                          style={styles.sortSelect}
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                        >
                          <option value="lotNumber">Sort by Lot</option>
                          <option value="brand">Sort by Brand</option>
                          <option value="totalAmount">Sort by Amount</option>
                          <option value="totalQuantity">Sort by Quantity</option>
                        </select>
                        
                        <button
                          style={styles.sortOrderButton}
                          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                        >
                          {sortOrder === 'asc' ? '↑' : '↓'}
                        </button>
                        
                        <button
                          style={styles.selectAllButton}
                          onClick={handleSelectAllLots}
                        >
                          {selectedLots.length === filteredLots.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                    </div>

                    {/* Grouped Lots Table */}
                    {filteredLots.length > 0 ? (
                      <div style={styles.tableContainer}>
                        <table style={styles.lotsTable}>
                          <thead>
                            <tr>
                              <th style={styles.tableHeader} width="40px">
                                <input
                                  type="checkbox"
                                  checked={selectedLots.length === filteredLots.length && filteredLots.length > 0}
                                  onChange={handleSelectAllLots}
                                  style={styles.tableCheckbox}
                                />
                              </th>
                              <th style={styles.tableHeader}>Lot No.</th>
                              <th style={styles.tableHeader}>Brand</th>
                              <th style={styles.tableHeader}>Fabric</th>
                              <th style={styles.tableHeader}>Style</th>
                              <th style={styles.tableHeader}>Karigars</th>
                              <th style={styles.tableHeader}>Shades</th>
                              <th style={styles.tableHeader}>Qty</th>
                              <th style={styles.tableHeader}>Rate (₹)</th>
                              <th style={styles.tableHeader}>Amount (₹)</th>
                              <th style={styles.tableHeader}>Rate Source</th>
                              <th style={styles.tableHeader}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredLots.map(lot => (
                              <React.Fragment key={lot.lotNumber}>
                                <tr 
                                  style={{
                                    ...styles.tableRow,
                                    ...(selectedLots.includes(lot.lotNumber) ? styles.tableRowSelected : {}),
                                    cursor: 'pointer'
                                  }}
                                  onClick={() => handleLotSelection(lot.lotNumber)}
                                >
                                  <td style={styles.tableCell} onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={selectedLots.includes(lot.lotNumber)}
                                      onChange={() => handleLotSelection(lot.lotNumber)}
                                      style={styles.tableCheckbox}
                                    />
                                  </td>
                                  <td style={{...styles.tableCell, fontWeight: '600'}}>
                                    {lot.lotNumber}
                                  </td>
                                  <td style={styles.tableCell}>{lot.brand}</td>
                                  <td style={styles.tableCell}>{lot.fabric}</td>
                                  <td style={styles.tableCell}>{lot.style}</td>
                                  <td style={styles.tableCell}>
                                    <span style={styles.karigarCount}>
                                      {lot.karigarCount} karigar(s)
                                    </span>
                                  </td>
                                  <td style={styles.tableCell}>
                                    <span style={styles.shadeCount}>
                                      {lot.shadeCount}/{lot.totalShades}
                                    </span>
                                  </td>
                                  <td style={{...styles.tableCell, textAlign: 'right'}}>
                                    {lot.totalQuantity}
                                  </td>
                                  <td style={{...styles.tableCell, textAlign: 'right'}}>
                                    ₹{lot.rate.toFixed(2)}
                                  </td>
                                  <td style={{...styles.tableCell, textAlign: 'right', fontWeight: '600', color: '#059669'}}>
                                    ₹{lot.totalAmount.toLocaleString()}
                                  </td>
                                  <td style={styles.tableCell}>
                                    {lot.rateInfo?.source === 'rateList' ? (
                                      <span style={styles.rateSourceBadge} title={lot.rateInfo.matchedFrom}>
                                        ✓ Master
                                      </span>
                                    ) : (
                                      <span style={{...styles.rateSourceBadge, background: '#fee2e2', color: '#dc2626'}}>
                                        ⚠ Default
                                      </span>
                                    )}
                                  </td>
                                  <td style={styles.tableCell}>
                                    <span style={styles.lotStatusBadge} title={`${lot.shadeCount}/${lot.totalShades} shades completed by ${lot.karigarCount} karigars`}>
                                      ✓ Fully Completed
                                    </span>
                                    <button 
                                      style={styles.expandButton}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleLotExpand(lot.lotNumber);
                                      }}
                                    >
                                      {expandedLots.has(lot.lotNumber) ? '▼' : '▶'}
                                    </button>
                                  </td>
                                </tr>
                                
                                {/* Expanded view showing karigar-wise breakdown */}
                                {expandedLots.has(lot.lotNumber) && (
                                  <tr style={styles.expandedRow}>
                                    <td colSpan="12" style={styles.expandedCell}>
                                      <div style={styles.expandedContent}>
                                        <h4 style={styles.expandedTitle}>Karigar-wise Breakdown - Lot {lot.lotNumber}</h4>
                                        <table style={styles.expandedTable}>
                                          <thead>
                                            <tr>
                                              <th style={styles.expandedTableHeader}>Karigar</th>
                                              <th style={styles.expandedTableHeader}>Shades</th>
                                              <th style={styles.expandedTableHeader}>Quantity</th>
                                              <th style={styles.expandedTableHeader}>Amount (₹)</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {Object.entries(lot.shadesByKarigar).map(([karigar, shades]) => {
                                              const karigarQuantity = shades.reduce((sum, s) => sum + s.quantity, 0);
                                              const karigarAmount = karigarQuantity * lot.rate;
                                              return (
                                                <tr key={karigar}>
                                                  <td style={styles.expandedTableCell}>{karigar}</td>
                                                  <td style={styles.expandedTableCell}>
                                                    {shades.map(s => `${s.shade} (${s.quantity})`).join(', ')}
                                                  </td>
                                                  <td style={{...styles.expandedTableCell, textAlign: 'right'}}>{karigarQuantity}</td>
                                                  <td style={{...styles.expandedTableCell, textAlign: 'right', fontWeight: '500'}}>
                                                    ₹{karigarAmount.toLocaleString()}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            <tr style={styles.expandedTableFooter}>
                                              <td colSpan="2" style={{...styles.expandedTableCell, textAlign: 'right', fontWeight: '600'}}>Total:</td>
                                              <td style={{...styles.expandedTableCell, textAlign: 'right', fontWeight: '600'}}>{lot.totalQuantity}</td>
                                              <td style={{...styles.expandedTableCell, textAlign: 'right', fontWeight: '600', color: '#059669'}}>
                                                ₹{lot.totalAmount.toLocaleString()}
                                              </td>
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
                          <tfoot>
                            <tr style={styles.tableFooter}>
                              <td colSpan="7" style={{...styles.tableCell, textAlign: 'right', fontWeight: '600'}}>
                                Total Selected:
                              </td>
                              <td style={{...styles.tableCell, textAlign: 'right', fontWeight: '600'}}>
                                {calculateTotalQuantity()}
                              </td>
                              <td style={styles.tableCell}></td>
                              <td style={{...styles.tableCell, textAlign: 'right', fontWeight: '700', color: '#059669', fontSize: '15px'}}>
                                ₹{calculateTotalAmount().toLocaleString()}
                              </td>
                              <td style={styles.tableCell}></td>
                              <td style={styles.tableCell}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div style={styles.emptyState}>
                        <span style={styles.emptyIcon}>📭</span>
                        <h3 style={styles.emptyTitle}>No fully completed lots found</h3>
                        <p style={styles.emptyText}>
                          No fully completed lots found for this thekedar. 
                          Lots will only appear here when ALL shades in the lot are marked as "completed".
                        </p>
                      </div>
                    )}

                    {/* Proceed Button */}
                    {selectedLots.length > 0 && (
                      <div style={styles.proceedSection}>
                        <button
                          onClick={handleCreatePayment}
                          style={styles.proceedButton}
                        >
                          Proceed to Payment Details →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Payment Details */}
              {(formData.payeeName || selectedLots.length > 0) && currentStep >= 3 && (
                <div style={styles.sectionCard}>
                  <div style={styles.sectionHeader}>
                    <h2 style={styles.sectionTitle}>Step 3: Payment Details</h2>
                    <span style={{
                      ...styles.sectionBadge,
                      ...(currentStep >= 3 ? styles.sectionBadgeActive : {})
                    }}>
                      {currentStep > 3 ? 'Completed' : currentStep === 3 ? 'Current' : 'Pending'}
                    </span>
                  </div>
                  
                  <form onSubmit={submitPayable} style={styles.sectionContent}>
                    <div style={styles.formGrid}>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Payee (Thekedar) *</label>
                        <input
                          type="text"
                          style={styles.formInput}
                          value={formData.payeeName}
                          readOnly
                          disabled
                        />
                      </div>
                      
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Amount (₹) *</label>
                        <input
                          type="number"
                          name="amount"
                          style={styles.formInput}
                          value={formData.amount}
                          onChange={handleInputChange}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          required
                        />
                      </div>
                      
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Due Date *</label>
                        <input
                          type="date"
                          name="dueDate"
                          style={styles.formInput}
                          value={formData.dueDate}
                          onChange={handleInputChange}
                          required
                        />
                      </div>
                      
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Reference No.</label>
                        <input
                          type="text"
                          name="reference"
                          style={styles.formInput}
                          value={formData.reference}
                          onChange={handleInputChange}
                          placeholder="REF-001"
                        />
                      </div>
                      
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Status</label>
                        <select
                          name="status"
                          style={styles.formInput}
                          value={formData.status}
                          onChange={handleInputChange}
                        >
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                        </select>
                      </div>
                      
                      <div style={{...styles.formField, gridColumn: 'span 3'}}>
                        <label style={styles.formLabel}>Description</label>
                        <textarea
                          name="description"
                          style={styles.formTextarea}
                          value={formData.description}
                          onChange={handleInputChange}
                          placeholder="Enter payment description..."
                          rows="3"
                        />
                      </div>
                    </div>

                    <div style={styles.formActions}>
                      <button type="button" style={styles.cancelButton} onClick={resetForm}>
                        Clear
                      </button>
                      <button type="submit" style={styles.submitButton} disabled={submitting}>
                        {submitting ? (
                          <>
                            <span style={styles.spinner}></span>
                            Creating...
                          </>
                        ) : (
                          <>
                            <span>💰</span>
                            Create Payment & Generate Slip
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* View Tab - Payment History */
          <div style={styles.viewContent}>
            {/* Search Bar */}
            <div style={styles.searchBar}>
              <div style={styles.searchWrapper}>
                <span style={styles.searchIcon}>🔍</span>
                <input
                  type="text"
                  style={styles.searchInput}
                  placeholder="Search payments by payee, description, or reference..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Stats Cards */}
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statIcon}>💰</div>
                <div>
                  <span style={styles.statLabel}>Total</span>
                  <span style={styles.statValue}>₹{totals.total.toLocaleString()}</span>
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={{...styles.statIcon, background: '#fef3c7', color: '#d97706'}}>⏳</div>
                <div>
                  <span style={styles.statLabel}>Pending</span>
                  <span style={styles.statValue}>₹{totals.pending.toLocaleString()}</span>
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={{...styles.statIcon, background: '#d1fae5', color: '#059669'}}>✅</div>
                <div>
                  <span style={styles.statLabel}>Paid</span>
                  <span style={styles.statValue}>₹{totals.paid.toLocaleString()}</span>
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={{...styles.statIcon, background: '#fee2e2', color: '#dc2626'}}>⚠️</div>
                <div>
                  <span style={styles.statLabel}>Overdue</span>
                  <span style={styles.statValue}>₹{totals.overdue.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Payments Table */}
            {loading ? (
              <div style={styles.loadingState}>
                <div style={styles.spinner}></div>
                <p>Loading payments...</p>
              </div>
            ) : (
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Payee</th>
                      <th style={styles.th}>Amount</th>
                      <th style={styles.th}>Due Date</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Category</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayables.length > 0 ? (
                      filteredPayables.map(payable => (
                        <tr key={payable.id} style={styles.tr}>
                          <td style={styles.td}>
                            <span style={styles.payableId}>{payable.payableId}</span>
                          </td>
                          <td style={styles.td}>
                            <div style={styles.payeeInfo}>
                              <span>{getTypeIcon(payable.payableType)}</span>
                              <span style={styles.payeeName}>{payable.payeeName}</span>
                            </div>
                          </td>
                          <td style={styles.td}>
                            <span style={styles.amount}>₹{payable.amount?.toLocaleString()}</span>
                          </td>
                          <td style={styles.td}>
                            <span style={styles.date}>
                              {new Date(payable.dueDate).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric'
                              })}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <span style={{
                              ...styles.statusBadge,
                              background: getStatusBgColor(payable.status),
                              color: getStatusColor(payable.status)
                            }}>
                              {payable.status}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <span style={styles.category}>{payable.category || '—'}</span>
                          </td>
                          <td style={styles.td}>
                            <button
                              style={styles.viewButton}
                              onClick={() => {
                                setSelectedPayable(payable);
                                setShowDetailsModal(true);
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" style={styles.tableEmpty}>
                          <div style={styles.emptyState}>
                            <span style={styles.emptyIcon}>📭</span>
                            <p style={styles.emptyText}>No payments found</p>
                            <span style={styles.emptySubtext}>Try adjusting your search</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Slip Modal */}
      {showPaymentSlipModal && paymentSlipData && (
        <div style={styles.modalOverlay} onClick={() => setShowPaymentSlipModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Download Payment Slip</h3>
              <button style={styles.modalClose} onClick={() => setShowPaymentSlipModal(false)}>✕</button>
            </div>
            <div style={styles.modalContent}>
              {!paymentSlipData.saveSuccess && (
                <div style={styles.warningMessage}>
                  ⚠️ Payment was not saved to database. You can still download the slip.
                </div>
              )}
              
              <p style={styles.modalText}>
                Payment slip has been generated successfully. Choose download option:
              </p>
              
              <div style={styles.modalButtons}>
                <button
                  style={styles.downloadButton}
                  onClick={() => {
                    downloadPaymentSlip(paymentSlipData.payable, paymentSlipData.lots);
                    setShowPaymentSlipModal(false);
                  }}
                >
                  📄 Download as HTML
                </button>
                
                <button
                  style={{...styles.downloadButton, background: '#059669'}}
                  onClick={() => {
                    downloadPaymentSlipAsPDF(paymentSlipData.payable, paymentSlipData.lots);
                    setShowPaymentSlipModal(false);
                  }}
                >
                  📑 Download as PDF (Print)
                </button>
                
                <button
                  style={styles.modalCancelButton}
                  onClick={() => setShowPaymentSlipModal(false)}
                >
                  Close
                </button>
              </div>

              <div style={styles.paymentSummaryBox}>
                <strong>Payment Summary:</strong><br/>
                Payee: {paymentSlipData.payable.payeeName}<br/>
                Amount: ₹{paymentSlipData.totalAmount.toLocaleString()}<br/>
                Selected Lots: {paymentSlipData.lots.length}<br/>
                Total Qty: {paymentSlipData.totalQuantity}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && selectedPayable && (
        <div style={styles.modalOverlay} onClick={() => setShowDetailsModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Payment Details</h3>
              <button style={styles.modalClose} onClick={() => setShowDetailsModal(false)}>✕</button>
            </div>
            <div style={styles.modalContent}>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Payment ID</span>
                <span style={styles.detailValue}>{selectedPayable.payableId}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Payee</span>
                <span style={styles.detailValue}>{selectedPayable.payeeName}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Amount</span>
                <span style={{...styles.detailValue, fontWeight: '600', color: '#059669'}}>
                  ₹{selectedPayable.amount?.toLocaleString()}
                </span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Due Date</span>
                <span style={styles.detailValue}>{new Date(selectedPayable.dueDate).toLocaleDateString()}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Status</span>
                <span style={{
                  ...styles.statusBadge,
                  background: getStatusBgColor(selectedPayable.status),
                  color: getStatusColor(selectedPayable.status)
                }}>
                  {selectedPayable.status}
                </span>
              </div>
              {selectedPayable.description && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Description</span>
                  <span style={styles.detailValue}>{selectedPayable.description}</span>
                </div>
              )}
              {selectedPayable.reference && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Reference</span>
                  <span style={styles.detailValue}>{selectedPayable.reference}</span>
                </div>
              )}
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Created By</span>
                <span style={styles.detailValue}>{selectedPayable.createdBy}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Created At</span>
                <span style={styles.detailValue}>{new Date(selectedPayable.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button style={styles.modalButton} onClick={() => setShowDetailsModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const styles = {
  container: {
    minHeight: '100vh',
    background: '#ffffff',
    padding: '24px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    background: 'white',
    padding: '16px 24px',
    borderRadius: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  backButton: {
    width: '40px',
    height: '40px',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '12px',
    color: '#4b5563',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    ':hover': {
      background: '#e5e7eb',
    }
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 4px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
  },
  userBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px',
    background: '#f9fafb',
    borderRadius: '40px',
    border: '1px solid #e5e7eb',
  },
  userAvatar: {
    width: '36px',
    height: '36px',
    background: '#3b82f6',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    fontWeight: '600',
    color: 'white',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
  },
  userName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#111827',
  },
  userRole: {
    fontSize: '12px',
    color: '#6b7280',
  },
  debugInfo: {
    padding: '12px',
    background: '#f3f4f6',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '12px',
    color: '#4b5563',
    border: '1px dashed #d1d5db',
  },
  successAlert: {
    padding: '12px 20px',
    background: '#10b981',
    borderRadius: '12px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '16px',
  },
  errorAlert: {
    padding: '12px 20px',
    background: '#ef4444',
    borderRadius: '12px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '16px',
  },
  warningAlert: {
    padding: '12px 20px',
    background: '#f59e0b',
    borderRadius: '12px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '16px',
  },
  tabsContainer: {
    display: 'flex',
    gap: '12px',
    marginBottom: '20px',
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px 20px',
    background: 'white',
    border: 'none',
    borderRadius: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    ':hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
    }
  },
  activeTab: {
    background: '#3b82f6',
    color: 'white',
    ':hover': {
      background: '#2563eb',
    }
  },
  tabIcon: {
    fontSize: '28px',
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
  },
  tabLabel: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '4px',
  },
  tabDescription: {
    fontSize: '13px',
    opacity: 0.9,
  },
  content: {
    background: 'transparent',
  },
  createLayout: {
    display: 'grid',
    gridTemplateColumns: '300px 1fr',
    gap: '20px',
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  rightColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  stepsCard: {
    background: 'white',
    borderRadius: '20px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  stepsTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 20px 0',
    paddingBottom: '12px',
    borderBottom: '1px solid #e5e7eb',
  },
  stepsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginBottom: '24px',
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    borderRadius: '12px',
    transition: 'all 0.2s',
  },
  stepActive: {
    background: '#f9fafb',
  },
  stepCurrent: {
    background: '#eff6ff',
    border: '1px solid #3b82f6',
  },
  stepIndicator: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  stepNumber: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#4b5563',
  },
  stepCheck: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#10b981',
    fontSize: '16px',
    fontWeight: '600',
  },
  stepInfo: {
    flex: 1,
  },
  stepLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#111827',
    marginBottom: '2px',
  },
  stepStatus: {
    fontSize: '12px',
    color: '#6b7280',
  },
  summaryCard: {
    background: '#f9fafb',
    borderRadius: '16px',
    padding: '16px',
    border: '1px solid #e5e7eb',
  },
  summaryCardTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 12px 0',
  },
  summaryCardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  summaryCardItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '13px',
  },
  summaryCardLabel: {
    color: '#6b7280',
  },
  summaryCardValue: {
    fontWeight: '500',
    color: '#111827',
  },
  selectionSummaryCard: {
    background: '#eff6ff',
    borderRadius: '16px',
    padding: '16px',
    border: '1px solid #bfdbfe',
  },
  sectionCard: {
    background: 'white',
    borderRadius: '20px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e5e7eb',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#111827',
    margin: 0,
  },
  sectionBadge: {
    padding: '4px 12px',
    background: '#f3f4f6',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '500',
    color: '#6b7280',
  },
  sectionBadgeActive: {
    background: '#dbeafe',
    color: '#2563eb',
  },
  sectionContent: {
    // No padding needed
  },
  select: {
    width: '100%',
    padding: '12px 16px',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    fontSize: '15px',
    background: 'white',
    cursor: 'pointer',
    ':focus': {
      outline: 'none',
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59,130,246,0.1)',
    }
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    gap: '16px',
    flexWrap: 'wrap',
  },
  searchWrapper: {
    flex: 1,
    minWidth: '250px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 12px',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
  },
  searchIcon: {
    fontSize: '16px',
    color: '#9ca3af',
  },
  searchInput: {
    flex: 1,
    padding: '12px 0',
    border: 'none',
    fontSize: '14px',
    background: 'transparent',
    ':focus': {
      outline: 'none',
    }
  },
  controlsRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sortSelect: {
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '14px',
    background: 'white',
    cursor: 'pointer',
  },
  sortOrderButton: {
    width: '40px',
    height: '40px',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '16px',
    cursor: 'pointer',
    ':hover': {
      background: '#f3f4f6',
    }
  },
  selectAllButton: {
    padding: '10px 16px',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#4b5563',
    cursor: 'pointer',
    ':hover': {
      background: '#f3f4f6',
    }
  },
  tableContainer: {
    overflowX: 'auto',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    marginBottom: '20px',
  },
  lotsTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
    minWidth: '1400px',
  },
  tableHeader: {
    padding: '14px 12px',
    textAlign: 'left',
    background: '#f9fafb',
    color: '#374151',
    fontWeight: '600',
    fontSize: '12px',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
  },
  tableRow: {
    cursor: 'pointer',
    transition: 'background 0.2s',
    ':hover': {
      background: '#f9fafb',
    }
  },
  tableRowSelected: {
    background: '#f0f9ff',
    ':hover': {
      background: '#e6f3ff',
    }
  },
  tableCell: {
    padding: '12px',
    borderBottom: '1px solid #f3f4f6',
    color: '#1f2937',
  },
  tableCheckbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  tableFooter: {
    background: '#f9fafb',
    borderTop: '2px solid #e5e7eb',
  },
  rateSourceBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    background: '#d1fae5',
    color: '#059669',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  lotStatusBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    background: '#dbeafe',
    color: '#2563eb',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
    marginRight: '8px',
  },
  karigarCount: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#f3f4f6',
    borderRadius: '12px',
    fontSize: '11px',
    color: '#4b5563',
  },
  shadeCount: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#e0f2fe',
    borderRadius: '12px',
    fontSize: '11px',
    color: '#0369a1',
  },
  expandButton: {
    background: 'none',
    border: 'none',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '4px 8px',
    color: '#6b7280',
    ':hover': {
      color: '#3b82f6',
    }
  },
  expandedRow: {
    background: '#f9fafb',
  },
  expandedCell: {
    padding: '20px',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  expandedContent: {
    background: 'white',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #e5e7eb',
  },
  expandedTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 16px 0',
  },
  expandedTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  expandedTableHeader: {
    padding: '10px',
    textAlign: 'left',
    background: '#f3f4f6',
    color: '#4b5563',
    fontWeight: '600',
    borderBottom: '1px solid #e5e7eb',
  },
  expandedTableCell: {
    padding: '8px 10px',
    borderBottom: '1px solid #f3f4f6',
    color: '#1f2937',
  },
  expandedTableFooter: {
    background: '#f9fafb',
    borderTop: '2px solid #e5e7eb',
  },
  proceedSection: {
    marginTop: '20px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  proceedButton: {
    padding: '12px 24px',
    background: '#3b82f6',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      background: '#2563eb',
      transform: 'translateX(4px)',
    }
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    marginBottom: '24px',
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  formLabel: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#4b5563',
  },
  formInput: {
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '14px',
    background: 'white',
    ':focus': {
      outline: 'none',
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59,130,246,0.1)',
    },
    ':disabled': {
      background: '#f9fafb',
      color: '#6b7280',
    }
  },
  formTextarea: {
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit',
    ':focus': {
      outline: 'none',
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59,130,246,0.1)',
    }
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
  cancelButton: {
    padding: '12px 24px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#6b7280',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      background: '#f9fafb',
    }
  },
  submitButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    background: '#3b82f6',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '500',
    color: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      background: '#2563eb',
    },
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    }
  },
  viewContent: {
    background: 'white',
    borderRadius: '20px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  searchBar: {
    marginBottom: '24px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '20px',
    background: '#f9fafb',
    borderRadius: '16px',
    border: '1px solid #e5e7eb',
  },
  statIcon: {
    width: '48px',
    height: '48px',
    background: '#e5e7eb',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
  },
  statLabel: {
    fontSize: '13px',
    color: '#6b7280',
    display: 'block',
    marginBottom: '4px',
  },
  statValue: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#111827',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    padding: '16px',
    textAlign: 'left',
    background: '#f9fafb',
    color: '#4b5563',
    fontWeight: '600',
    fontSize: '13px',
    borderBottom: '1px solid #e5e7eb',
  },
  td: {
    padding: '16px',
    borderBottom: '1px solid #f3f4f6',
    color: '#1f2937',
  },
  tr: {
    transition: 'background 0.2s',
    ':hover': {
      background: '#f9fafb',
    }
  },
  payableId: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#6b7280',
  },
  payeeInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  payeeName: {
    fontWeight: '500',
  },
  amount: {
    fontWeight: '600',
    color: '#111827',
  },
  date: {
    color: '#6b7280',
    fontSize: '13px',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  category: {
    fontSize: '13px',
    color: '#6b7280',
  },
  viewButton: {
    padding: '6px 16px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    color: '#4b5563',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    ':hover': {
      background: '#e5e7eb',
    }
  },
  tableEmpty: {
    padding: '60px 20px',
    textAlign: 'center',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
    color: '#9ca3af',
  },
  emptyIcon: {
    fontSize: '48px',
    display: 'block',
    marginBottom: '16px',
  },
  emptyTitle: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#374151',
    margin: '0 0 4px 0',
  },
  emptyText: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
  },
  emptySubtext: {
    fontSize: '13px',
    color: '#9ca3af',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    color: '#6b7280',
  },
  spinner: {
    width: '16px',
    height: '16px',
    border: '2px solid rgba(59,130,246,0.2)',
    borderTop: '2px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    display: 'inline-block',
    marginRight: '8px',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'white',
    borderRadius: '20px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e5e7eb',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    margin: 0,
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px',
    ':hover': {
      color: '#4b5563',
    }
  },
  modalContent: {
    padding: '24px',
  },
  warningMessage: {
    padding: '12px',
    background: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: '10px',
    marginBottom: '20px',
    color: '#92400e',
    fontSize: '14px',
  },
  modalText: {
    marginBottom: '20px',
    color: '#4b5563',
  },
  modalButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  downloadButton: {
    width: '100%',
    padding: '14px',
    background: '#3b82f6',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s',
    ':hover': {
      background: '#2563eb',
      transform: 'translateY(-1px)',
    }
  },
  modalCancelButton: {
    width: '100%',
    padding: '14px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    color: '#4b5563',
    fontSize: '15px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      background: '#e5e7eb',
    }
  },
  paymentSummaryBox: {
    marginTop: '20px',
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '10px',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '12px 0',
    borderBottom: '1px solid #f3f4f6',
    ':last-child': {
      borderBottom: 'none',
    }
  },
  detailLabel: {
    fontSize: '14px',
    color: '#6b7280',
  },
  detailValue: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#111827',
  },
  modalFooter: {
    padding: '20px 24px',
    borderTop: '1px solid #e5e7eb',
    textAlign: 'right',
  },
  modalButton: {
    padding: '10px 24px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#4b5563',
    cursor: 'pointer',
    ':hover': {
      background: '#e5e7eb',
    }
  },
};

// Add keyframes
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);
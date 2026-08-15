// src/CreatePayable.js
import React, { useState, useEffect } from 'react';
import './CreatePayable.css';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Google Sheets configuration
const GOOGLE_SHEETS_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "17qqixpHOXvG1U3RlRwaHON5JCkugpy4RIu5N9zR9ScM",
  KARIGAR_ASSIGNMENTS_RANGE: "KarigarAssignments!A:Z",
  KARIGAR_PROFILE_RANGE: "KarigarProfiles!A:L",
  PAYABLES_RANGE: "Payables!A:J",
  SUPPLIERS_RANGE: "Suppliers!A:F",
};

// Separate workbook for rate list
const RATE_LIST_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "1AhDU_LPVXJB-jZoeJ7gt7uZ2r1lLMRG5AJdZkYGVaUs",
  RANGE: "Master List!A:J",
};

export default function CreatePayable({ onBack, supervisor, onNavigate }) {
  const [activeModule, setActiveModule] = useState('create');
  const [payableType, setPayableType] = useState('karigar');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payables, setPayables] = useState([]);
  const [karigarAssignments, setKarigarAssignments] = useState([]);
  const [karigarProfiles, setKarigarProfiles] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [rateList, setRateList] = useState([]);
  
  // State for karigar filtering
  const [selectedSupervisor, setSelectedSupervisor] = useState('');
  const [supervisors, setSupervisors] = useState([]);
  const [filteredKarigars, setFilteredKarigars] = useState([]);
  const [selectedKarigar, setSelectedKarigar] = useState('');
  const [karigarWorkSummary, setKarigarWorkSummary] = useState(null);
  const [shadeWiseLots, setShadeWiseLots] = useState({});
  const [selectedShades, setSelectedShades] = useState([]);
  const [expandedShade, setExpandedShade] = useState(null);
  const [selectedLots, setSelectedLots] = useState({});
  
  // NEW: Search state for karigar dropdown
  const [karigarSearchTerm, setKarigarSearchTerm] = useState('');
  const [isKarigarDropdownOpen, setIsKarigarDropdownOpen] = useState(false);
  
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(1)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedPayable, setSelectedPayable] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');

  const [formData, setFormData] = useState({
    payableId: '',
    payableType: 'karigar',
    payeeId: '',
    payeeName: '',
    amount: '',
    dueDate: '',
    paymentDate: '',
    status: 'pending',
    category: '',
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
    loadSuppliers();
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
        console.log('Karigar profiles loaded:', profiles.length);
        
        const uniqueSupervisors = [...new Set(profiles.map(p => p.supervisorName))].filter(Boolean);
        setSupervisors(uniqueSupervisors);
        console.log('Supervisors found:', uniqueSupervisors);
        
        // NEW: Auto-select the logged-in supervisor
        if (supervisor?.name && uniqueSupervisors.includes(supervisor.name)) {
          setSelectedSupervisor(supervisor.name);
        } else if (uniqueSupervisors.length > 0 && !selectedSupervisor) {
          // Fallback: if logged-in supervisor not found, don't auto-select
          console.log('Logged-in supervisor not found in supervisors list:', supervisor?.name);
        }
      }
    } catch (err) {
      console.error('Error loading karigar profiles:', err);
      setKarigarProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  const loadKarigarAssignments = async () => {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.KARIGAR_ASSIGNMENTS_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch karigar assignments');
      const data = await response.json();

      const allAssignments = [];

      if (data.values && data.values.length > 0) {
        const rows = data.values.slice(1);
        
        for (const row of rows) {
          const timestamp = row[0] || '';
          const lotNumber = row[1] ? row[1].toString().trim() : '';
          const brand = row[2] ? row[2].trim() : '';
          const fabric = row[3] ? row[3].trim() : '';
          const style = row[4] ? row[4].trim() : '';
          const garmentType = row[5] ? row[5].trim() : '';
          const partyName = row[6] ? row[6].trim() : '';
          const season = row[7] ? row[7].trim() : '';
          const assignmentsJSON = row[8] ? row[8].trim() : '';
          const totalShades = parseInt(row[9]) || 0;
          const totalPieces = parseInt(row[10]) || 0;
          const savedBy = row[11] ? row[11].trim() : '';
          const supervisor = row[12] ? row[12].trim() : '';
          const savedAt = row[13] || '';
          const rowStatus = row[14] ? row[14].trim().toLowerCase() : 'pending';
          const lastUpdated = row[15] || '';
          const completionDateTime = row[16] || '';

          if (assignmentsJSON) {
            try {
              const parsedAssignments = JSON.parse(assignmentsJSON);
              
              for (const [shade, assignmentData] of Object.entries(parsedAssignments)) {
                const karigarId = assignmentData.karigarId || '';
                const karigarName = assignmentData.karigarName || '';
                const quantity = parseInt(assignmentData.pcs) || 0;
                const assignmentStatus = assignmentData.status ? assignmentData.status.toLowerCase() : 'pending';
                const completedAt = assignmentData.completedAt || '';
                const updatedAt = assignmentData.updatedAt || '';
                
                const individualAssignment = {
                  id: `${lotNumber}_${shade}_${karigarId}`,
                  timestamp: timestamp,
                  lotNumber: lotNumber,
                  brand: brand,
                  fabric: fabric,
                  style: style,
                  garmentType: garmentType,
                  partyName: partyName,
                  season: season,
                  shade: shade,
                  karigarName: karigarName,
                  karigarId: karigarId,
                  quantity: quantity,
                  completedQuantity: assignmentStatus === 'completed' ? quantity : 0,
                  savedBy: savedBy,
                  supervisor: supervisor,
                  savedAt: savedAt,
                  status: assignmentStatus,
                  rowStatus: rowStatus,
                  rate: 0,
                  paymentStatus: 'pending',
                  notes: '',
                  completedAt: completedAt,
                  updatedAt: updatedAt,
                  totalShades: totalShades,
                  totalPieces: totalPieces,
                  lastUpdated: lastUpdated,
                  completionDateTime: completionDateTime
                };
                
                individualAssignment.totalAmount = (individualAssignment.completedQuantity || 0) * (individualAssignment.rate || 0);
                allAssignments.push(individualAssignment);
              }
            } catch (parseError) {
              console.error(`Error parsing JSON for lot ${lotNumber}:`, parseError);
            }
          }
        }
        
        console.log('Total individual assignments loaded:', allAssignments.length);
        setKarigarAssignments(allAssignments);
      }
    } catch (err) {
      console.error('Error loading karigar assignments:', err);
      setError('Failed to load karigar assignments');
    }
  };

  const loadRateList = async () => {
    try {
      setLoading(true);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${RATE_LIST_CONFIG.SPREADSHEET_ID}/values/${RATE_LIST_CONFIG.RANGE}?key=${RATE_LIST_CONFIG.API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn('Rate list not available');
        setRateList([]);
        return;
      }
      
      const data = await response.json();

      if (data.values && data.values.length > 0) {
        const headers = data.values[0];
        const rows = data.values.slice(1);
        
        const lotNoIndex = headers.findIndex(h => h && h.toLowerCase().includes('lot'));
        const rateIndex = headers.findIndex(h => h && (h.toLowerCase().includes('total') || h.toLowerCase().includes('rate') || h.includes('₹')));
        
        const rates = rows.map(row => {
          let rate = 0;
          let lotNo = '';
          
          if (lotNoIndex !== -1 && row[lotNoIndex]) {
            lotNo = row[lotNoIndex].toString().trim();
          } else if (row[8]) {
            lotNo = row[8].toString().trim();
          }
          
          if (rateIndex !== -1 && row[rateIndex]) {
            const rateStr = row[rateIndex].toString().replace('₹', '').replace(/,/g, '').trim();
            rate = parseFloat(rateStr) || 0;
          } else if (row[9]) {
            const rateStr = row[9].toString().replace('₹', '').replace(/,/g, '').trim();
            rate = parseFloat(rateStr) || 0;
          }
          
          return {
            lotNo: lotNo,
            rate: rate
          };
        }).filter(r => r.lotNo && r.lotNo !== '');
        
        console.log('Rate list loaded:', rates.length, 'rates by lot number');
        setRateList(rates);
      }
    } catch (err) {
      console.error('Error loading rate list:', err);
      setRateList([]);
    } finally {
      setLoading(false);
    }
  };

  const getRateFromList = (assignment) => {
    if (!rateList || rateList.length === 0) {
      return {
        rate: 0,
        source: 'none',
        matchedFrom: 'No rate list available'
      };
    }

    const lotNumberStr = assignment.lotNumber.toString().trim();
    const matchedRate = rateList.find(r => 
      r.lotNo && r.lotNo.toString().trim() === lotNumberStr
    );

    if (matchedRate && matchedRate.rate > 0) {
      return {
        rate: matchedRate.rate,
        source: 'rateList',
        matchedFrom: `Lot ${assignment.lotNumber} - Rate: ₹${matchedRate.rate}`,
        rateDetails: matchedRate
      };
    } else if (matchedRate && matchedRate.rate === 0) {
      return {
        rate: 0,
        source: 'none',
        matchedFrom: `Lot ${assignment.lotNumber} found but rate is ₹0 in master list`
      };
    } else {
      return {
        rate: 0,
        source: 'none',
        matchedFrom: `No rate found for lot ${assignment.lotNumber} in master list`
      };
    }
  };

  const loadSuppliers = async () => {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.SUPPLIERS_RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) {
        setSuppliers([]);
        return;
      }
      const data = await response.json();

      if (data.values && data.values.length > 0) {
        const rows = data.values.slice(1);
        const suppliersList = rows.map(row => ({
          id: row[0] || '',
          name: row[1] || '',
          material: row[2] || '',
          paymentTerms: row[3] || '',
          contact: row[4] || '',
          active: row[5] || 'Yes'
        })).filter(s => s.id && s.name);
        
        setSuppliers(suppliersList);
      }
    } catch (err) {
      console.error('Error loading suppliers:', err);
      setSuppliers([]);
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

  useEffect(() => {
    if (selectedSupervisor && karigarProfiles.length > 0) {
      const karigarsUnderSupervisor = karigarProfiles
        .filter(profile => profile.supervisorName === selectedSupervisor)
        .map(profile => ({
          karigarId: profile.karigarId.trim(),
          karigarName: profile.karigarName.trim(),
          floorArea: profile.floorArea,
          skillType: profile.skillType
        }));

      const enhancedKarigars = karigarsUnderSupervisor.map(karigar => {
        const karigarWork = karigarAssignments.filter(
          a => a.karigarId && a.karigarId.trim() === karigar.karigarId && a.status === 'completed'
        );
        
        return {
          ...karigar,
          totalLots: karigarWork.length,
          totalAmount: karigarWork.reduce((sum, a) => sum + (a.totalAmount || 0), 0),
          totalQuantity: karigarWork.reduce((sum, a) => sum + (a.completedQuantity || a.quantity || 0), 0)
        };
      });

      setFilteredKarigars(enhancedKarigars);
    } else {
      setFilteredKarigars([]);
    }
  }, [selectedSupervisor, karigarProfiles, karigarAssignments]);

  // Get filtered karigars based on search term
  const getFilteredKarigarsBySearch = () => {
    if (!karigarSearchTerm.trim()) {
      return filteredKarigars;
    }
    
    const searchLower = karigarSearchTerm.toLowerCase();
    return filteredKarigars.filter(karigar => 
      karigar.karigarId.toLowerCase().includes(searchLower) ||
      karigar.karigarName.toLowerCase().includes(searchLower)
    );
  };

  const handleKarigarSelect = (karigar) => {
    setSelectedKarigar(karigar.karigarId);
    setKarigarSearchTerm('');
    setIsKarigarDropdownOpen(false);
  };

  useEffect(() => {
    if (selectedKarigar && karigarAssignments.length > 0) {
      const completedWork = karigarAssignments.filter(
        a => a.karigarId && a.karigarId.trim() === selectedKarigar.trim() && a.status === 'completed'
      );

      console.log(`Found ${completedWork.length} completed assignments for karigar ${selectedKarigar}`);

      const groupedByShade = completedWork.reduce((acc, assignment) => {
        const shade = assignment.shade || 'Unassigned';
        
        const rateInfo = getRateFromList(assignment);
        const quantity = assignment.completedQuantity || assignment.quantity || 0;
        const totalAmount = quantity * rateInfo.rate;
        
        if (!acc[shade]) {
          acc[shade] = {
            shade: shade,
            lots: [],
            totalQuantity: 0,
            totalAmount: 0,
            lotNumbers: [],
            rateInfo: rateInfo,
            rates: {},
            completedCount: 0,
            lotNumber: assignment.lotNumber
          };
        }
        
        const updatedAssignment = {
          ...assignment,
          rate: rateInfo.rate,
          rateInfo: rateInfo,
          totalAmount: totalAmount,
          isCompleted: true
        };
        
        acc[shade].lots.push(updatedAssignment);
        acc[shade].totalQuantity += quantity;
        acc[shade].totalAmount += totalAmount;
        acc[shade].lotNumbers.push(assignment.lotNumber);
        acc[shade].rates[assignment.lotNumber] = rateInfo;
        acc[shade].completedCount += 1;
        
        return acc;
      }, {});

      setShadeWiseLots(groupedByShade);

      if (completedWork.length > 0) {
        const totalAmount = Object.values(groupedByShade).reduce(
          (sum, shade) => sum + shade.totalAmount, 0
        );
        
        setKarigarWorkSummary({
          name: completedWork[0].karigarName,
          id: completedWork[0].karigarId,
          totalLots: completedWork.length,
          totalAmount: totalAmount,
          totalQuantity: completedWork.reduce((sum, a) => sum + (a.completedQuantity || a.quantity || 0), 0),
          brands: [...new Set(completedWork.map(a => a.brand))].filter(Boolean).join(', '),
          completedShades: Object.keys(groupedByShade).length
        });
      } else {
        setKarigarWorkSummary(null);
      }

      setSelectedShades([]);
      setExpandedShade(null);
      setSelectedLots({});
      
      setDebugInfo(`Selected Karigar: ${selectedKarigar}\nTotal Assignments: ${karigarAssignments.length}\nCompleted for this karigar: ${completedWork.length}`);
    }
  }, [selectedKarigar, karigarAssignments, rateList]);

  const generatePayableId = () => {
    const prefix = 'PAY';
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}${year}${month}${random}`;
  };

  const handleSupervisorChange = (e) => {
    setSelectedSupervisor(e.target.value);
    setSelectedKarigar('');
    setKarigarSearchTerm('');
    setIsKarigarDropdownOpen(false);
    setShadeWiseLots({});
    setSelectedShades([]);
    setKarigarWorkSummary(null);
    setExpandedShade(null);
    setSelectedLots({});
    setDebugInfo('');
  };

  const handleShadeSelection = (shade) => {
    setSelectedShades(prev => {
      if (prev.includes(shade)) {
        const newSelectedLots = { ...selectedLots };
        delete newSelectedLots[shade];
        setSelectedLots(newSelectedLots);
        return prev.filter(s => s !== shade);
      } else {
        const newSelectedLots = { ...selectedLots };
        newSelectedLots[shade] = shadeWiseLots[shade].lots.map(lot => lot.lotNumber);
        setSelectedLots(newSelectedLots);
        return [...prev, shade];
      }
    });
  };

  const handleLotSelection = (shade, lotNumber) => {
    setSelectedLots(prev => {
      const shadeLots = prev[shade] || [];
      const updatedShadeLots = shadeLots.includes(lotNumber)
        ? shadeLots.filter(l => l !== lotNumber)
        : [...shadeLots, lotNumber];
      
      const newSelectedLots = {
        ...prev,
        [shade]: updatedShadeLots
      };

      setSelectedShades(prevShades => {
        if (updatedShadeLots.length === 0) {
          return prevShades.filter(s => s !== shade);
        } else if (!prevShades.includes(shade) && updatedShadeLots.length > 0) {
          return [...prevShades, shade];
        }
        return prevShades;
      });

      return newSelectedLots;
    });
  };

  const handleSelectAllLots = (shade) => {
    const allLots = shadeWiseLots[shade].lots.map(lot => lot.lotNumber);
    setSelectedLots(prev => {
      const currentShadeLots = prev[shade] || [];
      const newSelectedLots = {
        ...prev,
        [shade]: currentShadeLots.length === allLots.length ? [] : allLots
      };

      setSelectedShades(prevShades => {
        if (newSelectedLots[shade].length === 0) {
          return prevShades.filter(s => s !== shade);
        } else if (!prevShades.includes(shade)) {
          return [...prevShades, shade];
        }
        return prevShades;
      });

      return newSelectedLots;
    });
  };

  const handleSelectAllShades = () => {
    const allShades = Object.keys(shadeWiseLots);
    if (selectedShades.length === allShades.length) {
      setSelectedShades([]);
      setSelectedLots({});
    } else {
      setSelectedShades(allShades);
      const allLots = {};
      allShades.forEach(shade => {
        allLots[shade] = shadeWiseLots[shade].lots.map(lot => lot.lotNumber);
      });
      setSelectedLots(allLots);
    }
  };

  const toggleShadeExpand = (shade) => {
    setExpandedShade(expandedShade === shade ? null : shade);
  };

  const calculateTotalAmount = () => {
    let total = 0;
    Object.entries(selectedLots).forEach(([shade, lots]) => {
      const shadeData = shadeWiseLots[shade];
      if (shadeData) {
        lots.forEach(lotNumber => {
          const lot = shadeData.lots.find(l => l.lotNumber === lotNumber);
          if (lot) {
            total += lot.totalAmount;
          }
        });
      }
    });
    return total;
  };

  const calculateTotalQuantity = () => {
    let total = 0;
    Object.entries(selectedLots).forEach(([shade, lots]) => {
      const shadeData = shadeWiseLots[shade];
      if (shadeData) {
        lots.forEach(lotNumber => {
          const lot = shadeData.lots.find(l => l.lotNumber === lotNumber);
          if (lot) {
            total += lot.completedQuantity || lot.quantity || 0;
          }
        });
      }
    });
    return total;
  };

  const getSelectedLotsData = () => {
    const selectedLotsData = [];
    Object.entries(selectedLots).forEach(([shade, lots]) => {
      const shadeData = shadeWiseLots[shade];
      if (shadeData) {
        const shadeLots = shadeData.lots.filter(lot => lots.includes(lot.lotNumber));
        if (shadeLots.length > 0) {
          selectedLotsData.push({
            shade: shade,
            lots: shadeLots,
            totalQuantity: shadeLots.reduce((sum, lot) => sum + (lot.completedQuantity || lot.quantity || 0), 0),
            totalAmount: shadeLots.reduce((sum, lot) => sum + lot.totalAmount, 0),
            lotNumbers: shadeLots.map(lot => lot.lotNumber)
          });
        }
      }
    });
    return selectedLotsData;
  };

  const handleCreatePayment = () => {
    const selectedLotsData = getSelectedLotsData();
    const totalAmount = calculateTotalAmount();
    const lotNumbers = selectedLotsData.flatMap(s => s.lotNumbers).join(', ');
    const shadesList = selectedLotsData.map(s => s.shade).join(', ');
    
    const rateDetails = selectedLotsData.map(shade => {
      const lotsWithRates = shade.lots.map(lot => 
        `${lot.lotNumber}: ${lot.completedQuantity || lot.quantity} pcs @ ₹${lot.rate?.toFixed(2)} (${lot.rateInfo?.matchedFrom || 'rate list'})`
      ).join('; ');
      return `${shade.shade}: ${lotsWithRates}`;
    }).join('\n');
    
    setFormData({
      ...formData,
      payeeId: selectedKarigar,
      payeeName: karigarWorkSummary?.name || '',
      amount: totalAmount,
      category: 'Wages',
      description: `Payment for completed lots:\nLots: ${lotNumbers}\nShades: ${shadesList}\n\nRate Details:\n${rateDetails}`,
      supervisor: selectedSupervisor || supervisor?.name || 'Supervisor'
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };

  // Black and White PDF Generation Function
const generatePaymentSlipPDF = (payableData, selectedLotsData) => {
    // 1. Variable Definitions & Setup
    const payableId = payableData.payableId || payableData.id || "N/A";
    
    // Using numberToWords function on the total amount
    const amountInWords = typeof numberToWords === 'function' 
        ? numberToWords(payableData.amount) 
        : (payableData.amountInWords || "");

    const supervisorName = payableData.supervisor || '________________';
    
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    let yPos = 18;

    const formatCurrency = (num) => parseFloat(num || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const currentDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    // Calculate total quantity
    let totalQuantity = 0;
    selectedLotsData.forEach(shade => {
        shade.lots.forEach(lot => {
            const qty = parseFloat(lot.completedQuantity || lot.quantity || 0);
            totalQuantity += qty;
        });
    });

    // --- 2. FULL PAGE BORDER ---
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(5, 5, pageWidth - 10, pageHeight - 10);

    // --- 3. HEADER SECTION ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("PAYMENT VOUCHER", pageWidth / 2, yPos, { align: "center" });
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("KARIGAR PAYMENT SLIP", pageWidth / 2, yPos + 6, { align: "center" });
    
    doc.setFont("helvetica", "bold");
    doc.text(`VOUCHER NUMBER: ${payableId}`, pageWidth - margin - 2, yPos, { align: "right" });

    yPos += 12;

    // --- 4. INFORMATION GRID (TOP BOX) ---
    doc.setLineWidth(0.3);
    doc.rect(margin, yPos, pageWidth - (margin * 2), 28); 
    doc.line(pageWidth / 2 + 5, yPos, pageWidth / 2 + 5, yPos + 28); 

    doc.setFontSize(9);
    const leftX = margin + 3;
    const rightX = pageWidth / 2 + 8;

    // Left Column
    doc.setFont("helvetica", "bold"); doc.text("DATE:", leftX, yPos + 6);
    doc.setFont("helvetica", "normal"); doc.text(currentDate, leftX + 15, yPos + 6);
    doc.setFont("helvetica", "bold"); doc.text("PAYEE:", leftX, yPos + 12);
    doc.setFont("helvetica", "normal"); doc.text(`${payableData.payeeName || ''}`, leftX + 15, yPos + 12);
    doc.setFont("helvetica", "bold"); doc.text("CATEGORY:", leftX, yPos + 18);
    doc.setFont("helvetica", "normal"); doc.text(`${payableData.category || ''}`, leftX + 22, yPos + 18);
    doc.setFont("helvetica", "bold"); doc.text("STATUS:", leftX, yPos + 24);
    doc.setFont("helvetica", "normal"); doc.text(`${payableData.status || ''}`, leftX + 18, yPos + 24);

    // Right Column
    doc.setFont("helvetica", "bold"); doc.text("DUE DATE:", rightX, yPos + 6);
    doc.setFont("helvetica", "normal"); doc.text(new Date(payableData.dueDate).toLocaleDateString('en-IN'), rightX + 20, yPos + 6);
    doc.setFont("helvetica", "bold"); doc.text("PAYEE ID:", rightX, yPos + 12);
    doc.setFont("helvetica", "normal"); doc.text(`${payableData.payeeId || ''}`, rightX + 20, yPos + 12);
    doc.setFont("helvetica", "bold"); doc.text("TOTAL QTY:", rightX, yPos + 18);
    
    // UPDATED: Removed .toFixed(2) so it shows 55 instead of 55.00
    doc.setFont("helvetica", "normal"); 
    doc.text(`${Math.round(totalQuantity)}`, rightX + 25, yPos + 18);

    doc.setFont("helvetica", "bold"); doc.text("SUPERVISOR:", rightX, yPos + 24);
    doc.setFont("helvetica", "normal"); doc.text(supervisorName, rightX + 25, yPos + 24);

    yPos += 28;

    // --- 5. AMOUNT IN WORDS ---
    doc.setLineWidth(0.3);
    doc.rect(margin, yPos, pageWidth - (margin * 2), 10);
    doc.setFont("helvetica", "bold");
    doc.text(`Amt in Words :-`, margin + 3, yPos + 6.5);
    doc.setFont("helvetica", "normal");
    doc.text(`${amountInWords} Rupees Only`, margin + 30, yPos + 6.5);

    // --- 6. THE GAP ---
    yPos += 25; 

    // --- 7. MAIN TABLE ---
    const tableBody = [];
    let calculatedGrandTotal = 0;

    selectedLotsData.forEach(shade => {
        shade.lots.forEach(lot => {
            const qty = parseFloat(lot.completedQuantity || lot.quantity || 0);
            const rate = parseFloat(lot.rate || 0);
            const lineAmount = qty * rate;
            calculatedGrandTotal += lineAmount;

            tableBody.push([
                lot.lotNumber || '',
                shade.shade || '',
                `${lot.brand || ''} ${lot.style || ''}`.trim(),
                qty, // Individual row qty
                rate.toFixed(2),
                lineAmount.toFixed(2)
            ]);
        });
    });

    autoTable(doc, {
        startY: yPos,
        head: [['LOT NO.', 'SHADE', 'BRAND/STYLE', 'QTY', 'RATE', 'Amt.']],
        body: tableBody,
        theme: 'grid',
        styles: { 
            lineColor: [0, 0, 0], 
            lineWidth: 0.2, 
            textColor: [0, 0, 0], 
            halign: 'center',
            fontSize: 8.5,
            cellPadding: 3
        },
        headStyles: { 
            fillColor: [245, 245, 245], 
            textColor: [0, 0, 0], 
            fontStyle: 'bold',
            lineWidth: 0.2
        },
        margin: { left: margin, right: margin },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 'auto' },
            4: { cellWidth: 'auto' },
            5: { cellWidth: 'auto' }
        }
    });

    yPos = doc.lastAutoTable.finalY;

    // --- 8. TOTAL PAYABLE SECTION ---
    doc.rect(margin, yPos, pageWidth - (margin * 2), 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    // doc.text("TOTAL", margin + 15, yPos + 7.5);
    doc.text("PAYABLE AMOUNT", margin + 70, yPos + 7.5);
    doc.setFontSize(12);
    doc.text(`Rs. ${formatCurrency(calculatedGrandTotal)}`, pageWidth - margin - 5, yPos + 7.5, { align: "right" });

    // --- 9. SIGNATURE SECTION ---
    const footerY = pageHeight - 30;
    doc.setLineWidth(0.4);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    
    doc.line(margin + 5, footerY, margin + 65, footerY);
    doc.text("RECEIVER SIGNATURE", margin + 35, footerY + 5, { align: "center" });

    doc.line(pageWidth - margin - 65, footerY, pageWidth - margin - 5, footerY);
    doc.text("SUPERVISOR/ THEKEDAR", pageWidth - margin - 35, footerY + 5, { align: "center" });

    // --- 10. SAVE ---
    doc.save(`Voucher_${payableId}.pdf`);
};

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

const submitPayable = async (e) => {
  e.preventDefault();
  setSubmitting(true);
  setError('');

  try {
    if (!formData.payeeName || !formData.amount || !formData.dueDate) {
      throw new Error('Please fill all required fields');
    }

    const payableId = generatePayableId();
    const selectedLotsData = getSelectedLotsData();
    const currentDate = new Date().toISOString().split('T')[0];
    
    // IMPORTANT: Replace with your actual Apps Script Web App URL
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyuhODCrUpcFi0b5Om0GrT0dwRuS-QFHlW1ms_6fIiByzMU522dI_qvW2OO6Lkrtnsv/exec';
    
    // Create payment record for Payables sheet using Apps Script
    const newPayable = {
      action: 'createPayable',
      data: {
        payableId: payableId,
        payableType: payableType,
        payeeId: formData.payeeId,
        payeeName: formData.payeeName,
        amount: formData.amount,
        dueDate: formData.dueDate,
        paymentDate: formData.paymentDate || currentDate,
        status: formData.status,
        category: formData.category,
        description: formData.description,
        reference: formData.reference,
        notes: formData.notes,
        createdBy: supervisor?.name || 'Unknown'
      }
    };
    
    let saveSuccess = false;
    
    // 1. Save to Payables sheet via Apps Script
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          action: 'createPayable',
          data: JSON.stringify(newPayable.data)
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        saveSuccess = true;
        console.log('Payable saved successfully:', result);
      } else {
        throw new Error(result.error || 'Failed to save payable');
      }
      
    } catch (saveError) {
      console.error('Error saving to Google Sheets:', saveError);
      throw new Error('Failed to save payable to database: ' + saveError.message);
    }

    // 2. UPDATE KARIGAR ASSIGNMENTS with payment information in JSON
    // Group updates by lot to batch process
    const updatesByLot = {};
    
    for (const shadeData of selectedLotsData) {
      for (const lot of shadeData.lots) {
        if (!updatesByLot[lot.lotNumber]) {
          updatesByLot[lot.lotNumber] = {
            lotNumber: lot.lotNumber,
            shades: [],
            amounts: []
          };
        }
        if (!updatesByLot[lot.lotNumber].shades.includes(shadeData.shade)) {
          updatesByLot[lot.lotNumber].shades.push(shadeData.shade);
          updatesByLot[lot.lotNumber].amounts.push(lot.totalAmount);
        }
      }
    }
    
    // Process each lot's updates
    for (const lotNumber in updatesByLot) {
      const updateData = updatesByLot[lotNumber];
      
      try {
        console.log(`Updating payment info for lot ${lotNumber} with shades:`, updateData.shades);
        
        const updateResponse = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            action: 'updateBulkPaymentInfo',
            data: JSON.stringify({
              lotNumber: updateData.lotNumber,
              shades: updateData.shades,
              paymentId: payableId,
              totalAmount: parseFloat(formData.amount),
              paymentDate: formData.paymentDate || currentDate,
              paidBy: supervisor?.name || 'Unknown',
              paymentStatus: 'paid'
            })
          })
        });
        
        const updateResult = await updateResponse.json();
        console.log(`Payment info updated for lot ${lotNumber}:`, updateResult);
        
      } catch (updateError) {
        console.error(`Error updating payment info for lot ${lotNumber}:`, updateError);
        // Don't throw here, continue with other updates
      }
    }

    // Generate PDF
    const paymentData = {
      ...formData,
      payableId: payableId,
      payableType: payableType,
      supervisor: selectedSupervisor || supervisor?.name || 'Supervisor'
    };
    
    generatePaymentSlipPDF(paymentData, selectedLotsData);
    
    if (saveSuccess) {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      loadPayables();
      loadKarigarAssignments();
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
      payableType: 'karigar',
      payeeId: '',
      payeeName: '',
      amount: '',
      dueDate: '',
      paymentDate: '',
      status: 'pending',
      category: '',
      description: '',
      reference: '',
      notes: '',
      createdBy: supervisor?.name || 'Unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setSelectedSupervisor('');
    setSelectedKarigar('');
    setKarigarSearchTerm('');
    setIsKarigarDropdownOpen(false);
    setShadeWiseLots({});
    setSelectedShades([]);
    setSelectedLots({});
    setKarigarWorkSummary(null);
    setExpandedShade(null);
    setDebugInfo('');
  };

  const filteredPayables = payables.filter(payable => {
    const matchesStatus = filterStatus === 'all' || payable.status === filterStatus;
    const matchesSearch = (payable.payeeName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (payable.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (payable.reference || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDateRange = (!dateRange.start || payable.dueDate >= dateRange.start) &&
                            (!dateRange.end || payable.dueDate <= dateRange.end);
    
    return matchesStatus && matchesSearch && matchesDateRange;
  });

  const getStatusColor = (status) => {
    switch(status) {
      case 'paid': return { bg: '#ECFDF3', text: '#027A48', dot: '#12B76A' };
      case 'pending': return { bg: '#FFFAEB', text: '#B54708', dot: '#F79009' };
      case 'overdue': return { bg: '#FEF3F2', text: '#B42318', dot: '#F04438' };
      default: return { bg: '#F2F4F7', text: '#344054', dot: '#667085' };
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

  const modules = [
    { id: 'create', label: 'Create Payable', icon: '➕' },
    { id: 'view', label: 'View Payables', icon: '👁️' }
  ];

  const payableTypes = [
    { id: 'karigar', label: 'Karigar Wages', icon: '👤', desc: 'Process worker payments' },
    { 
      id: 'supplier', 
      label: 'Supervisor/Thekedar Payment', 
      icon: '🏭', 
      desc: 'Pay material Supervisor/Thekedar',
      navigateTo: 'supervisorPayment'
    },
    { id: 'operational', label: 'Operational Expense', icon: '⚡', desc: 'Other business expenses' }
  ];

  return (
    <div className="create-payable-container">
      <div className="create-payable-header">
        <div className="create-payable-header-left">
          <button onClick={onBack} className="create-payable-back-button">
            ← Back
          </button>
          <div>
            <h1 className="create-payable-title">Payables Management</h1>
            <p className="create-payable-subtitle">Manage and track all your payment obligations</p>
          </div>
        </div>
        <div className="create-payable-header-right">
          {/* UPDATED: Display logged-in user prominently */}
          <div className="create-payable-supervisor-badge">
            <span className="create-payable-supervisor-avatar">
              {supervisor?.name?.charAt(0) || 'U'}
            </span>
            <div className="create-payable-supervisor-info">
              <span className="create-payable-supervisor-label">Logged in as</span>
              <span className="create-payable-supervisor-name">{supervisor?.name || 'Unknown'}</span>
              {supervisor?.role && (
                <span className="create-payable-supervisor-role">({supervisor.role})</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {rateList.length === 0 && (
        <div className="create-payable-warning-alert">
          <span className="create-payable-alert-icon">⚠️</span>
          <span>Rate list not loaded. Using default rates from assignments.</span>
        </div>
      )}

      {rateList.length > 0 && (
        <div className="create-payable-success-alert">
          <span className="create-payable-alert-icon">✓</span>
          <span>Rate list loaded: {rateList.length} rates available</span>
        </div>
      )}

      {showSuccess && (
        <div className="create-payable-success-alert">
          <span className="create-payable-alert-icon">✓</span>
          <span>Payable created successfully! PDF downloaded.</span>
        </div>
      )}
      {error && (
        <div className="create-payable-error-alert">
          <span className="create-payable-alert-icon">⚠</span>
          <span>{error}</span>
        </div>
      )}

      <div className="create-payable-module-nav">
        {modules.map(module => (
          <button
            key={module.id}
            className={`create-payable-module-button ${activeModule === module.id ? 'active' : ''}`}
            onClick={() => setActiveModule(module.id)}
          >
            <span className="create-payable-module-icon">{module.icon}</span>
            <span>{module.label}</span>
          </button>
        ))}
      </div>

      <div className="create-payable-content">
        {activeModule === 'create' ? (
          <div className="create-payable-module-content">
            <div className="create-payable-type-section">
              <h2 className="create-payable-section-title">Select Payable Type</h2>
              <div className="create-payable-type-grid">
                {payableTypes.map(type => (
                  <button
                    key={type.id}
                    className={`create-payable-type-card ${payableType === type.id ? 'active' : ''}`}
                    onClick={() => {
                      if (type.navigateTo) {
                        if (onNavigate) {
                          onNavigate(type.navigateTo);
                        } else {
                          setPayableType(type.id);
                          resetForm();
                        }
                      } else {
                        setPayableType(type.id);
                        resetForm();
                      }
                    }}
                  >
                    <span className="create-payable-type-icon">{type.icon}</span>
                    <div className="create-payable-type-info">
                      <h3 className="create-payable-type-label">{type.label}</h3>
                      <p className="create-payable-type-desc">{type.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="create-payable-form-container">
              <div className="create-payable-left-column">
                {payableType === 'karigar' ? (
                  <>
                    <div className="create-payable-card">
                      <h3 className="create-payable-card-title">Step 1: Select Supervisor</h3>
                      <div className="create-payable-field">
                        <label className="create-payable-label">
                          Supervisor/Thekedar <span className="create-payable-required">*</span>
                        </label>
                        {/* UPDATED: Supervisor dropdown now shows only the logged-in user */}
                        <select
                          className="create-payable-select"
                          value={selectedSupervisor}
                          onChange={handleSupervisorChange}
                          required
                          disabled={supervisors.length === 1} // Disable if only one option
                        >
                          <option value="">Choose Supervisor</option>
                          {/* Filter supervisors to show only the logged-in user's name */}
                          {supervisors
                            .filter(sup => sup === supervisor?.name)
                            .map(sup => (
                              <option key={sup} value={sup}>{sup}</option>
                            ))}
                        </select>
                        {supervisor?.name && supervisors.length > 0 && !supervisors.includes(supervisor.name) && (
                          <div className="create-payable-warning-text">
                            ⚠️ Your name "{supervisor.name}" is not in the supervisors list. Please contact admin.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="create-payable-card">
                      <h3 className="create-payable-card-title">Step 2: Select Karigar</h3>
                      <div className="create-payable-field">
                        <label className="create-payable-label">
                          Karigar <span className="create-payable-required">*</span>
                        </label>
                        <div className="create-payable-searchable-dropdown">
                          <input
                            type="text"
                            className="create-payable-input create-payable-search-input"
                            placeholder="Search by ID or Name..."
                            value={selectedKarigar ? (filteredKarigars.find(k => k.karigarId === selectedKarigar)?.karigarName || '') : karigarSearchTerm}
                            onChange={(e) => {
                              setKarigarSearchTerm(e.target.value);
                              setIsKarigarDropdownOpen(true);
                              if (selectedKarigar) {
                                setSelectedKarigar('');
                              }
                            }}
                            onFocus={() => setIsKarigarDropdownOpen(true)}
                            disabled={!selectedSupervisor}
                            readOnly={!!selectedKarigar}
                          />
                          {selectedKarigar && (
                            <button
                              className="create-payable-clear-search"
                              onClick={() => {
                                setSelectedKarigar('');
                                setKarigarSearchTerm('');
                                setShadeWiseLots({});
                                setKarigarWorkSummary(null);
                              }}
                              type="button"
                            >
                              ✕
                            </button>
                          )}
                          {isKarigarDropdownOpen && (
                            <div className="create-payable-dropdown-list">
                              {getFilteredKarigarsBySearch().length > 0 ? (
                                getFilteredKarigarsBySearch().map(karigar => (
                                  <div
                                    key={karigar.karigarId}
                                    className="create-payable-dropdown-item"
                                    onClick={() => handleKarigarSelect(karigar)}
                                  >
                                    <div className="create-payable-dropdown-item-main">
                                      <span className="create-payable-dropdown-id">{karigar.karigarId}</span>
                                      <span className="create-payable-dropdown-name">{karigar.karigarName}</span>
                                    </div>
                                    <div className="create-payable-dropdown-details">
                                      <span className="create-payable-dropdown-lots">
                                        {karigar.totalLots} lots completed
                                      </span>
                                      {karigar.totalAmount > 0 && (
                                        <span className="create-payable-dropdown-amount">
                                          ₹{karigar.totalAmount.toLocaleString()}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="create-payable-dropdown-no-results">
                                  No karigars found matching "{karigarSearchTerm}"
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : payableType === 'supplier' ? (
                  <div className="create-payable-card">
                    <h3 className="create-payable-card-title">Supplier Information</h3>
                    <div className="create-payable-field">
                      <label className="create-payable-label">
                        Select Supplier <span className="create-payable-required">*</span>
                      </label>
                      <select
                        className="create-payable-select"
                        value={formData.payeeId}
                        onChange={(e) => {
                          const supplier = suppliers.find(s => s.id === e.target.value);
                          setFormData({
                            ...formData,
                            payeeId: e.target.value,
                            payeeName: supplier?.name || '',
                            category: 'Raw Material',
                          });
                        }}
                        required
                      >
                        <option value="">Choose Supplier</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="create-payable-card">
                    <h3 className="create-payable-card-title">Payee Information</h3>
                    <div className="create-payable-field">
                      <label className="create-payable-label">
                        Payee Name <span className="create-payable-required">*</span>
                      </label>
                      <input
                        type="text"
                        name="payeeName"
                        className="create-payable-input"
                        value={formData.payeeName}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="create-payable-right-column">
                {payableType === 'karigar' && Object.keys(shadeWiseLots).length > 0 && (
                  <div className="create-payable-card">
                    <div className="create-payable-card-header">
                      <h3 className="create-payable-card-title">Completed Work by Shade</h3>
                      <button type="button" onClick={handleSelectAllShades} className="create-payable-select-all-button">
                        {selectedShades.length === Object.keys(shadeWiseLots).length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    
                    {/* Table format for Completed Work by Shade */}
                    <div className="create-payable-shade-table-container">
                      <table className="create-payable-shade-table">
                        <thead>
                          <tr>
                            <th style={{ width: '40px' }}>Select</th>
                            <th>Shade Name</th>
                            <th>Lot Numbers</th>
                            <th>Total Qty</th>
                            <th>Rate</th>
                            <th>Total Amount</th>
                            <th style={{ width: '50px' }}>Expand</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(shadeWiseLots).map(([shade, data]) => (
                            <React.Fragment key={shade}>
                              <tr className={`create-payable-shade-table-row ${selectedShades.includes(shade) ? 'selected' : ''}`}>
                                <td className="create-payable-table-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={selectedShades.includes(shade)}
                                    onChange={() => handleShadeSelection(shade)}
                                  />
                                 </td>
                                <td className="create-payable-shade-name-cell">{shade}</td>
                                <td className="create-payable-lot-numbers-cell">{data.lotNumbers.join(', ')}</td>
                                <td className="create-payable-quantity-cell">{data.totalQuantity}</td>
                                <td className="create-payable-rate-cell">₹{data.lots[0]?.rate?.toFixed(2) || '0'}</td>
                                <td className="create-payable-amount-cell">₹{data.totalAmount.toLocaleString()}</td>
                                <td className="create-payable-expand-cell">
                                  <button 
                                    className="create-payable-expand-table-button"
                                    onClick={() => toggleShadeExpand(shade)}
                                  >
                                    {expandedShade === shade ? '▼' : '▶'}
                                  </button>
                                </td>
                              </tr>
                              {expandedShade === shade && (
                                <tr className="create-payable-lots-expanded-row">
                                  <td colSpan="7">
                                    <div className="create-payable-lots-table-container">
                                      <table className="create-payable-lots-table">
                                        <thead>
                                          <tr>
                                            <th style={{ width: '40px' }}>Select</th>
                                            <th>Lot Number</th>
                                            <th>Brand/Style</th>
                                            <th>Quantity</th>
                                            <th>Rate (₹)</th>
                                            <th>Amount (₹)</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {data.lots.map((lot) => (
                                            <tr key={lot.lotNumber}>
                                              <td className="create-payable-table-checkbox">
                                                <input
                                                  type="checkbox"
                                                  checked={selectedLots[shade]?.includes(lot.lotNumber) || false}
                                                  onChange={() => handleLotSelection(shade, lot.lotNumber)}
                                                />
                                              </td>
                                              <td>{lot.lotNumber}</td>
                                              <td>{lot.brand} {lot.style}</td>
                                              <td>{lot.completedQuantity || lot.quantity || 0}</td>
                                              <td>₹{lot.rate?.toFixed(2) || '0'}</td>
                                              <td>₹{lot.totalAmount.toLocaleString()}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    
                    {Object.keys(selectedLots).length > 0 && (
                      <div className="create-payable-selected-summary">
                        <button type="button" onClick={handleCreatePayment} className="create-payable-create-payment-button">
                          Create Payment for Selected Lots (₹{calculateTotalAmount().toLocaleString()})
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {(formData.payeeName || Object.keys(selectedLots).length > 0) && (
              <form onSubmit={submitPayable} className="create-payable-payment-section">
                <h2 className="create-payable-section-title">Payment Details</h2>
                <div className="create-payable-payment-grid">
                  <div className="create-payable-payment-column">
                    <div className="create-payable-field">
                      <label className="create-payable-label">Amount (₹) <span className="create-payable-required">*</span></label>
                      <input type="number" name="amount" className="create-payable-input" value={formData.amount} onChange={handleInputChange} required />
                    </div>
                    <div className="create-payable-field">
                      <label className="create-payable-label">Due Date <span className="create-payable-required">*</span></label>
                      <input type="date" name="dueDate" className="create-payable-input" value={formData.dueDate} onChange={handleInputChange} required />
                    </div>
                  </div>
                  <div className="create-payable-payment-column">
                    <div className="create-payable-field">
                      <label className="create-payable-label">Category</label>
                      <select name="category" className="create-payable-select" value={formData.category} onChange={handleInputChange}>
                        <option value="">Select category</option>
                        <option value="Wages">Wages</option>
                        <option value="Advance">Advance</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="create-payable-form-actions">
                  <button type="button" className="create-payable-cancel-button" onClick={resetForm}>Clear Form</button>
                  <button type="submit" className="create-payable-submit-button" disabled={submitting}>
                    {submitting ? 'Creating...' : 'Create & Download PDF'}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="create-payable-module-content">
            <div className="create-payable-filters-bar">
              <input type="text" placeholder="Search payables..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            <div className="create-payable-table-container">
              <table className="create-payable-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Type</th><th>Payee</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayables.map(payable => (
                    <tr key={payable.id}>
                      <td>{payable.payableId}</td>
                      <td>{payable.payableType}</td>
                      <td>{payable.payeeName}</td>
                      <td>₹{payable.amount?.toLocaleString()}</td>
                      <td>{new Date(payable.dueDate).toLocaleDateString()}</td>
                      <td>{payable.status}</td>
                      <td><button onClick={() => { setSelectedPayable(payable); setShowDetailsModal(true); }}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showDetailsModal && selectedPayable && (
        <div className="create-payable-modal-overlay" onClick={() => setShowDetailsModal(false)}>
          <div className="create-payable-modal" onClick={e => e.stopPropagation()}>
            <div className="create-payable-modal-header">
              <h3>Payable Details</h3>
              <button onClick={() => setShowDetailsModal(false)}>✕</button>
            </div>
            <div className="create-payable-modal-content">
              <p><strong>Payable ID:</strong> {selectedPayable.payableId}</p>
              <p><strong>Payee:</strong> {selectedPayable.payeeName}</p>
              <p><strong>Amount:</strong> ₹{selectedPayable.amount?.toLocaleString()}</p>
              <p><strong>Status:</strong> {selectedPayable.status}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
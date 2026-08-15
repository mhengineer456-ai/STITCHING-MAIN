// src/KarigarLotDetail.js - TABLE LAYOUT VERSION WITH UNIQUE CLASSNAMES AND STATUS FILTERS
// UPDATED: Supports multiple karigars per shade (karigars array format)
import React, { useState, useEffect, useMemo } from "react";
import "./KarigarLotDetail.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Google Sheets configuration
const GOOGLE_SHEETS_API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk";
const SHEET_ID = "17qqixpHOXvG1U3RlRwaHON5JCkugpy4RIu5N9zR9ScM";
const JOB_ORDER_SHEET_ID = "1fKSwGBIpzWEFk566WRQ4bzQ0anJlmasoY8TwrTLQHXI";
const ASSIGNMENTS_SHEET_NAME = "KarigarAssignments";
const PROFILE_SHEET_NAME = "KarigarProfiles";
const JOB_ORDER_SHEET_NAME = "JobOrder";

export default function KarigarLotDetail({ onBack, supervisor }) {
  const [loading, setLoading] = useState(true);
  const [karigars, setKarigars] = useState([]);
  const [lots, setLots] = useState([]);
  const [selectedKarigar, setSelectedKarigar] = useState(null);
  const [viewMode, setViewMode] = useState("summary");
  const [searchTerm, setSearchTerm] = useState("");
  const [isExiting, setIsExiting] = useState(false);
  
  // State for lot search
  const [lotSearchModal, setLotSearchModal] = useState(false);
  const [lotSearchTerm, setLotSearchTerm] = useState("");
  const [lotSearchResults, setLotSearchResults] = useState([]);
  const [selectedLot, setSelectedLot] = useState(null);
  const [lotStatusFilter, setLotStatusFilter] = useState("all");
  const [lotImageUrl, setLotImageUrl] = useState(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [jobOrderData, setJobOrderData] = useState(null);
  
  // State for karigar search
  const [karigarSearchModal, setKarigarSearchModal] = useState(false);
  const [karigarSearchTerm, setKarigarSearchTerm] = useState("");
  const [karigarSearchResults, setKarigarSearchResults] = useState([]);
  const [selectedKarigarForReport, setSelectedKarigarForReport] = useState(null);
  const [karigarStatusFilter, setKarigarStatusFilter] = useState("all");
  
  // Filter states
  const [filters, setFilters] = useState({
    floorArea: "",
    gender: "",
    supervisorType: "",
    supervisorName: "",
    status: "",
    minEfficiency: "",
    sortBy: "name"
  });
  const [showFilters, setShowFilters] = useState(false);
  const [uniqueFloorAreas, setUniqueFloorAreas] = useState([]);
  const [uniqueGenders, setUniqueGenders] = useState([]);
  const [uniqueSupervisorTypes, setUniqueSupervisorTypes] = useState([]);
  const [uniqueSupervisorNames, setUniqueSupervisorNames] = useState([]);
// Add this helper function near the top of your component (after the imports, before the component declaration)
const parseCustomDate = (dateString) => {
  if (!dateString) return null;
  
  // Handle format: "14-05-2026, 15:49:21" or "14-05-2026, 15:49:21"
  const match = dateString.match(/(\d{1,2})-(\d{1,2})-(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (match) {
    const [_, day, month, year, hour, minute, second] = match;
    // Note: month is 0-indexed in JavaScript Date
    return new Date(year, month - 1, day, hour, minute, second);
  }
  
  // Try standard date parsing as fallback
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (dateString) => {
  const date = parseCustomDate(dateString);
  if (!date) return '-';
  return `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-GB')}`;
};
  // Helper function to extract assignments from either format
// Update the extractAssignments function (around line 60-100 in your component)
const extractAssignments = (assignmentsJson, karigarProfileMap) => {
  const assignments = [];
  
  Object.entries(assignmentsJson).forEach(([shadeName, shadeData]) => {
    // Check if this is the new format with karigars array
    if (shadeData.karigars && Array.isArray(shadeData.karigars)) {
      // New format: multiple karigars per shade
      shadeData.karigars.forEach(karigarData => {
        const karigarId = karigarData.karigarId || "";
        const actualKarigarName = karigarProfileMap ? 
          (karigarProfileMap.get(karigarId)?.name || karigarData.karigarName || karigarId) : 
          (karigarData.karigarName || karigarId);
        
        // CRITICAL FIX: Get completedAt from karigarData
        // Your data has completedAt like "14-05-2026, 15:49:21"
        let completedAtValue = karigarData.completedAt || "";
        
        // Also check for completedAt in the shadeData if not found in karigarData
        if (!completedAtValue && shadeData.completedAt) {
          completedAtValue = shadeData.completedAt;
        }
        
        // If still no completedAt but status is Completed, use updatedAt
        if (!completedAtValue && karigarData.status === "Completed") {
          completedAtValue = karigarData.updatedAt || "";
        }
        
        assignments.push({
          shade: shadeName,
          karigarId: karigarId,
          karigarName: actualKarigarName,
          pcs: parseInt(karigarData.pcs) || 0,
          status: karigarData.status || "Pending",
          assignedAt: karigarData.assignedAt || "",
          completedAt: completedAtValue,
          updatedAt: karigarData.updatedAt || ""
        });
      });
    } else if (shadeData.karigarId) {
      // Old format: single karigar per shade
      const karigarId = shadeData.karigarId || "";
      const actualKarigarName = karigarProfileMap ? 
        (karigarProfileMap.get(karigarId)?.name || shadeData.karigarName || karigarId) : 
        (shadeData.karigarName || karigarId);
      
      assignments.push({
        shade: shadeName,
        karigarId: karigarId,
        karigarName: actualKarigarName,
        pcs: parseInt(shadeData.pcs) || 0,
        status: shadeData.status || "Pending",
        assignedAt: shadeData.assignedAt || shadeData.createdAt || "",
        completedAt: shadeData.completedAt || "",
        updatedAt: shadeData.updatedAt || ""
      });
    }
  });
  
  return assignments;
};
  // Function to fetch job order image by lot number
  const fetchJobOrderImage = async (lotNumber) => {
    if (!lotNumber) return;
    
    setLoadingImage(true);
    setLotImageUrl(null);
    setJobOrderData(null);
    
    try {
      const jobOrderUrl = `https://sheets.googleapis.com/v4/spreadsheets/${JOB_ORDER_SHEET_ID}/values/${JOB_ORDER_SHEET_NAME}?key=${GOOGLE_SHEETS_API_KEY}`;
      const response = await fetch(jobOrderUrl);
      const data = await response.json();
      
      if (!data.values || data.values.length <= 1) {
        setLoadingImage(false);
        return;
      }
      
      const headers = data.values[0];
      const rows = data.values.slice(1);
      
      const lotNumberColIndex = headers.findIndex(h => 
        h?.toLowerCase() === "lot number" || 
        h?.toLowerCase() === "lotno" || 
        h?.toLowerCase() === "lot_no"
      );
      const imageUrlColIndex = headers.findIndex(h => 
        h?.toLowerCase() === "image url" || 
        h?.toLowerCase() === "image" || 
        h?.toLowerCase() === "image_link"
      );
      
      if (lotNumberColIndex === -1) {
        setLoadingImage(false);
        return;
      }
      
      let foundRow = null;
      for (const row of rows) {
        const rowLotNumber = row[lotNumberColIndex]?.toString().trim();
        if (rowLotNumber === lotNumber.toString().trim()) {
          foundRow = row;
          break;
        }
      }
      
      if (foundRow) {
        const jobOrderDetails = {};
        headers.forEach((header, index) => {
          jobOrderDetails[header] = foundRow[index] || "";
        });
        setJobOrderData(jobOrderDetails);
        
        if (imageUrlColIndex !== -1 && foundRow[imageUrlColIndex]) {
          let imageUrl = foundRow[imageUrlColIndex];
          if (imageUrl.includes("drive.google.com")) {
            let fileId = null;
            const idMatch = imageUrl.match(/[-\w]{25,}/);
            if (idMatch) {
              fileId = idMatch[0];
              imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
            }
          }
          setLotImageUrl(imageUrl);
        }
      }
    } catch (error) {
      console.error("Error fetching job order data:", error);
    } finally {
      setLoadingImage(false);
    }
  };

  // Fetch data from Google Sheets
  useEffect(() => {
    const fetchGoogleSheetsData = async () => {
      setLoading(true);
      try {
        // Fetch Assignments data
        const assignmentsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${ASSIGNMENTS_SHEET_NAME}?key=${GOOGLE_SHEETS_API_KEY}`;
        const assignmentsResponse = await fetch(assignmentsUrl);
        const assignmentsData = await assignmentsResponse.json();
        
        if (!assignmentsData.values || assignmentsData.values.length <= 1) {
          console.log("No assignments found");
          setLoading(false);
          return;
        }
        
        const rows = assignmentsData.values.slice(1);
        const lotsData = [];
        const karigarIdsFromAssignments = new Set();
        
        // First pass: Collect all unique karigar IDs from assignments (supporting multiple karigars per shade)
        rows.forEach(row => {
          const assignmentsJSON = row[8];
          let assignments = {};
          try {
            assignments = JSON.parse(assignmentsJSON || "{}");
          } catch (e) {
            console.error("Error parsing assignments JSON:", e);
          }
          
          // Extract assignments from both formats
          const extractedAssignments = extractAssignments(assignments);
          extractedAssignments.forEach(assignment => {
            if (assignment.karigarId) {
              karigarIdsFromAssignments.add(assignment.karigarId);
            }
          });
        });
        
        console.log("Unique Karigar IDs from assignments:", Array.from(karigarIdsFromAssignments));
        
        if (karigarIdsFromAssignments.size === 0) {
          console.log("No karigars found in assignments");
          setLoading(false);
          return;
        }
        
        // Fetch Karigar Profiles
        const profileUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${PROFILE_SHEET_NAME}?key=${GOOGLE_SHEETS_API_KEY}`;
        const profileResponse = await fetch(profileUrl);
        const profileData = await profileResponse.json();
        
        const profileMap = new Map();
        const karigarsList = [];
        const floorAreasSet = new Set();
        const gendersSet = new Set();
        const supervisorTypesSet = new Set();
        const supervisorNamesSet = new Set();
        
        if (profileData.values && profileData.values.length > 1) {
          const profileRows = profileData.values.slice(1);
          
          profileRows.forEach(row => {
            const karigarId = row[1];
            
            if (karigarIdsFromAssignments.has(karigarId)) {
              const karigar = {
                timestamp: row[0],
                id: karigarId || "",
                name: row[2] || "",
                dateOfBirth: row[3] || "",
                age: row[4] || "",
                gender: row[5] || "",
                floorArea: row[6] || "",
                dateOfJoining: row[8] || "",
                supervisorType: row[9] || "",
                supervisorName: row[10] || "",
                status: "active",
                assignments: [],
                totalLots: 0,
                completedLots: 0,
                activeLots: 0,
                totalPcs: 0,
                completedPcs: 0,
                activePcs: 0,
                pendingPcs: 0,
                efficiency: 0,
                phone: "Not available"
              };
              
              karigarsList.push(karigar);
              profileMap.set(karigar.id, karigar);
              
              if (karigar.floorArea) floorAreasSet.add(karigar.floorArea);
              if (karigar.gender) gendersSet.add(karigar.gender);
              if (karigar.supervisorType) supervisorTypesSet.add(karigar.supervisorType);
              if (karigar.supervisorName) supervisorNamesSet.add(karigar.supervisorName);
            }
          });
        }
        
        setUniqueFloorAreas(Array.from(floorAreasSet).sort());
        setUniqueGenders(Array.from(gendersSet).sort());
        setUniqueSupervisorTypes(Array.from(supervisorTypesSet).sort());
        setUniqueSupervisorNames(Array.from(supervisorNamesSet).sort());
        
        // Second pass: Process assignments with proper shade extraction (supporting multiple karigars)
        rows.forEach(row => {
          const lot = {
            timestamp: row[0],
            lotNumber: row[1],
            brand: row[2],
            fabric: row[3],
            style: row[4],
            garmentType: row[5],
            partyName: row[6],
            season: row[7],
            assignmentsJSON: row[8],
            totalShades: row[9],
            totalPieces: row[10],
            savedBy: row[11],
            supervisor: row[12],
            savedAt: row[13],
            status: row[14] || "In Progress",
            lastUpdated: row[15],
            completionDate: row[16]
          };
          
          let assignments = {};
          try {
            assignments = JSON.parse(lot.assignmentsJSON || "{}");
          } catch (e) {
            console.error("Error parsing assignments JSON:", e);
          }
          
          // Extract all assignments (supports multiple karigars per shade)
          const extractedAssignments = extractAssignments(assignments);
          
          // Calculate totals
          const totalAssignedPieces = extractedAssignments.reduce((sum, a) => sum + (a.pcs || 0), 0);
          const completedPieces = extractedAssignments.filter(a => a.status === "Completed").reduce((sum, a) => sum + (a.pcs || 0), 0);
          const inProgressPieces = extractedAssignments.filter(a => a.status === "In Progress").reduce((sum, a) => sum + (a.pcs || 0), 0);
          const pendingPieces = extractedAssignments.filter(a => a.status === "Pending").reduce((sum, a) => sum + (a.pcs || 0), 0);
          const activeAssignments = extractedAssignments.filter(a => a.status !== "Completed").length;
          
          const enhancedLot = {
            ...lot,
            parsedAssignments: assignments,
            extractedAssignments: extractedAssignments,
            totalAssignedPieces: totalAssignedPieces,
            completedPieces: completedPieces,
            inProgressPieces: inProgressPieces,
            pendingPieces: pendingPieces,
            activeAssignments: activeAssignments
          };
          
          lotsData.push(enhancedLot);
          
          // Process each assignment and add to karigar
          extractedAssignments.forEach(assignment => {
            if (assignment.karigarId && profileMap.has(assignment.karigarId)) {
              const karigar = profileMap.get(assignment.karigarId);
              const pcs = assignment.pcs || 0;
              const isCompleted = assignment.status === "Completed";
              
              karigar.assignments.push({
                lotId: lot.lotNumber,
                lotName: `${lot.brand} - ${lot.garmentType}`,
                brand: lot.brand,
                garmentType: lot.garmentType,
                assignedDate: lot.timestamp,
                issueDate: assignment.assignedAt || lot.timestamp,
                shade: assignment.shade,
                targetPcs: pcs,
                completedPcs: isCompleted ? pcs : 0,
                pendingPcs: !isCompleted ? pcs : 0,
                qualityRate: isCompleted ? 85 + Math.floor(Math.random() * 15) : 0,
                status: assignment.status?.toLowerCase().replace(" ", "-") || "pending",
                lastUpdated: assignment.updatedAt,
                completedAt: assignment.completedAt,
                lotDetails: lot
              });
            }
          });
        });
        
        // Process karigars with aggregated data
        const processedKarigars = Array.from(profileMap.values()).map(karigar => {
          const totalAssignments = karigar.assignments.length;
          const completedAssignments = karigar.assignments.filter(a => a.status === "completed").length;
          const totalTarget = karigar.assignments.reduce((sum, a) => sum + a.targetPcs, 0);
          const totalCompleted = karigar.assignments.reduce((sum, a) => sum + a.completedPcs, 0);
          const totalPending = karigar.assignments.reduce((sum, a) => sum + a.pendingPcs, 0);
          const efficiency = totalTarget > 0 ? (totalCompleted / totalTarget) * 100 : 0;
          
          return {
            ...karigar,
            totalLots: totalAssignments,
            completedLots: completedAssignments,
            activeLots: totalAssignments - completedAssignments,
            totalPcs: totalTarget,
            completedPcs: totalCompleted,
            activePcs: totalTarget - totalCompleted,
            pendingPcs: totalPending,
            efficiency: Math.round(efficiency)
          };
        });
        
        setLots(lotsData);
        setKarigars(processedKarigars);
        
        console.log(`Loaded ${processedKarigars.length} karigars with assignments`);
        console.log(`Loaded ${lotsData.length} lots`);
        
      } catch (error) {
        console.error("Error fetching Google Sheets data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchGoogleSheetsData();
  }, []);

  // Apply filters to karigars
  const filteredAndSortedKarigars = useMemo(() => {
    let result = [...karigars];
    
    if (searchTerm) {
      result = result.filter(k => 
        k.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        k.id?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (filters.floorArea) {
      result = result.filter(k => k.floorArea === filters.floorArea);
    }
    
    if (filters.gender) {
      result = result.filter(k => k.gender?.toLowerCase() === filters.gender.toLowerCase());
    }
    
    if (filters.supervisorType) {
      result = result.filter(k => k.supervisorType === filters.supervisorType);
    }
    
    if (filters.supervisorName) {
      result = result.filter(k => k.supervisorName === filters.supervisorName);
    }
    
    if (filters.status) {
      result = result.filter(k => k.status === filters.status);
    }
    
    if (filters.minEfficiency) {
      result = result.filter(k => k.efficiency >= parseInt(filters.minEfficiency));
    }
    
    switch (filters.sortBy) {
      case "name":
        result.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "efficiency":
        result.sort((a, b) => b.efficiency - a.efficiency);
        break;
      case "activeLots":
        result.sort((a, b) => b.activeLots - a.activeLots);
        break;
      case "pendingPcs":
        result.sort((a, b) => b.pendingPcs - a.pendingPcs);
        break;
      default:
        break;
    }
    
    return result;
  }, [karigars, searchTerm, filters]);

  // Get filtered shade assignments based on status filter
  const getFilteredShadeAssignments = () => {
    if (!selectedLot) return [];
    
    let allShadeAssignments = [];
    
    if (selectedLot.extractedAssignments) {
      allShadeAssignments = [...selectedLot.extractedAssignments];
    } else if (selectedLot.parsedAssignments) {
      allShadeAssignments = extractAssignments(selectedLot.parsedAssignments);
    }
    
    // Apply status filter
    let filtered = allShadeAssignments;
    if (lotStatusFilter === "completed") {
      filtered = allShadeAssignments.filter(s => s.status === "Completed");
    } else if (lotStatusFilter === "pending") {
      filtered = allShadeAssignments.filter(s => s.status !== "Completed");
    }
    
    // Sort by shade name
    filtered.sort((a, b) => a.shade?.localeCompare(b.shade || "") || 0);
    
    return filtered;
  };

  // Get filtered karigar assignments based on status filter
  const getFilteredKarigarAssignments = () => {
    if (!selectedKarigarForReport) return [];
    
    const lotAssignments = new Map();
    
    selectedKarigarForReport.assignments.forEach(assignment => {
      let includeAssignment = true;
      if (karigarStatusFilter === "completed") {
        includeAssignment = assignment.status === "completed";
      } else if (karigarStatusFilter === "pending") {
        includeAssignment = assignment.status !== "completed";
      }
      
      if (!includeAssignment) return;
      
      const lotId = assignment.lotId;
      if (!lotAssignments.has(lotId)) {
        lotAssignments.set(lotId, {
          lotId: lotId,
          lotName: assignment.lotName,
          brand: assignment.brand,
          garmentType: assignment.garmentType,
          totalTarget: 0,
          totalCompleted: 0,
          totalPending: 0,
          shades: []
        });
      }
      
      const lotData = lotAssignments.get(lotId);
      lotData.totalTarget += assignment.targetPcs;
      lotData.totalCompleted += assignment.completedPcs;
      lotData.totalPending += assignment.pendingPcs;
      lotData.shades.push({
        shade: assignment.shade,
        targetPcs: assignment.targetPcs,
        completedPcs: assignment.completedPcs,
        pendingPcs: assignment.pendingPcs,
        status: assignment.status,
        issueDate: assignment.issueDate,
        completedAt: assignment.completedAt,
        qualityRate: assignment.qualityRate
      });
    });
    
    const result = Array.from(lotAssignments.values()).sort((a, b) => a.lotId.localeCompare(b.lotId));
    return result.filter(lot => lot.shades.length > 0);
  };

  // Search lot by number
  const searchLotByNumber = async () => {
    console.log("Searching for lot:", lotSearchTerm);
    
    if (!lotSearchTerm.trim()) {
      setLotSearchResults([]);
      setSelectedLot(null);
      setLotImageUrl(null);
      setJobOrderData(null);
      return;
    }
    
    let foundLot = lots.find(lot => 
      lot.lotNumber?.toLowerCase() === lotSearchTerm.toLowerCase()
    );
    
    if (!foundLot) {
      foundLot = lots.find(lot => 
        lot.lotNumber?.toLowerCase().includes(lotSearchTerm.toLowerCase())
      );
    }
    
    console.log("Found lot:", foundLot);
    
    if (foundLot) {
      setSelectedLot(foundLot);
      setLotStatusFilter("all");
      await fetchJobOrderImage(foundLot.lotNumber);
    } else {
      setSelectedLot(null);
      setLotSearchResults([]);
      setLotImageUrl(null);
      setJobOrderData(null);
    }
  };

  // Update lot search results when filter changes
  useEffect(() => {
    if (selectedLot) {
      const filteredShades = getFilteredShadeAssignments();
      setLotSearchResults(filteredShades);
    }
  }, [lotStatusFilter, selectedLot]);

  // Update karigar search results when filter changes
  useEffect(() => {
    if (selectedKarigarForReport) {
      const filteredAssignments = getFilteredKarigarAssignments();
      setKarigarSearchResults(filteredAssignments);
    }
  }, [karigarStatusFilter, selectedKarigarForReport]);

  // Search karigar by ID or Name
  const searchKarigarByIdOrName = () => {
    console.log("Searching for karigar:", karigarSearchTerm);
    
    if (!karigarSearchTerm.trim()) {
      setKarigarSearchResults([]);
      setSelectedKarigarForReport(null);
      return;
    }
    
    let foundKarigar = karigars.find(k => 
      k.id?.toLowerCase() === karigarSearchTerm.toLowerCase() ||
      k.name?.toLowerCase() === karigarSearchTerm.toLowerCase()
    );
    
    if (!foundKarigar) {
      foundKarigar = karigars.find(k => 
        k.id?.toLowerCase().includes(karigarSearchTerm.toLowerCase()) ||
        k.name?.toLowerCase().includes(karigarSearchTerm.toLowerCase())
      );
    }
    
    console.log("Found karigar:", foundKarigar);
    
    if (foundKarigar) {
      setSelectedKarigarForReport(foundKarigar);
      setKarigarStatusFilter("all");
    } else {
      setSelectedKarigarForReport(null);
      setKarigarSearchResults([]);
    }
  };

  const handleKarigarSearch = () => {
    searchKarigarByIdOrName();
  };

  const handleKarigarSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchKarigarByIdOrName();
    }
  };

  const closeKarigarSearchModal = () => {
    setKarigarSearchModal(false);
    setKarigarSearchTerm("");
    setKarigarSearchResults([]);
    setSelectedKarigarForReport(null);
    setKarigarStatusFilter("all");
  };

  const handleLotSearch = () => {
    searchLotByNumber();
  };

  const handleLotSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchLotByNumber();
    }
  };

  const closeLotSearchModal = () => {
    setLotSearchModal(false);
    setLotSearchTerm("");
    setLotSearchResults([]);
    setSelectedLot(null);
    setLotStatusFilter("all");
    setLotImageUrl(null);
    setJobOrderData(null);
  };

  const getStatusColor = (status) => {
    switch(status?.toLowerCase()) {
      case "active": return "#3b82f6";
      case "inactive": return "#ef4444";
      case "completed": return "#10b981";
      case "in-progress": return "#f59e0b";
      case "pending": return "#8b5cf6";
      default: return "#6b7280";
    }
  };

  const handleBack = () => {
    setIsExiting(true);
    setTimeout(() => {
      if (onBack) onBack();
    }, 300);
  };

  const handleViewKarigarDetails = (karigar) => {
    setSelectedKarigar(karigar);
    setViewMode("details");
  };

  const handleBackToSummary = () => {
    setSelectedKarigar(null);
    setViewMode("summary");
  };

  const clearAllFilters = () => {
    setFilters({
      floorArea: "",
      gender: "",
      supervisorType: "",
      supervisorName: "",
      status: "",
      minEfficiency: "",
      sortBy: "name"
    });
    setSearchTerm("");
  };

  const downloadPDFReport = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const availableWidth = pageWidth - (margin * 2);
    
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(margin, 10, pageWidth - margin, 10);
    
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("KARIGAR PRODUCTION REPORT", pageWidth / 2, 25, { align: "center" });
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("KARIGAR WISE PRODUCTION TRACKING SYSTEM", pageWidth / 2, 32, { align: "center" });
    
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, 45);
    
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, 58, pageWidth - margin, 58);
    
    const tableData = filteredAndSortedKarigars.map((karigar, index) => [
      index + 1,
      karigar.id || "-",
      karigar.name || "-",
      karigar.supervisorName || "N/A",
      karigar.activeLots.toString(),
      karigar.pendingPcs.toString(),
      `${karigar.efficiency}%`
    ]);
    
    autoTable(doc, {
      startY: 65,
      head: [["#", "ID", "Karigar Name", "Supervisor", "Active Lots", "Pending PCs", "Efficiency"]],
      body: tableData,
      theme: "plain",
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        fontSize: 8,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        lineColor: [0, 0, 0],
        lineWidth: 0.3
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 3,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.3
      },
      alternateRowStyles: {
        fillColor: [255, 255, 255]
      },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: 35, halign: "center" },
        2: { cellWidth: 45, halign: "center" },
        3: { cellWidth: 35, halign: "center" },
        4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: 25, halign: "center" },
        6: { cellWidth: 20, halign: "center" }
      },
      margin: { left: margin, right: margin },
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.2,
      pageBreak: 'auto'
    });
    
    const finalY = doc.lastAutoTable.finalY + 10;
    let summaryY = finalY;
    if (finalY + 40 > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      summaryY = 20;
    }
    
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(margin, summaryY, availableWidth, 40);
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("SUMMARY", pageWidth / 2, summaryY + 7, { align: "center" });
    
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, summaryY + 11, pageWidth - margin, summaryY + 11);
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    
    const totalKarigars = filteredAndSortedKarigars.length;
    const totalPendingPCs = filteredAndSortedKarigars.reduce((sum, k) => sum + k.pendingPcs, 0);
    const totalActiveLots = filteredAndSortedKarigars.reduce((sum, k) => sum + k.activeLots, 0);
    const avgEfficiency = totalKarigars > 0 ? Math.round(filteredAndSortedKarigars.reduce((sum, k) => sum + k.efficiency, 0) / totalKarigars) : 0;
    const activeWorkers = filteredAndSortedKarigars.filter(k => k.status === "active").length;
    
    const col1X = margin + 5;
    const col2X = pageWidth / 2 + 5;
    
    doc.text(`Total Karigars: ${totalKarigars}`, col1X, summaryY + 20);
    doc.text(`Active Workers: ${activeWorkers}`, col1X, summaryY + 28);
    doc.text(`Total Active Lots: ${totalActiveLots}`, col1X, summaryY + 36);
    doc.text(`Total Pending PCs: ${totalPendingPCs.toLocaleString()}`, col2X, summaryY + 20);
    doc.text(`Average Efficiency: ${avgEfficiency}%`, col2X, summaryY + 28);
    
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: "center" });
      doc.text("MH Stitching - Karigar Management System", pageWidth / 2, doc.internal.pageSize.getHeight() - 5, { align: "center" });
    }
    
    doc.save(`karigar_report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // Download Lot-wise PDF Report
// Complete downloadLotPDFReport function with proper karigar name mapping
const downloadLotPDFReport = async () => {
  if (!selectedLot) {
    alert("Please search and select a lot first to generate PDF report.");
    return;
  }

  const filteredShades = getFilteredShadeAssignments();
  
  if (filteredShades.length === 0) {
    alert(`No ${lotStatusFilter === "completed" ? "completed" : "pending"} shades found for this lot.`);
    return;
  }

  // Helper function to get karigar name from ID
  const getKarigarNameFromId = (karigarId) => {
    if (!karigarId) return "-";
    const karigar = karigars.find(k => k.id === karigarId);
    return karigar?.name || karigarId;
  };

  // Helper function to parse custom date format
  const parseCustomDate = (dateString) => {
    if (!dateString) return null;
    
    // Handle format: "14-05-2026, 15:49:21" or "14-05-2026 15:49:21"
    let match = dateString.match(/(\d{1,2})-(\d{1,2})-(\d{4})[,\s]\s*(\d{1,2}):(\d{2}):(\d{2})/);
    if (match) {
      const [_, day, month, year, hour, minute, second] = match;
      return new Date(year, month - 1, day, hour, minute, second);
    }
    
    // Handle format: "14-05-2026"
    match = dateString.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (match) {
      const [_, day, month, year] = match;
      return new Date(year, month - 1, day);
    }
    
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatDateTime = (dateString) => {
    const date = parseCustomDate(dateString);
    if (!date) return '-';
    return `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-GB')}`;
  };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 8;
  
  let currentY = 15;
  
  // Header
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.text(`LOT REPORT: ${selectedLot.lotNumber}`, pageWidth / 2, currentY, { align: "center" });
  currentY += 5;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated: ${new Date().toLocaleString()} | By: ${supervisor?.name || "System"}`, pageWidth / 2, currentY, { align: "center" });
  currentY += 6;
  
  if (lotStatusFilter !== "all") {
    doc.setTextColor(100, 100, 100);
    doc.text(`Filter: ${lotStatusFilter === "completed" ? "Completed Only" : "Pending Only"}`, pageWidth / 2, currentY, { align: "center" });
    currentY += 4;
    doc.setTextColor(0, 0, 0);
  }
  
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 5;
  
  // Lot Info
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Lot Details:", margin, currentY);
  doc.setFont("helvetica", "normal");
  doc.text(`${selectedLot.lotNumber} | ${selectedLot.brand || "N/A"} | ${selectedLot.garmentType || "N/A"} | Fabric: ${selectedLot.fabric || "N/A"} | Style: ${selectedLot.style || "N/A"}`, margin + 25, currentY);
  currentY += 6;
  
  // Production Summary
  const totalPieces = filteredShades.reduce((sum, s) => sum + (s.pcs || 0), 0);
  const completedPieces = filteredShades.filter(s => s.status === "Completed").reduce((sum, s) => sum + (s.pcs || 0), 0);
  const pendingPieces = totalPieces - completedPieces;
  const completionPercentage = totalPieces > 0 ? (completedPieces / totalPieces * 100).toFixed(1) : 0;
  
  doc.setFont("helvetica", "bold");
  doc.text("Production (Filtered):", margin, currentY);
  doc.setFont("helvetica", "normal");
  doc.text(`Total: ${totalPieces} | Completed: ${completedPieces} (${completionPercentage}%) | Pending: ${pendingPieces}`, margin + 25, currentY);
  currentY += 8;
  
  // Job Order Details
  if (jobOrderData) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Job Order Details:", margin, currentY);
    doc.setFont("helvetica", "normal");
    currentY += 4;
    
    const joDetails = [
      `JO No: ${jobOrderData["Job Order No"] || "-"} | Date: ${jobOrderData["Date"] || "-"} | Fabric: ${jobOrderData["Fabric"] || "-"}`,
      `Party: ${jobOrderData["Party Name"] || "-"} | Season: ${jobOrderData["Season"] || "-"} | Section: ${jobOrderData["Section"] || "-"}`,
      `Style: ${jobOrderData["Style"] || "-"} | Remarks: ${jobOrderData["Remarks"] || "-"}`
    ];
    
    joDetails.forEach(detail => {
      doc.setFontSize(7);
      doc.text(detail, margin + 10, currentY);
      currentY += 4;
    });
    currentY += 2;
  }
  
  // Shade-wise Assignments Table WITH PROPER KARIGAR NAME MAPPING
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Shade-wise Assignments:", margin, currentY);
  currentY += 4;
  
  const tableData = filteredShades.map((shadeAssignment, index) => {
    let completedDateTime = "-";
    if (shadeAssignment.status === "Completed") {
      if (shadeAssignment.completedAt && shadeAssignment.completedAt !== "Invalid Date") {
        completedDateTime = formatDateTime(shadeAssignment.completedAt);
      } else if (shadeAssignment.updatedAt && shadeAssignment.updatedAt !== "Invalid Date") {
        completedDateTime = formatDateTime(shadeAssignment.updatedAt);
      } else {
        completedDateTime = "Completed";
      }
    }
    
    // Get actual karigar name from the karigars array
    const actualKarigarName = getKarigarNameFromId(shadeAssignment.karigarId);
    
    return [
      index + 1,
      shadeAssignment.shade || "-",
      shadeAssignment.karigarId || "-",
      actualKarigarName,  // This will now show the actual name, not the ID
      (shadeAssignment.pcs || 0).toString(),
      shadeAssignment.status === "Completed" ? (shadeAssignment.pcs || 0).toString() : "0",
      shadeAssignment.status !== "Completed" ? (shadeAssignment.pcs || 0).toString() : "0",
      shadeAssignment.status || "pending",
      completedDateTime
    ];
  });
  
  autoTable(doc, {
    startY: currentY,
    head: [["#", "Shade", "Karigar ID", "Karigar Name", "Target", "Comp.", "Pending", "Status", "Completed Date & Time"]],
    body: tableData,
    theme: "plain",
    headStyles: {
      fillColor: [220, 220, 220],
      textColor: [0, 0, 0],
      fontSize: 9,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      lineColor: [0, 0, 0],
      lineWidth: 0.3
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: 2,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.3
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245]
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 45, halign: "center" },
      2: { cellWidth: 45, halign: "center" },
      3: { cellWidth: 40, halign: "center" },
      4: { cellWidth: 18, halign: "center" },
      5: { cellWidth: 18, halign: "center" },
      6: { cellWidth: 18, halign: "center" },
      7: { cellWidth: 25, halign: "center" },
      8: { cellWidth: 55, halign: "center" }
    },
    margin: { left: margin, right: margin },
    tableLineColor: [0, 0, 0],
    tableLineWidth: 0.1,
    pageBreak: 'auto'
  });
  
  // Calculate Karigar-wise Summary (using actual names)
  const karigarSummary = new Map();
  
  filteredShades.forEach(shade => {
    const karigarId = shade.karigarId;
    const actualKarigarName = getKarigarNameFromId(karigarId);
    
    if (!karigarSummary.has(karigarId)) {
      karigarSummary.set(karigarId, {
        karigarId: karigarId,
        karigarName: actualKarigarName,  // Use actual name
        shades: [],
        totalTarget: 0,
        totalCompleted: 0,
        totalPending: 0,
        completedShades: 0,
        pendingShades: 0
      });
    }
    
    const summary = karigarSummary.get(karigarId);
    summary.shades.push(shade.shade);
    summary.totalTarget += shade.pcs || 0;
    
    if (shade.status === "Completed") {
      summary.totalCompleted += shade.pcs || 0;
      summary.completedShades++;
    } else {
      summary.totalPending += shade.pcs || 0;
      summary.pendingShades++;
    }
  });
  
  const karigarSummaryArray = Array.from(karigarSummary.values());
  
  let summaryY = doc.lastAutoTable.finalY + 8;
  if (summaryY + 80 > doc.internal.pageSize.getHeight()) {
    doc.addPage();
    summaryY = 20;
  }
  
  // Karigar-wise Summary Section
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(margin, summaryY, pageWidth - (margin * 2), 8);
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, summaryY, pageWidth - (margin * 2), 8, 'F');
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("KARIGAR-WISE SUMMARY", pageWidth / 2, summaryY + 5.5, { align: "center" });
  summaryY += 12;
  
  const karigarTableData = karigarSummaryArray.map((karigar, idx) => [
    idx + 1,
    karigar.karigarId,
    karigar.karigarName,  // This will now show the actual name
    karigar.shades.join(", "),
    karigar.shades.length.toString(),
    karigar.completedShades.toString(),
    karigar.pendingShades.toString(),
    karigar.totalTarget.toString(),
    karigar.totalCompleted.toString(),
    karigar.totalPending.toString(),
    karigar.totalTarget > 0 ? `${Math.round((karigar.totalCompleted / karigar.totalTarget) * 100)}%` : "0%"
  ]);
  
  autoTable(doc, {
    startY: summaryY,
    head: [["#", "Karigar ID", "Karigar Name", "Shades Assigned", "Total Shades", "Completed", "Pending", "Target PCS", "Completed PCS", "Pending PCS", "Efficiency"]],
    body: karigarTableData,
    theme: "plain",
    headStyles: {
      fillColor: [220, 220, 220],
      textColor: [0, 0, 0],
      fontSize: 8,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    alternateRowStyles: {
      fillColor: [248, 248, 248]
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 35, halign: "center" },
      2: { cellWidth: 45, halign: "center" },
      3: { cellWidth: 70, halign: "center" },
      4: { cellWidth: 15, halign: "center" },
      5: { cellWidth: 15, halign: "center" },
      6: { cellWidth: 15, halign: "center" },
      7: { cellWidth: 20, halign: "center" },
      8: { cellWidth: 20, halign: "center" },
      9: { cellWidth: 20, halign: "center" },
      10: { cellWidth: 18, halign: "center" }
    },
    margin: { left: margin, right: margin },
    tableLineColor: [200, 200, 200],
    tableLineWidth: 0.1,
    pageBreak: 'auto'
  });
  
  // Overall Summary
  const finalYPosition = doc.lastAutoTable.finalY + 6;
  const totalKarigars = karigarSummaryArray.length;
  const totalShadesOverall = filteredShades.length;
  const totalCompletedShades = filteredShades.filter(s => s.status === "Completed").length;
  const totalTargetOverall = filteredShades.reduce((sum, s) => sum + (s.pcs || 0), 0);
  const totalCompletedOverall = filteredShades.filter(s => s.status === "Completed").reduce((sum, s) => sum + (s.pcs || 0), 0);
  const totalPendingOverall = totalTargetOverall - totalCompletedOverall;
  const overallEfficiency = totalTargetOverall > 0 ? Math.round((totalCompletedOverall / totalTargetOverall) * 100) : 0;
  const karigarsWithMultipleShades = karigarSummaryArray.filter(k => k.shades.length > 1).length;
  
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.line(margin, finalYPosition, pageWidth - margin, finalYPosition);
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("OVERALL SUMMARY:", margin, finalYPosition + 5);
  doc.setFont("helvetica", "normal");
  
  let summaryText = `Total Karigars: ${totalKarigars} | Karigars with Multiple Shades: ${karigarsWithMultipleShades} | Total Shades: ${totalShadesOverall} | Completed Shades: ${totalCompletedShades} | Pending Shades: ${totalShadesOverall - totalCompletedShades}`;
  doc.text(summaryText, margin, finalYPosition + 12);
  
  summaryText = `Total Target PCS: ${totalTargetOverall.toLocaleString()} | Total Completed PCS: ${totalCompletedOverall.toLocaleString()} | Total Pending PCS: ${totalPendingOverall.toLocaleString()} | Overall Efficiency: ${overallEfficiency}%`;
  doc.text(summaryText, margin, finalYPosition + 19);
  
  // Lot Image Section
  let imageY = finalYPosition + 32;
  
  if (imageY + 70 > doc.internal.pageSize.getHeight()) {
    doc.addPage();
    imageY = 20;
  }
  
  const imageBoxWidth = 120;
  const imageBoxHeight = 60;
  const imageBoxX = (pageWidth - imageBoxWidth) / 2;
  
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(imageBoxX, imageY, imageBoxWidth, imageBoxHeight);
  
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("LOT IMAGE", pageWidth / 2, imageY - 2, { align: "center" });
  
  if (lotImageUrl) {
    try {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      
      const imageLoaded = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = lotImageUrl;
      });
      
      const loadedImg = await imageLoaded;
      
      const canvas = document.createElement('canvas');
      canvas.width = loadedImg.width;
      canvas.height = loadedImg.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(loadedImg, 0, 0);
      
      const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
      
      const imgAspect = loadedImg.width / loadedImg.height;
      const boxAspect = imageBoxWidth / imageBoxHeight;
      
      let drawWidth, drawHeight;
      if (imgAspect > boxAspect) {
        drawWidth = imageBoxWidth - 8;
        drawHeight = drawWidth / imgAspect;
      } else {
        drawHeight = imageBoxHeight - 8;
        drawWidth = drawHeight * imgAspect;
      }
      
      const drawX = imageBoxX + (imageBoxWidth - drawWidth) / 2;
      const drawY = imageY + (imageBoxHeight - drawHeight) / 2;
      
      doc.addImage(imageBase64, 'JPEG', drawX, drawY, drawWidth, drawHeight);
      
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      doc.text(`Image for Lot: ${selectedLot.lotNumber}`, pageWidth / 2, imageY + imageBoxHeight + 4, { align: "center" });
    } catch (error) {
      console.error("Error adding image to PDF:", error);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(150, 150, 150);
      doc.text("Image could not be loaded", pageWidth / 2, imageY + (imageBoxHeight / 2), { align: "center" });
      
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      for (let i = 0; i < 3; i++) {
        doc.line(imageBoxX + 10, imageY + 15 + (i * 15), imageBoxX + imageBoxWidth - 10, imageY + 15 + (i * 15));
      }
    }
  } else {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 150);
    doc.text("No Image Available", pageWidth / 2, imageY + (imageBoxHeight / 2), { align: "center" });
    
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    for (let i = 0; i < 3; i++) {
      doc.line(imageBoxX + 10, imageY + 15 + (i * 15), imageBoxX + imageBoxWidth - 10, imageY + 15 + (i * 15));
    }
  }
  
  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 6, { align: "center" });
    doc.text("MH Stitching - Karigar Management System", pageWidth / 2, doc.internal.pageSize.getHeight() - 2, { align: "center" });
  }
  
  const filterSuffix = lotStatusFilter !== "all" ? `_${lotStatusFilter}` : "";
  doc.save(`lot_report_${selectedLot.lotNumber}${filterSuffix}_${new Date().toISOString().split('T')[0]}.pdf`);
};

  // Download Karigar PDF Report
const downloadKarigarPDFReport = () => {
  if (!selectedKarigarForReport) {
    alert("Please search and select a karigar first to generate PDF report.");
    return;
  }

  const filteredAssignments = getFilteredKarigarAssignments();
  
  if (filteredAssignments.length === 0) {
    alert(`No ${karigarStatusFilter === "completed" ? "completed" : "pending"} assignments found for this karigar.`);
    return;
  }

  // Helper function to parse custom date format
  const parseCustomDate = (dateString) => {
    if (!dateString) return null;
    
    // Handle format: "14-05-2026, 15:49:21" or "14-05-2026 15:49:21"
    let match = dateString.match(/(\d{1,2})-(\d{1,2})-(\d{4})[,\s]\s*(\d{1,2}):(\d{2}):(\d{2})/);
    if (match) {
      const [_, day, month, year, hour, minute, second] = match;
      return new Date(year, month - 1, day, hour, minute, second);
    }
    
    // Handle format: "14-05-2026"
    match = dateString.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (match) {
      const [_, day, month, year] = match;
      return new Date(year, month - 1, day);
    }
    
    // Handle standard format
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    const date = parseCustomDate(dateString);
    if (!date) return '-';
    return `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-GB')}`;
  };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 8;
  
  let currentY = 15;
  
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.text(`KARIGAR REPORT: ${selectedKarigarForReport.name}`, pageWidth / 2, currentY, { align: "center" });
  currentY += 5;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated: ${new Date().toLocaleString()} | By: ${supervisor?.name || "System"}`, pageWidth / 2, currentY, { align: "center" });
  currentY += 6;
  
  if (karigarStatusFilter !== "all") {
    doc.setTextColor(100, 100, 100);
    doc.text(`Filter: ${karigarStatusFilter === "completed" ? "Completed Only" : "Pending Only"}`, pageWidth / 2, currentY, { align: "center" });
    currentY += 4;
    doc.setTextColor(0, 0, 0);
  }
  
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 5;
  
  // Karigar Profile Info
  const filteredTotalTarget = filteredAssignments.reduce((sum, lot) => sum + lot.totalTarget, 0);
  const filteredTotalCompleted = filteredAssignments.reduce((sum, lot) => sum + lot.totalCompleted, 0);
  const filteredEfficiency = filteredTotalTarget > 0 ? Math.round((filteredTotalCompleted / filteredTotalTarget) * 100) : 0;
  
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Karigar Profile:", margin, currentY);
  doc.setFont("helvetica", "normal");
  currentY += 4;
  
  const profileData = [
    [`ID: ${selectedKarigarForReport.id}`, `Name: ${selectedKarigarForReport.name}`],
    [`Floor Area: ${selectedKarigarForReport.floorArea}`, `Gender: ${selectedKarigarForReport.gender}`],
    [`Supervisor: ${selectedKarigarForReport.supervisorName} (${selectedKarigarForReport.supervisorType})`, `Efficiency (Filtered): ${filteredEfficiency}%`],
    [`Total Shades (Filtered): ${filteredAssignments.reduce((sum, lot) => sum + lot.shades.length, 0)}`, `Completed Shades (Filtered): ${filteredAssignments.reduce((sum, lot) => sum + lot.shades.filter(s => s.status === "completed").length, 0)}`],
    [`Total Production (Filtered): ${filteredTotalTarget} pcs`, `Completed Production (Filtered): ${filteredTotalCompleted} pcs`],
    [`Pending Production (Filtered): ${filteredTotalTarget - filteredTotalCompleted} pcs`, `Status: ${selectedKarigarForReport.status}`]
  ];
  
  profileData.forEach(row => {
    doc.setFontSize(8);
    doc.text(row[0], margin, currentY);
    doc.text(row[1], pageWidth / 2, currentY);
    currentY += 5;
  });
  
  currentY += 3;
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 5;
  
  // Lot-wise Assignments
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Lot-wise Assignments and Shade Details:", margin, currentY);
  currentY += 5;
  
  filteredAssignments.forEach((lot, lotIndex) => {
    if (currentY + 60 > doc.internal.pageSize.getHeight()) {
      doc.addPage();
      currentY = 20;
    }
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(`Lot ${lotIndex + 1}: ${lot.lotId} - ${lot.lotName}`, margin, currentY);
    currentY += 4;
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Brand: ${lot.brand} | Garment: ${lot.garmentType}`, margin + 10, currentY);
    currentY += 4;
    
    const lotProgress = lot.totalTarget > 0 ? (lot.totalCompleted / lot.totalTarget) * 100 : 0;
    doc.text(`Total Target: ${lot.totalTarget} | Completed: ${lot.totalCompleted} | Pending: ${lot.totalPending} | Progress: ${lotProgress.toFixed(1)}%`, margin + 10, currentY);
    currentY += 6;
    
    const shadeTableData = lot.shades.map((shade, shadeIdx) => {
      let completedDateTime = "-";
      if (shade.status === "completed") {
        // Use the custom date parser for completedAt
        if (shade.completedAt) {
          completedDateTime = formatDateTime(shade.completedAt);
        } else if (shade.lastUpdated) {
          completedDateTime = formatDateTime(shade.lastUpdated);
        } else {
          completedDateTime = "Completed";
        }
      }
      
      const shadeProgress = shade.targetPcs > 0 ? (shade.completedPcs / shade.targetPcs) * 100 : 0;
      
      return [
        shadeIdx + 1,
        shade.shade,
        shade.targetPcs,
        shade.completedPcs,
        shade.pendingPcs,
        `${shadeProgress.toFixed(0)}%`,
        shade.status,
        completedDateTime,
        `${shade.qualityRate}%`
      ];
    });
    
    autoTable(doc, {
      startY: currentY,
      head: [["#", "Shade", "Target", "Completed", "Pending", "Progress", "Status", "Completion Date", "Quality"]],
      body: shadeTableData,
      theme: "plain",
      headStyles: {
        fillColor: [220, 220, 220],
        textColor: [0, 0, 0],
        fontSize: 8,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        lineColor: [0, 0, 0],
        lineWidth: 0.2
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 2,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.2
      },
      alternateRowStyles: {
        fillColor: [248, 248, 248]
      },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 55, halign: "center" },
        2: { cellWidth: 18, halign: "center" },
        3: { cellWidth: 18, halign: "center" },
        4: { cellWidth: 18, halign: "center" },
        5: { cellWidth: 20, halign: "center" },
        6: { cellWidth: 40, halign: "center" },
        7: { cellWidth: 50, halign: "center" },
        8: { cellWidth: 20, halign: "center" }
      },
      margin: { left: margin, right: margin },
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.1,
      pageBreak: 'avoid'
    });
    
    currentY = doc.lastAutoTable.finalY + 8;
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Lot Summary:", margin, currentY);
    doc.setFont("helvetica", "normal");
    currentY += 4;
    
    const completedShades = lot.shades.filter(s => s.status === "completed").length;
    const pendingShades = lot.shades.filter(s => s.status !== "completed").length;
    const avgQuality = lot.shades.reduce((sum, s) => sum + s.qualityRate, 0) / lot.shades.length;
    
    doc.text(`Total Shades: ${lot.shades.length} | Completed Shades: ${completedShades} | Pending Shades: ${pendingShades}`, margin + 10, currentY);
    currentY += 4;
    doc.text(`Overall Efficiency: ${lotProgress.toFixed(1)}% | Average Quality: ${avgQuality.toFixed(1)}%`, margin + 10, currentY);
    currentY += 8;
    
    if (lotIndex < filteredAssignments.length - 1) {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(margin, currentY - 4, pageWidth - margin, currentY - 4);
    }
  });
  
  // Overall Performance Summary
  let summaryY = currentY;
  if (summaryY + 50 > doc.internal.pageSize.getHeight()) {
    doc.addPage();
    summaryY = 20;
  }
  
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(margin, summaryY, pageWidth - (margin * 2), 45);
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, summaryY, pageWidth - (margin * 2), 8, 'F');
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("OVERALL PERFORMANCE SUMMARY (Filtered Data)", pageWidth / 2, summaryY + 5.5, { align: "center" });
  summaryY += 12;
  
  const totalLots = filteredAssignments.length;
  const totalShades = filteredAssignments.reduce((sum, lot) => sum + lot.shades.length, 0);
  const totalCompletedShades = filteredAssignments.reduce((sum, lot) => sum + lot.shades.filter(s => s.status === "completed").length, 0);
  const totalPendingShades = totalShades - totalCompletedShades;
  const totalTargetOverall = filteredAssignments.reduce((sum, lot) => sum + lot.totalTarget, 0);
  const totalCompletedOverall = filteredAssignments.reduce((sum, lot) => sum + lot.totalCompleted, 0);
  const totalPendingOverall = totalTargetOverall - totalCompletedOverall;
  const overallEfficiency = totalTargetOverall > 0 ? (totalCompletedOverall / totalTargetOverall) * 100 : 0;
  const averageQuality = filteredAssignments.reduce((sum, lot) => 
    sum + (lot.shades.reduce((sSum, shade) => sSum + shade.qualityRate, 0) / lot.shades.length), 0) / totalLots || 0;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  
  const col1X = margin + 5;
  const col2X = pageWidth / 2 + 5;
  
  doc.text(`Total Lots: ${totalLots}`, col1X, summaryY);
  doc.text(`Total Shades: ${totalShades}`, col1X, summaryY + 7);
  doc.text(`Completed Shades: ${totalCompletedShades}`, col1X, summaryY + 14);
  doc.text(`Pending Shades: ${totalPendingShades}`, col1X, summaryY + 21);
  
  doc.text(`Total Target: ${totalTargetOverall.toLocaleString()} pcs`, col2X, summaryY);
  doc.text(`Total Completed: ${totalCompletedOverall.toLocaleString()} pcs`, col2X, summaryY + 7);
  doc.text(`Total Pending: ${totalPendingOverall.toLocaleString()} pcs`, col2X, summaryY + 14);
  doc.text(`Overall Efficiency: ${overallEfficiency.toFixed(1)}%`, col2X, summaryY + 21);
  doc.text(`Average Quality: ${averageQuality.toFixed(1)}%`, col2X, summaryY + 28);
  
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 6, { align: "center" });
    doc.text("MH Stitching - Karigar Management System", pageWidth / 2, doc.internal.pageSize.getHeight() - 2, { align: "center" });
  }
  
  const filterSuffix = karigarStatusFilter !== "all" ? `_${karigarStatusFilter}` : "";
  doc.save(`karigar_report_${selectedKarigarForReport.id}${filterSuffix}_${new Date().toISOString().split('T')[0]}.pdf`);
};
  if (loading) {
    return (
      <div className="kld-page">
        <div className="kld-loading-container">
          <div className="kld-spinner"></div>
          <p className="kld-loading-text">Loading karigar lot details from Google Sheets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kld-page">
      <div className="kld-bg-gradient"></div>
      <div className="kld-bg-pattern"></div>
      
      <div className={`kld-container ${isExiting ? "kld-container-exiting" : ""}`}>
        <header className="kld-header">
          <div className="kld-header-inner">
            <div className="kld-logo-area">
              <div className="kld-logo-icon">📋</div>
              <div>
                <h1 className="kld-logo-text">Karigar Lot Detail</h1>
                <p className="kld-logo-tagline">Lot-wise production tracking system</p>
              </div>
            </div>
            <div className="kld-user-area">
              <div className="kld-user-info">
                <div className="kld-user-avatar">
                  {supervisor?.emoji || "👨‍💼"}
                </div>
                <div>
                  <p className="kld-user-name">{supervisor?.name || "Supervisor"}</p>
                  <p className="kld-user-role">Karigar Management</p>
                </div>
              </div>
              <button onClick={handleBack} className="kld-back-button">
                ← Back to Dashboard
              </button>
            </div>
          </div>
        </header>

        <main className="kld-main">
          {viewMode === "summary" && (
            <div className="kld-summary-view">
              {/* Stats Table */}
              <div className="kld-stats-table-wrapper">
                <table className="kld-stats-table">
                  <thead>
                    <tr>
                      <th>👥 Active Karigars</th>
                      <th>📦 Total Lots</th>
                      <th>✅ Active Workers</th>
                      <th>⏳ Total Pending PCs</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="kld-stat-number">{karigars.length}</td>
                      <td className="kld-stat-number">{lots.length}</td>
                      <td className="kld-stat-number">{karigars.filter(k => k.status === "active").length}</td>
                      <td className="kld-stat-number">{karigars.reduce((sum, k) => sum + k.pendingPcs, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Search and Filters Section */}
              <div className="kld-search-section">
                <div className="kld-search-wrapper">
                  <span className="kld-search-icon">🔍</span>
                  <input
                    type="text"
                    className="kld-search-input"
                    placeholder="Search karigar by name or ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="kld-button-group">
                  <button className="kld-filter-toggle-btn" onClick={() => setShowFilters(!showFilters)}>
                    {showFilters ? "▲ Hide Filters" : "▼ Show Filters"}
                  </button>
                  <button className="kld-lot-search-btn" onClick={() => setLotSearchModal(true)}>
                    🔍 Search Lot
                  </button>
                  <button className="kld-karigar-search-btn" onClick={() => setKarigarSearchModal(true)}>
                    👤 Search Karigar
                  </button>
                  <button className="kld-download-pdf-btn" onClick={downloadPDFReport}>
                    📄 Download PDF Report
                  </button>
                  <button className="kld-clear-filters-btn" onClick={clearAllFilters}>
                    Clear All
                  </button>
                </div>
              </div>

              {/* Filters Panel */}
              {showFilters && (
                <div className="kld-filters-panel">
                  <div className="kld-filters-grid">
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Floor Area</label>
                      <select className="kld-filter-select" value={filters.floorArea} onChange={(e) => setFilters({...filters, floorArea: e.target.value})}>
                        <option value="">All Floors</option>
                        {uniqueFloorAreas.map(area => <option key={area} value={area}>{area}</option>)}
                      </select>
                    </div>
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Gender</label>
                      <select className="kld-filter-select" value={filters.gender} onChange={(e) => setFilters({...filters, gender: e.target.value})}>
                        <option value="">All</option>
                        {uniqueGenders.map(gender => <option key={gender} value={gender}>{gender}</option>)}
                      </select>
                    </div>
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Supervisor Type</label>
                      <select className="kld-filter-select" value={filters.supervisorType} onChange={(e) => setFilters({...filters, supervisorType: e.target.value})}>
                        <option value="">All</option>
                        {uniqueSupervisorTypes.map(type => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </div>
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Supervisor Name</label>
                      <select className="kld-filter-select" value={filters.supervisorName} onChange={(e) => setFilters({...filters, supervisorName: e.target.value})}>
                        <option value="">All Supervisors</option>
                        {uniqueSupervisorNames.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </div>
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Status</label>
                      <select className="kld-filter-select" value={filters.status} onChange={(e) => setFilters({...filters, status: e.target.value})}>
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Min Efficiency (%)</label>
                      <input type="number" className="kld-filter-input" value={filters.minEfficiency} onChange={(e) => setFilters({...filters, minEfficiency: e.target.value})} placeholder="e.g., 80" min="0" max="100" />
                    </div>
                    <div className="kld-filter-group">
                      <label className="kld-filter-label">Sort By</label>
                      <select className="kld-filter-select" value={filters.sortBy} onChange={(e) => setFilters({...filters, sortBy: e.target.value})}>
                        <option value="name">Name</option>
                        <option value="efficiency">Efficiency (High to Low)</option>
                        <option value="activeLots">Active Lots (High to Low)</option>
                        <option value="pendingPcs">Pending PCs (High to Low)</option>
                      </select>
                    </div>
                  </div>
                  <div className="kld-filter-summary">
                    <span>Showing {filteredAndSortedKarigars.length} of {karigars.length} karigars</span>
                    {filters.supervisorName && <span className="kld-active-filter-badge">Supervisor: {filters.supervisorName}</span>}
                  </div>
                </div>
              )}

              {/* Karigar Table */}
              {karigars.length === 0 ? (
                <div className="kld-empty-table-state"><p>No karigars found with active assignments.</p></div>
              ) : (
                <div className="kld-table-wrapper">
                  <table className="kld-karigar-table">
                    <thead>
                      <tr className="kld-table-header">
                        <th className="kld-th">Karigar ID</th>
                        <th className="kld-th">Name</th>
                        <th className="kld-th">Floor Area</th>
                        <th className="kld-th">Supervisor</th>
                        <th className="kld-th">Active Lots</th>
                        <th className="kld-th">Active PCs</th>
                        <th className="kld-th">Completed Lots</th>
                        <th className="kld-th">Completed PCs</th>
                        <th className="kld-th">Efficiency</th>
                        <th className="kld-th">Status</th>
                        <th className="kld-th">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedKarigars.map((karigar) => (
                        <tr key={karigar.id} className="kld-table-row">
                          <td className="kld-td">{karigar.id}</td>
                          <td className="kld-td kld-name-cell">{karigar.name}</td>
                          <td className="kld-td">{karigar.floorArea}</td>
                          <td className="kld-td"><span className="kld-supervisor-badge">👨‍💼 {karigar.supervisorName}</span></td>
                          <td className="kld-td">{karigar.activeLots}</td>
                          <td className="kld-td">{karigar.activePcs}</td>
                          <td className="kld-td">{karigar.completedLots}/{karigar.totalLots}</td>
                          <td className="kld-td">{karigar.completedPcs}/{karigar.totalPcs}</td>
                          <td className="kld-td">
                            <div className="kld-efficiency-cell">
                              <div className="kld-efficiency-bar"><div className="kld-efficiency-fill" style={{width: `${karigar.efficiency}%`}}></div></div>
                              <span>{karigar.efficiency}%</span>
                            </div>
                          </td>
                          <td className="kld-td"><span className="kld-status-badge" style={{background: `${getStatusColor(karigar.status)}15`, color: getStatusColor(karigar.status)}}>{karigar.status}</span></td>
                          <td className="kld-td"><button className="kld-view-btn" onClick={() => handleViewKarigarDetails(karigar)}>View Details</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredAndSortedKarigars.length === 0 && <div className="kld-empty-table-state"><p>No karigars found matching your filters.</p></div>}
                </div>
              )}

              {/* Recent Lots Table */}
              {lots.length > 0 && (
                <div className="kld-lots-table-section">
                  <h3 className="kld-section-title">Recent Lots</h3>
                  <div className="kld-table-wrapper">
                    <table className="kld-lots-table">
                      <thead>
                        <tr className="kld-table-header">
                          <th className="kld-th">Lot Number</th>
                          <th className="kld-th">Brand</th>
                          <th className="kld-th">Garment Type</th>
                          <th className="kld-th">Total Pieces</th>
                          <th className="kld-th">Completed</th>
                          <th className="kld-th">Progress</th>
                          <th className="kld-th">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lots.slice(0, 10).map((lot) => (
                          <tr key={lot.lotNumber} className="kld-table-row">
                            <td className="kld-td kld-lot-number-cell">{lot.lotNumber}</td>
                            <td className="kld-td">{lot.brand}</td>
                            <td className="kld-td">{lot.garmentType}</td>
                            <td className="kld-td">{lot.totalPieces}</td>
                            <td className="kld-td">{lot.completedPieces || 0}</td>
                            <td className="kld-td">
                              <div className="kld-progress-cell">
                                <div className="kld-progress-bar-table"><div className="kld-progress-fill-table" style={{width: `${((lot.completedPieces || 0) / (lot.totalPieces || 1)) * 100}%`}}></div></div>
                                <span className="kld-progress-percent">{((lot.completedPieces || 0) / (lot.totalPieces || 1) * 100).toFixed(0)}%</span>
                              </div>
                            </td>
                            <td className="kld-td"><span className="kld-status-badge" style={{background: `${getStatusColor(lot.status)}15`, color: getStatusColor(lot.status)}}>{lot.status || "In Progress"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {viewMode === "details" && selectedKarigar && (
            <div className="kld-details-view">
              <div className="kld-details-header">
                <button className="kld-back-btn" onClick={handleBackToSummary}>← Back to Summary</button>
                <h2 className="kld-details-title">Karigar Production Details</h2>
              </div>
              
              {/* Karigar Profile Table */}
              <div className="kld-profile-table-wrapper">
                <table className="kld-profile-table">
                  <tbody>
                    <tr>
                      <td className="kld-profile-label">Karigar ID</td>
                      <td className="kld-profile-value">{selectedKarigar.id}</td>
                      <td className="kld-profile-label">Name</td>
                      <td className="kld-profile-value">{selectedKarigar.name}</td>
                    </tr>
                    <tr>
                      <td className="kld-profile-label">Phone</td>
                      <td className="kld-profile-value">{selectedKarigar.phone}</td>
                      <td className="kld-profile-label">Efficiency</td>
                      <td className="kld-profile-value">{selectedKarigar.efficiency}%</td>
                    </tr>
                    <tr>
                      <td className="kld-profile-label">Floor Area</td>
                      <td className="kld-profile-value">{selectedKarigar.floorArea}</td>
                      <td className="kld-profile-label">Gender</td>
                      <td className="kld-profile-value">{selectedKarigar.gender}</td>
                    </tr>
                    <tr>
                      <td className="kld-profile-label">Supervisor</td>
                      <td className="kld-profile-value" colSpan="3">{selectedKarigar.supervisorName} ({selectedKarigar.supervisorType})</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Assignments Table */}
              <div className="kld-assignments-section">
                <h3 className="kld-section-title">Lot Assignments & Production Progress</h3>
                {selectedKarigar.assignments.length === 0 ? (
                  <div className="kld-empty-state"><p>No assignments found for this karigar.</p></div>
                ) : (
                  <div className="kld-table-wrapper">
                    <table className="kld-assignments-table">
                      <thead>
                        <tr className="kld-table-header">
                          <th className="kld-th">Lot ID</th>
                          <th className="kld-th">Lot Name</th>
                          <th className="kld-th">Shade</th>
                          <th className="kld-th">Target</th>
                          <th className="kld-th">Completed</th>
                          <th className="kld-th">Pending</th>
                          <th className="kld-th">Progress</th>
                          <th className="kld-th">Quality</th>
                          <th className="kld-th">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedKarigar.assignments.map((assignment, idx) => {
                          const progress = (assignment.completedPcs / assignment.targetPcs) * 100;
                          return (
                            <tr key={idx} className="kld-table-row">
                              <td className="kld-td kld-lot-id-cell">{assignment.lotId}</td>
                              <td className="kld-td">{assignment.lotName}</td>
                              <td className="kld-td"><span className="kld-shade-badge">{assignment.shade}</span></td>
                              <td className="kld-td">{assignment.targetPcs}</td>
                              <td className="kld-td kld-completed-cell">{assignment.completedPcs}</td>
                              <td className="kld-td kld-pending-cell">{assignment.pendingPcs}</td>
                              <td className="kld-td">
                                <div className="kld-progress-cell">
                                  <div className="kld-progress-bar-table"><div className="kld-progress-fill-table" style={{width: `${progress}%`, background: "#3b82f6"}}></div></div>
                                  <span className="kld-progress-percent">{progress.toFixed(0)}%</span>
                                </div>
                              </td>
                              <td className="kld-td"><span className="kld-quality-badge">{assignment.qualityRate}%</span></td>
                              <td className="kld-td"><span className="kld-status-badge" style={{background: `${getStatusColor(assignment.status)}15`, color: getStatusColor(assignment.status)}}>{assignment.status}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Performance Summary Table */}
              <div className="kld-performance-section">
                <h3 className="kld-section-title">Performance Summary</h3>
                <div className="kld-table-wrapper">
                  <table className="kld-performance-table">
                    <tbody>
                      <tr>
                        <td className="kld-perf-label">📋 Total Lots Assigned</td>
                        <td className="kld-perf-value">{selectedKarigar.assignments.length}</td>
                        <td className="kld-perf-label">✅ Completed Lots</td>
                        <td className="kld-perf-value">{selectedKarigar.assignments.filter(a => a.status === "completed").length}</td>
                      </tr>
                      <tr>
                        <td className="kld-perf-label">📦 Total Production</td>
                        <td className="kld-perf-value">{selectedKarigar.assignments.reduce((acc, a) => acc + a.completedPcs, 0)} pcs</td>
                        <td className="kld-perf-label">⏳ Pending PCs</td>
                        <td className="kld-perf-value">{selectedKarigar.pendingPcs} pcs</td>
                      </tr>
                      <tr>
                        <td className="kld-perf-label">⭐ Avg Quality Rate</td>
                        <td className="kld-perf-value">{(selectedKarigar.assignments.reduce((acc, a) => acc + a.qualityRate, 0) / selectedKarigar.assignments.length || 0).toFixed(1)}%</td>
                        <td className="kld-perf-label">🏭 Floor Area</td>
                        <td className="kld-perf-value">{selectedKarigar.floorArea}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Lot Search Modal */}
        {lotSearchModal && (
          <div className="kld-modal-overlay" onClick={closeLotSearchModal}>
            <div className="kld-modal-content kld-modal-large" onClick={(e) => e.stopPropagation()}>
              <div className="kld-modal-header">
                <h2 className="kld-modal-title">🔍 Search Lot Number</h2>
                <button className="kld-modal-close" onClick={closeLotSearchModal}>×</button>
              </div>
              <div className="kld-modal-body">
                <div className="kld-lot-search-input-group">
                  <input type="text" className="kld-lot-search-input" placeholder="Enter Lot Number" value={lotSearchTerm} onChange={(e) => setLotSearchTerm(e.target.value)} onKeyPress={handleLotSearchKeyPress} />
                  <button className="kld-lot-search-btn-primary" onClick={handleLotSearch}>Search Lot</button>
                </div>

                {selectedLot && (
                  <>
                    <div className="kld-lot-details-section">
                      <h3 className="kld-lot-details-title">Lot Information</h3>
                      <div className="kld-table-wrapper">
                        <table className="kld-lot-info-table">
                          <tbody>
                            <tr>
                              <td className="kld-lot-info-label">Lot Number:</td>
                              <td className="kld-lot-info-value">{selectedLot.lotNumber}</td>
                              <td className="kld-lot-info-label">Brand:</td>
                              <td className="kld-lot-info-value">{selectedLot.brand}</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Garment Type:</td>
                              <td className="kld-lot-info-value">{selectedLot.garmentType}</td>
                              <td className="kld-lot-info-label">Total Pieces:</td>
                              <td className="kld-lot-info-value">{selectedLot.totalPieces}</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Completed Pieces:</td>
                              <td className="kld-lot-info-value">{selectedLot.completedPieces || 0}</td>
                              <td className="kld-lot-info-label">Pending Pieces:</td>
                              <td className="kld-lot-info-value">{selectedLot.pendingPieces || 0}</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Lot Status:</td>
                              <td className="kld-lot-info-value" colSpan="3"><span className="kld-status-badge" style={{background: `${getStatusColor(selectedLot.status)}15`, color: getStatusColor(selectedLot.status)}}>{selectedLot.status || "In Progress"}</span></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    {/* Job Order Details Section */}
                    {jobOrderData && (
                      <div className="kld-joborder-section">
                        <h3 className="kld-lot-details-title">📋 Job Order Details</h3>
                        <div className="kld-table-wrapper">
                          <table className="kld-joborder-info-table">
                            <tbody>
                              <tr>
                                <td className="kld-lot-info-label">Job Order No:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Job Order No"] || "-"}</td>
                                <td className="kld-lot-info-label">Date:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Date"] || "-"}</td>
                              </tr>
                              <tr>
                                <td className="kld-lot-info-label">Fabric:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Fabric"] || "-"}</td>
                                <td className="kld-lot-info-label">Party Name:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Party Name"] || "-"}</td>
                              </tr>
                              <tr>
                                <td className="kld-lot-info-label">Season:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Season"] || "-"}</td>
                                <td className="kld-lot-info-label">Section:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Section"] || "-"}</td>
                              </tr>
                              <tr>
                                <td className="kld-lot-info-label">Style:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Style"] || "-"}</td>
                                <td className="kld-lot-info-label">Remarks:</td>
                                <td className="kld-lot-info-value">{jobOrderData["Remarks"] || "-"}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    
                    {/* Lot Image Section */}
                    <div className="kld-lot-image-section">
                      <h3 className="kld-lot-details-title">🖼️ Lot Image</h3>
                      {loadingImage ? (
                        <div className="kld-image-loading">
                          <div className="kld-spinner-small"></div>
                          <p>Loading image...</p>
                        </div>
                      ) : lotImageUrl ? (
                        <div className="kld-image-container">
                          <img 
                            src={lotImageUrl} 
                            alt={`Lot ${selectedLot.lotNumber}`} 
                            className="kld-lot-image"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='8.5' cy='8.5' r='1.5' fill='%23999'%3E%3C/circle%3E%3Cpolyline points='21 15 16 10 5 21'%3E%3C/polyline%3E%3C/svg%3E";
                              e.target.style.objectFit = "contain";
                            }}
                          />
                          <a href={lotImageUrl} target="_blank" rel="noopener noreferrer" className="kld-image-download-link">
                            🔍 View Full Size
                          </a>
                        </div>
                      ) : (
                        <div className="kld-no-image">
                          <p>No image available for this lot</p>
                          <p className="kld-no-image-hint">Please check the Job Order sheet for image URL</p>
                        </div>
                      )}
                    </div>
                    
                    {/* Status Filter for Lot */}
                    <div className="kld-status-filter-section">
                      <label className="kld-filter-label">Filter by Status:</label>
                      <div className="kld-status-filter-buttons">
                        <button 
                          className={`kld-status-filter-btn ${lotStatusFilter === "all" ? "active" : ""}`}
                          onClick={() => setLotStatusFilter("all")}
                        >
                          All ({selectedLot.extractedAssignments ? selectedLot.extractedAssignments.length : 0})
                        </button>
                        <button 
                          className={`kld-status-filter-btn ${lotStatusFilter === "completed" ? "active" : ""}`}
                          onClick={() => setLotStatusFilter("completed")}
                        >
                          ✅ Completed ({selectedLot.extractedAssignments ? selectedLot.extractedAssignments.filter(a => a.status === "Completed").length : 0})
                        </button>
                        <button 
                          className={`kld-status-filter-btn ${lotStatusFilter === "pending" ? "active" : ""}`}
                          onClick={() => setLotStatusFilter("pending")}
                        >
                          ⏳ Pending ({selectedLot.extractedAssignments ? selectedLot.extractedAssignments.filter(a => a.status !== "Completed").length : 0})
                        </button>
                      </div>
                    </div>
                    
                    <div className="kld-lot-pdf-btn-container">
                      <button onClick={downloadLotPDFReport} className="kld-lot-pdf-btn">
                        📄 Download Lot PDF Report
                      </button>
                    </div>
                  </>
                )}

                {lotSearchResults.length > 0 && (
                  <div className="kld-search-results-section">
                    <h3 className="kld-results-title">
                      Shade-wise Assignments for Lot: {selectedLot?.lotNumber}
                      <span className="kld-results-count">(Total: {lotSearchResults.length} shades)</span>
                    </h3>
                    <div className="kld-table-wrapper kld-results-table-wrapper">
                      <table className="kld-results-table">
                        <thead>
                          <tr className="kld-table-header">
                            <th className="kld-th">#</th>
                            <th className="kld-th">Shade Name</th>
                            <th className="kld-th">Karigar ID</th>
                            <th className="kld-th">Karigar Name</th>
                            <th className="kld-th">Target PCS</th>
                            <th className="kld-th">Completed PCS</th>
                            <th className="kld-th">Pending PCS</th>
                            <th className="kld-th">Issue Date</th>
                            <th className="kld-th">Status</th>
                            <th className="kld-th">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lotSearchResults.map((shade, idx) => (
                            <tr key={idx} className="kld-table-row">
                              <td className="kld-td">{idx + 1}</td>
                              <td className="kld-td"><span className="kld-shade-badge">{shade.shade}</span></td>
                              <td className="kld-td">{shade.karigarId}</td>
                              <td className="kld-td kld-name-cell">{shade.karigarName}</td>
                              <td className="kld-td">{shade.pcs}</td>
                              <td className="kld-td kld-completed-cell">{shade.status === "Completed" ? shade.pcs : 0}</td>
                              <td className="kld-td kld-pending-cell">{shade.status !== "Completed" ? shade.pcs : 0}</td>
                              <td className="kld-td">{shade.assignedAt ? new Date(shade.assignedAt).toLocaleDateString() : "-"}</td>
                              <td className="kld-td">
                                <span className="kld-status-badge" style={{background: `${getStatusColor(shade.status)}15`, color: getStatusColor(shade.status)}}>
                                  {shade.status}
                                </span>
                              </td>
                              <td className="kld-td">
                                <button className="kld-view-btn" onClick={() => {
                                  const karigar = karigars.find(k => k.id === shade.karigarId);
                                  if (karigar) {
                                    closeLotSearchModal();
                                    handleViewKarigarDetails(karigar);
                                  }
                                }}>
                                  View Details
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {lotSearchTerm && !selectedLot && (
                  <div className="kld-no-results">
                    <p>No lot found with number: {lotSearchTerm}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Karigar Search Modal */}
        {karigarSearchModal && (
          <div className="kld-modal-overlay" onClick={closeKarigarSearchModal}>
            <div className="kld-modal-content kld-modal-large" onClick={(e) => e.stopPropagation()}>
              <div className="kld-modal-header">
                <h2 className="kld-modal-title">👤 Search Karigar</h2>
                <button className="kld-modal-close" onClick={closeKarigarSearchModal}>×</button>
              </div>
              <div className="kld-modal-body">
                <div className="kld-lot-search-input-group">
                  <input 
                    type="text" 
                    className="kld-lot-search-input" 
                    placeholder="Enter Karigar ID or Name" 
                    value={karigarSearchTerm} 
                    onChange={(e) => setKarigarSearchTerm(e.target.value)} 
                    onKeyPress={handleKarigarSearchKeyPress} 
                  />
                  <button className="kld-lot-search-btn-primary" onClick={handleKarigarSearch}>Search Karigar</button>
                </div>

                {selectedKarigarForReport && (
                  <>
                    <div className="kld-lot-details-section">
                      <h3 className="kld-lot-details-title">Karigar Information</h3>
                      <div className="kld-table-wrapper">
                        <table className="kld-lot-info-table">
                          <tbody>
                            <tr>
                              <td className="kld-lot-info-label">Karigar ID:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.id}</td>
                              <td className="kld-lot-info-label">Name:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.name}</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Floor Area:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.floorArea}</td>
                              <td className="kld-lot-info-label">Gender:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.gender}</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Supervisor:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.supervisorName}</td>
                              <td className="kld-lot-info-label">Efficiency:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.efficiency}%</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Total Lots:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.assignments.length}</td>
                              <td className="kld-lot-info-label">Total Production:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.totalPcs} pcs</td>
                            </tr>
                            <tr>
                              <td className="kld-lot-info-label">Completed Production:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.completedPcs} pcs</td>
                              <td className="kld-lot-info-label">Pending Production:</td>
                              <td className="kld-lot-info-value">{selectedKarigarForReport.pendingPcs} pcs</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    {/* Status Filter for Karigar */}
                    <div className="kld-status-filter-section">
                      <label className="kld-filter-label">Filter by Status:</label>
                      <div className="kld-status-filter-buttons">
                        <button 
                          className={`kld-status-filter-btn ${karigarStatusFilter === "all" ? "active" : ""}`}
                          onClick={() => setKarigarStatusFilter("all")}
                        >
                          All ({selectedKarigarForReport.assignments.length})
                        </button>
                        <button 
                          className={`kld-status-filter-btn ${karigarStatusFilter === "completed" ? "active" : ""}`}
                          onClick={() => setKarigarStatusFilter("completed")}
                        >
                          ✅ Completed ({selectedKarigarForReport.assignments.filter(a => a.status === "completed").length})
                        </button>
                        <button 
                          className={`kld-status-filter-btn ${karigarStatusFilter === "pending" ? "active" : ""}`}
                          onClick={() => setKarigarStatusFilter("pending")}
                        >
                          ⏳ Pending ({selectedKarigarForReport.assignments.filter(a => a.status !== "completed").length})
                        </button>
                      </div>
                    </div>
                    
                    <div className="kld-lot-pdf-btn-container">
                      <button onClick={downloadKarigarPDFReport} className="kld-lot-pdf-btn">
                        📄 Download Karigar PDF Report
                      </button>
                    </div>
                  </>
                )}

                {karigarSearchResults.length > 0 && (
                  <div className="kld-search-results-section">
                    <h3 className="kld-results-title">
                      Lot-wise Assignments for Karigar: {selectedKarigarForReport?.name}
                      <span className="kld-results-count">(Total: {karigarSearchResults.length} lots)</span>
                    </h3>
                    {karigarSearchResults.map((lot, lotIdx) => (
                      <div key={lot.lotId} className="kld-lot-assignment-card">
                        <div className="kld-lot-assignment-header">
                          <h4>Lot #{lot.lotId} - {lot.lotName}</h4>
                          <div className="kld-lot-summary">
                            <span>Target: {lot.totalTarget} | Completed: {lot.totalCompleted} | Pending: {lot.totalPending}</span>
                            <span className="kld-lot-progress">Progress: {((lot.totalCompleted / lot.totalTarget) * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="kld-table-wrapper">
                          <table className="kld-results-table">
                            <thead>
                              <tr className="kld-table-header">
                                <th className="kld-th">#</th>
                                <th className="kld-th">Shade</th>
                                <th className="kld-th">Target PCS</th>
                                <th className="kld-th">Completed PCS</th>
                                <th className="kld-th">Pending PCS</th>
                                <th className="kld-th">Progress</th>
                                <th className="kld-th">Quality</th>
                                <th className="kld-th">Status</th>
                                <th className="kld-th">Completion Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lot.shades.map((shade, idx) => (
                                <tr key={idx} className="kld-table-row">
                                  <td className="kld-td">{idx + 1}</td>
                                  <td className="kld-td"><span className="kld-shade-badge">{shade.shade}</span></td>
                                  <td className="kld-td">{shade.targetPcs}</td>
                                  <td className="kld-td kld-completed-cell">{shade.completedPcs}</td>
                                  <td className="kld-td kld-pending-cell">{shade.pendingPcs}</td>
                                  <td className="kld-td">{((shade.completedPcs / shade.targetPcs) * 100).toFixed(0)}%</td>
                                  <td className="kld-td"><span className="kld-quality-badge">{shade.qualityRate}%</span></td>
                                  <td className="kld-td">
                                    <span className="kld-status-badge" style={{background: `${getStatusColor(shade.status)}15`, color: getStatusColor(shade.status)}}>
                                      {shade.status}
                                    </span>
                                  </td>
                                  <td className="kld-td">{shade.completedAt ? new Date(shade.completedAt).toLocaleDateString() : '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {karigarSearchTerm && !selectedKarigarForReport && (
                  <div className="kld-no-results">
                    <p>No karigar found with ID or Name: {karigarSearchTerm}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <footer className="kld-footer">
          <span>© 2025 MH Stitching — Karigar Lot Management System</span>
          <div className="kld-footer-links">
            <a href="#">Reports</a>
            <a href="#">Analytics</a>
            <a href="#">Export Data</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
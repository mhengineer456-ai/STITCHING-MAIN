import React, { useState, useEffect } from 'react';
import './UpdateCompletionLot.css';

const UpdateCompletionLot = ({ user, onBack }) => {
  const [lotsData, setLotsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedShades, setSelectedShades] = useState(new Map());
  const [updateStatus, setUpdateStatus] = useState('');
  const [filterText, setFilterText] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [expandedLots, setExpandedLots] = useState(new Set());
  const [sortBy, setSortBy] = useState('lotNumber');
  const [sortOrder, setSortOrder] = useState('asc');
  const [isExporting, setIsExporting] = useState(false);
  
  // New state for completion filter
  const [completionFilter, setCompletionFilter] = useState('pending'); // 'all', 'completed', 'pending', 'partial'

  // Get logged-in user's name for filtering
  const loggedInUser = user?.name || '';
  const normalizedLoggedInUser = loggedInUser.toLowerCase().trim();

  // Google Sheets API configuration
  const API_KEY = 'AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk';
  const SPREADSHEET_ID = '17qqixpHOXvG1U3RlRwaHON5JCkugpy4RIu5N9zR9ScM';
  const RANGE = 'KarigarAssignments!A:Q';
  
  const APP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzreKvgqQ_o_Dr7TjGjqatwX8L76xliQKJJKfJx3c_dv404ZLKQ_wsYJmt6062dl8aj/exec';

  // Helper function for name normalization (case-insensitive)
  const normalizeName = (name) => {
    if (!name) return '';
    return name.toString().toLowerCase().trim();
  };

  // Navigation back function
  const handleGoBack = () => {
    if (onBack) {
      onBack();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  };

  useEffect(() => {
    fetchSheetData();
  }, []);

  // Parse assignments JSON supporting multiple karigars per shade
  const parseAssignmentsJSON = (jsonString) => {
    if (!jsonString || jsonString === '') return {};
    try {
      if (typeof jsonString === 'string') {
        return JSON.parse(jsonString);
      }
      return jsonString;
    } catch (e) {
      console.error('Error parsing assignments JSON:', e, jsonString);
      return {};
    }
  };

  // Transform to nested structure with multiple karigars support
  const transformToNestedStructure = (flatData) => {
    const lotsMap = new Map();

    flatData.forEach(row => {
      const lotNumber = row['Lot Number'];
      if (!lotNumber) return;

      if (!lotsMap.has(lotNumber)) {
        lotsMap.set(lotNumber, {
          id: lotNumber,
          lotNumber: lotNumber,
          brand: row['Brand'] || '',
          fabric: row['Fabric'] || '',
          style: row['Style'] || '',
          garmentType: row['Garment Type'] || '',
          partyName: row['Party Name'] || '',
          season: row['Season'] || '',
          supervisor: row['Supervisor'] || '',
          savedBy: row['Saved By'] || '',
          savedAt: row['Saved At'] || '',
          timestamp: row['Timestamp'] || '',
          totalShades: parseInt(row['Total Shades']) || 0,
          totalPieces: parseInt(row['Total Pieces']) || 0,
          status: row['Status'] || 'Pending',
          lastUpdated: row['Last Updated'] || '',
          completionDateTime: row['Completion Date/Time'] || '',
          rowIndex: row.rowIndex,
          assignmentsJSON: row['Assignments JSON'] || '{}',
          shades: [],
          completedShades: 0,
          allShadesCompleted: false
        });
      }

      const lot = lotsMap.get(lotNumber);
      
      if (lot.assignmentsJSON && !lot.shades.length) {
        const assignments = parseAssignmentsJSON(lot.assignmentsJSON);
        
        // Process each shade
        for (const [shadeName, shadeData] of Object.entries(assignments)) {
          let karigars = [];
          let shadeStatus = 'Pending';
          let totalPcs = 0;
          
          if (shadeData.karigars && Array.isArray(shadeData.karigars)) {
            // New format: multiple karigars per shade
            karigars = shadeData.karigars.map(karigar => ({
              karigarId: karigar.karigarId,
              karigarName: karigar.karigarName,
              pcs: karigar.pcs || 0,
              status: karigar.status || 'Pending',
              completed: karigar.status?.toLowerCase() === 'completed',
              assignedAt: karigar.assignedAt || '',
              completedAt: karigar.completedAt || ''
            }));
            shadeStatus = shadeData.status || 'Pending';
            totalPcs = shadeData.totalPcs || karigars.reduce((sum, k) => sum + k.pcs, 0);
          } else if (shadeData.karigarId) {
            // Legacy format: single karigar per shade
            karigars = [{
              karigarId: shadeData.karigarId,
              karigarName: shadeData.karigarName,
              pcs: shadeData.pcs || 0,
              status: shadeData.status || 'Pending',
              completed: shadeData.status?.toLowerCase() === 'completed',
              assignedAt: shadeData.updatedAt || '',
              completedAt: ''
            }];
            shadeStatus = shadeData.status || 'Pending';
            totalPcs = shadeData.pcs || 0;
          }
          
          // Check if shade is completed (all karigars completed OR shade status is Completed)
          const allKarigarsCompleted = karigars.length > 0 && karigars.every(k => k.completed);
          const shadeCompleted = allKarigarsCompleted || shadeStatus?.toLowerCase() === 'completed';
          
          lot.shades.push({
            id: `${lotNumber}_${shadeName}`,
            shadeName: shadeName,
            totalPcs: totalPcs,
            karigars: karigars,
            status: shadeCompleted ? 'Completed' : 'Pending',
            completed: shadeCompleted,
            updatedAt: shadeData.updatedAt || '',
            lastUpdated: shadeData.lastUpdated || ''
          });
        }
        
        lot.completedShades = lot.shades.filter(s => s.completed).length;
        lot.allShadesCompleted = lot.completedShades === lot.totalShades && lot.totalShades > 0;
        lot.shades.sort((a, b) => a.shadeName.localeCompare(b.shadeName));
      }
    });

    return Array.from(lotsMap.values()).sort((a, b) => a.lotNumber.localeCompare(b.lotNumber));
  };

  const fetchSheetData = async () => {
    try {
      setLoading(true);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${RANGE}?key=${API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      
      if (data.values && data.values.length > 0) {
        const headers = data.values[0];
        const rows = data.values.slice(1).map((row, index) => {
          const rowObject = {
            id: index,
            rowIndex: index + 2,
          };
          
          headers.forEach((header, colIndex) => {
            rowObject[header] = row[colIndex] || '';
          });
          
          return rowObject;
        });
        
        const nestedData = transformToNestedStructure(rows);
        setLotsData(nestedData);
      }
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Updated: Mark entire shade as completed (all karigars)
  const updateShadeStatus = async (updates) => {
    try {
      const now = new Date();
      const completionDateTime = now.toLocaleString('en-IN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/\//g, '-');

      const formData = new URLSearchParams();
      formData.append('action', 'updateShadeCompletionStatus');
      formData.append('data', JSON.stringify({
        updates: updates,
        completionDateTime: completionDateTime
      }));

      await fetch(APP_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });

      return { success: true };
      
    } catch (err) {
      console.error('Error updating sheet:', err);
      throw err;
    }
  };

  // Handle shade selection (entire shade)
  const handleShadeSelect = (lotId, shadeId) => {
    const newSelected = new Map(selectedShades);
    if (!newSelected.has(lotId)) {
      newSelected.set(lotId, new Set());
    }
    
    const lotShades = newSelected.get(lotId);
    if (lotShades.has(shadeId)) {
      lotShades.delete(shadeId);
    } else {
      lotShades.add(shadeId);
    }
    
    if (lotShades.size === 0) {
      newSelected.delete(lotId);
    }
    
    setSelectedShades(newSelected);
  };

  // Select all uncompleted shades in a lot
  const handleSelectAllShadesInLot = (lot) => {
    const newSelected = new Map(selectedShades);
    const uncompletedShades = lot.shades.filter(s => !s.completed);
    
    if (uncompletedShades.length === 0) return;
    
    const lotShades = new Set();
    uncompletedShades.forEach(shade => {
      lotShades.add(shade.id);
    });
    
    newSelected.set(lot.id, lotShades);
    setSelectedShades(newSelected);
  };

  // Deselect all shades in a lot
  const handleDeselectAllInLot = (lotId) => {
    const newSelected = new Map(selectedShades);
    newSelected.delete(lotId);
    setSelectedShades(newSelected);
  };

  const toggleLotExpansion = (lotId) => {
    const newExpanded = new Set(expandedLots);
    if (newExpanded.has(lotId)) {
      newExpanded.delete(lotId);
    } else {
      newExpanded.add(lotId);
    }
    setExpandedLots(newExpanded);
  };

  // Updated: Handle shade completion (marks entire shade and all its karigars)
  const handleUpdateCompletion = async () => {
    if (selectedShades.size === 0) {
      setUpdateStatus('Please select at least one shade to mark as completed');
      return;
    }

    setIsUpdating(true);
    setUpdateStatus('Updating Google Sheet...');

    try {
      const updates = [];
      const updatedSelections = new Map(selectedShades);
      
      for (const [lotId, shadeIds] of selectedShades.entries()) {
        const lot = lotsData.find(l => l.id === lotId);
        if (lot) {
          shadeIds.forEach(shadeId => {
            const shade = lot.shades.find(s => s.id === shadeId);
            if (shade && !shade.completed) {
              updates.push({
                lotNumber: lot.lotNumber,
                shadeName: shade.shadeName,
                status: 'Completed'
              });
            }
          });
        }
      }

      if (updates.length === 0) {
        setUpdateStatus('No uncompleted shades selected');
        setIsUpdating(false);
        return;
      }

      await updateShadeStatus(updates);
      
      // Update local state
      const updatedLotsData = lotsData.map(lot => {
        if (updatedSelections.has(lot.id)) {
          const selectedShadeIds = updatedSelections.get(lot.id);
          const updatedShades = lot.shades.map(shade => {
            if (selectedShadeIds.has(shade.id) && !shade.completed) {
              const updatedKarigars = shade.karigars.map(karigar => ({
                ...karigar,
                status: 'Completed',
                completed: true,
                completedAt: new Date().toISOString()
              }));
              
              return { 
                ...shade, 
                karigars: updatedKarigars,
                completed: true, 
                status: 'Completed',
                updatedAt: new Date().toISOString()
              };
            }
            return shade;
          });
          
          const completedCount = updatedShades.filter(s => s.completed).length;
          const allCompleted = completedCount === lot.totalShades;
          
          return {
            ...lot,
            shades: updatedShades,
            completedShades: completedCount,
            allShadesCompleted: allCompleted,
            status: allCompleted ? 'Completed' : 'Pending'
          };
        }
        return lot;
      });
      
      setLotsData(updatedLotsData);
      setUpdateStatus(`✅ Successfully marked ${updates.length} shade(s) as completed!`);
      setSelectedShades(new Map());
      
      setTimeout(() => {
        fetchSheetData();
      }, 2000);
      
    } catch (err) {
      console.error('Bulk update error:', err);
      setUpdateStatus(`❌ Error: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle individual shade completion
  const handleIndividualComplete = async (lotId, shadeId) => {
    setIsUpdating(true);
    setUpdateStatus('Updating Google Sheet...');

    try {
      const lot = lotsData.find(l => l.id === lotId);
      const shade = lot?.shades.find(s => s.id === shadeId);
      
      if (!shade || shade.completed) {
        throw new Error('Shade already completed or not found');
      }
      
      const updates = [{
        lotNumber: lot.lotNumber,
        shadeName: shade.shadeName,
        status: 'Completed'
      }];
      
      await updateShadeStatus(updates);
      
      const updatedLotsData = lotsData.map(l => {
        if (l.id === lotId) {
          const updatedShades = l.shades.map(s => {
            if (s.id === shadeId) {
              const updatedKarigars = s.karigars.map(karigar => ({
                ...karigar,
                status: 'Completed',
                completed: true,
                completedAt: new Date().toISOString()
              }));
              
              return { 
                ...s, 
                karigars: updatedKarigars,
                completed: true, 
                status: 'Completed',
                updatedAt: new Date().toISOString()
              };
            }
            return s;
          });
          
          const completedCount = updatedShades.filter(s => s.completed).length;
          const allCompleted = completedCount === l.totalShades;
          
          return {
            ...l,
            shades: updatedShades,
            completedShades: completedCount,
            allShadesCompleted: allCompleted,
            status: allCompleted ? 'Completed' : 'Pending'
          };
        }
        return l;
      });
      
      setLotsData(updatedLotsData);
      setUpdateStatus(`✅ Successfully marked shade "${shade.shadeName}" as completed!`);
      
      if (selectedShades.has(lotId)) {
        const newSelected = new Map(selectedShades);
        const lotShades = newSelected.get(lotId);
        if (lotShades) {
          lotShades.delete(shadeId);
          if (lotShades.size === 0) {
            newSelected.delete(lotId);
          }
        }
        setSelectedShades(newSelected);
      }
      
      setTimeout(() => {
        fetchSheetData();
      }, 2000);
      
    } catch (err) {
      console.error('Individual update error:', err);
      setUpdateStatus(`❌ Error: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const getLotStatus = (lot) => {
    if (lot.allShadesCompleted) return 'completed';
    if (lot.completedShades === 0) return 'pending';
    return 'partial';
  };

  // Filter lots by logged-in user (supervisor)
  const getFilteredLots = () => {
    let filtered = lotsData.filter(lot => {
      const normalizedSupervisor = normalizeName(lot.supervisor);
      const isAuthorized = normalizedSupervisor === normalizedLoggedInUser;
      
      if (!isAuthorized) return false;
      
      if (completionFilter !== 'all') {
        const lotStatus = getLotStatus(lot);
        if (lotStatus !== completionFilter) return false;
      }
      
      if (!filterText) return true;
      
      const searchLower = filterText.toLowerCase();
      return (
        lot.lotNumber.toLowerCase().includes(searchLower) ||
        lot.brand.toLowerCase().includes(searchLower) ||
        lot.fabric.toLowerCase().includes(searchLower) ||
        lot.garmentType.toLowerCase().includes(searchLower) ||
        lot.style.toLowerCase().includes(searchLower) ||
        lot.partyName.toLowerCase().includes(searchLower) ||
        lot.supervisor.toLowerCase().includes(searchLower) ||
        lot.shades.some(shade => 
          shade.shadeName.toLowerCase().includes(searchLower) ||
          shade.karigars.some(k => 
            k.karigarName.toLowerCase().includes(searchLower) ||
            k.karigarId.toLowerCase().includes(searchLower)
          )
        )
      );
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      switch(sortBy) {
        case 'completion':
          const aPercent = a.completedShades / a.totalShades;
          const bPercent = b.completedShades / b.totalShades;
          comparison = aPercent - bPercent;
          break;
        case 'supervisor':
          comparison = normalizeName(a.supervisor).localeCompare(normalizeName(b.supervisor));
          break;
        default:
          comparison = a.lotNumber.localeCompare(b.lotNumber);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    setUpdateStatus('Preparing PDF export...');

    try {
      const html2pdf = (await import('html2pdf.js')).default;
      
      const exportContainer = document.createElement('div');
      exportContainer.style.padding = '20px';
      exportContainer.style.backgroundColor = 'white';
      exportContainer.style.fontFamily = 'Arial, sans-serif';
      
      const header = document.createElement('div');
      header.innerHTML = `
        <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #2563EB;">
          <h1 style="color: #1e293b; margin: 0;">Shade Completion Report</h1>
          <p style="color: #64748b; margin-top: 10px;">Generated on: ${new Date().toLocaleString()}</p>
          <p style="color: #2563EB;">Supervisor: ${loggedInUser}</p>
          ${filterText ? `<p style="color: #2563EB;">Search: ${filterText}</p>` : ''}
          ${completionFilter !== 'all' ? `<p style="color: #2563EB;">Status Filter: ${completionFilter.charAt(0).toUpperCase() + completionFilter.slice(1)}</p>` : ''}
        </div>
      `;
      exportContainer.appendChild(header);
      
      const mainTable = document.createElement('table');
      mainTable.style.width = '100%';
      mainTable.style.borderCollapse = 'collapse';
      mainTable.style.marginBottom = '30px';
      
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      headerRow.style.backgroundColor = '#f1f5f9';
      headerRow.style.borderBottom = '2px solid #e2e8f0';
      
      const headers = ['Lot Number', 'Brand', 'Fabric', 'Garment Type', 'Party Name', 'Shades', 'Completion %', 'Status'];
      headers.forEach(headerText => {
        const th = document.createElement('th');
        th.textContent = headerText;
        th.style.padding = '12px';
        th.style.textAlign = 'left';
        th.style.fontWeight = '600';
        th.style.color = '#1e293b';
        th.style.borderBottom = '2px solid #e2e8f0';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      mainTable.appendChild(thead);
      
      const tbody = document.createElement('tbody');
      filteredLots.forEach(lot => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid #e2e8f0';
        
        const completionPercentage = lot.totalShades > 0 ? (lot.completedShades / lot.totalShades) * 100 : 0;
        
        const rowData = [
          `#${lot.lotNumber}`,
          lot.brand || '-',
          lot.fabric || '-',
          lot.garmentType || '-',
          lot.partyName || '-',
          `${lot.completedShades}/${lot.totalShades}`,
          `${Math.round(completionPercentage)}%`,
          lot.allShadesCompleted ? 'Completed' : 'In Progress'
        ];
        
        rowData.forEach(cellData => {
          const td = document.createElement('td');
          td.textContent = cellData;
          td.style.padding = '10px 12px';
          td.style.color = '#334155';
          
          if (cellData === 'Completed') {
            td.style.color = '#10b981';
            td.style.fontWeight = '600';
          } else if (cellData === 'In Progress') {
            td.style.color = '#f59e0b';
            td.style.fontWeight = '600';
          }
          
          row.appendChild(td);
        });
        
        tbody.appendChild(row);
        
        if (lot.shades.length > 0) {
          const shadeDetailRow = document.createElement('tr');
          const shadeDetailCell = document.createElement('td');
          shadeDetailCell.colSpan = 8;
          shadeDetailCell.style.padding = '12px';
          shadeDetailCell.style.backgroundColor = '#f8fafc';
          
          const shadeTable = document.createElement('table');
          shadeTable.style.width = '100%';
          shadeTable.style.borderCollapse = 'collapse';
          shadeTable.style.marginTop = '10px';
          shadeTable.style.border = '1px solid #e2e8f0';
          
          const shadeHeader = document.createElement('tr');
          shadeHeader.style.backgroundColor = '#e2e8f0';
          ['Shade Name', 'Karigars', 'Total Pieces', 'Status', 'Completion'].forEach(shadeHeaderText => {
            const th = document.createElement('th');
            th.textContent = shadeHeaderText;
            th.style.padding = '8px';
            th.style.textAlign = 'left';
            th.style.fontSize = '0.85rem';
            th.style.fontWeight = '600';
            th.style.borderBottom = '1px solid #cbd5e1';
            shadeHeader.appendChild(th);
          });
          shadeTable.appendChild(shadeHeader);
          
          lot.shades.forEach(shade => {
            const shadeRow = document.createElement('tr');
            shadeRow.style.borderBottom = '1px solid #e2e8f0';
            
            const karigarsList = shade.karigars.map(k => `${k.karigarName || k.karigarId} (${k.pcs} pcs)`).join(', ');
            
            const shadeData = [
              shade.shadeName,
              karigarsList || '-',
              shade.totalPcs.toString(),
              shade.completed ? 'Completed' : 'Pending',
              shade.completed ? '✓ Done' : '⏳ In Progress'
            ];
            
            shadeData.forEach(data => {
              const td = document.createElement('td');
              td.textContent = data;
              td.style.padding = '8px';
              td.style.fontSize = '0.85rem';
              td.style.color = '#475569';
              
              if (data === 'Completed' || data === '✓ Done') {
                td.style.color = '#10b981';
              } else if (data === 'Pending' || data === '⏳ In Progress') {
                td.style.color = '#f59e0b';
              }
              
              shadeRow.appendChild(td);
            });
            
            shadeTable.appendChild(shadeRow);
          });
          
          shadeDetailCell.appendChild(shadeTable);
          shadeDetailRow.appendChild(shadeDetailCell);
          tbody.appendChild(shadeDetailRow);
        }
      });
      
      mainTable.appendChild(tbody);
      exportContainer.appendChild(mainTable);
      
      const footer = document.createElement('div');
      footer.style.marginTop = '30px';
      footer.style.paddingTop = '20px';
      footer.style.borderTop = '2px solid #e2e8f0';
      footer.style.textAlign = 'center';
      footer.style.color = '#64748b';
      footer.innerHTML = `
        <p><strong>Summary:</strong> ${filteredLots.length} Lots | Total Shades: ${filteredLots.reduce((sum, lot) => sum + lot.totalShades, 0)} | Completed Shades: ${filteredLots.reduce((sum, lot) => sum + lot.completedShades, 0)}</p>
        <p style="font-size: 0.85rem;">Generated by Shade Completion Manager for Supervisor: ${loggedInUser}</p>
      `;
      exportContainer.appendChild(footer);
      
      const opt = {
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `shade-completion-report-${loggedInUser}-${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, letterRendering: true },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
      };
      
      await html2pdf().set(opt).from(exportContainer).save();
      
      setUpdateStatus('✅ PDF exported successfully!');
      setTimeout(() => setUpdateStatus(''), 3000);
    } catch (error) {
      console.error('PDF export error:', error);
      setUpdateStatus('❌ Error exporting PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const filteredLots = getFilteredLots();
  const totalSelectedShades = Array.from(selectedShades.values()).reduce(
    (total, shadeSet) => total + shadeSet.size, 0
  );

  const pendingLotsCount = filteredLots.filter(lot => !lot.allShadesCompleted && lot.completedShades === 0).length;
  const partialLotsCount = filteredLots.filter(lot => !lot.allShadesCompleted && lot.completedShades > 0).length;
  const completedLotsCount = filteredLots.filter(lot => lot.allShadesCompleted).length;

  const displayName = loggedInUser || 'Supervisor';

  if (loading) {
    return (
      <div className="ucl-loading-state">
        <div className="ucl-loading-content">
          <div className="ucl-spinner"></div>
          <p>Loading your data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ucl-error-state">
        <div className="ucl-error-content">
          <div className="ucl-error-icon">⚠️</div>
          <h3>Oops! Something went wrong</h3>
          <p>{error}</p>
          <button onClick={fetchSheetData} className="ucl-retry-btn">
            <span>↻</span> Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ucl-update-completion-lot">
      <div className="ucl-main-card">
        {/* Modern Gradient Header */}
        <div className="ucl-modern-header">
          <div className="ucl-header-background">
            <div className="ucl-header-overlay"></div>
          </div>
          <div className="ucl-header-content-modern">
            <div className="ucl-header-left">
              <button onClick={handleGoBack} className="ucl-back-button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back
              </button>
              <div className="ucl-header-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 7L12 12L4 7M12 22V12M20 12V16L12 21L4 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20 7L12 12L4 7L12 2L20 7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="ucl-header-title">
                <h1>Shade Completion Manager</h1>
                <p>Welcome, {displayName} - Complete entire shades assigned to you</p>
              </div>
            </div>
            <div className="ucl-header-stats">
              <div className="ucl-stat-card">
                <div className="ucl-stat-value">{filteredLots.length}</div>
                <div className="ucl-stat-label">Your Lots</div>
              </div>
              <div className="ucl-stat-card">
                <div className="ucl-stat-value">{filteredLots.reduce((sum, lot) => sum + lot.totalShades, 0)}</div>
                <div className="ucl-stat-label">Total Shades</div>
              </div>
              <div className="ucl-stat-card">
                <div className="ucl-stat-value">{filteredLots.reduce((sum, lot) => sum + lot.completedShades, 0)}</div>
                <div className="ucl-stat-label">Completed</div>
              </div>
              <div className="ucl-stat-card">
                <div className="ucl-stat-value">{totalSelectedShades}</div>
                <div className="ucl-stat-label">Selected</div>
              </div>
            </div>
          </div>
        </div>

        {/* Completion Status Filter */}
        <div className="ucl-status-filter-container">
          <div className="ucl-filter-header">
            <h3>Filter by Completion Status</h3>
          </div>
          <div className="ucl-status-chips">
            <button 
              className={`ucl-status-chip ${completionFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCompletionFilter('all')}
            >
              All Lots
              <span className="ucl-status-count">{filteredLots.length}</span>
            </button>
            <button 
              className={`ucl-status-chip pending ${completionFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setCompletionFilter('pending')}
            >
              ⏳ Pending
              <span className="ucl-status-count">{pendingLotsCount}</span>
            </button>
            <button 
              className={`ucl-status-chip partial ${completionFilter === 'partial' ? 'active' : ''}`}
              onClick={() => setCompletionFilter('partial')}
            >
              🔄 Partial Complete
              <span className="ucl-status-count">{partialLotsCount}</span>
            </button>
            <button 
              className={`ucl-status-chip completed ${completionFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setCompletionFilter('completed')}
            >
              ✓ Completed
              <span className="ucl-status-count">{completedLotsCount}</span>
            </button>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="ucl-controls-bar">
          <div className="ucl-search-section">
            <div className="ucl-search-container">
              <svg className="ucl-search-svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                placeholder="Search by lot number, brand, garment type, shade, karigar..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="ucl-search-input-modern"
                disabled={isUpdating}
              />
            </div>
          </div>
          
          <div className="ucl-view-controls">
            <select 
              className="ucl-sort-select"
              value={sortBy}
              onChange={(e) => handleSort(e.target.value)}
            >
              <option value="lotNumber">Sort by Lot #</option>
              <option value="completion">Sort by Completion %</option>
              <option value="supervisor">Sort by Supervisor</option>
            </select>
            <button 
              className="ucl-export-btn"
              onClick={exportToPDF}
              disabled={isExporting || filteredLots.length === 0}
            >
              {isExporting ? (
                <>
                  <span className="ucl-spinner-small"></span>
                  Exporting...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3v12m0 0-3-3m3 3 3-3M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Export PDF
                </>
              )}
            </button>
            <button 
              className="ucl-refresh-btn-small"
              onClick={fetchSheetData}
              disabled={isUpdating}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M23 4V10H17M1 20V14H7M3.51 9C4.73 5.8 7.96 3.5 11.66 3.5C16.73 3.5 20.89 6.92 22.02 11.5M20.49 15C19.27 18.2 16.04 20.5 12.34 20.5C7.27 20.5 3.11 17.08 1.98 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Welcome Banner for Supervisor */}
        <div className="ucl-welcome-banner">
          <div className="ucl-welcome-content">
            <span className="ucl-welcome-icon">👋</span>
            <div>
              <strong>Working as: {displayName}</strong>
              <span className="ucl-welcome-note">You can only see and complete shades for lots assigned to you.</span>
            </div>
          </div>
        </div>

        {/* Bulk Action Bar */}
        <div className="ucl-bulk-action-bar">
          <div className="ucl-selection-summary">
            {totalSelectedShades > 0 ? (
              <>
                <span className="ucl-selection-badge">{totalSelectedShades} Shade{totalSelectedShades !== 1 ? 's' : ''} Selected</span>
                <button 
                  className="ucl-clear-selection"
                  onClick={() => setSelectedShades(new Map())}
                >
                  Clear All
                </button>
              </>
            ) : (
              <span className="ucl-no-selection">No shades selected</span>
            )}
          </div>
          
          <button 
            onClick={handleUpdateCompletion} 
            className="ucl-bulk-complete-btn"
            disabled={totalSelectedShades === 0 || isUpdating}
          >
            {isUpdating ? (
              <>
                <span className="ucl-spinner-small"></span>
                Processing...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Mark Selected Shades as Completed
              </>
            )}
          </button>
        </div>

        {/* Status Toast */}
        {updateStatus && (
          <div className={`ucl-toast ${updateStatus.includes('❌') ? 'error' : updateStatus.includes('✅') ? 'success' : 'info'}`}>
            <div className="ucl-toast-content">
              <span>{updateStatus}</span>
            </div>
          </div>
        )}

        {/* Main Table */}
        <div className="ucl-table-container">
          {filteredLots.length === 0 ? (
            <div className="ucl-empty-state-modern">
              <div className="ucl-empty-icon-wrapper">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12H15M12 9V15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <h3>No lots found for {displayName}</h3>
              <p>You don't have any lots assigned to you at this moment.</p>
            </div>
          ) : (
            <table className="ucl-data-table">
              <thead>
                <tr>
                  <th className="ucl-table-expand-col"></th>
                  <th className="ucl-table-select-col"></th>
                  <th onClick={() => handleSort('lotNumber')} className="ucl-sortable-header">
                    Lot Number {sortBy === 'lotNumber' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Garment Type</th>
                  <th>Brand</th>
                  <th>Fabric</th>
                  <th>Party Name</th>
                  <th onClick={() => handleSort('supervisor')} className="ucl-sortable-header">
                    Supervisor {sortBy === 'supervisor' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Shades Assigned</th>
                  <th onClick={() => handleSort('completion')} className="ucl-sortable-header">
                    Completion {sortBy === 'completion' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot) => {
                  const isExpanded = expandedLots.has(lot.id);
                  const lotSelectedShades = selectedShades.get(lot.id) || new Set();
                  const uncompletedShadesCount = lot.shades.filter(s => !s.completed).length;
                  const completionPercentage = lot.totalShades > 0 ? (lot.completedShades / lot.totalShades) * 100 : 0;
                  const allShadesSelected = lotSelectedShades.size === uncompletedShadesCount && uncompletedShadesCount > 0;
                  
                  return (
                    <React.Fragment key={lot.id}>
                      <tr className={`ucl-table-row ${lot.allShadesCompleted ? 'completed-lot' : ''}`}>
                        <td className="ucl-table-expand-cell">
                          <button 
                            className="ucl-table-expand-btn"
                            onClick={() => toggleLotExpansion(lot.id)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                              <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </td>
                        <td className="ucl-table-select-cell">
                          {!lot.allShadesCompleted && uncompletedShadesCount > 0 && (
                            <input
                              type="checkbox"
                              checked={allShadesSelected}
                              onChange={() => {
                                if (allShadesSelected) {
                                  handleDeselectAllInLot(lot.id);
                                } else {
                                  handleSelectAllShadesInLot(lot);
                                }
                              }}
                              className="ucl-table-checkbox"
                            />
                          )}
                        </td>
                        <td className="ucl-lot-number-cell">
                          <span className="ucl-lot-number-link">#{lot.lotNumber}</span>
                          {lot.allShadesCompleted && (
                            <span className="ucl-completion-badge-small">Complete</span>
                          )}
                        </td>
                        <td className="ucl-garment-type-cell">
                          <span className="ucl-garment-type-badge">{lot.garmentType || '-'}</span>
                        </td>
                        <td>{lot.brand || '-'}</td>
                        <td>{lot.fabric || '-'}</td>
                        <td>{lot.partyName || '-'}</td>
                        <td>{lot.supervisor || '-'}</td>
                        <td className="ucl-shades-count-cell">
                          <span className="ucl-shades-count-badge">
                            {lot.completedShades}/{lot.totalShades}
                          </span>
                        </td>
                        <td className="ucl-progress-cell">
                          <div className="ucl-table-progress-bar">
                            <div 
                              className="ucl-table-progress-fill"
                              style={{ width: `${completionPercentage}%` }}
                            >
                              <span className="ucl-progress-percent">{Math.round(completionPercentage)}%</span>
                            </div>
                          </div>
                        </td>
                        <td className="ucl-actions-cell">
                          {!lot.allShadesCompleted && uncompletedShadesCount > 0 && (
                            <button
                              className="ucl-quick-select-btn"
                              onClick={() => {
                                if (allShadesSelected) {
                                  handleDeselectAllInLot(lot.id);
                                } else {
                                  handleSelectAllShadesInLot(lot);
                                }
                              }}
                              title={allShadesSelected ? "Deselect all shades" : "Select all uncompleted shades"}
                            >
                              {allShadesSelected ? 'Deselect All' : `Select All (${uncompletedShadesCount})`}
                            </button>
                          )}
                        </td>
                      </tr>
                      
                      {isExpanded && (
                        <tr className="ucl-expanded-row">
                          <td colSpan="11">
                            <div className="ucl-expanded-content">
                              <div className="ucl-shades-subtable-header">
                                <h4>Shade Details for Lot #{lot.lotNumber}</h4>
                                <div className="ucl-shades-summary">
                                  <span>Total Shades: {lot.totalShades}</span>
                                  <span>Completed: {lot.completedShades}</span>
                                  <span>Pending: {uncompletedShadesCount}</span>
                                </div>
                              </div>
                              <table className="ucl-shades-subtable">
                                <thead>
                                  <tr>
                                    <th className="ucl-subtable-select"></th>
                                    <th>Shade Name</th>
                                    <th>Assigned Karigars</th>
                                    <th>Total Pieces</th>
                                    <th>Status</th>
                                    <th>Last Updated</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lot.shades.map((shade) => {
                                    const isSelected = lotSelectedShades.has(shade.id);
                                    
                                    return (
                                      <tr key={shade.id} className={`ucl-shade-row ${shade.completed ? 'completed-shade' : ''}`}>
                                        <td className="ucl-subtable-select">
                                          {!shade.completed && (
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => handleShadeSelect(lot.id, shade.id)}
                                              className="ucl-table-checkbox"
                                            />
                                          )}
                                        </td>
                                        <td>
                                          <span className="ucl-shade-name-cell">
                                            🎨 {shade.shadeName}
                                          </span>
                                        </td>
                                        <td className="ucl-karigars-list">
                                          <div className="ucl-karigar-chips">
                                            {shade.karigars.map((karigar, idx) => (
                                              <span key={idx} className={`ucl-karigar-chip ${karigar.completed ? 'completed' : ''}`}>
                                                {karigar.karigarName || karigar.karigarId}
                                                <span className="ucl-karigar-pcs">({karigar.pcs} pcs)</span>
                                                {karigar.completed && <span className="ucl-check-mark">✓</span>}
                                              </span>
                                            ))}
                                          </div>
                                        </td>
                                        <td>{shade.totalPcs}</td>
                                        <td>
                                          {shade.completed ? (
                                            <span className="ucl-status-badge completed">
                                              ✓ Completed
                                            </span>
                                          ) : (
                                            <span className="ucl-status-badge pending">
                                              ⏳ Pending
                                            </span>
                                          )}
                                        </td>
                                        <td className="ucl-last-updated">
                                          {shade.lastUpdated || shade.updatedAt || '-'}
                                        </td>
                                        <td>
                                          {!shade.completed && (
                                            <button
                                              className="ucl-complete-btn"
                                              onClick={() => handleIndividualComplete(lot.id, shade.id)}
                                              disabled={isUpdating}
                                            >
                                              Complete Shade
                                            </button>
                                          )}
                                          {shade.completed && (
                                            <span className="ucl-completed-mark">✓ Done</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="ucl-footer-modern">
          <div className="ucl-footer-stats">
            Showing {filteredLots.length} of {filteredLots.length} lots assigned to {displayName}
            {completionFilter !== 'all' && (
              <span className="ucl-active-filter-badge">
                Filter: {completionFilter === 'pending' ? 'Pending' : completionFilter === 'partial' ? 'Partial Complete' : 'Completed'}
              </span>
            )}
          </div>
          <button 
            className="ucl-refresh-btn"
            onClick={fetchSheetData}
            disabled={isUpdating}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M23 4V10H17M1 20V14H7M3.51 9C4.73 5.8 7.96 3.5 11.66 3.5C16.73 3.5 20.89 6.92 22.02 11.5M20.49 15C19.27 18.2 16.04 20.5 12.34 20.5C7.27 20.5 3.11 17.08 1.98 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Refresh Data
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateCompletionLot;
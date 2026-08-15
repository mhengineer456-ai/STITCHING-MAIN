import React, { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Google Sheets Configuration
const SPREADSHEET_ID = '16mifNw0WMIlnZ1XRHsuH_8kVUm_6Y1O3uVsoM-Hjppo';
const API_KEY = 'AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk';
const PURCHASE_ORDERS_RANGE = 'ZipPurchaseOrders!A:V';

// Helper functions
const formatDate = (dateString) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return dateString;
  }
};

const formatNumber = (num) => {
  if (!num) return '0';
  return parseInt(num).toLocaleString('en-IN');
};

const formatCurrency = (amount) => {
  if (!amount) return '₹0';
  return `₹${parseInt(amount).toLocaleString('en-IN')}`;
};

const safeJSONParse = (str, defaultValue = {}) => {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
};

const parseColorBreakdown = (breakdown) => {
  if (!breakdown) return [];
  try {
    return breakdown.split(';').map(item => {
      const [color, pieces] = item.split(':').map(s => s.trim());
      return { color, pieces: pieces?.replace('pcs', '') || '0' };
    });
  } catch {
    return [];
  }
};

// New helper function to calculate aging
const calculateAging = (timestamp, materialEntryDate) => {
  if (!timestamp) return 0;
  
  const timestampDate = new Date(timestamp);
  let endDate;
  
  if (materialEntryDate) {
    // If Material Entry Date is present, use it as end date
    endDate = new Date(materialEntryDate);
  } else {
    // If Material Entry Date is not present, use today's date
    endDate = new Date();
  }
  
  // Calculate difference in days
  const timeDiff = endDate.getTime() - timestampDate.getTime();
  const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
  
  return Math.max(0, daysDiff); // Return 0 if negative
};

const ZipManagement = ({ user, onNavigate }) => { // Add user and onNavigate props
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    garmentType: '',
    supervisor: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    zipPlacement: ''
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Fetch data from Google Sheets
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${PURCHASE_ORDERS_RANGE}?key=${API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status}`);
      }
      
      const result = await response.json();
      const values = result.values;
      
      if (!values || values.length === 0) {
        throw new Error('No data found in the spreadsheet');
      }
      
      // Process the data
      const headers = values[0];
      const rows = values.slice(1);
      
      const processedData = rows.map((row, index) => {
        const obj = { id: index + 1 };
        headers.forEach((header, colIndex) => {
          obj[header] = row[colIndex] || '';
        });
        
        // Add derived fields for easier filtering
        obj.hasGateEntry = !!(obj['Gate Entry Person'] && obj['Gate Entry Date']);
        obj.hasMaterialReceived = !!(obj['Material Received By'] && obj['Material Received Date']);
        obj.hasSupplierEntry = !!(obj['Supplier Name'] && obj['Material Entry Date']);
        
        // Calculate aging
        obj.aging = calculateAging(obj['Timestamp'], obj['Material Entry Date']);
        
        return obj;
      });
      
      setData(processedData);
      
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handle back button click
  const handleBackButton = () => {
    if (onNavigate) {
      onNavigate('Welcome', user);
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  };

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const garmentTypes = [...new Set(data.map(row => row['Garment Type']).filter(Boolean))];
    const supervisors = [...new Set(data.map(row => row['Supervisor']).filter(Boolean))];
    
    // Extract all unique zip placements
    const allPlacements = data.flatMap(row => {
      const placements = safeJSONParse(row['Selected Placements'], []);
      return placements;
    }).filter(Boolean);
    
    const zipPlacements = [...new Set(allPlacements)];
    
    return { garmentTypes, supervisors, zipPlacements };
  }, [data]);

  // Filter data based on logged-in user
  const userFilteredData = useMemo(() => {
    if (!user) return data;
    
    // Get the supervisor name from user object
    const supervisorName = user.name || user.username;
    
    if (!supervisorName) return data;
    
    // Filter data to show only records for the logged-in supervisor
    return data.filter(row => {
      const rowSupervisor = row['Supervisor'];
      return rowSupervisor && rowSupervisor.toLowerCase().includes(supervisorName.toLowerCase());
    });
  }, [data, user]);

  // Filter and search data
  const filteredData = useMemo(() => {
    let result = userFilteredData;

    // Text search
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      result = result.filter(row =>
        Object.entries(row).some(([key, value]) =>
          key !== 'id' && 
          String(value).toLowerCase().includes(searchLower)
        )
      );
    }

    // Apply filters
    if (filters.garmentType) {
      result = result.filter(row => 
        row['Garment Type']?.toLowerCase().includes(filters.garmentType.toLowerCase())
      );
    }

    if (filters.supervisor) {
      result = result.filter(row => 
        row['Supervisor']?.toLowerCase().includes(filters.supervisor.toLowerCase())
      );
    }

    if (filters.status) {
      switch (filters.status) {
        case 'with-gate-entry':
          result = result.filter(row => row.hasGateEntry);
          break;
        case 'with-material-received':
          result = result.filter(row => row.hasMaterialReceived);
          break;
        case 'with-supplier-entry':
          result = result.filter(row => row.hasSupplierEntry);
          break;
        case 'pending-gate-entry':
          result = result.filter(row => !row.hasGateEntry);
          break;
        case 'pending-material-received':
          result = result.filter(row => !row.hasMaterialReceived);
          break;
        case 'pending-supplier-entry':
          result = result.filter(row => !row.hasSupplierEntry);
          break;
      }
    }

    if (filters.dateFrom) {
      result = result.filter(row => {
        const rowDate = new Date(row['Issue Date']);
        const filterDate = new Date(filters.dateFrom);
        return rowDate >= filterDate;
      });
    }

    if (filters.dateTo) {
      result = result.filter(row => {
        const rowDate = new Date(row['Issue Date']);
        const filterDate = new Date(filters.dateTo);
        return rowDate <= filterDate;
      });
    }

    // Add zip placement filter
    if (filters.zipPlacement) {
      result = result.filter(row => {
        const placements = safeJSONParse(row['Selected Placements'], []);
        return placements.some(placement => 
          placement.toLowerCase().includes(filters.zipPlacement.toLowerCase())
        );
      });
    }

    return result;
  }, [userFilteredData, searchTerm, filters]);

  // Pagination
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filters, itemsPerPage]);

  // Statistics
  const stats = useMemo(() => {
    const total = filteredData.length;
    const totalPieces = filteredData.reduce((sum, row) => sum + (parseInt(row['Total Pieces']) || 0), 0);
    const totalCost = filteredData.reduce((sum, row) => sum + (parseInt(row['Total Cost (₹)']) || 0), 0);
    
    const withGateEntry = filteredData.filter(row => row.hasGateEntry).length;
    const withMaterialReceived = filteredData.filter(row => row.hasMaterialReceived).length;
    const withSupplierEntry = filteredData.filter(row => row.hasSupplierEntry).length;

    // Aging statistics
    const averageAging = filteredData.length > 0 
      ? Math.round(filteredData.reduce((sum, row) => sum + (row.aging || 0), 0) / filteredData.length)
      : 0;

    return {
      total,
      totalPieces,
      totalCost,
      withGateEntry,
      withMaterialReceived,
      withSupplierEntry,
      averageAging
    };
  }, [filteredData]);

  const handleFilterChange = (filterName, value) => {
    setFilters(prev => ({
      ...prev,
      [filterName]: value
    }));
  };

  const clearFilters = () => {
    setFilters({
      garmentType: '',
      supervisor: '',
      status: '',
      dateFrom: '',
      dateTo: '',
      zipPlacement: ''
    });
    setSearchTerm('');
  };

  // Download Excel/CSV
  const downloadExcel = () => {
    const headers = [
      'Sr. No.',
      'Lot Number',
      'Garment Type',
      'Style',
      'Fabric',
      'Total Pieces',
      'Issue Date',
      'Supervisor',
      'Total Cost (₹)',
      'Gate Entry Person',
      'Gate Entry Date',
      'Material Received By',
      'Material Received Date',
      'Supplier Name',
      'Material Entry Date',
      'Aging (Days)'
    ];

    const csvData = filteredData.map((row, index) => [
      index + 1,
      row['Lot Number'] || '',
      row['Garment Type'] || '',
      row['Style'] || '',
      row['Fabric'] || '',
      row['Total Pieces'] || '',
      formatDate(row['Issue Date']),
      row['Supervisor'] || '',
      row['Total Cost (₹)'] || '',
      row['Gate Entry Person'] || '',
      formatDate(row['Gate Entry Date']),
      row['Material Received By'] || '',
      formatDate(row['Material Received Date']),
      row['Supplier Name'] || '',
      formatDate(row['Material Entry Date']),
      row.aging || 0
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => 
        row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `zip-purchase-orders-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download PDF
  const downloadPDF = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a3'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 8;

    // Page border - light gray for B&W printing
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.3);
    doc.rect(margin, margin, pageWidth - (2 * margin), pageHeight - (2 * margin));

    // Header - White background (changed from dark gray)
    doc.setFillColor(255, 255, 255); // White background
    doc.rect(margin, margin, pageWidth - (2 * margin), 18, 'F');
    
    // Title - Navy blue text
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 128); // Navy blue color
    doc.setFont('helvetica', 'bold');
    doc.text('ZIP PURCHASE ORDERS REPORT', pageWidth / 2, margin + 10, { align: 'center' });

    // Subtitle - Dark gray text
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80); // Dark gray for subtitle
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, pageWidth / 2, margin + 16, { align: 'center' });

    // Prepare table data with zip status
    const tableData = filteredData.map((row, index) => {
      const hasPendingZip = !row.hasSupplierEntry || !row.hasMaterialReceived;
      const zipStatus = hasPendingZip ? 'PENDING' : 'DONE';
      
      return [
        (index + 1).toString(),
        row['Lot Number'] || '-',
        row['Garment Type'] || '-',
        row['Style'] || '-',
        row['Fabric'] || '-',
        formatNumber(row['Total Pieces']),
        formatCurrency(row['Total Cost (₹)']).replace('₹', ''),
        formatDate(row['Issue Date']),
        row['Supervisor'] || '-',
        row.aging?.toString() || '0',
        zipStatus
      ];
    });

    // Create table with optimized column widths for A3
    autoTable(doc, {
      head: [[
        'Sr.No.', 
        'Lot No.', 
        'Garment Type', 
        'Style', 
        'Fabric',
        'Pieces', 
        'Cost', 
        'Issue Date', 
        'Supervisor', 
        'Aging (Days)',
        'Status'
      ]],
      body: tableData,
      startY: margin + 25,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: 3,
        lineColor: [80, 80, 80],
        lineWidth: 0.25,
        textColor: [0, 0, 0],
        font: 'helvetica',
        fontStyle: 'normal'
      },
      headStyles: {
        fillColor: [0, 0, 128], // Navy blue background
        textColor: [255, 255, 255], // White text
        fontStyle: 'bold',
        fontSize: 8,
        lineWidth: 0.25,
        lineColor: [80, 80, 80],
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 9,
        lineWidth: 0.25,
        lineColor: [150, 150, 150],
        textColor: [0, 0, 0]
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      didParseCell: function(data) {
        // Check if this is a body cell
        if (data.section === 'body') {
          const rowData = tableData[data.row.index];
          const zipStatus = rowData[10]; // Status is now at index 10
          
          if (zipStatus === 'PENDING') {
            // Highlight entire row for pending zips
            data.cell.styles.fillColor = [255, 240, 240]; // Light red background
            data.cell.styles.fontStyle = 'bold';
            
            // Make the Status column more prominent
            if (data.column.index === 10) {
              data.cell.styles.fillColor = [255, 200, 200]; // Darker red
              data.cell.styles.textColor = [200, 0, 0]; // Red text
            }
          } else {
            // Style for completed zips
            if (data.column.index === 10) {
              data.cell.styles.fillColor = [230, 255, 230]; // Light green
              data.cell.styles.textColor = [0, 100, 0]; // Green text
              data.cell.styles.fontStyle = 'bold';
            }
          }
          
          // Style aging column based on days
          if (data.column.index === 9) { // Aging column
            const agingDays = parseInt(rowData[9]) || 0;
            if (agingDays > 14) {
              data.cell.styles.fillColor = [255, 220, 220]; // Light red for high aging
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.textColor = [150, 0, 0]; // Dark red text
            } else if (agingDays > 7) {
              data.cell.styles.fillColor = [255, 245, 220]; // Light yellow for medium aging
              data.cell.styles.textColor = [120, 80, 0]; // Dark yellow text
            }
          }

          // Style cost column for better readability
          if (data.column.index === 6) { // Cost column
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [0, 80, 0]; // Dark green for cost
          }

          // Style pieces column
          if (data.column.index === 5) { // Pieces column
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
      columnStyles: {
        0: { 
          cellWidth: 15, 
          halign: 'center',
          fontStyle: 'bold'
        },
        1: { 
          cellWidth: 20, 
          fontStyle: 'bold',
          halign: 'center'
        },
        2: { 
          cellWidth: 35,
          halign: 'center'
        },
        3: { 
          cellWidth: 35,
          halign: 'center'
        },
        4: { 
          cellWidth: 32,
          halign: 'center'
        },
        5: { 
          cellWidth: 25, 
          halign: 'center'
        },
        6: { 
          cellWidth: 25, 
          halign: 'center'
        },
        7: { 
          cellWidth: 25, 
          halign: 'center'
        },
        8: { 
          cellWidth: 25,
          halign: 'center'
        },
        9: { 
          cellWidth: 18, 
          halign: 'center',
          fontStyle: 'bold'
        },
        10: { 
          cellWidth: 24, 
          halign: 'center',
          fontStyle: 'bold'
        }
      },
      tableWidth: 'wrap',
      showHead: 'firstPage',
      useCss: false
    });

    // Save with descriptive filename
    const timestamp = new Date().toISOString().split('T')[0];
    doc.save(`zip-orders-report-${timestamp}.pdf`);
  };

  // Get aging color based on days
  const getAgingColor = (days) => {
    if (days <= 7) return '#059669'; // Green for 0-7 days
    if (days <= 14) return '#d97706'; // Amber for 8-14 days
    if (days <= 30) return '#dc2626'; // Red for 15-30 days
    return '#7c3aed'; // Purple for more than 30 days
  };

  // User info display component
  const UserInfoDisplay = () => {
    if (!user) return null;
    
    return (
      <div style={styles.userInfo}>
        <div style={styles.userAvatar}>
          {user.name?.charAt(0) || user.username?.charAt(0) || 'U'}
        </div>
        <div style={styles.userDetails}>
          <div style={styles.userName}>{user.name}</div>
          <div style={styles.userRole}>Supervisor</div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>Loading Purchase Orders Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <h2 style={styles.errorTitle}>Error Loading Data</h2>
        <p style={styles.errorText}>{error}</p>
        <button onClick={fetchData} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.dashboard}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button 
            onClick={handleBackButton}
            style={styles.backButton}
            title="Go back"
          >
            ← Back
          </button>
          <div style={styles.headerContent}>
            <h1 style={styles.title}>Zip Purchase Orders Dashboard</h1>
            <p style={styles.subtitle}>
              {user ? `Viewing orders for ${user.name}` : 'Manage and track all zip material requirements'}
            </p>
          </div>
        </div>
        <div style={styles.headerActions}>
          <UserInfoDisplay />
          <div style={styles.downloadButtons}>
            <button onClick={downloadPDF} style={styles.pdfButton}>
              📊 PDF Report
            </button>
            <button onClick={downloadExcel} style={styles.excelButton}>
              📈 Excel/CSV
            </button>
          </div>
          <button onClick={fetchData} style={styles.refreshButton}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>📋</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{stats.total}</h3>
            <p style={styles.statLabel}>Total Orders</p>
          </div>
        </div>
        
        {/* <div style={styles.statCard}>
          <div style={styles.statIcon}>👕</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{formatNumber(stats.totalPieces)}</h3>
            <p style={styles.statLabel}>Total Pieces</p>
          </div>
        </div> */}
        
        {/* <div style={styles.statCard}>
          <div style={styles.statIcon}>💰</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{formatCurrency(stats.totalCost)}</h3>
            <p style={styles.statLabel}>Total Cost</p>
          </div>
        </div> */}
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>⏱️</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{stats.averageAging}</h3>
            <p style={styles.statLabel}>Avg. Aging (Days)</p>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>✅</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{stats.withGateEntry}</h3>
            <p style={styles.statLabel}>Gate Entry Done</p>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>📦</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{stats.withMaterialReceived}</h3>
            <p style={styles.statLabel}>Material Received</p>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🏢</div>
          <div style={styles.statContent}>
            <h3 style={styles.statNumber}>{stats.withSupplierEntry}</h3>
            <p style={styles.statLabel}>Supplier Entry</p>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div style={styles.controlsSection}>
        <div style={styles.searchBox}>
          <input
            type="text"
            placeholder="Search across all orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        
        <div style={styles.filtersGrid}>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Garment Type</label>
            <select
              value={filters.garmentType}
              onChange={(e) => handleFilterChange('garmentType', e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">All Types</option>
              {filterOptions.garmentTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Supervisor</label>
            <select
              value={filters.supervisor}
              onChange={(e) => handleFilterChange('supervisor', e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">All Supervisors</option>
              {filterOptions.supervisors.map(supervisor => (
                <option key={supervisor} value={supervisor}>{supervisor}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Status</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">All Status</option>
              <option value="with-gate-entry">With Gate Entry</option>
              <option value="pending-gate-entry">Pending Gate Entry</option>
              <option value="with-material-received">Material Received</option>
              <option value="pending-material-received">Pending Material</option>
              <option value="with-supplier-entry">With Supplier</option>
              <option value="pending-supplier-entry">Pending Supplier</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Zip Placement</label>
            <select
              value={filters.zipPlacement}
              onChange={(e) => handleFilterChange('zipPlacement', e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">All Placements</option>
              {filterOptions.zipPlacements.map(placement => (
                <option key={placement} value={placement}>{placement}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Date From</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              style={styles.filterInput}
            />
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Date To</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              style={styles.filterInput}
            />
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>&nbsp;</label>
            <button onClick={clearFilters} style={styles.clearButton}>
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Pagination Controls - Top */}
      <div style={styles.paginationSection}>
        <div style={styles.paginationInfo}>
          Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} entries
        </div>
        <div style={styles.paginationControls}>
          <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            style={{...styles.paginationButton, ...(currentPage === 1 ? styles.disabledButton : {})}}
          >
            Previous
          </button>
          <span style={styles.pageInfo}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            style={{...styles.paginationButton, ...(currentPage === totalPages ? styles.disabledButton : {})}}
          >
            Next
          </button>
          <select
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(Number(e.target.value))}
            style={styles.pageSizeSelect}
          >
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
      <div style={styles.tableContainer}>
        {filteredData.length === 0 ? (
          <div style={styles.noData}>
            <p style={styles.noDataText}>
              {data.length === 0 ? 'No purchase orders found' : 'No orders match your search/filters'}
            </p>
            {(searchTerm || Object.values(filters).some(f => f)) && (
              <button onClick={clearFilters} style={styles.clearSearchButton}>
                Clear Search & Filters
              </button>
            )}
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Sr. No.</th>
                  <th style={styles.tableHeader}>Lot No.</th>
                  <th style={styles.tableHeader}>Garment Type</th>
                  <th style={styles.tableHeader}>Style</th>
                  <th style={styles.tableHeader}>Pieces</th>
                  <th style={styles.tableHeader}>Cost</th>
                  <th style={styles.tableHeader}>Issue Date</th>
                  <th style={styles.tableHeader}>Supervisor</th>
                  <th style={styles.tableHeader}>Zip Placements</th>
                  <th style={styles.tableHeader}>Gate Entry</th>
                  <th style={styles.tableHeader}>Material Received</th>
                  <th style={styles.tableHeader}>Supplier</th>
                  <th style={styles.tableHeader}>Aging (Days)</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, index) => {
                  const globalIndex = (currentPage - 1) * itemsPerPage + index;
                  const selectedPlacements = safeJSONParse(row['Selected Placements'], []);
                  
                  return (
                    <tr 
                      key={row.id} 
                      style={styles.tableRow}
                      onMouseEnter={(e) => e.target.parentNode.style.backgroundColor = '#f8fafc'}
                      onMouseLeave={(e) => e.target.parentNode.style.backgroundColor = '#ffffff'}
                    >
                      <td style={styles.srNoCell}>
                        <strong>{globalIndex + 1}</strong>
                      </td>
                      <td style={styles.tableCell}>
                        <strong style={styles.lotNumber}>{row['Lot Number']}</strong>
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.garmentInfo}>
                          <div style={styles.garmentType}>{row['Garment Type']}</div>
                          {row['Fabric'] && (
                            <div style={styles.fabric}>{row['Fabric']}</div>
                          )}
                        </div>
                      </td>
                      <td style={styles.tableCell}>{row['Style']}</td>
                      <td style={styles.tableCell}>
                        <strong>{formatNumber(row['Total Pieces'])}</strong>
                      </td>
                      <td style={styles.tableCell}>
                        <strong style={styles.cost}>{formatCurrency(row['Total Cost (₹)'])}</strong>
                      </td>
                      <td style={styles.tableCell}>{formatDate(row['Issue Date'])}</td>
                      <td style={styles.tableCell}>{row['Supervisor']}</td>
                      <td style={styles.tableCell}>
                        <div style={styles.zipInfo}>
                          {selectedPlacements.map(placement => (
                            <div key={placement} style={styles.placement}>
                              {placement}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.statusCell}>
                          {row.hasGateEntry ? (
                            <div style={styles.statusSuccess}>
                              <div>✅ Done</div>
                              <div style={styles.smallText}>{row['Gate Entry Person']}</div>
                              <div style={styles.smallText}>{formatDate(row['Gate Entry Date'])}</div>
                            </div>
                          ) : (
                            <div style={styles.statusPending}>⏳ Pending</div>
                          )}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.statusCell}>
                          {row.hasMaterialReceived ? (
                            <div style={styles.statusSuccess}>
                              <div>✅ Received</div>
                              <div style={styles.smallText}>{row['Material Received By']}</div>
                              <div style={styles.smallText}>{formatDate(row['Material Received Date'])}</div>
                            </div>
                          ) : (
                            <div style={styles.statusPending}>⏳ Pending</div>
                          )}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.statusCell}>
                          {row.hasSupplierEntry ? (
                            <div style={styles.statusSuccess}>
                              <div>✅ Entered</div>
                              <div style={styles.smallText}>{row['Supplier Name']}</div>
                              <div style={styles.smallText}>{formatDate(row['Material Entry Date'])}</div>
                            </div>
                          ) : (
                            <div style={styles.statusPending}>⏳ Pending</div>
                          )}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        <div 
                          style={{
                            ...styles.agingBadge,
                            backgroundColor: getAgingColor(row.aging),
                            color: '#ffffff',
                            fontWeight: '600'
                          }}
                        >
                          {row.aging} days
                        </div>
                        <div style={styles.smallText}>
                          {row.hasSupplierEntry ? 'Completed' : 'In Progress'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls - Bottom */}
      {filteredData.length > 0 && (
        <div style={styles.paginationSection}>
          <div style={styles.paginationInfo}>
            Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} entries
          </div>
          <div style={styles.paginationControls}>
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              style={{...styles.paginationButton, ...(currentPage === 1 ? styles.disabledButton : {})}}
            >
              Previous
            </button>
            <span style={styles.pageInfo}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              style={{...styles.paginationButton, ...(currentPage === totalPages ? styles.disabledButton : {})}}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add CSS for spinner animation */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

// Complete styles
const styles = {
  dashboard: {
    padding: '24px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    backgroundColor: '#ffffffff',
    minHeight: '100vh',
    color: '#1e293b',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    backgroundColor: '#ffffff',
    padding: '32px',
    borderRadius: '16px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '20px',
    flex: 1,
  },
  backButton: {
    padding: '12px 20px',
    backgroundColor: '#6b7280',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 4px rgba(107, 114, 128, 0.3)',
    minWidth: '80px',
    marginTop: '8px',
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#0f172a',
    margin: '0 0 8px 0',
    background: 'linear-gradient(135deg, #0F172A, #2563EB)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  subtitle: {
    fontSize: '16px',
    color: '#000000ff',
    margin: '0',
    fontWeight: '500',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px',
    background: '#f8fafc',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    marginRight: '12px',
  },
  userAvatar: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #0F172A 0%, #1E40AF 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: '600',
    fontSize: '14px',
  },
  userDetails: {
    display: 'flex',
    flexDirection: 'column',
  },
  userName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1e293b',
  },
  userRole: {
    fontSize: '11px',
    color: '#64748b',
  },
  downloadButtons: {
    display: 'flex',
    gap: '10px',
  },
  pdfButton: {
    padding: '12px 16px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s ease',
  },
  excelButton: {
    padding: '12px 16px',
    backgroundColor: '#059669',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s ease',
  },
  refreshButton: {
    padding: '12px 20px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '32px',
  },
  statCard: {
    backgroundColor: '#ffffff',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
  statIcon: {
    fontSize: '32px',
    width: '60px',
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: '12px',
  },
  statContent: {
    flex: 1,
  },
  statNumber: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#0f172a',
    margin: '0 0 4px 0',
    lineHeight: '1',
  },
  statLabel: {
    fontSize: '14px',
    color: '#004ab3ff',
    margin: '0',
    fontWeight: '500',
  },
  controlsSection: {
    backgroundColor: '#ffffff',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    marginBottom: '24px',
  },
  searchBox: {
    marginBottom: '20px',
  },
  searchInput: {
    width: '100%',
    padding: '12px 16px',
    border: '2px solid #e2e8f0',
    borderRadius: '10px',
    fontSize: '16px',
    transition: 'border-color 0.2s ease',
    outline: 'none',
    boxSizing: 'border-box',
  },
  filtersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  filterLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  },
  filterSelect: {
    padding: '10px 12px',
    border: '2px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease',
    outline: 'none',
  },
  filterInput: {
    padding: '10px 12px',
    border: '2px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    transition: 'border-color 0.2s ease',
    outline: 'none',
    boxSizing: 'border-box',
  },
  clearButton: {
    padding: '10px 16px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'background-color 0.2s ease',
    marginTop: '8px',
  },
  paginationSection: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: '16px 24px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    marginBottom: '16px',
  },
  paginationInfo: {
    color: '#64748b',
    fontSize: '14px',
    fontWeight: '500',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  paginationButton: {
    padding: '8px 16px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s ease',
  },
  disabledButton: {
    backgroundColor: '#9ca3af',
    cursor: 'not-allowed',
  },
  pageInfo: {
    margin: '0 12px',
    fontSize: '14px',
    color: '#374151',
    fontWeight: '500',
  },
  pageSizeSelect: {
    padding: '8px 12px',
    border: '2px solid #e2e8f0',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
  },
  tableContainer: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    overflow: 'hidden',
    marginBottom: '16px',
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
    minWidth: '1500px',
  },
  tableHeader: {
    backgroundColor: '#f8fafc',
    padding: '16px 12px',
    textAlign: 'left',
    fontWeight: '600',
    color: '#060038ff',
    borderBottom: '2px solid #e2e8f0',
    fontSize: '13px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  tableRow: {
    border: '1px solid #f1f5f9',
    transition: 'background-color 0.2s ease',
    backgroundColor: '#ffffff',
  },
  srNoCell: {
    padding: '16px 12px',
    color: '#000000ff',
    borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'top',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: '13px',
    backgroundColor: '#f8fafc',
  },
  tableCell: {
    padding: '16px 12px',
    color: '#000000ff',
    border: '1px solid #f1f5f9',
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
  },
  lotNumber: {
    color: '#0f172a',
    fontSize: '15px',
    fontWeight: '600',
  },
  garmentInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '120px',
  },
  garmentType: {
    fontWeight: '600',
    color: '#0f172a',
  },
  fabric: {
    fontSize: '12px',
    color: '#003681ff',
    fontStyle: 'italic',
  },
  cost: {
    color: '#059669',
    fontWeight: '600',
  },
  zipInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '120px',
  },
  placement: {
    fontSize: '12px',
    backgroundColor: '#f1f5f9',
    padding: '4px 8px',
    borderRadius: '6px',
    color: '#000a68ff',
    textAlign: 'center',
  },
  statusCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    minWidth: '100px',
  },
  statusSuccess: {
    color: '#059669',
    fontWeight: '500',
    fontSize: '13px',
  },
  statusPending: {
    color: '#d97706',
    fontWeight: '500',
    fontSize: '13px',
  },
  smallText: {
    fontSize: '11px',
    color: '#6b7280',
    marginTop: '2px',
  },
  agingBadge: {
    padding: '6px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    textAlign: 'center',
    display: 'inline-block',
    minWidth: '70px',
  },
  noData: {
    padding: '60px 20px',
    textAlign: 'center',
    color: '#6b7280',
  },
  noDataText: {
    fontSize: '16px',
    marginBottom: '16px',
  },
  clearSearchButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: '#6b7280',
  },
  spinner: {
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px',
  },
  loadingText: {
    fontSize: '16px',
    fontWeight: '500',
  },
  errorContainer: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#6b7280',
  },
  errorTitle: {
    color: '#dc2626',
    marginBottom: '12px',
    fontSize: '20px',
  },
  errorText: {
    marginBottom: '20px',
    fontSize: '16px',
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
  },
};

export default ZipManagement;
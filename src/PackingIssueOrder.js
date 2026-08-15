// src/PackingIssueOrder.jsx
import React, { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** ========= CONFIG ========= */
const API_KEY = "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk"; // same as MSO if you reuse JobOrder lookup
const SHEET_ID = "1fKSwGBIpzWEFk566WRQ4bzQ0anJlmasoY8TwrTLQHXI"; // JobOrder sheet id
const JOB_ORDER_RANGE = "JobOrder!A:Z";

// IMPORTANT: use the unified Apps Script Web App you showed earlier (with CORS helper)
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbznVnm1s0WoBSzQObJHfqmQpICsAcs77t_UqYWtVfYQMa2troYlmUTaP0Q5agSe58_Iqw/exec";

export default function PackingIssueOrder({ supervisor, fallbackPath = "/" }) {
  /** ------- FORM STATE ------- */
  const [orderNo, setOrderNo] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [brand, setBrand] = useState("");
  const [garmentType, setGarmentType] = useState("");
  const [qty, setQty] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [remarks, setRemarks] = useState("");

  const [acc, setAcc] = useState({
    tag: false,
    tagDori: false,
    polyBag: false,
    doriLower: false, // DORI LOWER / SW
  });

  /** ------- UX STATE ------- */
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [activeTab, setActiveTab] = useState("basic");

  /** ------- PSO NUMBER (PSO-YYYYMMDD-###) ------- */
  useEffect(() => {
    const generateOrderNo = () => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const rand = Math.floor(Math.random() * 900) + 100;
      setOrderNo(`PSO-${y}${m}${dd}-${rand}`);
    };
    generateOrderNo();
  }, []);

  /** ------- JOB ORDER LOOKUP (same pattern as MSO) ------- */
  const fetchJobOrder = async (lot) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
      JOB_ORDER_RANGE
    )}?key=${API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to read Job Order (${res.status})`);
    const data = await res.json();
    const rows = data?.values || [];
    if (rows.length < 2) throw new Error("Job Order sheet is empty");

    const head = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
    const idxOf = (label) => head.findIndex((h) => h === label.toLowerCase());

    const colLot = idxOf("lot number");
    if (colLot === -1) throw new Error('Column "Lot Number" not found');

    const colBrand = idxOf("brand");
    const colGType = idxOf("garment type");

    const body = rows.slice(1);
    const norm = (s) => String(s ?? "").trim().toLowerCase();

    const row = body.find((r) => norm(r[colLot]) === norm(lot));
    if (!row) throw new Error(`Lot ${lot} not found`);

    return {
      brand: colBrand !== -1 ? String(row[colBrand] ?? "") : "",
      garmentType: colGType !== -1 ? String(row[colGType] ?? "") : "",
    };
  };

  const handleFetch = async () => {
    if (!lotNo.trim()) {
      setLookupErr("Enter Lot Number first");
      return;
    }
    setLookupErr("");
    setLoadingLookup(true);
    setBrand("");
    setGarmentType("");

    try {
      const out = await fetchJobOrder(lotNo.trim());
      setBrand(out.brand || "");
      setGarmentType(out.garmentType || "");
      if (!out.brand && !out.garmentType)
        setLookupErr("Found lot but Brand/Garment Type are empty");
    } catch (e) {
      setLookupErr(e.message || "Lookup failed");
    } finally {
      setLoadingLookup(false);
    }
  };

  /** ------- VALIDATE & SUBMIT ------- */
  const validate = () => {
    if (!lotNo.trim()) return "Lot Number is required";
    if (!brand.trim()) return "Brand is required";
    if (!garmentType.trim()) return "Garment Type is required";
    if (!qty || Number(qty) <= 0) return "Valid Quantity is required";
    return "";
  };

  const handleBack = () => {
    try {
      if (window && window.history && window.history.length > 1) {
        window.history.back();
      } else {
        window.location.assign(fallbackPath);
      }
    } catch {
      window.location.assign(fallbackPath);
    }
  };

  const onSubmit = async () => {
    setSaveErr("");
    setSaveMsg("");
    const v = validate();
    if (v) {
      setSaveErr(v);
      return;
    }

    // Map UI keys -> sheet headers
    const labelMap = {
      tag: "TAG",
      tagDori: "TAG DORI",
      polyBag: "POLY BAG",
      doriLower: "DORI LOWER / SW",
    };

    const accessories = Object.entries(acc)
      .filter(([, val]) => val)
      .map(([k]) => labelMap[k]);

    const payload = {
      orderNo,
      lotNo: lotNo.trim(),
      brand: brand.trim(),
      garmentType: garmentType.trim(),
      quantity: String(qty),
      unit: "PCS",
      priority,
      accessories,
      remarks,
      createdBy: supervisor?.name || "Stitching Supervisor",
      createdAt: new Date().toISOString(),
    };

    try {
      // ✅ IMPORTANT: text/plain avoids preflight (hence no Apps Script OPTIONS headache)
      const res = await fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "submitPackingOrder", data: payload }),
        redirect: "follow",
      });

      // If Apps Script throws, Chrome may mark it as CORS—guard with robust parsing:
      let out;
      try {
        out = await res.json();
      } catch {
        const text = await res.text();
        throw new Error(`Unexpected response: ${text?.slice(0, 200)}`);
      }

      if (!res.ok || out.status !== "ok") {
        throw new Error(out?.message || `HTTP ${res.status}`);
      }

      // ✅ Generate PDF after successful save
      generatePdf(payload);
      setSaveMsg("Packing order saved to Sheet & PDF downloaded successfully!");
    } catch (err) {
      setSaveErr("Failed to save order: " + (err?.message || String(err)));
    }
  };

  const resetForm = () => {
    setLotNo("");
    setBrand("");
    setGarmentType("");
    setQty("");
    setPriority("Normal");
    setRemarks("");
    setAcc({
      tag: false,
      tagDori: false,
      polyBag: false,
      doriLower: false,
    });
    // Generate new PSO number
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900) + 100;
    setOrderNo(`PSO-${y}${m}${dd}-${rand}`);
    setSaveErr("");
    setSaveMsg("");
    setActiveTab("basic");
  };

  /** ------- PDF GENERATION (simple, tweak as you like) ------- */
  function generatePdf({
  orderNo,
  lotNo,
  brand,
  garmentType,
  quantity,
  unit,
  priority,
  accessories, // expect ["TAG","TAG DORI","POLY BAG","DORI LOWER / SW"]
  remarks,
  createdBy,
  createdAt,
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // helpers
  const M = 36;
  const BORDER_INSET = 14;
  const line = (x1, y1, x2, y2, w = 1) => { doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const rect = (x, y, w, h, wid = 1) => { doc.setLineWidth(wid); doc.rect(x, y, w, h); };
  const drawCheck = (x, y) => { doc.setLineWidth(2); line(x - 8, y + 2, x - 3, y + 8); line(x - 3, y + 8, x + 10, y - 6); doc.setLineWidth(1); };
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // border
  rect(BORDER_INSET, BORDER_INSET, W - 2 * BORDER_INSET, H - 2 * BORDER_INSET, 1.2);

  // header (only the title text differs)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("PO No.PSO", M, M + 2);
  doc.setFontSize(18);
  doc.text("PACKING MATERIAL ISSUE ORDER", W / 2, M + 16, { align: "center" });

  // left meta (same layout)
  const leftX = M;
  let y = M + 56;
  const rowGap = 26, labelW = 74, valueW = 140;

  const drawField = (label, value = "") => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label, leftX, y);
    const lx1 = leftX + labelW, lx2 = leftX + labelW + valueW, underlineY = y + 3;
    line(lx1, underlineY, lx2, underlineY, 0.9);
    if (value) { doc.setFont("helvetica", "normal"); doc.text(String(value), lx1 + 4, y); }
    y += rowGap;
  };

  const dateVal = createdAt ? new Date(createdAt) : new Date();
  const dateStr = new Intl.DateTimeFormat("en-GB").format(dateVal);
  const qtyStr = [quantity || "", unit || ""].join(" ").trim();

  drawField("Date:", dateStr);
  drawField("Lot No.:", lotNo || "");
  drawField("Item.:", (garmentType || "").toString().toUpperCase());
  drawField("Qty.:", qtyStr);
  drawField("Brand", brand || "");
  drawField("HEAD", remarks || "");

  // right tiles (same positions, packing labels swapped in)
  const picked = (accessories || []).map(norm);
  const pickSet = new Set(picked);

  const Tx = W - M - 260, Ty = M + 50, Tw = 125, Th = 72, Gx = 25, Gy = 25;

  const tile = (label, i, j) => {
    const x = Tx + i * (Tw + Gx);
    const yy = Ty + j * (Th + Gy);
    doc.setFillColor(255, 255, 255);
    doc.rect(x, yy, Tw, Th, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(label, x + Tw / 2, yy + Th / 2 + 5, { align: "center" });
  };

  // Row 1
  tile("TAG", 0, 0);
  tile("POLY BAG", 1, 0);

  // Row 2 (centered)
  const centerOffsetX = (Tw + Gx) / 2;
  const centerX = Tx + centerOffsetX;
  const centerY = Ty + (Th + Gy);
  doc.setFillColor(255, 255, 255);
  rect(centerX, centerY, Tw, Th, 1.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("TAG DORI", centerX + Tw / 2, centerY + Th / 2 + 5, { align: "center" });

  // table (same columns/widths)
  const tableTop = y + 12;
  const c1 = 60, c2 = 120, cSel = 70, c3 = 100, c4 = 90, c5 = 90;
  const cols = [c1, c2, cSel, c3, c4, c5];
  const tableW = cols.reduce((a, b) => a + b, 0);
  const X = M;

  const headerH = 28;
  rect(X, tableTop, tableW, headerH, 1.2);
  const headTexts = ["Sr. No.","ITEM NAME","SELECTED","DATE OF GIVEN","QTY RECD.","RECIEVER SIGN"];
  let cx = X;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  headTexts.forEach((t, i) => {
    if (i > 0) line(cx, tableTop, cx, tableTop + headerH, 1.2);
    doc.text(t, cx + 8, tableTop + 18);
    cx += cols[i];
  });

  const rows = ["TAG","TAG DORI","POLY BAG","DORI LOWER / SW"];
  let by = tableTop + headerH, rowH = 120;
  rows.forEach((name, i) => {
    rect(X, by, tableW, rowH, 1.0);
    let vx = X;
    cols.forEach((w, k) => { if (k > 0) line(vx, by, vx, by + rowH, 1.0); vx += w; });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(String(i + 1), X + 8, by + 24);
    doc.text(name, X + c1 + 8, by + 24);
    if (pickSet.has(norm(name))) {
      const selCenterX = X + c1 + c2 + cSel / 2;
      const selCenterY = by + rowH / 2;
      drawCheck(selCenterX, selCenterY);
    }
    by += rowH;
  });

  // footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const footer = [
    orderNo ? `PSO: ${orderNo}` : null,
    priority ? `Priority: ${priority}` : null,
    createdBy ? `Prepared by: ${createdBy}` : null,
  ].filter(Boolean).join(" • ");
  if (footer) doc.text(footer, X, by + 22);

  // save
  const fname = `PSO_${(orderNo || "draft").toString().replace(/[^\w-]/g, "")}.pdf`;
  doc.save(fname);
}

  /** ------- MODERN STYLES (matching your MSO look) ------- */
  const styles = {
    container: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0d2d42ff 0%, #551b5aff 100%)",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      padding: "20px",
    },
    glassCard: {
      backdropFilter: "blur(20px)",
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderRadius: "24px",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      boxShadow: "0 25px 50px rgba(0, 0, 0, 0.15)",
      overflow: "hidden",
      margin: "20px auto",
      maxWidth: "1200px",
      
    },
    header: {
      background: "linear-gradient(135deg, #4744efff 0%, #2516f9ff 100%)",
      padding: "40px 50px 30px",
      color: "white",
      position: "relative",
    },
    backBtn: {
      position: "absolute",
      top: "30px",
      left: "30px",
      background: "rgba(255, 255, 255, 0.15)",
      border: "1px solid rgba(255, 255, 255, 0.3)",
      borderRadius: "12px",
      padding: "12px 20px",
      color: "white",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "14px",
      fontWeight: "600",
      transition: "all 0.3s ease",
      backdropFilter: "blur(10px)",
    },
    backBtnHover: {
      background: "rgba(255, 255, 255, 0.25)",
      transform: "translateY(-2px)",
    },
    titleSection: { textAlign: "center", marginTop: "20px" },
    title: {
      fontSize: "2.6rem",
      fontWeight: "800",
      margin: "0 0 12px 0",
      background: "linear-gradient(45deg, #fff, #ffe4e6)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
    },
    subtitle: { fontSize: "1.2rem", opacity: "0.9", fontWeight: "300", margin: "0" },
    tabContainer: {
      display: "flex",
      background: "rgba(255, 255, 255, 0.1)",
      borderRadius: "16px",
      padding: "8px",
      margin: "30px 50px 0",
      backdropFilter: "blur(10px)",
    },
    tab: {
      flex: 1,
      padding: "16px 24px",
      textAlign: "center",
      borderRadius: "12px",
      cursor: "pointer",
      fontWeight: "600",
      fontSize: "15px",
      transition: "all 0.3s ease",
      color: "rgba(255, 255, 255, 0.8)",
    },
    activeTab: {
      background: "rgba(255, 255, 255, 0.2)",
      color: "white",
      boxShadow: "0 4px 15px rgba(0, 0, 0, 0.1)",
    },
    content: { padding: "50px" },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
      gap: "32px",
      marginBottom: "40px",
    },
    field: { display: "flex", flexDirection: "column", gap: "12px" },
    label: { fontSize: "14px", fontWeight: "600", color: "#374151", display: "flex", alignItems: "center", gap: "8px" },
    input: {
      padding: "18px 20px",
      border: "2px solid #e5e7eb",
      borderRadius: "14px",
      fontSize: "15px",
      transition: "all 0.3s ease",
      background: "white",
      outline: "none",
      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.02)",
    },
    inputFocus: {
      borderColor: "#ef4444",
      boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.15)",
      transform: "translateY(-2px)",
    },
    accessoriesSection: {
      background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
      borderRadius: "20px",
      padding: "32px",
      border: "1px solid #e2e8f0",
      marginBottom: "40px",
    },
    sectionTitle: { fontSize: "20px", fontWeight: "700", color: "#1f2937", marginBottom: "24px", display: "flex", alignItems: "center", gap: "12px" },
    checkboxGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" },
    checkboxItem: {
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "20px 24px",
      border: "2px solid #e5e7eb",
      borderRadius: "16px",
      backgroundColor: "white",
      cursor: "pointer",
      transition: "all 0.3s ease",
      position: "relative",
      overflow: "hidden",
    },
    checkboxItemHover: {
      borderColor: "#ef4444",
      transform: "translateY(-3px)",
      boxShadow: "0 12px 25px rgba(239, 68, 68, 0.15)",
    },
    checkboxItemSelected: {
      borderColor: "#10b981",
      backgroundColor: "#f0fdf4",
      transform: "translateY(-3px)",
      boxShadow: "0 12px 25px rgba(16, 185, 129, 0.15)",
    },
    actions: { display: "flex", gap: "20px", justifyContent: "center", marginTop: "40px" },
    primaryBtn: {
      padding: "20px 48px",
      background: "linear-gradient(135deg, #ef4444, #f97316)",
      color: "white",
      border: "none",
      borderRadius: "16px",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.3s ease",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      boxShadow: "0 8px 20px rgba(239, 68, 68, 0.3)",
    },
    primaryBtnHover: { transform: "translateY(-4px)", boxShadow: "0 15px 30px rgba(249, 115, 22, 0.4)" },
    secondaryBtn: {
      padding: "20px 48px",
      backgroundColor: "transparent",
      color: "#6b7280",
      border: "2px solid #d1d5db",
      borderRadius: "16px",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.3s ease",
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },
    secondaryBtnHover: { borderColor: "#ef4444", color: "#ef4444", transform: "translateY(-2px)", boxShadow: "0 6px 15px rgba(239, 68, 68, 0.1)" },
    error: {
      padding: "18px 22px",
      backgroundColor: "#fef2f2",
      border: "1px solid #fecaca",
      borderRadius: "14px",
      color: "#dc2626",
      marginTop: "24px",
      fontSize: "14px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      animation: "shake 0.5s ease-in-out",
    },
    success: {
      padding: "18px 22px",
      backgroundColor: "#f0fdf4",
      border: "1px solid #bbf7d0",
      borderRadius: "14px",
      color: "#166534",
      marginTop: "24px",
      fontSize: "14px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      animation: "bounceIn 0.6s ease",
    },
  };

  // Hover states
  const [hoverStates, setHoverStates] = useState({
    searchBtn: false,
    primaryBtn: false,
    secondaryBtn: false,
    backBtn: false,
    checkboxes: {},
    inputs: {},
  });

  const handleMouseEnter = (element) => setHoverStates((p) => ({ ...p, [element]: true }));
  const handleMouseLeave = (element) => setHoverStates((p) => ({ ...p, [element]: false }));
  const handleCheckboxHover = (key, isHovering) =>
    setHoverStates((p) => ({ ...p, checkboxes: { ...p.checkboxes, [key]: isHovering } }));
  const handleInputFocus = (key, isFocused) =>
    setHoverStates((p) => ({ ...p, inputs: { ...p.inputs, [key]: isFocused } }));

  /** ------- MODERN UI ------- */
  return (
    <div style={styles.container}>
      <div style={styles.glassCard}>
        {/* Header Section */}
        <div style={styles.header}>
          <button
            type="button"
            onClick={handleBack}
            style={{ ...styles.backBtn, ...(hoverStates.backBtn && styles.backBtnHover) }}
            onMouseEnter={() => handleMouseEnter("backBtn")}
            onMouseLeave={() => handleMouseLeave("backBtn")}
            aria-label="Go back"
            title="Go back"
          >
            <span style={{ fontSize: 18 }}>←</span>
            <span>Back to Dashboard</span>
          </button>

          <div style={styles.titleSection}>
            <h1 style={styles.title}>Packing Issue Order</h1>
            <p style={styles.subtitle}>Create packing material issue orders with auto lookup</p>
          </div>

          {/* Navigation Tabs */}
          <div style={styles.tabContainer}>
            <div
              style={{ ...styles.tab, ...(activeTab === "basic" && styles.activeTab) }}
              onClick={() => setActiveTab("basic")}
            >
              📋 Basic Information
            </div>
            <div
              style={{ ...styles.tab, ...(activeTab === "accessories" && styles.activeTab) }}
              onClick={() => setActiveTab("accessories")}
            >
              🎁 Packing Items
            </div>
            <div
              style={{ ...styles.tab, ...(activeTab === "review" && styles.activeTab) }}
              onClick={() => setActiveTab("review")}
            >
              👁️ Review & Submit
            </div>
          </div>
        </div>

        {/* Form Content */}
        <div style={styles.content}>
          {/* Basic Information Tab */}
          {activeTab === "basic" && (
            <div>
              <div style={styles.formGrid}>
                <div style={styles.field}>
                  <label style={styles.label}>
                    <span>🔢</span>
                    PSO Reference Number
                  </label>
                  <input
                    style={{ ...styles.input, ...(hoverStates.inputs.orderNo && styles.inputFocus) }}
                    value={orderNo}
                    readOnly
                    onFocus={() => handleInputFocus("orderNo", true)}
                    onBlur={() => handleInputFocus("orderNo", false)}
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    <span>🏷️</span>
                    Lot Number *
                  </label>
                  <div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <input
                        style={{ ...styles.input, ...(hoverStates.inputs.lotNo && styles.inputFocus) }}
                        value={lotNo}
                        placeholder="e.g., 64003"
                        onChange={(e) => setLotNo(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                        onFocus={() => handleInputFocus("lotNo", true)}
                        onBlur={() => handleInputFocus("lotNo", false)}
                      />
                      <button
                        type="button"
                        style={
                          loadingLookup || !lotNo
                            ? { ...styles.primaryBtn, opacity: 0.5, cursor: "not-allowed" }
                            : { ...styles.primaryBtn, ...(hoverStates.searchBtn && styles.primaryBtnHover) }
                        }
                        onClick={handleFetch}
                        disabled={!lotNo || loadingLookup}
                        onMouseEnter={() => handleMouseEnter("searchBtn")}
                        onMouseLeave={() => handleMouseLeave("searchBtn")}
                      >
                        <span>🔍</span>
                        {loadingLookup ? "Searching..." : "Fetch Details"}
                      </button>
                    </div>
                    {lookupErr && (
                      <div style={{ marginTop: 10, color: "#dc2626", fontWeight: 600 }}>{lookupErr}</div>
                    )}
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    <span>🏢</span>
                    Brand *
                  </label>
                  <input style={styles.input} value={brand} readOnly placeholder="Auto-filled from Job Order" />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    <span>👕</span>
                    Garment Type *
                  </label>
                  <input style={styles.input} value={garmentType} readOnly placeholder="Auto-filled from Job Order" />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    <span>📦</span>
                    Required Quantity *
                  </label>
                  <input
                    type="number"
                    style={{ ...styles.input, ...(hoverStates.inputs.qty && styles.inputFocus) }}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="e.g., 500"
                    onFocus={() => handleInputFocus("qty", true)}
                    onBlur={() => handleInputFocus("qty", false)}
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>
                    <span>🎯</span>
                    Priority Level
                  </label>
                  <select style={styles.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="High">🚨 High Priority</option>
                    <option value="Normal">✅ Normal Priority</option>
                    <option value="Low">💤 Low Priority</option>
                  </select>
                </div>
              </div>

              <div style={styles.actions}>
                <button
                  style={{ ...styles.primaryBtn, ...(hoverStates.primaryBtn && styles.primaryBtnHover) }}
                  onClick={() => setActiveTab("accessories")}
                  onMouseEnter={() => handleMouseEnter("primaryBtn")}
                  onMouseLeave={() => handleMouseLeave("primaryBtn")}
                >
                  <span>➡️</span>
                  Continue to Packing Items
                </button>
              </div>
            </div>
          )}

          {/* Accessories/Packing Items Tab */}
          {activeTab === "accessories" && (
            <div>
              <div style={styles.accessoriesSection}>
                <h3 style={styles.sectionTitle}>
                  <span>🎁</span>
                  Packing Items
                  <span style={{ fontSize: "14px", color: "#6b7280", marginLeft: "12px" }}>
                    Select required packing materials
                  </span>
                </h3>
                <div style={styles.checkboxGrid}>
                  {[
                    ["tag", "TAG", "🏷️", "Main hang tag"],
                    ["tagDori", "TAG DORI", "🧵", "String for tag"],
                    ["polyBag", "POLY BAG", "🛍️", "Transparent packing bag"],
                    ["doriLower", "DORI LOWER / SW", "📎", "Lower dori / SW"],
                  ].map(([key, text, emoji, desc]) => (
                    <label
                      key={key}
                      style={{
                        ...styles.checkboxItem,
                        ...(hoverStates.checkboxes[key] && styles.checkboxItemHover),
                        ...(acc[key] && styles.checkboxItemSelected),
                      }}
                      onMouseEnter={() => handleCheckboxHover(key, true)}
                      onMouseLeave={() => handleCheckboxHover(key, false)}
                    >
                      <input
                        type="checkbox"
                        checked={!!acc[key]}
                        onChange={() => setAcc((a) => ({ ...a, [key]: !a[key] }))}
                        style={{ display: "none" }}
                      />
                      <span style={{ fontSize: "20px" }}>{emoji}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span
                          style={{
                            fontWeight: "600",
                            color: acc[key] ? "#065f46" : "#1f2937",
                            fontSize: "15px",
                          }}
                        >
                          {text}
                        </span>
                        <span style={{ fontSize: "12px", color: acc[key] ? "#059669" : "#6b7280" }}>{desc}</span>
                      </div>
                      {acc[key] && (
                        <span style={{ marginLeft: "auto", color: "#10b981", fontWeight: "bold", fontSize: "18px" }}>
                          ✓
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div style={styles.actions}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => setActiveTab("basic")}
                  onMouseEnter={() => handleMouseEnter("secondaryBtn")}
                  onMouseLeave={() => handleMouseLeave("secondaryBtn")}
                >
                  <span>⬅️</span>
                  Back to Basic Info
                </button>
                <button
                  style={{ ...styles.primaryBtn, ...(hoverStates.primaryBtn && styles.primaryBtnHover) }}
                  onClick={() => setActiveTab("review")}
                  onMouseEnter={() => handleMouseEnter("primaryBtn")}
                  onMouseLeave={() => handleMouseLeave("primaryBtn")}
                >
                  <span>👁️</span>
                  Review Order
                </button>
              </div>
            </div>
          )}

          {/* Review & Submit Tab */}
          {activeTab === "review" && (
            <div>
              <div style={styles.accessoriesSection}>
                <h3 style={styles.sectionTitle}>
                  <span>👁️</span>
                  Order Review
                  <span style={{ fontSize: "14px", color: "#6b7280", marginLeft: "12px" }}>
                    Verify all information before generating PDF
                  </span>
                </h3>

                <div style={styles.formGrid}>
                  <div style={styles.field}>
                    <strong style={styles.label}>PSO Number:</strong>
                    <div style={styles.input}>{orderNo}</div>
                  </div>
                  <div style={styles.field}>
                    <strong style={styles.label}>Lot Number:</strong>
                    <div style={styles.input}>{lotNo}</div>
                  </div>
                  <div style={styles.field}>
                    <strong style={styles.label}>Brand:</strong>
                    <div style={styles.input}>{brand}</div>
                  </div>
                  <div style={styles.field}>
                    <strong style={styles.label}>Garment Type:</strong>
                    <div style={styles.input}>{garmentType}</div>
                  </div>
                  <div style={styles.field}>
                    <strong style={styles.label}>Quantity:</strong>
                    <div style={styles.input}>{qty} PCS</div>
                  </div>
                  <div style={styles.field}>
                    <strong style={styles.label}>Priority:</strong>
                    <div style={styles.input}>{priority}</div>
                  </div>
                </div>

                <div style={{ marginTop: "24px" }}>
                  <strong style={styles.label}>Selected Items:</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                    {Object.entries(acc)
                      .filter(([, val]) => val)
                      .map(([key]) => (
                        <span
                          key={key}
                          style={{
                            padding: "8px 16px",
                            background: "linear-gradient(135deg, #10b981, #059669)",
                            color: "white",
                            borderRadius: "20px",
                            fontSize: "14px",
                            fontWeight: "600",
                          }}
                        >
                          {(
                            {
                              tag: "TAG",
                              tagDori: "TAG DORI",
                              polyBag: "POLY BAG",
                              doriLower: "DORI LOWER / SW",
                            }[key]
                          ) || key}
                        </span>
                      ))}
                    {Object.values(acc).filter(Boolean).length === 0 && (
                      <span style={{ color: "#6b7280", fontStyle: "italic" }}>No items selected</span>
                    )}
                  </div>
                </div>

                {remarks && (
                  <div style={{ marginTop: "24px" }}>
                    <strong style={styles.label}>Remarks:</strong>
                    <div
                      style={{
                        ...styles.input,
                        minHeight: 100,
                        backgroundColor: "#f8fafc",
                        borderColor: "#e5e7eb",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {remarks}
                    </div>
                  </div>
                )}
              </div>

              {saveErr && <div style={styles.error}><span>❌</span>{saveErr}</div>}
              {saveMsg && <div style={styles.success}><span>✅</span>{saveMsg}</div>}

              <div style={styles.actions}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => setActiveTab("accessories")}
                  onMouseEnter={() => handleMouseEnter("secondaryBtn")}
                  onMouseLeave={() => handleMouseLeave("secondaryBtn")}
                >
                  <span>⬅️</span>
                  Back to Items
                </button>
                <button
                  style={{ ...styles.primaryBtn, ...(hoverStates.primaryBtn && styles.primaryBtnHover) }}
                  onClick={onSubmit}
                  onMouseEnter={() => handleMouseEnter("primaryBtn")}
                  onMouseLeave={() => handleMouseLeave("primaryBtn")}
                >
                  <span>📄</span>
                  Generate & Download PDF
                </button>
                <button
                  style={styles.secondaryBtn}
                  onClick={resetForm}
                  onMouseEnter={() => handleMouseEnter("secondaryBtn")}
                  onMouseLeave={() => handleMouseLeave("secondaryBtn")}
                >
                  <span>🔄</span>
                  New Order
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>
        {`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
          }
          @keyframes bounceIn {
            0% { transform: scale(0.3); opacity: 0; }
            50% { transform: scale(1.05); }
            70% { transform: scale(0.9); }
            100% { transform: scale(1); opacity: 1; }
          }
          input:focus, textarea:focus, select:focus {
            border-color: #ef4444 !important;
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12) !important;
            transform: translateY(-2px);
          }
          body { margin: 0; padding: 0; background: linear-gradient(135deg, #FF9966 0%, #FF5E62 100%); }
        `}
      </style>
    </div>
  );
}

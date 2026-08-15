// src/Welcome.js
import React, { useEffect, useMemo, useState } from "react";

// Stitching Supervisor specific navigation (same data, enhanced)
const STITCHING_SUPERVISOR_OPTIONS = [
  {
    id: "daily-report",
    label: "Daily Report",
    emoji: "📊",
    component: "DailyReport",
    description: "View and submit daily stitching reports with production metrics",
    color: "#1E40AF",
    instructions: [
      "Track daily production output",
      "Monitor quality metrics",
      "Submit end-of-day reports"
    ]
  },
  {
    id: "issue",
    label: "Issue to Stitching",
    emoji: "🚚",
    component: "IssueToStitching",
    description: "Manage fabric and accessory issues to stitching lines",
    color: "#2563EB",
    instructions: [
      "Issue raw materials to lines",
      "Track material consumption",
      "Manage inventory levels"
    ]
  },
  {
    id: "rate-list",
    label: "Rate List",
    emoji: "💰",
    component: "RateList",
    description: "Maintain and review stitching rate list and pricing",
    color: "#0284C7",
    instructions: [
      "Update operation rates",
      "Review pricing structures",
      "Manage operator payments"
    ]
  },
  {
    id: "material-stitching-order",
    label: "Material Stitching Order",
    emoji: "🧵",
    component: "MaterialStitchingOrder",
    description: "Create and track material orders for stitching operations",
    color: "#0EA5E9",
    instructions: [
      "Create material requests",
      "Track order status",
      "Manage delivery schedules"
    ]
  },
  {
    id: "zip",
    label: "Zip Management",
    emoji: "🤐",
    component: "ZipManagement",
    description: "Manage zip inventory, orders and consumption tracking",
    color: "#1D4ED8",
    instructions: [
      "Track zip inventory levels",
      "Place zip orders with suppliers",
      "Monitor zip consumption per style",
      "Manage zip quality control"
    ]
  },
  {
    id: "dori",
    label: "Dori Management",
    emoji: "🎀",
    component: "DoriManagement",
    description: "Manage dori (drawstring) inventory and order processing",
    color: "#3B82F6",
    instructions: [
      "Monitor dori stock levels",
      "Process dori material orders",
      "Track dori usage per garment",
      "Manage dori color and size variants"
    ]
  },
  {
    id: "daily-updation",
    label: "Daily Updation",
    emoji: "🔄",
    component: "DailyUpdationSystem",
    description: "Real-time production tracking and daily progress updates",
    color: "#0F172A",
    instructions: [
      "Update real-time production progress",
      "Track hourly output targets",
      "Monitor line efficiency metrics",
      "Generate shift-wise performance reports"
    ]
  },
  {
    id: "alter-job-order",
    label: "Alter Job Order",
    emoji: "✂️",
    component: "AlterJobOrder",
    description: "Manage alteration job orders and track modification requests",
    color: "#2563EB",
    instructions: [
      "Create alteration job orders",
      "Track modification requests",
      "Monitor alteration progress",
      "Manage customer alteration requirements"
    ]
  },
  {
    id: "palla-job-order",
    label: "Palla Job Order",
    emoji: "🧣",
    component: "PallaJobOrder",
    description: "Create and manage palla job orders for specialized stitching",
    color: "#0369A1",
    instructions: [
      "Create new palla job orders",
      "Assign palla work to karigars",
      "Track palla production progress",
      "Manage palla material requirements"
    ]
  },
  {
    id: "extra-pcs",
    label: "Extra Pcs",
    emoji: "➕",
    component: "Extrapcs",
    description: "Manage extra piece production and inventory corrections",
    color: "#1E3A8A",
    instructions: [
      "Track extra piece production",
      "Manage adjustment entries",
      "Record damage replacements",
      "Handle special requests"
    ]
  },
  {
    id: "create-karigar-profile",
    label: "Karigar Profile",
    emoji: "👤",
    component: "CreateKarigarProfile",
    description: "Create and manage artisan profiles with skills details",
    color: "#1E40AF",
    instructions: [
      "Register new karigar profiles",
      "Capture skill sets",
      "Store contact information",
      "Track experience levels"
    ]
  },
  {
    id: "enter-karigar-details",
    label: "Karigar Details",
    emoji: "✍️",
    component: "EnterKarigarDetails",
    description: "Record daily work details and production entries",
    color: "#2563EB",
    instructions: [
      "Record daily production entries",
      "Track work hours",
      "Enter piece-rate calculations",
      "Monitor performance"
    ]
  },
  {
    id: "update-lot-completion",
    label: "Lot Completion",
    emoji: "✅",
    component: "UpdateLotCompletion",
    description: "Update and track lot completion status",
    color: "#0EA5E9",
    instructions: [
      "Update lot completion status",
      "Track completed vs pending lots",
      "Monitor lot progress",
      "Generate completion reports"
    ]
  },
  {
    id: "karigar-lot-detail",
    label: "Karigar Lot Detail",
    emoji: "📋",
    component: "KarigarLotDetail",
    description: "View and manage detailed lot-wise karigar production tracking",
    color: "#1D4ED8",
    instructions: [
      "Track lot assignments per karigar",
      "Monitor lot-wise production progress",
      "View detailed karigar performance by lot",
      "Manage lot completion metrics"
    ]
  },
   {
    id: "thekedar-payment",
    label: "Thekedar Payment",
    emoji: "👨‍💼",
    component: "supervisorPayment",
    description: "Manage Thekedar and Supervisor payments, track dues and payment schedules",
    color: "#0F172A",
    instructions: [
      "Process Thekedar payment requests",
      "Track supervisor payment schedules",
      "Manage pending dues",
      "Generate payment receipts"
    ]
  },
];

// Google Sheets configuration
const GOOGLE_SHEETS_CONFIG = {
  API_KEY: "AIzaSyAomDFBkOySlIxKWSKGHe6ATv9gvaBr7uk",
  SPREADSHEET_ID: "1iBDfsxA9XEC9nhQE-ALBYlyGRZWOaCYvWsnGfYYbr1I",
  RANGE: "StitchingSupervisors!A:D",
};

export default function Welcome({ onNavigate }) {
  const [stitchingSupervisors, setStitchingSupervisors] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [hoveredCard, setHoveredCard] = useState(null);

  // Load supervisors from Google Sheets
  useEffect(() => {
    const load = async () => {
      try {
        setSheetLoading(true);
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.RANGE}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch data");
        const data = await response.json();

        if (!data.values || data.values.length === 0)
          throw new Error("No data found");

        const supervisors = data.values.slice(1).map((row, index) => ({
          id: row[0] || `supervisor-${index}`,
          username: row[1] || "",
          password: row[2] || "",
          name: row[3] || "Stitching Supervisor",
          role: "Stitching Supervisor",
          emoji: "👨‍💼",
          avatarColor: getColorGradient(index),
        }));

        setStitchingSupervisors(supervisors);
      } catch (err) {
        console.error("Error fetching supervisors:", err);
        setStitchingSupervisors([
          { id: "ss1", username: "supervisor", password: "stitch123", name: "Stitching Supervisor", role: "Stitching Supervisor", emoji: "👨‍💼", avatarColor: "#1E40AF" },
          { id: "ss2", username: "manager", password: "stitch456", name: "Line Manager", role: "Stitching Supervisor", emoji: "👔", avatarColor: "#2563EB" },
        ]);
      } finally {
        setSheetLoading(false);
      }
    };
    load();
  }, []);

  // Restore authentication
  useEffect(() => {
    if (!stitchingSupervisors.length) return;
    const isAuth = localStorage.getItem("stitching:authenticated") === "true";
    const authUser = localStorage.getItem("stitching:authenticatedUser");
    if (isAuth && authUser) {
      const user = stitchingSupervisors.find((s) => s.username === authUser);
      if (user) {
        setUsername(user.username);
        setIsAuthenticated(true);
      }
    }
  }, [stitchingSupervisors]);

  const currentSupervisor = useMemo(
    () => stitchingSupervisors.find((s) => s.username === username),
    [stitchingSupervisors, username]
  );

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsLoading(true);
    if (!username) { setAuthError("Please select your username"); setIsLoading(false); return; }
    if (!password) { setAuthError("Please enter your password"); setIsLoading(false); return; }
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (currentSupervisor && password === currentSupervisor.password) {
      setIsAuthenticated(true);
      setAuthError("");
      localStorage.setItem("stitching:authenticated", "true");
      localStorage.setItem("stitching:authenticatedUser", username);
    } else {
      setAuthError("Invalid username or password");
      setPassword("");
    }
    setIsLoading(false);
  };

  const handleLogout = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsAuthenticated(false);
      setUsername("");
      setPassword("");
      setAuthError("");
      setIsExiting(false);
      localStorage.removeItem("stitching:authenticated");
      localStorage.removeItem("stitching:authenticatedUser");
    }, 300);
  };

  const handleNavigation = (option) => {
    setIsExiting(true);
    setTimeout(() => {
      if (onNavigate) {
        onNavigate(option.component, currentSupervisor);
      }
    }, 400);
  };

  return (
    <div style={styles.page}>
      {/* Modern floating background elements */}
      <div style={styles.bgOrb1}></div>
      <div style={styles.bgOrb2}></div>
      <div style={styles.bgGrid}></div>

      <div style={{ ...styles.container, ...(isExiting ? styles.containerExiting : {}) }}>
        {/* Glassmorphic Header */}
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div style={styles.logoArea}>
              <div style={styles.logoIcon}>
                <span>🏭</span>
              </div>
              <div>
                <h1 style={styles.logoText}>MH Stitching</h1>
                <p style={styles.logoTagline}>Supervisor Command Center</p>
              </div>
            </div>
            {isAuthenticated && (
              <div style={styles.userArea}>
                <div style={styles.userCard}>
                  <div style={{ ...styles.userAvatar, background: currentSupervisor?.avatarColor || "#667eea" }}>
                    {currentSupervisor?.emoji || "👨‍💼"}
                  </div>
                  <div style={styles.userMeta}>
                    <p style={styles.userName}>{currentSupervisor?.name}</p>
                    <p style={styles.userRole}>Stitching Supervisor</p>
                  </div>
                </div>
                <button onClick={handleLogout} style={styles.logoutButton}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Exit
                </button>
              </div>
            )}
          </div>
        </header>

        <main style={styles.main}>
          {!isAuthenticated ? (
            // Modern Split-Screen Login Experience
            <div style={styles.loginWrapper}>
              {sheetLoading ? (
                <div style={styles.loadingContainer}>
                  <div style={styles.spinner}></div>
                  <p style={styles.loadingText}>Loading secure workspace...</p>
                </div>
              ) : (
                <div style={styles.loginGrid}>
                  <div style={styles.loginHero}>
                    <div style={styles.heroBadge}>✨ Enterprise Suite</div>
                    <h2 style={styles.heroTitle}>Stitching <span style={{color: "#2563EB"}}>Intelligence</span></h2>
                    <p style={styles.heroDesc}>Real-time production tracking, material management, and karigar performance — unified command center for modern stitching operations.</p>
                    <div style={styles.featureList}>
                      <div style={styles.featureItem}>📊 Live Production Analytics</div>
                      <div style={styles.featureItem}>🧵 Material Issue & Inventory</div>
                      <div style={styles.featureItem}>👥 Karigar & Thekedar Management</div>
                    </div>
                  </div>
                  <div style={styles.loginCard}>
                    <div style={styles.loginHeader}>
                      <div style={styles.loginBadge}>Welcome back</div>
                      <h3 style={styles.loginTitle}>Sign in to continue</h3>
                      <p style={styles.loginSubtitle}>Access your operational dashboard</p>
                    </div>
                    <form onSubmit={handleLogin} style={styles.loginForm}>
                      <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Username</label>
                        <select
                          style={styles.formSelect}
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                        >
                          <option value="">Select your profile</option>
                          {stitchingSupervisors.map((s) => (
                            <option key={s.id} value={s.username}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.formLabel}>Password</label>
                        <div style={styles.passwordWrapper}>
                          <input
                            type={showPassword ? "text" : "password"}
                            style={styles.formInput}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={styles.eyeButton}
                          >
                            {showPassword ? "🙈" : "👁️"}
                          </button>
                        </div>
                      </div>
                      {authError && <div style={styles.errorAlert}>⚠️ {authError}</div>}
                      <button type="submit" disabled={isLoading} style={{ ...styles.loginButton, ...(isLoading ? styles.loginButtonLoading : {}) }}>
                        {isLoading ? <span style={styles.buttonSpinner}></span> : "Launch Dashboard →"}
                      </button>
                    </form>
                    <p style={styles.loginFooter}>🔒 Secure supervisor access only</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Modern Dashboard with Card Grid & Stats
            <div style={styles.dashboard}>
              {/* Welcome Banner */}
              <div style={styles.welcomeBanner}>
                <div>
                  <h2 style={styles.welcomeTitle}>Good {getTimeBasedGreeting()}, {currentSupervisor?.name} 👋</h2>
                  <p style={styles.welcomeSub}>Here's your stitching command overview — {STITCHING_SUPERVISOR_OPTIONS.length} modules ready</p>
                </div>
                <div style={styles.statsChip}>
                  <span>🟢 Live Session</span>
                  <span style={styles.dot}></span>
                  <span>Today's target: 2,450 pcs</span>
                </div>
              </div>

              {/* Tools Grid - Modern responsive masonry feel */}
              <div style={styles.toolsSection}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={styles.sectionTitle}>⚡ Production Command Hub</h3>
                    <p style={styles.sectionSubtitle}>Launch any module with one click — real-time operational tools</p>
                  </div>
                  <div style={styles.moduleCount}>{STITCHING_SUPERVISOR_OPTIONS.length} active modules</div>
                </div>

                <div style={styles.gridContainer}>
                  {STITCHING_SUPERVISOR_OPTIONS.map((option) => (
                    <div
                      key={option.id}
                      style={{
                        ...styles.toolCard,
                        ...(hoveredCard === option.id ? styles.toolCardHover : {}),
                      }}
                      onClick={() => handleNavigation(option)}
                      onMouseEnter={() => setHoveredCard(option.id)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div style={{ ...styles.toolCardGlow, background: `${option.color}10` }} />
                      <div style={styles.toolCardContent}>
                        <div style={{ ...styles.toolIcon, background: `${option.color}20`, color: option.color }}>
                          <span style={{ fontSize: 26 }}>{option.emoji}</span>
                        </div>
                        <div style={styles.toolInfo}>
                          <h4 style={styles.toolName}>{option.label}</h4>
                          <p style={styles.toolDescription}>{option.description}</p>
                        </div>
                        <div style={styles.toolArrow}>→</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Insight Row: Quick Actions + System Status + Tip */}
              <div style={styles.bottomRow}>
                <div style={styles.insightCard}>
                  <div style={styles.cardHeader}>
                    <span>💡 Smart Assistant</span>
                    <span style={styles.smallBadge}>Pro Tips</span>
                  </div>
                  <ul style={styles.tipsList}>
                    <li>• Update <strong>Daily Report</strong> before shift closure for accurate payroll</li>
                    <li>• Monitor <strong>Zip & Dori</strong> stock levels to avoid line stoppages</li>
                    <li>• Review <strong>Karigar Lot Detail</strong> for performance insights</li>
                    <li>• Process <strong>Thekedar Payment</strong> on schedule for seamless ops</li>
                  </ul>
                </div>
                <div style={styles.statusGlance}>
                  <div style={styles.statusHeader}>
                    <span>🟢 System Nexus</span>
                    <span style={styles.statusBadge}>Operational</span>
                  </div>
                  <div style={styles.statusMetrics}>
                    <div style={styles.metricItem}>
                      <span>Google Sheets Sync</span>
                      <span style={styles.greenText}>Active</span>
                    </div>
                    <div style={styles.metricItem}>
                      <span>Last heartbeat</span>
                      <span>Just now</span>
                    </div>
                    <div style={styles.metricItem}>
                      <span>Supervisor Role</span>
                      <span style={{fontWeight:600}}>{currentSupervisor?.name}</span>
                    </div>
                  </div>
                  <div style={styles.actionHint}>
                    ⚡ All modules are optimized for instant navigation
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        <footer style={styles.footer}>
          <span>© 2025 MH Stitching — Intelligent Supervisor Portal</span>
          <div style={styles.footerLinks}>
            <a href="#docs">Documentation</a>
            <a href="#support">Support</a>
            <a href="#privacy">Privacy</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Helper functions
function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

function getColorGradient(index) {
  const colors = ["#1E40AF", "#2563EB", "#0284C7", "#0EA5E9", "#1D4ED8", "#3B82F6", "#0F172A", "#0369A1"];
  return colors[index % colors.length];
}

// Professional Modern Styles - ENHANCED BLUE & WHITE THEME
const styles = {
  page: {
    minHeight: "100vh",
    background: "#f0f9ff",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    position: "relative",
    overflowX: "hidden",
  },
  bgOrb1: {
    position: "fixed",
    top: "-20%",
    right: "-10%",
    width: "550px",
    height: "550px",
    background: "radial-gradient(circle, rgba(37,99,235,0.12) 0%, rgba(240,249,255,0) 70%)",
    borderRadius: "50%",
    zIndex: 0,
    pointerEvents: "none",
  },
  bgOrb2: {
    position: "fixed",
    bottom: "-15%",
    left: "-5%",
    width: "480px",
    height: "480px",
    background: "radial-gradient(circle, rgba(2,132,199,0.1) 0%, rgba(240,249,255,0) 70%)",
    borderRadius: "50%",
    zIndex: 0,
    pointerEvents: "none",
  },
  bgGrid: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundImage: "radial-gradient(circle at 1px 1px, rgba(37,99,235,0.04) 1px, transparent 1px)",
    backgroundSize: "32px 32px",
    zIndex: 0,
    pointerEvents: "none",
  },
  container: {
    position: "relative",
    zIndex: 2,
    maxWidth: 1920,
    margin: "0 auto",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    transition: "all 0.3s cubic-bezier(0.2, 0.9, 0.4, 1.1)",
  },
  containerExiting: {
    opacity: 0,
    transform: "translateY(12px)",
  },
  header: {
    background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%)",
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 8px 24px -6px rgba(37, 99, 235, 0.25)",
    borderBottom: "1px solid rgba(255,255,255,0.15)",
  },
  headerInner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 28px",
    maxWidth: 1920,
    margin: "0 auto",
  },
  logoArea: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  logoIcon: {
    background: "rgba(255, 255, 255, 0.2)",
    width: 44,
    height: 44,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(10px)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    fontSize: 22,
    color: "#ffffff",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  },
  logoText: {
    fontSize: 20,
    fontWeight: 850,
    color: "#ffffff",
    margin: 0,
    letterSpacing: "-0.3px",
  },
  logoTagline: {
    fontSize: 11,
    color: "#dbeafe",
    margin: 0,
    fontWeight: 600,
  },
  userArea: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  userCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "rgba(255, 255, 255, 0.18)",
    backdropFilter: "blur(10px)",
    padding: "5px 16px 5px 6px",
    borderRadius: 30,
    border: "1px solid rgba(255, 255, 255, 0.3)",
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    color: "white",
  },
  userMeta: {
    lineHeight: 1.2,
  },
  userName: {
    fontSize: 13,
    fontWeight: 750,
    color: "#ffffff",
    margin: 0,
  },
  userRole: {
    fontSize: 10,
    color: "#dbeafe",
    margin: 0,
    fontWeight: 500,
  },
  logoutButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255, 255, 255, 0.2)",
    border: "1px solid rgba(255, 255, 255, 0.35)",
    padding: "7px 16px",
    borderRadius: 30,
    fontSize: 12,
    fontWeight: 600,
    color: "#ffffff",
    cursor: "pointer",
    transition: "all 0.2s",
    backdropFilter: "blur(8px)",
  },
  main: {
    flex: 1,
    padding: "20px 28px 36px",
  },
  // Login Split Screen
  loginWrapper: {
    display: "flex",
    alignItems: "center",
    minHeight: "calc(100vh - 180px)",
  },
  loginGrid: {
    display: "grid",
    gridTemplateColumns: "1.1fr 1fr",
    gap: 28,
    width: "100%",
    maxWidth: 1100,
    margin: "0 auto",
  },
  loginHero: {
    background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%)",
    borderRadius: 24,
    padding: "40px 36px",
    color: "#ffffff",
    boxShadow: "0 12px 30px rgba(37, 99, 235, 0.2)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  heroBadge: {
    display: "inline-block",
    background: "rgba(255, 255, 255, 0.2)",
    color: "#ffffff",
    padding: "5px 14px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 20,
    backdropFilter: "blur(6px)",
    width: "fit-content",
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: 850,
    color: "#ffffff",
    marginBottom: 14,
    lineHeight: 1.25,
  },
  heroDesc: {
    fontSize: 14,
    color: "#dbeafe",
    lineHeight: 1.5,
    marginBottom: 28,
    fontWeight: 500,
  },
  featureList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  featureItem: {
    fontSize: 13,
    fontWeight: 600,
    color: "#ffffff",
    padding: "8px 12px",
    background: "rgba(255, 255, 255, 0.12)",
    borderRadius: 12,
    backdropFilter: "blur(4px)",
  },
  loginCard: {
    background: "#ffffff",
    borderRadius: 24,
    padding: "36px 32px",
    boxShadow: "0 10px 30px -10px rgba(37, 99, 235, 0.15)",
    border: "1.5px solid #bfdbfe",
  },
  loginHeader: {
    marginBottom: 24,
  },
  loginBadge: {
    fontSize: 11,
    fontWeight: 750,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: "1px",
    marginBottom: 8,
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: "#1e3a8a",
    margin: "0 0 6px 0",
  },
  loginSubtitle: {
    fontSize: 13,
    color: "#64748b",
  },
  loginForm: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: 750,
    color: "#1e3a8a",
  },
  formSelect: {
    padding: "11px 16px",
    borderRadius: 14,
    border: "1.5px solid #bfdbfe",
    fontSize: 13,
    background: "#f0f9ff",
    color: "#0f172a",
    outline: "none",
    fontWeight: 600,
    transition: "all 0.2s",
  },
  formInput: {
    width: "100%",
    padding: "11px 16px",
    borderRadius: 14,
    border: "1.5px solid #bfdbfe",
    fontSize: 13,
    background: "#f0f9ff",
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
  },
  passwordWrapper: {
    position: "relative",
  },
  eyeButton: {
    position: "absolute",
    right: 14,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 16,
  },
  errorAlert: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 12,
    color: "#b91c1c",
    fontWeight: 600,
  },
  loginButton: {
    background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
    color: "white",
    border: "none",
    padding: "12px",
    borderRadius: 20,
    fontWeight: 750,
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.2s",
    marginTop: 6,
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
  },
  loginButtonLoading: { opacity: 0.7, cursor: "wait" },
  buttonSpinner: {
    display: "inline-block",
    width: 16,
    height: 16,
    border: "2px solid rgba(255,255,255,0.3)",
    borderTop: "2px solid white",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  loginFooter: {
    marginTop: 20,
    fontSize: 11,
    textAlign: "center",
    color: "#94a3b8",
  },
  loadingContainer: {
    textAlign: "center",
    background: "white",
    padding: "40px",
    borderRadius: 24,
    border: "1.5px solid #bfdbfe",
    width: "100%",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid #dbeafe",
    borderTop: "3px solid #2563eb",
    borderRadius: "50%",
    margin: "0 auto 14px",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: { color: "#1e40af", fontWeight: 600, fontSize: 14 },
  // Dashboard Styles
  dashboard: { animation: "fadeInUp 0.4s ease-out" },
  welcomeBanner: {
    background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
    borderRadius: 20,
    padding: "18px 24px",
    marginBottom: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1.5px solid #bfdbfe",
    boxShadow: "0 4px 14px rgba(37, 99, 235, 0.06)",
  },
  welcomeTitle: { fontSize: 20, fontWeight: 800, color: "#1e3a8a", margin: "0 0 4px 0" },
  welcomeSub: { fontSize: 13, color: "#3b82f6", margin: 0, fontWeight: 500 },
  statsChip: {
    background: "#ffffff",
    border: "1px solid #bfdbfe",
    padding: "6px 16px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    color: "#1e40af",
    display: "flex",
    alignItems: "center",
    gap: 10,
    boxShadow: "0 2px 6px rgba(37, 99, 235, 0.05)",
  },
  dot: { width: 8, height: 8, background: "#16a34a", borderRadius: 8 },
  toolsSection: { marginBottom: 28 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  sectionTitle: { fontSize: 17, fontWeight: 850, color: "#1e3a8a", margin: 0 },
  sectionSubtitle: { fontSize: 12, color: "#0284c7", margin: "4px 0 0 0", fontWeight: 500 },
  moduleCount: { background: "#ffffff", border: "1px solid #bfdbfe", padding: "4px 14px", borderRadius: 20, fontSize: 11, fontWeight: 750, color: "#2563eb" },
  gridContainer: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 },
  toolCard: {
    background: "#ffffff",
    borderRadius: 18,
    cursor: "pointer",
    transition: "all 0.25s cubic-bezier(0.2, 0.9, 0.4, 1.1)",
    border: "1.5px solid #bfdbfe",
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(37, 99, 235, 0.04)",
  },
  toolCardHover: {
    transform: "translateY(-4px)",
    boxShadow: "0 12px 24px -6px rgba(37, 99, 235, 0.18)",
    borderColor: "#2563eb",
  },
  toolCardGlow: { position: "absolute", inset: 0, opacity: 0.3, pointerEvents: "none" },
  toolCardContent: { padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, position: "relative", zIndex: 2 },
  toolIcon: { width: 48, height: 48, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid rgba(37, 99, 235, 0.15)" },
  toolInfo: { flex: 1 },
  toolName: { fontSize: 15, fontWeight: 800, color: "#1e3a8a", margin: "0 0 4px 0" },
  toolDescription: { fontSize: 11, color: "#64748b", lineHeight: 1.35, margin: 0, fontWeight: 500 },
  toolArrow: { fontSize: 18, color: "#2563eb", transition: "transform 0.2s", flexShrink: 0, fontWeight: "bold" },
  bottomRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
  insightCard: {
    background: "#ffffff",
    borderRadius: 20,
    padding: "18px 20px",
    border: "1.5px solid #bfdbfe",
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.04)",
  },
  cardHeader: { display: "flex", justifyContent: "space-between", marginBottom: 14, fontWeight: 800, color: "#1e3a8a", fontSize: 14 },
  smallBadge: { background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", padding: "2px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700 },
  tipsList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "#334155" },
  statusGlance: {
    background: "#ffffff",
    borderRadius: 20,
    padding: "18px 20px",
    border: "1.5px solid #bfdbfe",
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.04)",
  },
  statusHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontWeight: 800, color: "#1e3a8a", fontSize: 14 },
  statusBadge: { background: "#d1fae5", color: "#065f46", border: "1px solid #a7f3d0", padding: "2px 10px", borderRadius: 12, fontSize: 10, fontWeight: 750 },
  statusMetrics: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 },
  metricItem: { display: "flex", justifyContent: "space-between", fontSize: 12, paddingBottom: 6, borderBottom: "1px solid #f0f9ff", color: "#475569" },
  greenText: { color: "#16a34a", fontWeight: 750 },
  actionHint: { fontSize: 11, background: "#f0f9ff", border: "1px solid #bfdbfe", padding: "8px 12px", borderRadius: 14, color: "#1e40af", textAlign: "center", fontWeight: 600 },
  footer: {
    borderTop: "1px solid #bfdbfe",
    padding: "14px 28px",
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#1e40af",
    background: "#ffffff",
    fontWeight: 500,
  },
  footerLinks: { display: "flex", gap: 20, a: { textDecoration: "none", color: "#2563eb", fontWeight: 600 } },
};

// Inject dynamic keyframes for spin & fade
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  select:focus, input:focus { outline: none; border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.15) !important; }
  .tool-card:hover .tool-arrow { transform: translateX(4px); color: #1d4ed8; }
  button:hover { transform: translateY(-1px); }
  a { text-decoration: none; color: #2563eb; transition: 0.2s; }
  a:hover { color: #1d4ed8; text-decoration: underline; }
`;
document.head.appendChild(styleSheet);
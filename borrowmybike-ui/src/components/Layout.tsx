// src/components/Layout.tsx
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import ScrollToTop from "./ScrollToTop";
import { useAuth } from "../auth/useAuth";
import { sb } from "../lib/supabase";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function formatMoney(amount: number | null) {
  if (amount == null) return "—";
  // credits are stored as numeric; keep simple display
  const rounded = Math.round(amount * 100) / 100;
  // show no decimals when clean integer
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export default function Layout() {
  const loc = useLocation();
  const navg = useNavigate();
  const { user } = useAuth();

  // Mobile menu
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [loc.pathname]);

  // Try a few common places Supabase user email might live
  const email =
    (user as any)?.email ||
    (user as any)?.user_metadata?.email ||
    (user as any)?.identities?.[0]?.identity_data?.email ||
    null;

  const me = (user as any)?.id ?? null;

  // Credits (global display)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function loadCredits() {
      if (!me) {
        setCreditsTotal(null);
        return;
      }

      // If RLS blocks this, we fail silently and show "—"
      try {
        const res = await sb
          .from("credits")
          .select("amount")
          .eq("user_id", me)
          .eq("status", "available");

        if (res.error) throw res.error;

        const rows = (res.data as any[]) || [];
        const sum = rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

        if (!cancelled) setCreditsTotal(sum);
      } catch {
        if (!cancelled) setCreditsTotal(null);
      }
    }

    // initial load + light polling so newly-issued credits show up without refresh
    loadCredits();
    timer = window.setInterval(loadCredits, 30000);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [me]);

  const shell: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f8fafc",
    color: "#0f172a",
    overflowX: "hidden", // guard: never allow sideways scroll from layout wrappers
  };

  const header: React.CSSProperties = {
    background: "white",
    borderBottom: "1px solid #e2e8f0",
  };

  const headerInner: React.CSSProperties = {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "14px 20px",
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    gap: 16,
    position: "relative", // for mobile dropdown positioning
    minWidth: 0,
  };

  /* BRAND */
  const brand: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    textDecoration: "none",
    minWidth: 0,
  };

  const brandLogo: React.CSSProperties = {
    height: 48,
    width: "auto",
    display: "block",
  };

  /* NAV */
  const nav: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    gap: 18,
    flexWrap: "wrap",
    alignItems: "center",
    fontWeight: 900,
    minWidth: 0,
  };

  const navLink = (href: string): React.CSSProperties => ({
    textDecoration: "none",
    color: isActive(loc.pathname, href) ? "#16a34a" : "#0f172a",
    fontWeight: isActive(loc.pathname, href) ? 700 : 500,
    borderBottom: isActive(loc.pathname, href)
      ? "2px solid #16a34a"
      : "2px solid transparent",
    paddingBottom: 4,
    whiteSpace: "nowrap",
  });

  /* RIGHT AUTH AREA */
  const rightArea: React.CSSProperties = {
    display: "flex",
    flexDirection: "column", // stack buttons + meta lines
    alignItems: "flex-end",
    gap: 6,
    minWidth: 0, // IMPORTANT: fixed minWidth here causes mobile overflow
  };

  const rightButtons: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  };

  const authLink: React.CSSProperties = {
    textDecoration: "none",
    color: "#0f172a",
    fontWeight: 900,
    border: "1px solid #cbd5e1",
    background: "white",
    padding: "8px 12px",
    borderRadius: 12,
    whiteSpace: "nowrap",
  };

  const signOutBtn: React.CSSProperties = {
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontWeight: 900,
    padding: "8px 12px",
    borderRadius: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  // Same subtle style as Signed-in email line (as you requested)
  const metaLine: React.CSSProperties = {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 450,
    lineHeight: 1.2,
    textAlign: "right",
    maxWidth: 260,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  // Mobile menu button
  const mobileMenuBtn: React.CSSProperties = {
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontWeight: 900,
    padding: "8px 12px",
    borderRadius: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const mobilePanel: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 10px)",
    left: 20,
    right: 20,
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    boxShadow: "0 10px 30px rgba(2, 6, 23, 0.12)",
    padding: 12,
    zIndex: 50,
  };

  const mobileMenuLink: React.CSSProperties = {
    display: "block",
    textDecoration: "none",
    color: "#0f172a",
    fontWeight: 900,
    padding: "10px 10px",
    borderRadius: 12,
  };

  const mobileMenuLinkActive: React.CSSProperties = {
    ...mobileMenuLink,
    background: "#f1f5f9",
    color: "#16a34a",
  };

  async function signOut() {
    await sb.auth.signOut();
    navg("/", { replace: true });
  }

  const main: React.CSSProperties = {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "0 16px 24px",
    minWidth: 0,
  };

  const footer: React.CSSProperties = {
    marginTop: 40,
    padding: "24px 0",
    borderTop: "1px solid #e2e8f0",
    background: "white",
  };

  const footerInner: React.CSSProperties = {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "0 16px",
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr",
    gap: 16,
    minWidth: 0
  };

  const footerTitle: React.CSSProperties = { fontWeight: 1000 };
  const footerLink: React.CSSProperties = {
    color: "#0f172a",
    textDecoration: "none",
    fontWeight: 900,
  };

  const creditsLabel = useMemo(() => formatMoney(creditsTotal), [creditsTotal]);

  const mobileHrefList: Array<{ href: string; label: string }> = [
    { href: "/", label: "Home" },
    { href: "/browse", label: "Browse" },
    { href: "/test-takers", label: "Taking a road test?" },
    { href: "/mentors/start", label: "List your bike • Earn $100" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/rules", label: "Rules" },
    { href: "/legal", label: "Legal" },
  ];

  return (
    <div style={shell}>
      <ScrollToTop />

      <header style={header}>
        <div style={headerInner}>
          {/* LOGO */}
          <Link to="/" style={brand} aria-label="Home">
            <img src="/logo-borrowmybike.png" alt="BorrowMyBike" style={brandLogo} />
          </Link>

          {/* CENTER NAV (Desktop) + Mobile menu button */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minWidth: 0, gap: 10 }}>
            <nav style={nav} className="bmb-nav">
              <Link to="/" style={navLink("/")}>Home</Link>
              <Link to="/browse" style={navLink("/browse")}>Browse</Link>
              <Link to="/test-takers" style={navLink("/test-takers")}>Taking a road test?</Link>
              <Link to="/mentors/start" style={navLink("/mentors")}>List your bike • Earn $100</Link>

              <Link to="/dashboard" style={navLink("/dashboard")}>Dashboard</Link>
              <Link to="/rules" style={navLink("/rules")}>Rules</Link>
              <Link to="/legal" style={navLink("/legal")}>Legal</Link>
            </nav>

            <button
              type="button"
              className="bmb-mobile-menu-btn"
              style={mobileMenuBtn}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              {mobileMenuOpen ? "Close" : "Menu"}
            </button>
          </div>

          {/* AUTH AREA */}
          <div style={rightArea}>
            {user ? (
              <>
                <div style={rightButtons}>
                  <Link to="/dashboard" style={authLink}>Account</Link>
                  <button onClick={signOut} style={signOutBtn}>Sign out</button>
                </div>

                {/* Subtle credits line (global) */}
                <div style={metaLine} title="Available credits on your account">
                  Credits: {creditsLabel}
                </div>

                {/* Subtle email line */}
                <div style={metaLine} title={email ?? ""}>
                  {email ? `Signed in as ${email}` : "Signed in"}
                </div>
              </>
            ) : (
              <div style={rightButtons}>
                <Link to="/auth" style={authLink} state={{ from: loc.pathname }}>
                  Sign in
                </Link>
              </div>
            )}
          </div>

          {/* Mobile dropdown panel */}
          {mobileMenuOpen && (
            <div className="bmb-mobile-menu-panel" style={mobilePanel} role="menu" aria-label="Site menu">
              {mobileHrefList.map((item) => {
                const active = isActive(loc.pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    style={active ? mobileMenuLinkActive : mobileMenuLink}
                    role="menuitem"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}

              {/* Extra account actions on mobile (helpful when nav hidden) */}
              <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
                {user ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                      Credits: {creditsLabel}
                    </div>
                    <button onClick={signOut} style={{ ...signOutBtn, width: "100%" }}>Sign out</button>
                  </div>
                ) : (
                  <Link to="/auth" style={{ ...authLink, display: "block", textAlign: "center" }} state={{ from: loc.pathname }}>
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <main style={main}>
        <Outlet />
      </main>

      <footer style={footer}>
        <div style={footerInner} className="bmb-footer-inner">
          <div>
            <div style={footerTitle}>BorrowMyBike / Class6Loaner</div>
            <div style={{ marginTop: 8, color: "#475569", fontWeight: 800 }}>
              Road tests only. Not a rental company.
              <br />
              Launching province-by-province — mentors can list Canada-wide.
            </div>
            <div style={{ marginTop: 10, color: "#475569", fontWeight: 800 }}>
              Questions? Email{" "}
              <span style={{ fontWeight: 1000, color: "#0f172a" }}>support@borrowmybike.ca</span>
            </div>
            <div style={{ marginTop: 10, color: "#94a3b8", fontWeight: 800, fontSize: 12 }}>
              © {new Date().getFullYear()} BorrowMyBike. All rights reserved.
            </div>
          </div>

          <div>
            <div style={footerTitle}>Explore</div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <Link to="/browse" style={footerLink}>Browse bikes</Link>
              <Link to="/mentors/start" style={footerLink}>List your bike</Link>
              <Link to="/dashboard" style={footerLink}>Dashboard</Link>
            </div>
          </div>

          <div>
            <div style={footerTitle}>Trust</div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <Link to="/rules" style={footerLink}>Rules &amp; Process</Link>
              <Link to="/rules#cancellations" style={footerLink}>Cancellation outcomes</Link>
              <Link to="/rules#fault" style={footerLink}>Fault scenarios</Link>
              <Link to="/legal" style={footerLink}>Legal / Policies</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

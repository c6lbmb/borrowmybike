// src/pages/Legal.tsx
import { Link } from "react-router-dom";

export default function Legal() {
  const page: React.CSSProperties = {
    maxWidth: 1050,
    margin: "0 auto",
    padding: 18,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji"',
  };

  const topRow: React.CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };

  const card: React.CSSProperties = {
    marginTop: 14,
    padding: 16,
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
  };

  const h1: React.CSSProperties = {
    margin: 0,
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: -0.2,
  };

  const h2: React.CSSProperties = {
    margin: "0 0 10px 0",
    fontSize: 20,
    fontWeight: 850,
    letterSpacing: -0.2,
  };

  const p: React.CSSProperties = {
    margin: "8px 0",
    color: "#0f172a",
    fontWeight: 450,
    lineHeight: 1.55,
  };

  const small: React.CSSProperties = {
    marginTop: 10,
    color: "#475569",
    fontWeight: 450,
    lineHeight: 1.55,
  };

  const ul: React.CSSProperties = {
    margin: "10px 0 0 18px",
    color: "#0f172a",
    fontWeight: 450,
    lineHeight: 1.6,
  };

  const qaQ: React.CSSProperties = {
    marginTop: 14,
    fontWeight: 800,
    color: "#0f172a",
  };

  const qaA: React.CSSProperties = {
    marginTop: 6,
    color: "#0f172a",
    fontWeight: 450,
    lineHeight: 1.6,
  };

  const quickLinks: React.CSSProperties = {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  };

  const quickLink: React.CSSProperties = {
    fontWeight: 750,
    color: "#0f172a",
    textDecoration: "none",
  };

  const callout: React.CSSProperties = {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#0f172a",
  };

  const calloutTitle: React.CSSProperties = { fontWeight: 850 };
  const calloutText: React.CSSProperties = { marginTop: 6, fontWeight: 450, lineHeight: 1.55, color: "#334155" };

  return (
    <div style={page}>
      <div style={topRow}>
        <div>
          <h1 style={h1}>Legal &amp; Policies</h1>
          <div style={{ marginTop: 6, color: "#475569", fontWeight: 450, lineHeight: 1.55 }}>
            Clear, plain-language policies. Headlines are short — details live in the Rules page.
          </div>

          <div style={callout}>
            <div style={calloutTitle}>Want the full “no surprises” rulebook?</div>
            <div style={calloutText}>
              Read the{" "}
              <Link to="/rules" style={{ fontWeight: 800 }}>
                Rules &amp; Process
              </Link>{" "}
              page — it explains clean completion, early/late cancellations (day 5 included), fault scenarios, and force
              majeure (weather/fire/etc.).
            </div>
          </div>
        </div>

        <div style={quickLinks}>
          <Link to="/browse" style={quickLink}>
            Browse →
          </Link>
          <Link to="/test-takers" style={quickLink}>
            Taking a road test? →
          </Link>
          <Link to="/owners/start" style={quickLink}>
            List your bike →
          </Link>
        </div>
      </div>

      {/* Cancellations */}
      <div style={card} id="cancellations">
        <div style={h2}>Cancellation policy (summary)</div>

        <div style={p}>
          These rules exist to protect real people from last-minute failures and no-shows — and to keep registry bookings
          stable.
        </div>

        <div style={qaQ}>Before the owner accepts (before owner deposit is paid)</div>
        <div style={qaA}>
          If the owner hasn’t accepted yet, the request can be cancelled and the test-taker receives their funds back (the
          registry appointment isn’t “blocked” yet). If a platform admin fee applies in your configuration, it will be
          shown during checkout.
        </div>

        <div style={qaQ}>After the owner accepts (booking confirmed)</div>
        <ul style={ul}>
          <li>
            <b>Early cancel</b> (more than 5 days before the test): cancelling party receives a refund minus{" "}
            <b>25% admin fee</b>.
          </li>
          <li>
            <b>Late cancel</b> (5 days or fewer before the test — day 5 included): cancelling party{" "}
            <b>forfeits</b> the payment/deposit.
          </li>
        </ul>

        <div style={small}>
          Full definitions and examples are published on{" "}
          <Link to="/rules" style={{ fontWeight: 800 }}>
            Rules &amp; Process
          </Link>
          .
        </div>
      </div>

      {/* Deposits */}
      <div style={card} id="deposits">
        <div style={h2}>Deposits &amp; accountability (summary)</div>

        <div style={p}>
          Deposits reduce no-shows and protect both sides when a registry booking would otherwise be lost.
        </div>

        <div style={qaQ}>Why does the owner put up a $150 deposit?</div>
        <div style={qaA}>
          To keep the owner accountable. If the owner no-shows or the bike isn’t road-worthy at the appointment (invalid
          insurance/registration, unsafe condition, required lights not working, etc.), the owner’s deposit can be used to
          compensate the test-taker so they can rebook.
        </div>

        <div style={qaQ}>Why does the test-taker pay $150?</div>
        <div style={qaA}>
          The test-taker fee compensates the owner for time, fuel, and admin. This is not a recreational rental — it’s
          compensation for a road-test-only appointment.
        </div>
      </div>

      {/* Insurance */}
      <div style={card} id="insurance">
        <div style={h2}>Insurance &amp; responsibility (summary)</div>

        <div style={qaA}>
          Owners provide bikes under <b>permissive use</b> (not renting). Owners should confirm details with their insurer.
          Test-takers may be responsible to cover loss or damage during the test. BorrowMyBike / Class6Loaner is a matching
          platform and does not provide insurance coverage.
        </div>

        <div style={qaA}>
          Owners must arrive with valid <b>registration</b>, valid <b>insurance papers</b>, and the <b>keys</b>. We recommend
          owners verify the test-taker’s ID before the ride begins.
        </div>

        <div style={small}>
          In-app messaging will be unlocked as onboarding grows so owners and test-takers can coordinate details in the
          platform.
        </div>
      </div>
    </div>
  );
}

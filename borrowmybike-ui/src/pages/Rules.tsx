// src/pages/Rules.tsx
import { Link } from "react-router-dom";

export default function Rules() {
  const page: React.CSSProperties = {
    maxWidth: 1050,
    margin: "0 auto",
    padding: 18,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji"',
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

  const lead: React.CSSProperties = {
    marginTop: 6,
    color: "#475569",
    fontWeight: 450,
    lineHeight: 1.55,
  };

  const p: React.CSSProperties = {
    margin: "8px 0",
    color: "#0f172a",
    fontWeight: 450,
    lineHeight: 1.65,
  };

  const small: React.CSSProperties = {
    marginTop: 10,
    color: "#475569",
    fontWeight: 450,
    lineHeight: 1.6,
  };

  const ul: React.CSSProperties = {
    margin: "10px 0 0 18px",
    color: "#0f172a",
    fontWeight: 450,
    lineHeight: 1.7,
  };

  const callout: React.CSSProperties = {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#0f172a",
    fontWeight: 450,
    lineHeight: 1.65,
  };

  const topLinksWrap: React.CSSProperties = {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  };

  const topLink: React.CSSProperties = {
    fontWeight: 750,
    color: "#0f172a",
    textDecoration: "none",
  };

  const quickAnchor: React.CSSProperties = {
    fontWeight: 750,
    color: "#0f172a",
    textDecoration: "none",
  };

  return (
    <div style={page}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={h1}>Rules &amp; Process</h1>
          <div style={lead}>
            Definitions and outcomes — written so nobody can claim “I didn’t know.”
          </div>
        </div>

        <div style={topLinksWrap}>
          <Link to="/browse" style={topLink}>
            Browse →
          </Link>
          <Link to="/test-takers" style={topLink}>
            Taking a road test? →
          </Link>
          <Link to="/owners/start" style={topLink}>
            List your bike →
          </Link>
        </div>
      </div>

      <div style={card}>
        <div style={h2}>1) What this platform is (and is not)</div>
        <div style={p}>
          BorrowMyBike / Class6Loaner is a <b>matching platform</b> for{" "}
          <b>registry road tests only</b>. It is <b>not a rental company</b>, does
          not provide recreational rentals, and does not provide insurance
          coverage.
        </div>
        <div style={p}>
          Fees and deposits exist to ensure both parties show up prepared, reduce
          no-shows, and compensate the non-fault party when something goes wrong.
        </div>
      </div>

      <div style={card} id="definitions">
        <div style={h2}>2) Definitions</div>
        <div style={p}>
          <b>Early cancellation</b>: cancellation that occurs <b>more than 5 days</b>{" "}
          before the scheduled test time.
        </div>
        <div style={p}>
          <b>Late cancellation</b>: cancellation that occurs <b>5 days or less</b>{" "}
          before the scheduled test time (this <b>includes day 5</b>).
        </div>
        <div style={p}>
          <b>Platform credit</b>: value stored in your account that can be applied
          to future bookings. (Any unused platform credit may be returned at the
          end of the season.)
        </div>

        <div style={callout}>
          The platform uses <b>platform credit</b> as the default remedy for
          cancellations and unavoidable events so users can rebook quickly.
        </div>
      </div>

      <div style={card} id="clean-completion">
        <div style={h2}>3) Clean completion process</div>
        <ul style={ul}>
          <li>Test-taker requests a booking and pays.</li>
          <li>Owner accepts and provides the owner deposit.</li>
          <li>Both parties check in at the scheduled time window (enforced in-app).</li>
          <li>After the test, both parties confirm completion/possession (enforced in-app).</li>
          <li>
            Owner earns <b>$100</b> upon successful completion and confirmation, owners deposit can either be returned via same payment method or (recommended) keep on platform to accept future bookings with ease.
          </li>
        </ul>

        <div style={small}>
          This process exists to ensure the bike is returned and both parties are
          protected with clear timestamps.
        </div>
      </div>

      <div style={card} id="cancellations">
        <div style={h2}>4) Cancellations (after the owner accepts)</div>

        <div style={p}>
          If a booking is cancelled <b>after the owner has accepted</b>, the
          outcome depends on whether the cancellation is early or late.
        </div>

        <div style={{ ...p, marginTop: 10 }}>
          <b>4A) Early cancellation (more than 5 days before the test)</b>
        </div>
        <ul style={ul}>
          <li>
            The cancelling party receives <b>platform credit</b> equal to their
            amount <b>minus a 25% admin fee</b>.
          </li>
          <li>
            The non-cancelling party receives <b>$150 platform credit</b> to rebook
            or accept another request.
          </li>
        </ul>

        <div style={{ ...p, marginTop: 12 }}>
          <b>4B) Late cancellation (5 days or less — including day 5)</b>
        </div>
        <ul style={ul}>
          <li>
            The cancelling party <b>forfeits</b> the applicable fee/deposit.
          </li>
          <li>
            The non-cancelling party receives <b>$150 platform credit</b> to rebook
            or accept another request.
          </li>
        </ul>

        <div style={small}>
          Credits are designed to help the non-cancelling party rebook without
          being stuck paying twice.
        </div>
      </div>

      <div style={card} id="fault">
        <div style={h2}>5) If the test cannot proceed (fault scenarios)</div>

        <div style={p}>
          If the test cannot proceed due to one party’s fault, that party may lose
          the applicable fee/deposit, and the other party is compensated.
        </div>

        <div style={{ ...p, marginTop: 10 }}>
          <b>Examples of test-taker fault</b>
        </div>
        <ul style={ul}>
          <li>
            No helmet, no hands-free, late/no-show, unfit to ride, or any behavior
            that prevents the test.
          </li>
        </ul>

        <div style={{ ...p, marginTop: 12 }}>
          <b>Examples of owner fault</b>
        </div>
        <ul style={ul}>
          <li>
            Invalid registration/insurance, unsafe condition, required lights not
            working, or arriving without the bike being road-test-ready.
          </li>
        </ul>

        <div style={callout}>
          In fault scenarios: the <b>at-fault party loses</b> their fee/deposit and
          the other party receives <b>$100 compensation</b>. If the registry fee is
          more than $100, the platform does <b>not</b> cover the difference.
        </div>
      </div>

      <div style={card} id="force-majeure">
        <div style={h2}>6) Unavoidable events (weather / emergency / force majeure)</div>
        <div style={p}>
          If the test cannot proceed due to events outside both users’ control
          (weather closures, fire, evacuation, emergencies, registry shutdowns,
          etc.), <b>no one loses</b> — including the platform.
        </div>
        <div style={p}>
          Both parties receive <b>full platform credit</b> for the applicable
          amounts so they can rebook.
        </div>

        <div style={small}>
          This clause exists to prevent unfair outcomes when neither user caused
          the failure.
        </div>
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ fontWeight: 850, fontSize: 18 }}>Quick links</div>
        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="#definitions" style={quickAnchor}>Definitions</a>
          <a href="#cancellations" style={quickAnchor}>Cancellations</a>
          <a href="#fault" style={quickAnchor}>Fault scenarios</a>
          <a href="#force-majeure" style={quickAnchor}>Unavoidable events</a>
        </div>
      </div>
    </div>
  );
}
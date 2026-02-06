// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";

// Pages
import Home from "./pages/Home";
import Browse from "./pages/Browse";
import BikeDetail from "./pages/BikeDetail";
import RequestBooking from "./pages/RequestBooking";
import Auth from "./pages/Auth";
import OwnerDashboard from "./pages/OwnerDashboard";
import BorrowerDashboard from "./pages/BorrowerDashboard";
import DashboardRouter from "./pages/DashboardRouter";

import OwnerStart from "./pages/OwnerStart";
import OwnerNew from "./pages/OwnerNew";
import Legal from "./pages/Legal";
import Dev from "./pages/Dev";
import TestTaker from "./pages/TestTaker";
import Rules from "./pages/Rules";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public */}
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/test-takers" element={<TestTaker />} />

        {/* Browse */}
        <Route path="/browse" element={<Browse />} />

        {/* Bike details (support both /bike and /bikes) */}
        <Route path="/bike/:id" element={<BikeDetail />} />
        <Route path="/bikes/:id" element={<BikeDetail />} />

        {/* Request booking (support both) */}
        <Route path="/bike/:id/request" element={<RequestBooking />} />
        <Route path="/bikes/:id/request" element={<RequestBooking />} />

        {/* Auth */}
        <Route path="/auth" element={<Auth />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<DashboardRouter />} />
        <Route path="/dashboard/owner" element={<OwnerDashboard />} />
        <Route path="/dashboard/mentor" element={<OwnerDashboard />} />
        <Route path="/dashboard/borrower" element={<BorrowerDashboard />} />

        {/* Owner flows */}
        <Route path="/mentors/start" element={<OwnerStart />} />
        <Route path="/mentors/new" element={<OwnerNew />} />

        <Route path="/owner/start" element={<OwnerStart />} />
        <Route path="/owners/start" element={<OwnerStart />} />
        <Route path="/owners/new" element={<OwnerNew />} />
        <Route path="/owner/new" element={<Navigate to="/owners/new" replace />} />

        {/* Policies */}
        <Route path="/rules" element={<Rules />} />
        <Route path="/legal" element={<Legal />} />

        {/* Other */}
        <Route path="/dev" element={<Dev />} />

        {/* Fallback */}
        <Route
          path="*"
          element={
            <div style={{ padding: "2rem" }}>
              <h1>Not Found</h1>
              <p>Wrong URL.</p>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}

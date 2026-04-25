// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";

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
import AdminReviews from "./pages/AdminReviews";

import Rules from "./pages/Rules";

export default function App() {
  const showDevRoute = import.meta.env.DEV;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
       
        <Route path="/browse" element={<Browse />} />
        <Route path="/bike/:id" element={<BikeDetail />} />
        <Route path="/bikes/:id" element={<BikeDetail />} />
        <Route path="/bike/:id/request" element={<RequestBooking />} />
        <Route path="/bikes/:id/request" element={<RequestBooking />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/dashboard" element={<DashboardRouter />} />
        <Route path="/dashboard/owner" element={<OwnerDashboard />} />
        <Route path="/dashboard/mentor" element={<OwnerDashboard />} />
        <Route path="/dashboard/borrower" element={<BorrowerDashboard />} />
        <Route path="/mentors" element={<Navigate to="/mentors/new" replace />} />
        <Route path="/mentor" element={<Navigate to="/mentors/new" replace />} />
        <Route path="/mentors/start" element={<OwnerStart />} />
        <Route path="/mentors/new" element={<OwnerNew />} />
        <Route path="/owner/start" element={<OwnerStart />} />
        <Route path="/owners/start" element={<OwnerStart />} />
        <Route path="/owners/new" element={<OwnerNew />} />
        <Route path="/owner/new" element={<Navigate to="/owners/new" replace />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/admin/reviews" element={<AdminReviews />} />

        {showDevRoute && <Route path="/dev" element={<Dev />} />}

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

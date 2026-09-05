import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminEvent from "./pages/AdminEvent";
import Join from "./pages/Join";
import Play from "./pages/Play";
import Monitor from "./pages/Monitor";
import RequireAdmin from "./pages/RequireAdmin";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/events/:eventId"
          element={
            <RequireAdmin>
              <AdminEvent />
            </RequireAdmin>
          }
        />
        <Route path="/join/:eventId" element={<Join />} />
        <Route path="/play/:eventId" element={<Play />} />
        <Route path="/monitor/:eventId" element={<Monitor />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

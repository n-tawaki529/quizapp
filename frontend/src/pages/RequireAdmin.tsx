import { Navigate } from "react-router-dom";
import { getAdminToken } from "../api";

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const token = getAdminToken();
  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}

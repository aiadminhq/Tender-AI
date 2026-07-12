import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/store/auth-context";

/** 未登入時導去 /login，並記住原本要去的路徑（登入後導回）。 */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    );
  }
  return <Outlet />;
}

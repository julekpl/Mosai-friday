import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";

/** Legacy /dashboard entry — forwards into the app workspace. */
export default function Dashboard() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/app", { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  if (!isLoading && !isAuthenticated) return <Navigate to="/auth" replace />;
  return null;
}

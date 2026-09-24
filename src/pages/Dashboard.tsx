import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { MosaicMark } from "@/components/mosaic";

/** Legacy /dashboard entry — forwards into the app workspace. */
export default function Dashboard() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/app", { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  if (!isLoading && !isAuthenticated) return <Navigate to="/auth" replace />;
  // A calm hand-off instead of a blank frame while the redirect resolves.
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-background"
    >
      <div role="status" className="flex flex-col items-center gap-4">
        <MosaicMark size={40} />
        <p className="font-mono text-small text-muted-foreground">Opening your workspace…</p>
      </div>
    </main>
  );
}

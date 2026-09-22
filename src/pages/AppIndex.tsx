import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";

export default function AppIndex() {
  const navigate = useNavigate();
  const projects = useQuery(api.projects.list);
  const isLoading = projects === undefined;

  useEffect(() => {
    if (isLoading) return;
    if (projects.length === 0) {
      navigate("/app/new", { replace: true });
    } else {
      navigate(`/app/${projects[0]._id}`, { replace: true });
    }
  }, [isLoading, projects, navigate]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </main>
  );
}

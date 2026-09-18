import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, LogOut } from "lucide-react";
import { useNavigate } from "react-router";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-caption text-terminal-green">
              ▸ session.active — {user?.email ?? "operator"}
            </p>
            <h1 className="mt-1 font-mono text-h1">Design system workspace</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer gap-2 self-start"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </header>

        <div className="rounded-md border bg-card p-6 shadow-card">
          <h2 className="font-mono text-h3">Phase 1 is live</h2>
          <p className="mt-2 max-w-xl font-mono text-small text-muted-foreground">
            The visual language — tokens, components, states, motion and
            accessibility specs — ships as a browsable component library.
            Product screens arrive in phase 2, composed from these parts.
          </p>
          <Button asChild className="mt-4">
            <a href="/system">
              Open the component library
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}

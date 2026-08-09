import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileText, Home, LogOut, Network, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const NAV_CLASS =
  "inline-flex items-center gap-2 rounded-md px-3 py-2 font-display text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
const NAV_ACTIVE_CLASS =
  "inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-display text-sm font-medium text-accent-foreground";

export function AppHeader({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  const items = [
    { to: "/dashboard", label: "Home", icon: Home },
    { to: "/work", label: "Work", icon: ClipboardList },
    { to: "/documents", label: "Documents", icon: FileText },
    { to: "/team", label: "Team", icon: Network },
    ...(isAdmin ? [{ to: "/people", label: "People", icon: Users }] : []),
  ] as const;

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link to="/dashboard" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            N
          </span>
          <span className="font-display text-base font-semibold tracking-tight">Northwind Ops</span>
        </Link>
        <nav className="flex items-center gap-1">
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={NAV_CLASS}
              activeProps={{ className: NAV_ACTIVE_CLASS, "aria-current": "page" }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}

          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </nav>
      </div>
    </header>
  );
}

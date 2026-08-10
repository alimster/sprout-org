import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileText, Home, LogOut, Network, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const NAV_CLASS =
  "inline-flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 font-display text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:px-3";
const NAV_ACTIVE_CLASS =
  "inline-flex shrink-0 items-center gap-2 rounded-md bg-accent px-2.5 py-2 font-display text-sm font-medium text-accent-foreground sm:px-3";


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
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4 sm:h-16 sm:px-6">
        <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            N
          </span>
          <span className="hidden font-display text-base font-semibold tracking-tight sm:inline">
            Northwind Ops
          </span>
        </Link>
        <nav
          aria-label="Main"
          className="-mx-1 flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-x-auto px-1 sm:gap-1"
        >
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              title={label}
              className={NAV_CLASS}
              activeProps={{ className: NAV_ACTIVE_CLASS, "aria-current": "page" }}
            >
              <Icon className="size-4 shrink-0" />
              <span className="hidden lg:inline">{label}</span>
              <span className="sr-only lg:hidden">{label}</span>
            </Link>
          ))}

          <Button variant="ghost" size="sm" onClick={signOut} title="Sign out" className="shrink-0">
            <LogOut className="size-4" />
            <span className="hidden lg:inline">Sign out</span>
            <span className="sr-only lg:hidden">Sign out</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}


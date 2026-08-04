import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Home · Northwind Ops" },
      { name: "description", content: "Your Northwind Ops account overview." },
      { property: "og:title", content: "Home · Northwind Ops" },
      { property: "og:description", content: "Your Northwind Ops account overview." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { profile, role, isAdmin, loading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl px-6 py-16">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-64" />
          </div>
        ) : (
          <div className="panel max-w-md p-8">
            <p className="label-caps">Signed in as</p>
            <h1 className="mt-2 text-3xl font-semibold">{profile?.full_name || "—"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{profile?.email}</p>
            <div className="mt-6 flex items-center gap-2">
              <span className="rounded-full bg-accent px-3 py-1 font-display text-xs font-medium uppercase tracking-wider text-accent-foreground">
                {role ?? "no role"}
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

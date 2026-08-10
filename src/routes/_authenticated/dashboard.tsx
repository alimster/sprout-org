import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, ClipboardList, FileSignature, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/AppHeader";
import { ErrorPanel, InlineError, errorMessage } from "@/components/ErrorPanel";
import { Skeleton } from "@/components/ui/skeleton";

import {
  ACTIVITY_LABEL,
  MY_WORK_STATUSES,
  STATUS_LABEL,
  TASK_SELECT,
  formatDateTime,
  type ActivityEntry,
  type Task,
} from "@/lib/tasks";
import {
  DOCUMENT_ACTIVITY_LABEL,
  DOCUMENT_SELECT,
  type DocumentRow,
} from "@/lib/documents";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Home dashboard · Northwind Ops" },
      {
        name: "description",
        content:
          "Your Northwind Ops home: work assigned to you, documents awaiting your signature, company totals and recent activity.",
      },
      { property: "og:title", content: "Home dashboard · Northwind Ops" },
      {
        property: "og:description",
        content: "Personal and company summaries plus the latest activity across Northwind Ops.",
      },
    ],
  }),
  component: Dashboard,
});

type DirectoryPerson = { id: string; full_name: string; department: string | null; is_active: boolean };

function Dashboard() {
  const { profile, role, isAdmin, loading } = useAuth();
  const userId = profile?.id ?? null;

  const tasksQuery = useQuery({
    queryKey: ["dashboard", "tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select(TASK_SELECT);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const documentsQuery = useQuery({
    queryKey: ["dashboard", "documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select(DOCUMENT_SELECT);
      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });

  const peopleQuery = useQuery({
    queryKey: ["dashboard", "people"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, department, is_active");
      if (error) throw error;
      return (data ?? []) as DirectoryPerson[];
    },
  });

  // RLS decides what lands here: task activity is company-wide, document
  // activity only for documents the viewer can read.
  const activityQuery = useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, entity_type, entity_id, actor_id, action, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as ActivityEntry[];
    },
  });

  const tasks = tasksQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const people = peopleQuery.data ?? [];

  // A failed fetch must never render as a confident "0" — hide the numbers instead.
  const summaryError = tasksQuery.isError || documentsQuery.isError || peopleQuery.isError;
  const summaryLoading =
    tasksQuery.isPending || documentsQuery.isPending || peopleQuery.isPending;
  const summaryFetching =
    tasksQuery.isFetching || documentsQuery.isFetching || peopleQuery.isFetching;


  const myTasksByStatus = useMemo(() => {
    const mine = tasks.filter((t) => t.assignee_id && t.assignee_id === userId);
    return MY_WORK_STATUSES.map((status) => ({
      status,
      count: mine.filter((t) => t.status === status).length,
    })).filter((row) => row.count > 0);
  }, [tasks, userId]);

  const myAssignedCount = tasks.filter((t) => t.assignee_id === userId).length;
  const awaitingMySignature = documents.filter(
    (d) => d.assigned_signer_id === userId && d.status === "pending",
  );
  const myOpenCreatedTasks = tasks.filter(
    (t) => t.created_by === userId && t.status !== "completed",
  );

  const openWorkItems = tasks.filter((t) => t.status !== "completed").length;
  const pendingSignatureCount = documents.filter((d) => d.status === "pending").length;

  const headcount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of people) {
      if (!person.is_active) continue;
      const key = person.department?.trim() || "Unassigned";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [people]);

  const nameById = useMemo(
    () => new Map(people.map((p) => [p.id, p.full_name])),
    [people],
  );
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);
  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d.name])), [documents]);

  const feed = (activityQuery.data ?? []).map((entry) => {
    const actor = (entry.actor_id && nameById.get(entry.actor_id)) || "Someone";
    const isTask = entry.entity_type === "task";
    const subject = isTask
      ? entry.entity_id
        ? taskById.get(entry.entity_id)
        : null
      : entry.entity_id
        ? docById.get(entry.entity_id)
        : null;
    const action = isTask
      ? (ACTIVITY_LABEL[entry.action] ?? entry.action.replace(/_/g, " "))
      : (DOCUMENT_ACTIVITY_LABEL[entry.action] ?? entry.action.replace(/_/g, " "));
    return { ...entry, actor, action, subject: subject ?? null, isTask };
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader isAdmin={isAdmin} />
        <main className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6 sm:py-12">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <p className="label-caps">Signed in as</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          {profile?.full_name || profile?.email || "—"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile?.title || "No title yet"} · {role ?? "no role"}
        </p>

        {summaryError ? (
          <div className="mt-10">
            <ErrorPanel
              title="We couldn't load your summary"
              message={errorMessage(
                tasksQuery.error ?? documentsQuery.error ?? peopleQuery.error,
                "The counts below would have been wrong, so we've hidden them.",
              )}
              retrying={summaryFetching}
              onRetry={() => {
                void tasksQuery.refetch();
                void documentsQuery.refetch();
                void peopleQuery.refetch();
              }}
            />
          </div>
        ) : summaryLoading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : (
          <>
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold tracking-tight">Your summary</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="panel p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ClipboardList className="size-4" />
                <span className="label-caps">Assigned to me</span>
              </div>
              <p className="mt-3 font-display text-3xl font-semibold">{myAssignedCount}</p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {myTasksByStatus.length === 0 ? (
                  <li>Nothing on your plate right now.</li>
                ) : (
                  myTasksByStatus.map((row) => (
                    <li key={row.status} className="flex justify-between">
                      <span>{STATUS_LABEL[row.status]}</span>
                      <span className="text-foreground">{row.count}</span>
                    </li>
                  ))
                )}
              </ul>
              <Link
                to="/work"
                className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
              >
                Open my work
              </Link>
            </div>

            <div className="panel p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileSignature className="size-4" />
                <span className="label-caps">Awaiting my signature</span>
              </div>
              <p className="mt-3 font-display text-3xl font-semibold">
                {awaitingMySignature.length}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {awaitingMySignature.length === 0 ? (
                  <li>No documents need your signature.</li>
                ) : (
                  awaitingMySignature.slice(0, 4).map((d) => <li key={d.id}>{d.name}</li>)
                )}
              </ul>
              <Link
                to="/documents"
                className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
              >
                Review documents
              </Link>
            </div>

            <div className="panel p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Activity className="size-4" />
                <span className="label-caps">My open requests</span>
              </div>
              <p className="mt-3 font-display text-3xl font-semibold">
                {myOpenCreatedTasks.length}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Tasks you created that aren&apos;t finished yet.
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {myOpenCreatedTasks.slice(0, 4).map((t) => (
                  <li key={t.id} className="truncate">
                    {t.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold tracking-tight">Across the company</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="panel p-5">
              <span className="label-caps">Open work items</span>
              <p className="mt-3 font-display text-3xl font-semibold">{openWorkItems}</p>
            </div>
            <div className="panel p-5">
              <span className="label-caps">Documents pending signature</span>
              <p className="mt-3 font-display text-3xl font-semibold">{pendingSignatureCount}</p>
            </div>
            <div className="panel p-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="size-4" />
                <span className="label-caps">Headcount by department</span>
              </div>
              {headcount.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No active team members yet.</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {headcount.map(([dept, count]) => (
                    <li key={dept} className="flex justify-between">
                      <span className="text-muted-foreground">{dept}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
        </>
        )}


        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold tracking-tight">Recent activity</h2>
          <div className="panel mt-4 divide-y divide-border">
            {activityQuery.isPending ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : activityQuery.isError ? (
              <div className="p-5">
                <InlineError
                  message={errorMessage(activityQuery.error, "Couldn't load recent activity.")}
                  onRetry={() => void activityQuery.refetch()}
                />
              </div>
            ) : feed.length === 0 ? (

              <p className="p-5 text-sm text-muted-foreground">
                No activity yet. Create a task or upload a document to get started.
              </p>
            ) : (
              feed.map((entry) => (
                <div key={entry.id} className="flex items-baseline justify-between gap-4 p-4">
                  <p className="text-sm">
                    <span className="font-medium">{entry.actor}</span>{" "}
                    <span className="text-muted-foreground">{entry.action}</span>
                    {entry.subject ? (
                      <>
                        {" — "}
                        <span className="font-medium">{entry.subject}</span>
                      </>
                    ) : null}
                    <span className="ml-2 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {entry.isTask ? "Task" : "Document"}
                    </span>
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { CalendarDays, ClipboardList, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTaskActions } from "@/hooks/use-task-actions";
import { AppHeader } from "@/components/AppHeader";
import { TaskDetailDialog } from "@/components/TaskDetailDialog";
import {
  formatDate,
  MY_WORK_STATUSES,
  PRIORITIES,
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  sortByPriorityThenNewest,
  STATUS_LABEL,
  TASK_SELECT,
  type Task,
  type TaskPriority,
} from "@/lib/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/work")({
  head: () => ({
    meta: [
      { title: "Work queue & my tasks · Northwind Ops" },
      {
        name: "description",
        content:
          "Post work that needs doing, assign it to a teammate, and track everything assigned to you from accepted through completed.",
      },
      { property: "og:title", content: "Work queue & my tasks · Northwind Ops" },
      {
        property: "og:description",
        content: "The shared Northwind work pool plus your personal task board.",
      },
    ],
  }),
  component: WorkPage,
});

const newTaskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(160),
  description: z.string().trim().max(2000),
  priority: z.enum(["low", "medium", "high"]),
  due_date: z.string().trim().max(20),
});

type Person = { id: string; full_name: string; email: string; is_active: boolean };

function WorkPage() {
  const { profile, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();
  const actions = useTaskActions(profile?.id);

  const [view, setView] = useState<"needed" | "mine">("needed");
  const [creating, setCreating] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
  });

  const peopleQuery = useQuery({
    queryKey: ["work-people"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, is_active")
        .order("full_name");
      if (error) throw error;
      return data as Person[];
    },
  });

  const tasks = tasksQuery.data ?? [];
  const people = peopleQuery.data ?? [];

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.full_name || p.email])), [people]);
  const assignable = useMemo(() => people.filter((p) => p.is_active), [people]);

  const workNeeded = useMemo(
    () => sortByPriorityThenNewest(tasks.filter((t) => t.status === "unassigned")),
    [tasks],
  );

  const myTasks = useMemo(
    () => tasks.filter((t) => t.assignee_id === profile?.id),
    [tasks, profile?.id],
  );

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  const createTask = useMutation({
    mutationFn: async (values: z.infer<typeof newTaskSchema>) => {
      if (!profile) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          title: values.title,
          description: values.description || null,
          priority: values.priority,
          due_date: values.due_date || null,
          created_by: profile.id,
          status: "unassigned",
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("activity_log").insert({
        entity_type: "task",
        entity_id: data.id,
        actor_id: profile.id,
        action: "created",
        detail: null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setCreating(false);
      toast.success("Task added to Work Needed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-caps">Work</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Work needed &amp; my work
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Anyone can post work, anyone can assign it, and every change is recorded.
            </p>
          </div>
          <Button onClick={() => setCreating(true)} disabled={loading || !profile}>
            <Plus className="size-4" />
            Add task
          </Button>
        </div>

        <div className="mt-6">
          <Tabs value={view} onValueChange={(value) => setView(value as "needed" | "mine")}>
            <TabsList>
              <TabsTrigger value="needed">Work needed ({workNeeded.length})</TabsTrigger>
              <TabsTrigger value="mine">My work ({myTasks.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {tasksQuery.isLoading ? (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : view === "needed" ? (
          <section className="mt-8 space-y-3">
            {workNeeded.length === 0 ? (
              <EmptyState
                title="No open work"
                body="Nothing is waiting to be picked up. Add a task and it will show up here for the whole team."
              />
            ) : (
              workNeeded.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  names={names}
                  onOpen={() => setOpenTaskId(task.id)}
                >
                  <div className="w-52">
                    <Select
                      value=""
                      onValueChange={(assigneeId) => {
                        const person = assignable.find((p) => p.id === assigneeId);
                        if (person) {
                          void actions.assign(task, person.id, person.full_name || person.email);
                        }
                      }}
                    >
                      <SelectTrigger aria-label={`Assign ${task.title}`}>
                        <SelectValue placeholder="Assign to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignable.map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            {person.full_name || person.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TaskCard>
              ))
            )}
          </section>
        ) : (
          <section className="mt-8 space-y-8">
            {myTasks.length === 0 ? (
              <EmptyState
                title="Nothing assigned to you"
                body="When a teammate assigns you a task it lands here, grouped by where it stands."
              />
            ) : (
              MY_WORK_STATUSES.map((status) => {
                const group = sortByPriorityThenNewest(
                  myTasks.filter((task) => task.status === status),
                );
                if (group.length === 0) return null;
                return (
                  <div key={status}>
                    <h2 className="label-caps">
                      {STATUS_LABEL[status]} ({group.length})
                    </h2>
                    <div className="mt-3 space-y-3">
                      {group.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          names={names}
                          onOpen={() => setOpenTaskId(task.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}
      </main>

      {creating && (
        <NewTaskDialog
          submitting={createTask.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(values) => createTask.mutate(values)}
        />
      )}

      {openTask && (
        <TaskDetailDialog
          task={openTask}
          names={names}
          currentUserId={profile?.id}
          isAdmin={isAdmin}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel flex flex-col items-center gap-2 p-12 text-center">
      <ClipboardList className="size-8 text-muted-foreground" />
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function TaskCard({
  task,
  names,
  onOpen,
  children,
}: {
  task: Task;
  names: Map<string, string>;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  return (
    <article className="panel flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-display text-xs font-medium uppercase tracking-wider ${PRIORITY_CLASS[task.priority]}`}
          >
            {PRIORITY_LABEL[task.priority]}
          </span>
          <span className="text-xs text-muted-foreground">
            {STATUS_LABEL[task.status]} · added {formatDate(task.created_at)}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="mt-2 text-left font-display text-lg font-semibold tracking-tight hover:underline"
        >
          {task.title}
        </button>
        {task.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>Raised by {names.get(task.created_by) ?? "someone"}</span>
          {task.assignee_id && <span>Assigned to {names.get(task.assignee_id) ?? "someone"}</span>}
          {task.due_date && (
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              Due {formatDate(task.due_date)}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <Button variant="outline" size="sm" onClick={onOpen}>
          Open
        </Button>
      </div>
    </article>
  );
}

function NewTaskDialog({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: z.infer<typeof newTaskSchema>) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const parsed = newTaskSchema.safeParse({ title, description, priority, due_date: dueDate });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a task</DialogTitle>
          <DialogDescription>
            New tasks start in Work Needed so anyone can pick them up or assign them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TaskPriority)}
              >
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRIORITY_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

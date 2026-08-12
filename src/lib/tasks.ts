import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type TaskPriority = Database["public"]["Enums"]["task_priority"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];

export type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  created_by: string;
  assignee_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityEntry = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  action: string;
  detail: string | null;
  created_at: string;
};

export const TASK_SELECT =
  "id, title, description, priority, status, created_by, assignee_id, due_date, completed_at, created_at, updated_at";

/** Order used to group the "I raised" board. */
export const RAISED_STATUSES: TaskStatus[] = [
  "unassigned",
  "assigned",
  "accepted",
  "in_progress",
  "completed",
  "declined",
];

export const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Tailwind classes per priority, built from semantic tokens only. */
export const PRIORITY_CLASS: Record<TaskPriority, string> = {
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-primary/30 bg-primary/10 text-primary",
  low: "border-border bg-muted text-muted-foreground",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  unassigned: "Work needed",
  assigned: "Assigned",
  accepted: "Accepted",
  declined: "Declined",
  in_progress: "In progress",
  completed: "Completed",
};

/** Order used to group the "My work" board. */
export const MY_WORK_STATUSES: TaskStatus[] = [
  "assigned",
  "accepted",
  "in_progress",
  "completed",
  "declined",
];

/** Highest priority first, then newest first. */
export function sortByPriorityThenNewest(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const ACTIVITY_LABEL: Record<string, string> = {
  created: "created this task",
  assigned: "assigned this task",
  accepted: "accepted this task",
  declined: "declined this task",
  in_progress: "started work",
  completed: "marked this complete",
};

export function activitySentence(entry: ActivityEntry): string {
  return ACTIVITY_LABEL[entry.action] ?? entry.action.replace(/_/g, " ");
}

/** Append a row to the shared activity log. Never blocks the caller's flow. */
export async function logTaskActivity(input: {
  taskId: string;
  actorId: string;
  action: string;
  detail?: string | null;
}) {
  const { error } = await supabase.from("activity_log").insert({
    entity_type: "task",
    entity_id: input.taskId,
    actor_id: input.actorId,
    action: input.action,
    detail: input.detail ?? null,
  });
  if (error) console.error("activity log write failed", error);
}

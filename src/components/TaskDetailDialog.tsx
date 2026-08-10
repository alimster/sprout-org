import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTaskActions } from "@/hooks/use-task-actions";
import {
  activitySentence,
  formatDate,
  formatDateTime,
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type ActivityEntry,
  type Task,
} from "@/lib/tasks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  task: Task;
  names: Map<string, string>;
  currentUserId: string | undefined;
  isAdmin: boolean;
  onClose: () => void;
};

export function TaskDetailDialog({ task, names, currentUserId, isAdmin, onClose }: Props) {
  const actions = useTaskActions(currentUserId);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const activity = useQuery({
    queryKey: ["task-activity", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, entity_type, entity_id, actor_id, action, detail, created_at")
        .eq("entity_type", "task")
        .eq("entity_id", task.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ActivityEntry[];
    },
  });

  const isAssignee = !!currentUserId && task.assignee_id === currentUserId;
  const isCreator = !!currentUserId && task.created_by === currentUserId;
  const canDelete = isCreator || isAdmin;

  async function run(fn: () => Promise<boolean>, close = false) {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok && close) onClose();
  }

  async function submitDecline() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    await run(() => actions.decline(task, trimmed.slice(0, 500)), true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left">{task.title}</DialogTitle>
          <DialogDescription className="text-left">
            Created by {names.get(task.created_by) ?? "someone"} on {formatDate(task.created_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-display text-xs font-medium uppercase tracking-wider ${PRIORITY_CLASS[task.priority]}`}
          >
            {PRIORITY_LABEL[task.priority]}
          </span>
          <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {STATUS_LABEL[task.status]}
          </span>
          {task.due_date && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" />
              Due {formatDate(task.due_date)}
            </span>
          )}
        </div>

        {task.description && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {task.description}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div>
            <dt className="label-caps">Assignee</dt>
            <dd className="mt-0.5">
              {task.assignee_id ? (names.get(task.assignee_id) ?? "Unknown") : "Nobody yet"}
            </dd>
          </div>
          <div>
            <dt className="label-caps">Completed</dt>
            <dd className="mt-0.5">{formatDate(task.completed_at)}</dd>
          </div>
        </dl>

        {isAssignee && task.status !== "completed" && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="label-caps">Your actions</p>
            {declining ? (
              <div className="space-y-2">
                <Label htmlFor="decline-reason">Reason for declining</Label>
                <Textarea
                  id="decline-reason"
                  value={reason}
                  maxLength={500}
                  placeholder="Let the team know why this isn't a fit for you"
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitDecline} disabled={busy || !reason.trim()}>
                    Submit decline
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeclining(false);
                      setReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {task.status === "assigned" && (
                  <Button size="sm" disabled={busy} onClick={() => run(() => actions.accept(task))}>
                    Accept
                  </Button>
                )}
                {task.status !== "in_progress" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => run(() => actions.start(task))}
                  >
                    Mark in progress
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(() => actions.complete(task))}
                >
                  Mark complete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDeclining(true)}
                >
                  Decline
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="label-caps">Activity</p>
          {activity.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (activity.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ol className="space-y-3 border-l border-border pl-4">
              {activity.data!.map((entry) => (
                <li key={entry.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                  <p>
                    <span className="font-medium">
                      {entry.actor_id ? (names.get(entry.actor_id) ?? "Someone") : "Someone"}
                    </span>{" "}
                    {activitySentence(entry)}
                  </p>
                  {entry.detail && (
                    <p className="mt-0.5 text-muted-foreground">{entry.detail}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        {canDelete && (
          <div className="border-t border-border pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete task
            </Button>
          </div>
        )}
      </DialogContent>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete "${task.title}"?`}
          body="The task and its activity history are permanently removed. This can't be undone."
          confirmLabel="Delete task"
          busy={busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            void run(() => actions.remove(task), true);
          }}
        />
      )}
    </Dialog>

  );
}

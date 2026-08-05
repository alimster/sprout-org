import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logTaskActivity, type Task, type TaskStatus } from "@/lib/tasks";

type Patch = {
  status: TaskStatus;
  assignee_id?: string | null;
};

/**
 * All task status changes funnel through here so every transition is written to
 * the activity log with the same shape.
 */
export function useTaskActions(actorId: string | undefined) {
  const queryClient = useQueryClient();

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["task-activity"] }),
    ]);
  }

  async function apply(
    task: Task,
    patch: Patch,
    action: string,
    detail: string | null,
    successMessage: string,
  ) {
    if (!actorId) return false;
    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    await logTaskActivity({ taskId: task.id, actorId, action, detail });
    await refresh();
    toast.success(successMessage);
    return true;
  }

  return {
    assign: (task: Task, assigneeId: string, assigneeName: string) =>
      apply(
        task,
        { status: "assigned", assignee_id: assigneeId },
        "assigned",
        `Assigned to ${assigneeName}`,
        `Assigned to ${assigneeName}`,
      ),

    accept: (task: Task) => apply(task, { status: "accepted" }, "accepted", null, "Task accepted"),

    decline: (task: Task, reason: string) =>
      apply(
        task,
        { status: "unassigned", assignee_id: null },
        "declined",
        reason,
        "Task declined and returned to Work Needed",
      ),

    start: (task: Task) =>
      apply(task, { status: "in_progress" }, "in_progress", null, "Marked in progress"),

    complete: (task: Task) =>
      apply(task, { status: "completed" }, "completed", null, "Task completed"),

    remove: async (task: Task) => {
      const { error } = await supabase.from("tasks").delete().eq("id", task.id);
      if (error) {
        toast.error(error.message);
        return false;
      }
      await refresh();
      toast.success("Task deleted");
      return true;
    },
  };
}

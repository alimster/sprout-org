import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatDateTime, type ActivityEntry } from "@/lib/tasks";
import {
  DOCUMENT_ACTIVITY_LABEL,
  DOCUMENT_STATUS_CLASS,
  DOCUMENT_STATUS_LABEL,
  logDocumentActivity,
  openDocumentFile,
  type DocumentRow,
} from "@/lib/documents";

export function DocumentDetailDialog({
  document,
  names,
  currentUserId,
  isAdmin,
  onClose,
}: {
  document: DocumentRow;
  names: Map<string, string>;
  currentUserId: string | undefined;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const canDecide =
    !!currentUserId && (isAdmin || document.assigned_signer_id === currentUserId) &&
    document.status === "pending";
  const canDelete = !!currentUserId && (isAdmin || document.uploaded_by === currentUserId);

  const activityQuery = useQuery({
    queryKey: ["document-activity", document.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, entity_type, entity_id, actor_id, action, detail, created_at")
        .eq("entity_type", "document")
        .eq("entity_id", document.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ActivityEntry[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ status, notes }: { status: "signed" | "rejected"; notes: string | null }) => {
      if (!currentUserId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("documents")
        .update({
          status,
          notes,
          signed_at: status === "signed" ? new Date().toISOString() : null,
        })
        .eq("id", document.id);
      if (error) throw error;
      await logDocumentActivity({
        documentId: document.id,
        actorId: currentUserId,
        action: status,
        detail: notes,
      });
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await queryClient.invalidateQueries({ queryKey: ["document-activity", document.id] });
      setRejecting(false);
      setReason("");
      toast.success(variables.status === "signed" ? "Marked as signed" : "Document rejected");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("documents").delete().eq("id", document.id);
      if (error) throw error;
      await supabase.storage.from("documents").remove([document.file_path]);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document deleted");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function download() {
    try {
      await openDocumentFile(document.file_path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that file");
    }
  }

  function submitRejection() {
    if (reason.trim().length === 0) {
      toast.error("A reason is required when rejecting a document");
      return;
    }
    decide.mutate({ status: "rejected", notes: reason.trim() });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8">{document.name}</DialogTitle>
          <DialogDescription>
            Uploaded {formatDate(document.created_at)} by{" "}
            {names.get(document.uploaded_by) ?? "someone"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 font-display text-xs font-medium uppercase tracking-wider ${DOCUMENT_STATUS_CLASS[document.status]}`}
            >
              {DOCUMENT_STATUS_LABEL[document.status]}
            </span>
            <span className="text-xs text-muted-foreground">
              Signer:{" "}
              {document.assigned_signer_id
                ? (names.get(document.assigned_signer_id) ?? "someone")
                : "unassigned"}
            </span>
            {document.signed_at && (
              <span className="text-xs text-muted-foreground">
                Signed {formatDateTime(document.signed_at)}
              </span>
            )}
          </div>

          {document.notes && (
            <div className="panel p-3 text-sm">
              <p className="label-caps">Reason</p>
              <p className="mt-1 text-muted-foreground">{document.notes}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void download()}>
              <Download className="size-4" />
              Open file
            </Button>
            {canDecide && !rejecting && (
              <>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ status: "signed", notes: null })}
                >
                  Mark signed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => setRejecting(true)}
                >
                  Reject
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            )}
          </div>

          {rejecting && (
            <div className="space-y-2">
              <Label htmlFor="document-reason">Reason for rejection</Label>
              <Textarea
                id="document-reason"
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={submitRejection} disabled={decide.isPending}>
                  Confirm rejection
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div>
            <p className="label-caps">History</p>
            <ul className="mt-2 space-y-2">
              {(activityQuery.data ?? []).map((entry) => (
                <li key={entry.id} className="text-sm">
                  <span className="font-medium">
                    {(entry.actor_id && names.get(entry.actor_id)) ?? "Someone"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {DOCUMENT_ACTIVITY_LABEL[entry.action] ?? entry.action}
                    {entry.detail ? ` — ${entry.detail}` : ""} · {formatDateTime(entry.created_at)}
                  </span>
                </li>
              ))}
              {(activityQuery.data ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">Nothing recorded yet.</li>
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

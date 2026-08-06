import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type DocumentStatus = Database["public"]["Enums"]["document_status"];

export type DocumentRow = {
  id: string;
  name: string;
  file_path: string;
  uploaded_by: string;
  assigned_signer_id: string | null;
  status: DocumentStatus;
  signed_at: string | null;
  notes: string | null;
  created_at: string;
};

export const DOCUMENT_SELECT =
  "id, name, file_path, uploaded_by, assigned_signer_id, status, signed_at, notes, created_at";

export const DOCUMENT_STATUSES: DocumentStatus[] = ["pending", "signed", "rejected"];

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  pending: "Pending",
  signed: "Signed",
  rejected: "Rejected",
};

/** Badge classes per status — semantic tokens only. */
export const DOCUMENT_STATUS_CLASS: Record<DocumentStatus, string> = {
  pending: "border-primary/30 bg-primary/10 text-primary",
  signed: "border-border bg-muted text-foreground",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
];

export const ACCEPT_ATTRIBUTE = ".pdf,.docx,image/*";

/** Returns an error message when the file is not an acceptable upload. */
export function validateDocumentFile(file: File): string | null {
  if (file.size > MAX_DOCUMENT_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That file is ${mb}MB. The limit is 10MB — please upload a smaller file.`;
  }
  const name = file.name.toLowerCase();
  const looksAccepted =
    ACCEPTED_DOCUMENT_TYPES.includes(file.type) ||
    file.type.startsWith("image/") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx");
  if (!looksAccepted) {
    return "Only PDF, DOCX, and image files can be uploaded.";
  }
  return null;
}

/** Storage keys are namespaced by uploader so storage policies can match the row rules. */
export function buildStoragePath(userId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
  return `${userId}/${crypto.randomUUID()}-${safe}`;
}

export async function openDocumentFile(filePath: string) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(filePath, 60);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export async function logDocumentActivity(input: {
  documentId: string;
  actorId: string;
  action: string;
  detail?: string | null;
}) {
  const { error } = await supabase.from("activity_log").insert({
    entity_type: "document",
    entity_id: input.documentId,
    actor_id: input.actorId,
    action: input.action,
    detail: input.detail ?? null,
  });
  if (error) console.error("document activity log write failed", error);
}

export const DOCUMENT_ACTIVITY_LABEL: Record<string, string> = {
  uploaded: "uploaded this document",
  signed: "marked this signed",
  rejected: "rejected this document",
};

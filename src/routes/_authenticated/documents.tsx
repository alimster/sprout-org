import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  Check,
  Download,
  FileText,
  Inbox,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/AppHeader";
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

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({
    meta: [
      { title: "Documents & signatures · Northwind Ops" },
      {
        name: "description",
        content:
          "Upload company documents, assign a signer, and track what is pending, signed, or rejected.",
      },
      { property: "og:title", content: "Documents & signatures · Northwind Ops" },
      {
        property: "og:description",
        content: "Upload, assign, and sign off on internal documents.",
      },
    ],
  }),
  component: DocumentsPage,
});

const ALL = "__all__";
const NONE = "__none__";
const MAX_BYTES = 10 * 1024 * 1024;

const ACCEPTED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

type DocStatus = "pending" | "signed" | "rejected";

type DocumentRow = {
  id: string;
  name: string;
  file_path: string;
  uploaded_by: string;
  assigned_signer_id: string | null;
  status: DocStatus;
  signed_at: string | null;
  notes: string | null;
  created_at: string;
};

type Person = { id: string; full_name: string; email: string };

const uploadSchema = z.object({
  name: z.string().trim().min(1, "Give the document a name").max(160),
  assigned_signer_id: z.string().nullable(),
});

function statusClasses(status: DocStatus) {
  if (status === "signed") return "bg-primary/10 text-primary";
  if (status === "rejected") return "bg-destructive/10 text-destructive";
  return "bg-accent text-accent-foreground";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DocumentsPage() {
  const { profile, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [signer, setSigner] = useState<string>(ALL);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [rejecting, setRejecting] = useState<DocumentRow | null>(null);

  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select(
          "id, name, file_path, uploaded_by, assigned_signer_id, status, signed_at, notes, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
    },
  });

  const people = useQuery({
    queryKey: ["people-basic"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data as Person[];
    },
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people.data ?? []) map.set(p.id, p.full_name || p.email);
    return map;
  }, [people.data]);

  const rows = docs.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (tab === "mine" && !(d.assigned_signer_id === profile?.id && d.status === "pending"))
        return false;
      if (status !== ALL && d.status !== status) return false;
      if (signer !== ALL) {
        if (signer === NONE ? d.assigned_signer_id !== null : d.assigned_signer_id !== signer)
          return false;
      }
      if (q && !d.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tab, status, signer, search, profile?.id]);

  const awaitingCount = useMemo(
    () =>
      rows.filter((d) => d.assigned_signer_id === profile?.id && d.status === "pending").length,
    [rows, profile?.id],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["documents"] });

  const decide = useMutation({
    mutationFn: async ({
      doc,
      next,
      notes,
    }: {
      doc: DocumentRow;
      next: "signed" | "rejected";
      notes?: string;
    }) => {
      const { error } = await supabase
        .from("documents")
        .update({
          status: next,
          signed_at: next === "signed" ? new Date().toISOString() : null,
          notes: next === "rejected" ? (notes ?? "") : doc.notes,
        })
        .eq("id", doc.id);
      if (error) throw error;

      const { error: logError } = await supabase.from("activity_log").insert({
        actor_id: profile!.id,
        entity_type: "document",
        entity_id: doc.id,
        action: next === "signed" ? "document_signed" : "document_rejected",
        detail: next === "rejected" ? (notes ?? null) : doc.name,
      });
      if (logError) throw logError;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.next === "signed" ? "Document signed." : "Document rejected.");
      setRejecting(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (doc: DocumentRow) => {
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
      await supabase.storage.from("documents").remove([doc.file_path]);
    },
    onSuccess: () => {
      toast.success("Document deleted.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function openFile(doc: DocumentRow) {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) {
      toast.error("You don't have access to this file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-caps">Documents</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Documents &amp; signatures
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a file, assign a signer, and track sign-off.
            </p>
          </div>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" />
            Upload document
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "mine")} className="mt-8">
          <TabsList>
            <TabsTrigger value="all">
              <FileText className="size-4" />
              All documents
            </TabsTrigger>
            <TabsTrigger value="mine">
              <Inbox className="size-4" />
              Awaiting my signature
              {awaitingCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {awaitingCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by document name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search documents"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="signed">Signed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={signer} onValueChange={setSigner}>
            <SelectTrigger className="w-48" aria-label="Filter by signer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All signers</SelectItem>
              <SelectItem value={NONE}>Unassigned</SelectItem>
              {(people.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-6">
          {loading || docs.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="panel p-10 text-center">
              <FileText className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 font-display text-lg font-semibold">
                {rows.length === 0 ? "No documents yet" : "Nothing matches those filters"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {rows.length === 0
                  ? "Upload a PDF, Word file, or image and assign someone to sign it."
                  : "Try clearing the search or filters."}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((doc) => {
                const canDecide =
                  doc.status === "pending" &&
                  (doc.assigned_signer_id === profile?.id || isAdmin);
                const canDelete = doc.uploaded_by === profile?.id || isAdmin;
                return (
                  <li key={doc.id} className="panel p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-display text-base font-semibold">
                            {doc.name}
                          </h3>
                          <span
                            className={`rounded-full px-2 py-0.5 font-display text-[11px] font-medium uppercase tracking-wider ${statusClasses(doc.status)}`}
                          >
                            {doc.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Uploaded by {nameById.get(doc.uploaded_by) ?? "—"} ·{" "}
                          {formatDate(doc.created_at)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Signer:{" "}
                          {doc.assigned_signer_id
                            ? (nameById.get(doc.assigned_signer_id) ?? "—")
                            : "Unassigned"}
                          {doc.signed_at && ` · signed ${formatDate(doc.signed_at)}`}
                        </p>
                        {doc.status === "rejected" && doc.notes && (
                          <p className="mt-2 text-sm text-destructive">Reason: {doc.notes}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => void openFile(doc)}>
                          <Download className="size-4" />
                          Open
                        </Button>
                        {canDecide && (
                          <>
                            <Button
                              size="sm"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ doc, next: "signed" })}
                            >
                              <Check className="size-4" />
                              Sign
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setRejecting(doc)}
                            >
                              <X className="size-4" />
                              Reject
                            </Button>
                          </>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${doc.name}`}
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(doc)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        people={people.data ?? []}
        uploaderId={profile?.id ?? null}
        onUploaded={invalidate}
      />

      <RejectDialog
        doc={rejecting}
        onClose={() => setRejecting(null)}
        pending={decide.isPending}
        onSubmit={(notes) =>
          rejecting && decide.mutate({ doc: rejecting, next: "rejected", notes })
        }
      />
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  people,
  uploaderId,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: Person[];
  uploaderId: string | null;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [signerId, setSignerId] = useState(NONE);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setSignerId(NONE);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!uploaderId) return;

    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
      );
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Only PDF, Word documents, and images are accepted.");
      return;
    }

    const parsed = uploadSchema.safeParse({
      name: name || file.name,
      assigned_signer_id: signerId === NONE ? null : signerId,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }

    setBusy(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${uploaderId}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("documents").insert({
        name: parsed.data.name,
        file_path: path,
        uploaded_by: uploaderId,
        assigned_signer_id: parsed.data.assigned_signer_id,
      });
      if (insertError) {
        await supabase.storage.from("documents").remove([path]);
        throw insertError;
      }

      await supabase.from("activity_log").insert({
        actor_id: uploaderId,
        entity_type: "document",
        action: "document_uploaded",
        detail: parsed.data.name,
      });

      toast.success("Document uploaded.");
      reset();
      onOpenChange(false);
      onUploaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            PDF, Word, or image files up to 10 MB. Assigning a signer asks them to sign off.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-file">File</Label>
            <Input
              id="doc-file"
              type="file"
              ref={fileRef}
              accept=".pdf,.doc,.docx,image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && !name) setName(file.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-name">Document name</Label>
            <Input
              id="doc-name"
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 contractor agreement"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-signer">Assigned signer (optional)</Label>
            <Select value={signerId} onValueChange={setSignerId}>
              <SelectTrigger id="doc-signer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No signer</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  doc,
  onClose,
  pending,
  onSubmit,
}: {
  doc: DocumentRow | null;
  onClose: () => void;
  pending: boolean;
  onSubmit: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");

  return (
    <Dialog
      open={!!doc}
      onOpenChange={(next) => {
        if (!next) {
          setNotes("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject “{doc?.name}”</DialogTitle>
          <DialogDescription>
            A reason is required and is saved with the document.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            value={notes}
            maxLength={1000}
            rows={4}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why are you rejecting this document?"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (!notes.trim()) {
                toast.error("Add a reason before rejecting.");
                return;
              }
              onSubmit(notes.trim());
              setNotes("");
            }}
          >
            Reject document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

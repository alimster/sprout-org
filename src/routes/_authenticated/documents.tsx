import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/AppHeader";
import { DocumentDetailDialog } from "@/components/DocumentDetailDialog";
import { formatDate } from "@/lib/tasks";
import {
  ACCEPT_ATTRIBUTE,
  buildStoragePath,
  DOCUMENT_SELECT,
  DOCUMENT_STATUS_CLASS,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_STATUSES,
  logDocumentActivity,
  validateDocumentFile,
  type DocumentRow,
  type DocumentStatus,
} from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
          "Upload contracts and files, assign a signer, and track what is pending, signed, or rejected across the team.",
      },
      { property: "og:title", content: "Documents & signatures · Northwind Ops" },
      {
        property: "og:description",
        content: "Northwind's private document store with signer assignment and status tracking.",
      },
    ],
  }),
  component: DocumentsPage,
});

type Person = { id: string; full_name: string; email: string; is_active: boolean };

function DocumentsPage() {
  const { profile, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"all" | "mine">("all");
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [signerFilter, setSignerFilter] = useState<string>("all");

  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select(DOCUMENT_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
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

  const documents = documentsQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const names = useMemo(
    () => new Map(people.map((p) => [p.id, p.full_name || p.email])),
    [people],
  );
  const signers = useMemo(() => people.filter((p) => p.is_active), [people]);

  const awaitingMe = useMemo(
    () => documents.filter((d) => d.status === "pending" && d.assigned_signer_id === profile?.id),
    [documents, profile?.id],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = view === "mine" ? awaitingMe : documents;
    return base.filter((doc) => {
      if (term && !doc.name.toLowerCase().includes(term)) return false;
      if (statusFilter !== "all" && doc.status !== statusFilter) return false;
      if (signerFilter === "unassigned" && doc.assigned_signer_id) return false;
      if (
        signerFilter !== "all" &&
        signerFilter !== "unassigned" &&
        doc.assigned_signer_id !== signerFilter
      )
        return false;
      return true;
    });
  }, [documents, awaitingMe, view, search, statusFilter, signerFilter]);

  const upload = useMutation({
    mutationFn: async ({
      file,
      name,
      signerId,
    }: {
      file: File;
      name: string;
      signerId: string | null;
    }) => {
      if (!profile) throw new Error("Not signed in");
      const path = buildStoragePath(profile.id, file.name);
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, file, file.type ? { contentType: file.type } : undefined);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("documents")
        .insert({
          name,
          file_path: path,
          uploaded_by: profile.id,
          assigned_signer_id: signerId,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) {
        await supabase.storage.from("documents").remove([path]);
        throw error;
      }
      await logDocumentActivity({
        documentId: data.id,
        actorId: profile.id,
        action: "uploaded",
        detail: signerId ? `assigned to ${names.get(signerId) ?? "a signer"}` : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      setUploading(false);
      toast.success("Document uploaded");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openDoc = documents.find((d) => d.id === openId) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-caps">Documents</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Documents &amp; signatures
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Files are stored privately — only the uploader, the assigned signer, and admins can
              open them.
            </p>
          </div>
          <Button onClick={() => setUploading(true)} disabled={loading || !profile}>
            <Upload className="size-4" />
            Upload document
          </Button>
        </div>

        <div className="mt-6">
          <Tabs value={view} onValueChange={(value) => setView(value as "all" | "mine")}>
            <TabsList>
              <TabsTrigger value="all">All documents ({documents.length})</TabsTrigger>
              <TabsTrigger value="mine">
                Awaiting my signature ({awaitingMe.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <Label htmlFor="document-search" className="sr-only">
              Search documents
            </Label>
            <Input
              id="document-search"
              placeholder="Search by name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="w-40">
            <Label htmlFor="document-status-filter" className="sr-only">
              Filter by status
            </Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="document-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {DOCUMENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {DOCUMENT_STATUS_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-52">
            <Label htmlFor="document-signer-filter" className="sr-only">
              Filter by signer
            </Label>
            <Select value={signerFilter} onValueChange={setSignerFilter}>
              <SelectTrigger id="document-signer-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All signers</SelectItem>
                <SelectItem value="unassigned">No signer</SelectItem>
                {signers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.full_name || person.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {documentsQuery.isLoading ? (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel mt-8 flex flex-col items-center gap-2 p-12 text-center">
            <FileText className="size-8 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold">No documents here</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {view === "mine"
                ? "Nothing is waiting on your signature right now."
                : "Upload a PDF, DOCX, or image and optionally pick who needs to sign it."}
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {filtered.map((doc) => (
              <li key={doc.id}>
                <article className="panel flex flex-wrap items-start justify-between gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-display text-xs font-medium uppercase tracking-wider ${DOCUMENT_STATUS_CLASS[doc.status]}`}
                      >
                        {DOCUMENT_STATUS_LABEL[doc.status]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Uploaded {formatDate(doc.created_at)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenId(doc.id)}
                      className="mt-2 text-left font-display text-lg font-semibold tracking-tight hover:underline"
                    >
                      {doc.name}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>From {names.get(doc.uploaded_by) ?? "someone"}</span>
                      <span>
                        Signer:{" "}
                        {doc.assigned_signer_id
                          ? (names.get(doc.assigned_signer_id) ?? "someone")
                          : "unassigned"}
                      </span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setOpenId(doc.id)}>
                    Open
                  </Button>
                </article>
              </li>
            ))}
          </ul>
        )}
      </main>

      {uploading && (
        <UploadDialog
          signers={signers}
          submitting={upload.isPending}
          onCancel={() => setUploading(false)}
          onSubmit={(values) => upload.mutate(values)}
        />
      )}

      {openDoc && (
        <DocumentDetailDialog
          document={openDoc}
          names={names}
          currentUserId={profile?.id}
          isAdmin={isAdmin}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function UploadDialog({
  signers,
  submitting,
  onCancel,
  onSubmit,
}: {
  signers: Person[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: { file: File; name: string; signerId: string | null }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [signerId, setSignerId] = useState<string>("none");
  const [error, setError] = useState<string | null>(null);

  function pick(next: File | null) {
    if (!next) {
      setFile(null);
      return;
    }
    const problem = validateDocumentFile(next);
    if (problem) {
      setError(problem);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(next);
    if (!name.trim()) setName(next.name.replace(/\.[^.]+$/, ""));
  }

  function submit() {
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    if (!name.trim()) {
      setError("Give the document a name.");
      return;
    }
    setError(null);
    onSubmit({
      file,
      name: name.trim().slice(0, 160),
      signerId: signerId === "none" ? null : signerId,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            PDF, DOCX, or images up to 10MB. Files stay private to you, the signer, and admins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-file">File</Label>
            <Input
              id="document-file"
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-name">Document name</Label>
            <Input
              id="document-name"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-signer">Assigned signer (optional)</Label>
            <Select value={signerId} onValueChange={setSignerId}>
              <SelectTrigger id="document-signer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No signer</SelectItem>
                {signers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.full_name || person.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { DocumentStatus };

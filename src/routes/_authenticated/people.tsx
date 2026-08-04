import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/AppHeader";
import { parseInviteCsv, type InviteRow, type RowError } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/people")({
  head: () => ({
    meta: [
      { title: "People · Northwind Ops" },
      { name: "description", content: "Manage invitations and roles for the Northwind workspace." },
      { property: "og:title", content: "People · Northwind Ops" },
      { property: "og:description", content: "Admin-only invitation management." },
    ],
  }),
  component: PeoplePage,
});

type Invitation = {
  id: string;
  email: string;
  full_name: string;
  title: string | null;
  department: string | null;
  manager_email: string | null;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  created_at: string;
};

const singleInvite = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(255),
  full_name: z.string().trim().min(1, "Name is required").max(120),
  title: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  manager_email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).optional(),
  role: z.enum(["admin", "member"]),
});

function PeoplePage() {
  const { isAdmin, loading, session } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    title: "",
    department: "",
    manager_email: "",
    role: "member" as "admin" | "member",
  });
  const [csvErrors, setCsvErrors] = useState<{ fatal?: string; errors: RowError[] } | null>(null);

  const invitations = useQuery({
    queryKey: ["invitations"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invitation[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["invitations"] });

  const addOne = useMutation({
    mutationFn: async () => {
      const parsed = singleInvite.parse(form);
      const { error } = await supabase.from("invitations").insert({
        email: parsed.email,
        full_name: parsed.full_name,
        title: parsed.title || null,
        department: parsed.department || null,
        manager_email: parsed.manager_email || null,
        role: parsed.role,
        invited_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation created");
      setForm({
        email: "",
        full_name: "",
        title: "",
        department: "",
        manager_email: "",
        role: "member",
      });
      void invalidate();
    },
    onError: (error: unknown) => {
      if (error instanceof z.ZodError) {
        toast.error(error.issues[0]!.message);
        return;
      }
      const message = error instanceof Error ? error.message : "";
      toast.error(
        /duplicate|unique/i.test(message)
          ? "There's already an invitation for that email."
          : "Couldn't create the invitation.",
      );
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "revoked" }) => {
      const { error } = await supabase
        .from("invitations")
        .update({ status, accepted_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void invalidate(),
    onError: () => toast.error("Couldn't update that invitation."),
  });

  const bulkImport = useMutation({
    mutationFn: async (rows: InviteRow[]) => {
      const { error } = await supabase
        .from("invitations")
        .insert(rows.map((r) => ({ ...r, invited_by: session?.user.id ?? null })));
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(`Imported ${count} invitation${count === 1 ? "" : "s"}`);
      void invalidate();
    },
    onError: () => toast.error("Import failed — nothing was written."),
  });

  async function handleFile(file: File) {
    setCsvErrors(null);
    const text = await file.text();
    const existing = (invitations.data ?? []).map((i) => i.email);
    const result = parseInviteCsv(text, existing);
    if (!result.ok) {
      setCsvErrors({ fatal: result.fatal, errors: result.errors });
      toast.error("Import rejected — fix the rows below and upload again.");
      return;
    }
    if (result.skipped.length > 0) {
      toast.message(`Skipping ${result.skipped.length} email(s) already invited.`);
    }
    if (result.rows.length === 0) {
      toast.message("Nothing new to import.");
      return;
    }
    bulkImport.mutate(result.rows);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader isAdmin={false} />
        <main className="mx-auto max-w-5xl px-6 py-12">
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader isAdmin={false} />
        <main className="mx-auto max-w-5xl px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have permission to manage people.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin />
      <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only invited emails can create an account.
          </p>
        </div>

        <section className="panel p-6">
          <h2 className="text-base font-semibold">Invite one person</h2>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              addOne.mutate();
            }}
          >
            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Full name" required>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </Field>
            <Field label="Job title">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Department">
              <Input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
            <Field label="Manager email">
              <Input
                type="email"
                value={form.manager_email}
                onChange={(e) => setForm({ ...form, manager_email: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as "admin" | "member" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={addOne.isPending}>
                {addOne.isPending ? "Inviting…" : "Send invitation"}
              </Button>
            </div>
          </form>
        </section>

        <section className="panel p-6">
          <h2 className="text-base font-semibold">Bulk import</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            CSV columns: <code>email, full_name, title, department, manager_email, role</code>. Every
            row is validated first — if any row is invalid, nothing is imported.
          </p>
          <div className="mt-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={bulkImport.isPending}
            >
              <Upload className="size-4" />
              {bulkImport.isPending ? "Importing…" : "Upload CSV"}
            </Button>
          </div>
          {csvErrors && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Import rejected — nothing was written.</p>
              {csvErrors.fatal && <p className="mt-2 text-muted-foreground">{csvErrors.fatal}</p>}
              {csvErrors.errors.length > 0 && (
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {csvErrors.errors.map((row) => (
                    <li key={row.line}>
                      <span className="font-medium text-foreground">Line {row.line}:</span>{" "}
                      {row.problems.join("; ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-border p-6">
            <h2 className="text-base font-semibold">Invitations</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.isLoading && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {invitations.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No invitations yet.
                  </TableCell>
                </TableRow>
              )}
              {invitations.data?.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-medium">{invite.email}</TableCell>
                  <TableCell>{invite.full_name}</TableCell>
                  <TableCell className="capitalize">{invite.role}</TableCell>
                  <TableCell>
                    <span className="label-caps">{invite.status}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {invite.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatus.mutate({ id: invite.id, status: "revoked" })}
                      >
                        Revoke
                      </Button>
                    )}
                    {invite.status === "revoked" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatus.mutate({ id: invite.id, status: "pending" })}
                      >
                        Re-invite
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </main>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

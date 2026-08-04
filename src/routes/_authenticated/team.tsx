import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { LayoutGrid, Network, Pencil, Search, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/AppHeader";
import { OrgChart } from "@/components/OrgChart";
import { buildOrgTree, countNodes, descendantIds, type TeamMember } from "@/lib/org-tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team directory & org chart · Northwind Ops" },
      {
        name: "description",
        content:
          "Search the Northwind team directory by department and explore the reporting structure as an expandable org chart.",
      },
      { property: "og:title", content: "Team directory & org chart · Northwind Ops" },
      {
        property: "og:description",
        content: "Every teammate, their department, and who they report to.",
      },
    ],
  }),
  component: TeamPage,
});

const ALL = "__all__";
const NONE = "__none__";

const editSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120),
  title: z.string().trim().max(120),
  department: z.string().trim().max(120),
  manager_id: z.string().nullable(),
  is_active: z.boolean(),
});

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(255),
  full_name: z.string().trim().min(1, "Name is required").max(120),
  title: z.string().trim().max(120),
  department: z.string().trim().max(120),
  manager_email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]),
  role: z.enum(["admin", "member"]),
});

function TeamPage() {
  const { isAdmin, loading, profile } = useAuth();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"directory" | "chart">("directory");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [inviting, setInviting] = useState(false);

  const team = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, title, department, email, manager_id, is_active")
        .order("full_name");
      if (error) throw error;
      return data as TeamMember[];
    },
  });

  const members = team.data ?? [];
  const visible = useMemo(
    () => (showInactive ? members : members.filter((m) => m.is_active)),
    [members, showInactive],
  );

  const departments = useMemo(
    () =>
      Array.from(new Set(visible.map((m) => m.department).filter((d): d is string => !!d))).sort(),
    [visible],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible.filter((m) => {
      if (department !== ALL && (m.department ?? "") !== department) return false;
      if (!q) return true;
      return [m.full_name, m.title, m.department, m.email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [visible, search, department]);

  const tree = useMemo(() => buildOrgTree(filtered), [filtered]);

  const toggleNode = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["team"] });

  const saveMember = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: z.infer<typeof editSchema> }) => {
      const canEditAll = isAdmin;
      const patch = canEditAll
        ? {
            full_name: values.full_name,
            title: values.title || null,
            department: values.department || null,
            manager_id: values.manager_id,
            is_active: values.is_active,
          }
        : { title: values.title || null, department: values.department || null };
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team member updated");
      setEditing(null);
      void invalidate();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      if (/circular|own manager|too deep/i.test(message)) {
        toast.error("That would create a circular reporting line.");
        return;
      }
      if (/only change your own/i.test(message)) {
        toast.error("You can only change your own job title and department.");
        return;
      }
      toast.error("Couldn't save those changes.");
    },
  });

  const invite = useMutation({
    mutationFn: async (values: z.infer<typeof inviteSchema>) => {
      const { error } = await supabase.from("invitations").insert({
        email: values.email,
        full_name: values.full_name,
        title: values.title || null,
        department: values.department || null,
        manager_email: values.manager_email || null,
        role: values.role,
        invited_by: profile?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation created — they'll appear here once they sign up.");
      setInviting(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        /duplicate|unique/i.test(message)
          ? "There's already an invitation for that email."
          : "Couldn't create that invitation.",
      );
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Team</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {members.length > 0
                ? `${visible.length} ${showInactive ? "people" : "active people"} · ${departments.length} department${departments.length === 1 ? "" : "s"}`
                : "The directory and reporting structure for everyone in the workspace."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="secondary" size="sm" onClick={() => setInviting(true)}>
                <UserPlus className="size-4" />
                Add team member
              </Button>
            )}
            <Tabs value={view} onValueChange={(v) => setView(v as "directory" | "chart")}>
              <TabsList>
                <TabsTrigger value="directory">
                  <LayoutGrid className="size-4" />
                  Directory
                </TabsTrigger>
                <TabsTrigger value="chart">
                  <Network className="size-4" />
                  Org chart
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {loading || team.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState isAdmin={isAdmin} onInvite={() => setInviting(true)} />
        ) : (
          <>
            <section className="panel flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search name, title, department or email"
                  aria-label="Search team"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="w-52" aria-label="Filter by department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={showInactive} onCheckedChange={setShowInactive} />
                  Show inactive
                </label>
              )}
            </section>

            {filtered.length === 0 ? (
              <div className="panel p-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Nobody matches that search or department filter.
                </p>
              </div>
            ) : view === "directory" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {filtered.map((member) => {
                  const manager = members.find((m) => m.id === member.manager_id);
                  const canEdit = isAdmin || member.id === profile?.id;
                  return (
                    <article key={member.id} className="panel p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-semibold">
                            {member.full_name}
                            {!member.is_active && (
                              <span className="ml-2 label-caps text-muted-foreground">inactive</span>
                            )}
                          </h2>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {member.title || "No title yet"}
                          </p>
                        </div>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(member)}
                            aria-label={`Edit ${member.full_name}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                      </div>
                      <dl className="mt-4 space-y-1.5 text-sm">
                        <Row term="Department" value={member.department || "—"} />
                        <Row term="Email" value={member.email} />
                        <Row term="Reports to" value={manager?.full_name || "—"} />
                      </dl>
                    </article>
                  );
                })}
              </div>
            ) : (
              <section className="panel p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="label-caps">Reporting structure · {countNodes(tree)} people</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setCollapsedIds(new Set())}>
                      Expand all
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCollapsedIds(new Set(filtered.map((m) => m.id)))}
                    >
                      Collapse all
                    </Button>
                  </div>
                </div>
                <OrgChart nodes={tree} collapsedIds={collapsedIds} onToggle={toggleNode} />
              </section>
            )}
          </>
        )}
      </main>

      {editing && (
        <EditDialog
          member={editing}
          members={members}
          isAdmin={isAdmin}
          pending={saveMember.isPending}
          onClose={() => setEditing(null)}
          onSave={(values) => saveMember.mutate({ id: editing.id, values })}
        />
      )}

      {inviting && (
        <InviteDialog
          pending={invite.isPending}
          onClose={() => setInviting(false)}
          onSave={(values) => invite.mutate(values)}
        />
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

function EmptyState({ isAdmin, onInvite }: { isAdmin: boolean; onInvite: () => void }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Users className="size-5" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">No team members yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Invite your colleagues — as soon as they create their account they'll show up in the directory and the org chart."
          : "Once your colleagues create their accounts, the directory and org chart will fill in here."}
      </p>
      {isAdmin && (
        <Button className="mt-6" onClick={onInvite}>
          <UserPlus className="size-4" />
          Add team member
        </Button>
      )}
    </div>
  );
}

function EditDialog({
  member,
  members,
  isAdmin,
  pending,
  onClose,
  onSave,
}: {
  member: TeamMember;
  members: TeamMember[];
  isAdmin: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (values: z.infer<typeof editSchema>) => void;
}) {
  const [form, setForm] = useState({
    full_name: member.full_name,
    title: member.title ?? "",
    department: member.department ?? "",
    manager_id: member.manager_id ?? NONE,
    is_active: member.is_active,
  });

  // Nobody in this person's own sub-tree can be their manager — that's a cycle.
  const blocked = useMemo(() => descendantIds(members, member.id), [members, member.id]);
  const managerOptions = members.filter((m) => !blocked.has(m.id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {member.full_name}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Update this person's details and reporting line."
              : "You can update your own job title and department."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = editSchema.safeParse({
              ...form,
              manager_id: form.manager_id === NONE ? null : form.manager_id,
            });
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]!.message);
              return;
            }
            onSave(parsed.data);
          }}
        >
          <div className="space-y-2 sm:col-span-2">
            <Label>Full name</Label>
            <Input
              value={form.full_name}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Job title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Email</Label>
            <Input value={member.email} disabled readOnly />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Manager</Label>
            <Select
              value={form.manager_id}
              disabled={!isAdmin}
              onValueChange={(v) => setForm({ ...form, manager_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="No manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No manager (top of the org)</SelectItem>
                {managerOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                    {m.title ? ` — ${m.title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin && (
              <p className="text-xs text-muted-foreground">
                People who report to {member.full_name} are hidden here to prevent circular
                reporting.
              </p>
            )}
          </div>
          {isAdmin && (
            <label className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <span className="text-sm">Active team member</span>
            </label>
          )}

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  pending,
  onClose,
  onSave,
}: {
  pending: boolean;
  onClose: () => void;
  onSave: (values: z.infer<typeof inviteSchema>) => void;
}) {
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    title: "",
    department: "",
    manager_email: "",
    role: "member" as "admin" | "member",
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            This creates their invitation. Their directory entry and place in the org chart appear as
            soon as they sign up.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = inviteSchema.safeParse(form);
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]!.message);
              return;
            }
            onSave(parsed.data);
          }}
        >
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Full name</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Job title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Manager email</Label>
            <Input
              type="email"
              value={form.manager_email}
              onChange={(e) => setForm({ ...form, manager_email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
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
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Inviting…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

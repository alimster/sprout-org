
import { ChevronRight, User } from "lucide-react";
import type { OrgNode } from "@/lib/org-tree";
import { cn } from "@/lib/utils";

export function OrgChart({
  nodes,
  collapsedIds,
  onToggle,
}: {
  nodes: OrgNode[];
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {nodes.map((node) => (
        <OrgBranch key={node.member.id} node={node} collapsedIds={collapsedIds} onToggle={onToggle} />
      ))}
    </ul>
  );
}

function OrgBranch({
  node,
  collapsedIds,
  onToggle,
}: {
  node: OrgNode;
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedIds.has(node.member.id);

  return (
    <li>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggle(node.member.id)}
          disabled={!hasChildren}
          aria-expanded={hasChildren ? !collapsed : undefined}
          aria-label={
            hasChildren ? `${collapsed ? "Expand" : "Collapse"} ${node.member.full_name}` : undefined
          }
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors",
            hasChildren ? "hover:bg-accent" : "border-transparent opacity-0",
          )}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} />
        </button>
        <div className="panel flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <User className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{node.member.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {node.member.title || "No title"}
              {node.member.department ? ` · ${node.member.department}` : ""}
            </p>
          </div>
          {hasChildren && (
            <span className="ml-auto shrink-0 label-caps">
              {node.children.length} report{node.children.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {hasChildren && !collapsed && (
        <div className="ml-3 mt-2 border-l border-border pl-5">
          <OrgChart nodes={node.children} collapsedIds={collapsedIds} onToggle={onToggle} />
        </div>
      )}
    </li>
  );
}

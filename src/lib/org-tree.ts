export type TeamMember = {
  id: string;
  full_name: string;
  title: string | null;
  department: string | null;
  email: string;
  manager_id: string | null;
  is_active: boolean;
};

export type OrgNode = {
  member: TeamMember;
  children: OrgNode[];
  depth: number;
};

/**
 * Builds a real recursive tree from manager_id. Members whose manager is missing
 * (or inactive/filtered out) become roots so nobody is silently dropped.
 * Cycles are impossible at the DB level, but we still guard with a visited set.
 */
export function buildOrgTree(members: TeamMember[]): OrgNode[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const childrenOf = new Map<string, TeamMember[]>();
  const roots: TeamMember[] = [];

  for (const member of members) {
    const parentId = member.manager_id;
    if (parentId && parentId !== member.id && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(member);
      childrenOf.set(parentId, list);
    } else {
      roots.push(member);
    }
  }

  const byName = (a: TeamMember, b: TeamMember) => a.full_name.localeCompare(b.full_name);
  const visited = new Set<string>();

  function build(member: TeamMember, depth: number): OrgNode {
    visited.add(member.id);
    const kids = (childrenOf.get(member.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(byName)
      .map((child) => build(child, depth + 1));
    return { member, children: kids, depth };
  }

  return roots.sort(byName).map((root) => build(root, 0));
}

/** Every id at or below `rootId` — used to keep a manager picker cycle-free. */
export function descendantIds(members: TeamMember[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const m of members) {
    if (!m.manager_id) continue;
    const list = childrenOf.get(m.manager_id) ?? [];
    list.push(m.id);
    childrenOf.set(m.manager_id, list);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

export function countNodes(nodes: OrgNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

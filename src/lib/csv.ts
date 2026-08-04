export type InviteRow = {
  email: string;
  full_name: string;
  title: string | null;
  department: string | null;
  manager_email: string | null;
  role: "admin" | "member";
};

export type RowError = { line: number; problems: string[] };

const REQUIRED_HEADERS = ["email", "full_name"] as const;
const KNOWN_HEADERS = [
  "email",
  "full_name",
  "title",
  "department",
  "manager_email",
  "role",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export type ParseResult =
  | { ok: true; rows: InviteRow[]; skipped: string[] }
  | { ok: false; fatal?: string; errors: RowError[] };

/**
 * Validates the whole file before anything is written. If a single row is
 * invalid the entire import is rejected — no partial org charts.
 */
export function parseInviteCsv(text: string, existingEmails: string[]): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { ok: false, fatal: "The file needs a header row and at least one person.", errors: [] };
  }

  const headers = splitLine(lines[0]!).map((h) => h.toLowerCase());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      ok: false,
      fatal: `Missing required column(s): ${missing.join(", ")}. Expected headers: ${KNOWN_HEADERS.join(", ")}.`,
      errors: [],
    };
  }

  const existing = new Set(existingEmails.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const rows: InviteRow[] = [];
  const skipped: string[] = [];
  const errors: RowError[] = [];

  lines.slice(1).forEach((line, idx) => {
    const lineNo = idx + 2;
    const cells = splitLine(line);
    const get = (name: string) => {
      const at = headers.indexOf(name);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };

    const problems: string[] = [];
    const email = get("email").toLowerCase();
    const fullName = get("full_name");
    const managerEmail = get("manager_email").toLowerCase();
    const roleRaw = get("role").toLowerCase() || "member";

    if (!email) problems.push("email is empty");
    else if (!EMAIL_RE.test(email)) problems.push(`"${email}" is not a valid email`);
    else if (email.length > 255) problems.push("email is too long");

    if (!fullName) problems.push("full_name is empty");
    else if (fullName.length > 120) problems.push("full_name is too long");

    if (managerEmail && !EMAIL_RE.test(managerEmail))
      problems.push(`manager_email "${managerEmail}" is not a valid email`);
    if (managerEmail && managerEmail === email)
      problems.push("manager_email cannot be the person's own email");

    if (roleRaw !== "admin" && roleRaw !== "member")
      problems.push(`role must be "admin" or "member" (got "${roleRaw}")`);

    if (email && seen.has(email)) problems.push("duplicate email inside this file");

    if (problems.length > 0) {
      errors.push({ line: lineNo, problems });
      return;
    }

    seen.add(email);

    if (existing.has(email)) {
      skipped.push(email);
      return;
    }

    rows.push({
      email,
      full_name: fullName,
      title: get("title") || null,
      department: get("department") || null,
      manager_email: managerEmail || null,
      role: roleRaw as "admin" | "member",
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows, skipped };
}

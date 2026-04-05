/**
 * Render — Generate JSONL spec patches from entity-learn data.
 * 
 * This is the spec generation engine. Any frontend (vanilla JS, React, merjs, TUI)
 * consumes its JSONL output. No framework dependency.
 * 
 * Usage: entity-learn render "init"
 *        entity-learn render "navigate:deal:deal.Tammie"
 *        entity-learn render "back"
 *        entity-learn render "search:windows crash"
 */

import type { ResolvedEntity } from "./entity-learn.js";

// Nav stack (persists within process)
let navStack: string[] = [];

const ICONS: Record<string, string> = {
  issue: "🐛", deal: "💰", email: "📧", email_reply: "📧",
  outreach_thread: "📨", release: "🚀", pull_request: "🔀",
  npm_downloads: "📦", connector: "🔗", dead_deal: "💀",
  action: "⚡", loose_end: "🧵", referrer: "🔍",
  clone_traffic: "📊", paper: "📄", repo: "📁", metric: "📈",
  product: "🏗️", draft: "✏️", stargazer: "⭐", contributor: "👤",
  bug: "🐛", repo_traffic: "📊", npm_daily: "📦", product_metric: "📈",
};

const TYPE_FIELDS: Record<string, string[]> = {
  issue: ["number", "title", "state", "body", "comments", "created_at", "html_url"],
  deal: ["name", "firm", "check", "probability", "status", "last signal", "next step", "notes", "email", "intro_via"],
  pull_request: ["number", "title", "state", "merged", "additions", "deletions", "changed_files", "created_at", "html_url"],
  release: ["tag_name", "name", "body", "published_at", "html_url"],
  email: ["subject", "from", "to", "date", "snippet"],
  outreach_thread: ["name", "email", "status", "last_message", "reply_count"],
  stargazer: ["login", "starred_at", "html_url"],
  contributor: ["login", "contributions", "html_url"],
  repo: ["full_name", "description", "stargazers_count", "forks_count", "open_issues_count", "language", "html_url"],
  paper: ["title", "citationCount", "influentialCitationCount", "publicationDate"],
  bug: ["number", "title", "state", "body", "labels", "created_at", "html_url"],
  connector: ["name", "firm", "relationship", "notes"],
  dead_deal: ["name", "firm", "reason", "last signal"],
};

// --- Helpers ---

function p(op: string, path: string, value: unknown): string {
  return JSON.stringify({ op, path, value });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}

function isMarkdown(s: string): boolean {
  if (s.length < 50) return false;
  return s.includes("\n") && (s.includes("```") || s.includes("## ") || s.includes("- ") || s.includes("* ") || s.includes("| ") || s.includes("[") || s.includes("**") || s.includes("1. "));
}

const IMAGE_PAT = /avatar|photo|image|picture|logo|icon|thumb|profile/i;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i;
const IMAGE_HOST = /avatars\.githubusercontent\.com|gravatar\.com|cloudinary\.com|imgur\.com|pbs\.twimg\.com/;

function findImage(data: Record<string, unknown>): string | null {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string" || !val.startsWith("http")) continue;
    if (IMAGE_PAT.test(key) || IMAGE_EXT.test(val) || IMAGE_HOST.test(val)) return val;
  }
  return null;
}

function isImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url) || IMAGE_HOST.test(url) || IMAGE_PAT.test(url);
}

function findName(data: Record<string, unknown>): string | null {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string" || !val || val.length > 50) continue;
    if (/^(login|username|name|author|user\.login|author\.login|user\.name|owner|creator|sender)$/i.test(key)) return val;
  }
  return null;
}

// --- Generators ---

function generateTypeList(queryFn: (type?: string, search?: string, related?: boolean) => ResolvedEntity[], typesFn: () => Record<string, number>): string[] {
  const typesRaw = typesFn();
  if (!typesRaw) return [p("add", "/root", "empty"), p("add", "/elements/empty", { type: "Empty", props: { message: "No pointers. Run: entity-learn learn <command>" }, children: [] })];

  navStack = ["Types"];
  const types = Object.entries(typesRaw);
  const total = types.reduce((s, [, c]) => s + c, 0);
  const lines: string[] = [];

  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "md" }, children: ["list"] }));

  const itemIds = types.map(([t]) => `t-${t}`);
  lines.push(p("add", "/elements/list", {
    type: "ListView",
    props: { title: "Entity Types", subtitle: `${total} entities across ${types.length} types`, emptyMessage: null },
    children: itemIds,
  }));

  for (const [t, count] of types) {
    lines.push(p("add", `/elements/t-${t}`, {
      type: "ListItem",
      props: { title: t, subtitle: `${count} entit${count === 1 ? "y" : "ies"}`, icon: ICONS[t] ?? "📄", status: null, id: t, type: t, image: null },
      children: [],
    }));
  }
  return lines;
}

function generateEntityList(entityType: string, queryFn: (type?: string, search?: string, related?: boolean) => ResolvedEntity[]): string[] {
  const entities = queryFn(entityType);
  if (!entities.length) return [];

  navStack = ["Types", entityType];
  const icon = ICONS[entityType] ?? "📄";
  const lines: string[] = [];

  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "sm" }, children: ["nav", "list"] }));
  lines.push(p("add", "/elements/nav", { type: "NavBar", props: { breadcrumbs: [...navStack] }, children: [] }));

  const itemIds = entities.map((_, i) => `i-${i}`);
  lines.push(p("add", "/elements/list", {
    type: "ListView",
    props: { title: `${icon} ${entityType}`, subtitle: `${entities.length} entities`, emptyMessage: null },
    children: itemIds,
  }));

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const eImage = findImage(e.data);
    const eName = findName(e.data);
    lines.push(p("add", `/elements/i-${i}`, {
      type: "ListItem",
      props: {
        title: truncate(e.title, 80),
        subtitle: eName ? `${eName} · ${truncate(e.source_command, 40)}` : truncate(e.source_command, 60),
        icon: eImage ? null : icon, image: eImage ?? null,
        status: e.status ?? null, id: e.id, type: e.type,
      },
      children: [],
    }));
  }
  return lines;
}

function generateEntityDetail(entityType: string, entityId: string, queryFn: (type?: string, search?: string, related?: boolean) => ResolvedEntity[]): string[] {
  const entities = queryFn(entityType, undefined, true);
  if (!entities.length) return [];

  const entity = entities.find((e) => e.id === entityId);
  if (!entity) return [];

  const shortName = entityId.split(".").pop() ?? entityId;
  if (navStack[1] !== entityType) navStack = ["Types", entityType, shortName];
  else navStack = [...navStack.slice(0, 2), shortName];

  const icon = ICONS[entityType] ?? "📄";
  const lines: string[] = [];
  const detailChildren: string[] = [];

  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/nav", { type: "NavBar", props: { breadcrumbs: [...navStack] }, children: [] }));

  const image = findImage(entity.data);
  const authorName = findName(entity.data);
  const skipPat = /^(node_id|performed_via_github_app|active_lock_reason|pinned_comment|state_reason|type|id|url|repository_url|.*_url$|.*_urls$|locked|author_association|gravatar_id|site_admin|user_view_type)$/;

  const seen = new Set<string>();
  const fieldEntries: [string, unknown][] = [];
  for (const key of (TYPE_FIELDS[entityType] ?? [])) {
    const match = Object.entries(entity.data).find(([k]) => k === key);
    if (match && match[1] != null) { fieldEntries.push(match); seen.add(key); }
  }
  for (const [key, val] of Object.entries(entity.data)) {
    if (seen.has(key) || skipPat.test(key) || val == null || typeof val === "object") continue;
    const s = String(val);
    if (!s || s.startsWith("https://api.github.com/") || isImageUrl(s)) continue;
    fieldEntries.push([key, val]);
    if (fieldEntries.length >= 15) break;
  }

  for (const [key, val] of fieldEntries) {
    const s = String(val);
    const fid = `f-${key.replace(/[\s.]+/g, "-")}`;
    const label = key.replace(/[_.]/g, " ");

    if (isMarkdown(s)) {
      const lid = `l-${key.replace(/[\s.]+/g, "-")}`;
      lines.push(p("add", `/elements/${lid}`, { type: "Text", props: { content: label, variant: "caption" }, children: [] }));
      lines.push(p("add", `/elements/${fid}`, { type: "Markdown", props: { content: truncate(s, 2000) }, children: [] }));
      detailChildren.push(lid, fid);
    } else if (s.length > 200) {
      const lid = `l-${key.replace(/[\s.]+/g, "-")}`;
      lines.push(p("add", `/elements/${lid}`, { type: "Text", props: { content: label, variant: "caption" }, children: [] }));
      lines.push(p("add", `/elements/${fid}`, { type: "Text", props: { content: truncate(s, 500), variant: "body" }, children: [] }));
      detailChildren.push(lid, fid);
    } else {
      lines.push(p("add", `/elements/${fid}`, { type: "DataRow", props: { label, value: truncate(s, 150) }, children: [] }));
      detailChildren.push(fid);
    }
  }

  lines.push(p("add", "/elements/f-src-label", { type: "Text", props: { content: "source pointer", variant: "caption" }, children: [] }));
  lines.push(p("add", "/elements/f-src", { type: "Text", props: { content: entity.source_command, variant: "code" }, children: [] }));
  detailChildren.push("f-src-label", "f-src");

  lines.push(p("add", "/elements/detail", {
    type: "DetailView",
    props: { title: entity.title, subtitle: authorName ? `${entityType} · ${authorName}` : entityType, icon: image ? null : icon, image: image ?? null, status: entity.status ?? null },
    children: detailChildren,
  }));

  const rootChildren = ["nav", "detail"];

  const relations = entity.related ?? [];
  if (relations.length > 0) {
    const linkIds = relations.map((_, i) => `lnk-${i}`);
    for (let i = 0; i < relations.length; i++) {
      const rel = relations[i];
      lines.push(p("add", `/elements/lnk-${i}`, {
        type: "LinkChip",
        props: { label: `${truncate(rel.targetTitle, 30)} (${rel.matchType}: ${truncate(rel.matchValue, 20)})`, entityId: rel.targetId, entityType: rel.targetType, icon: ICONS[rel.targetType] ?? "📄" },
        children: [],
      }));
    }
    lines.push(p("add", "/elements/connections", { type: "Section", props: { title: "Connections", subtitle: `${relations.length} auto-discovered` }, children: linkIds }));
    rootChildren.push("connections");
  }

  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "md" }, children: rootChildren }));
  return lines;
}

function generateSearch(searchQuery: string, queryFn: (type?: string, search?: string, related?: boolean) => ResolvedEntity[]): string[] {
  const results = queryFn(undefined, searchQuery);
  if (!results.length) return [];

  navStack.push(`Search: ${searchQuery}`);
  const lines: string[] = [];

  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "sm" }, children: ["nav", "list"] }));
  lines.push(p("add", "/elements/nav", { type: "NavBar", props: { breadcrumbs: [...navStack] }, children: [] }));

  const itemIds = results.map((_, i) => `r-${i}`);
  lines.push(p("add", "/elements/list", {
    type: "ListView",
    props: { title: `Search: "${searchQuery}"`, subtitle: `${results.length} results (BM25)`, emptyMessage: null },
    children: itemIds,
  }));

  for (let i = 0; i < results.length; i++) {
    const e = results[i];
    lines.push(p("add", `/elements/r-${i}`, {
      type: "ListItem",
      props: { title: truncate(e.title, 80), subtitle: e.type, icon: ICONS[e.type] ?? "📄", status: e.status ?? null, id: e.id, type: e.type, image: null },
      children: [],
    }));
  }
  return lines;
}

/**
 * Main render function — takes a prompt, returns JSONL patches.
 * queryFn and typesFn are injected so this works with both direct imports and CLI.
 */
export function render(
  prompt: string,
  queryFn: (type?: string, search?: string, related?: boolean) => ResolvedEntity[],
  typesFn: () => Record<string, number>,
): string {
  const cmd = prompt.trim();
  let patches: string[] = [];

  if (cmd === "init" || cmd === "") {
    patches = generateTypeList(queryFn, typesFn);
  } else if (cmd.startsWith("navigate:")) {
    const [type, ...idParts] = cmd.slice("navigate:".length).split(":");
    const id = idParts.join(":");
    if (!id || id === type) patches = generateEntityList(type, queryFn);
    else patches = generateEntityDetail(type, id, queryFn);
  } else if (cmd === "back") {
    navStack.pop();
    if (navStack.length <= 1) patches = generateTypeList(queryFn, typesFn);
    else if (navStack.length === 2) patches = generateEntityList(navStack[1], queryFn);
    else patches = generateTypeList(queryFn, typesFn);
  } else if (cmd.startsWith("search:")) {
    patches = generateSearch(cmd.slice("search:".length), queryFn);
  } else {
    patches = generateSearch(cmd, queryFn);
  }

  return patches.join("\n") + "\n";
}

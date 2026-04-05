#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/render.ts
var render_exports = {};
__export(render_exports, {
  render: () => render
});
function p(op, path, value) {
  return JSON.stringify({ op, path, value });
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}
function isMarkdown(s) {
  if (s.length < 50) return false;
  return s.includes("\n") && (s.includes("```") || s.includes("## ") || s.includes("- ") || s.includes("* ") || s.includes("| ") || s.includes("[") || s.includes("**") || s.includes("1. "));
}
function findImage(data) {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string" || !val.startsWith("http")) continue;
    if (IMAGE_PAT.test(key) || IMAGE_EXT.test(val) || IMAGE_HOST.test(val)) return val;
  }
  return null;
}
function isImageUrl(url) {
  return IMAGE_EXT.test(url) || IMAGE_HOST.test(url) || IMAGE_PAT.test(url);
}
function findName(data) {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string" || !val || val.length > 50) continue;
    if (/^(login|username|name|author|user\.login|author\.login|user\.name|owner|creator|sender)$/i.test(key)) return val;
  }
  return null;
}
function generateTypeList(queryFn, typesFn) {
  const typesRaw = typesFn();
  if (!typesRaw) return [p("add", "/root", "empty"), p("add", "/elements/empty", { type: "Empty", props: { message: "No pointers. Run: entity-learn learn <command>" }, children: [] })];
  navStack = ["Types"];
  const types = Object.entries(typesRaw);
  const total = types.reduce((s, [, c]) => s + c, 0);
  const lines = [];
  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "md" }, children: ["list"] }));
  const itemIds = types.map(([t]) => `t-${t}`);
  lines.push(p("add", "/elements/list", {
    type: "ListView",
    props: { title: "Entity Types", subtitle: `${total} entities across ${types.length} types`, emptyMessage: null },
    children: itemIds
  }));
  for (const [t, count] of types) {
    lines.push(p("add", `/elements/t-${t}`, {
      type: "ListItem",
      props: { title: t, subtitle: `${count} entit${count === 1 ? "y" : "ies"}`, icon: ICONS[t] ?? "\u{1F4C4}", status: null, id: t, type: t, image: null },
      children: []
    }));
  }
  return lines;
}
function generateEntityList(entityType, queryFn) {
  const entities = queryFn(entityType);
  if (!entities.length) return [];
  navStack = ["Types", entityType];
  const icon = ICONS[entityType] ?? "\u{1F4C4}";
  const lines = [];
  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "sm" }, children: ["nav", "list"] }));
  lines.push(p("add", "/elements/nav", { type: "NavBar", props: { breadcrumbs: [...navStack] }, children: [] }));
  const itemIds = entities.map((_, i) => `i-${i}`);
  lines.push(p("add", "/elements/list", {
    type: "ListView",
    props: { title: `${icon} ${entityType}`, subtitle: `${entities.length} entities`, emptyMessage: null },
    children: itemIds
  }));
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const eImage = findImage(e.data);
    const eName = findName(e.data);
    lines.push(p("add", `/elements/i-${i}`, {
      type: "ListItem",
      props: {
        title: truncate(e.title, 80),
        subtitle: eName ? `${eName} \xB7 ${truncate(e.source_command, 40)}` : truncate(e.source_command, 60),
        icon: eImage ? null : icon,
        image: eImage ?? null,
        status: e.status ?? null,
        id: e.id,
        type: e.type
      },
      children: []
    }));
  }
  return lines;
}
function generateEntityDetail(entityType, entityId, queryFn) {
  const entities = queryFn(entityType, void 0, true);
  if (!entities.length) return [];
  const entity = entities.find((e) => e.id === entityId);
  if (!entity) return [];
  const shortName = entityId.split(".").pop() ?? entityId;
  if (navStack[1] !== entityType) navStack = ["Types", entityType, shortName];
  else navStack = [...navStack.slice(0, 2), shortName];
  const icon = ICONS[entityType] ?? "\u{1F4C4}";
  const lines = [];
  const detailChildren = [];
  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/nav", { type: "NavBar", props: { breadcrumbs: [...navStack] }, children: [] }));
  const image = findImage(entity.data);
  const authorName = findName(entity.data);
  const skipPat = /^(node_id|performed_via_github_app|active_lock_reason|pinned_comment|state_reason|type|id|url|repository_url|.*_url$|.*_urls$|locked|author_association|gravatar_id|site_admin|user_view_type)$/;
  const seen = /* @__PURE__ */ new Set();
  const fieldEntries = [];
  for (const key of TYPE_FIELDS[entityType] ?? []) {
    const match = Object.entries(entity.data).find(([k]) => k === key);
    if (match && match[1] != null) {
      fieldEntries.push(match);
      seen.add(key);
    }
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
      lines.push(p("add", `/elements/${fid}`, { type: "Markdown", props: { content: truncate(s, 2e3) }, children: [] }));
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
    props: { title: entity.title, subtitle: authorName ? `${entityType} \xB7 ${authorName}` : entityType, icon: image ? null : icon, image: image ?? null, status: entity.status ?? null },
    children: detailChildren
  }));
  const rootChildren = ["nav", "detail"];
  const relations = entity.related ?? [];
  if (relations.length > 0) {
    const linkIds = relations.map((_, i) => `lnk-${i}`);
    for (let i = 0; i < relations.length; i++) {
      const rel = relations[i];
      lines.push(p("add", `/elements/lnk-${i}`, {
        type: "LinkChip",
        props: { label: `${truncate(rel.targetTitle, 30)} (${rel.matchType}: ${truncate(rel.matchValue, 20)})`, entityId: rel.targetId, entityType: rel.targetType, icon: ICONS[rel.targetType] ?? "\u{1F4C4}" },
        children: []
      }));
    }
    lines.push(p("add", "/elements/connections", { type: "Section", props: { title: "Connections", subtitle: `${relations.length} auto-discovered` }, children: linkIds }));
    rootChildren.push("connections");
  }
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "md" }, children: rootChildren }));
  return lines;
}
function generateSearch(searchQuery, queryFn) {
  const results = queryFn(void 0, searchQuery);
  if (!results.length) return [];
  navStack.push(`Search: ${searchQuery}`);
  const lines = [];
  lines.push(p("add", "/root", "root"));
  lines.push(p("add", "/elements/root", { type: "Stack", props: { gap: "sm" }, children: ["nav", "list"] }));
  lines.push(p("add", "/elements/nav", { type: "NavBar", props: { breadcrumbs: [...navStack] }, children: [] }));
  const itemIds = results.map((_, i) => `r-${i}`);
  lines.push(p("add", "/elements/list", {
    type: "ListView",
    props: { title: `Search: "${searchQuery}"`, subtitle: `${results.length} results (BM25)`, emptyMessage: null },
    children: itemIds
  }));
  for (let i = 0; i < results.length; i++) {
    const e = results[i];
    lines.push(p("add", `/elements/r-${i}`, {
      type: "ListItem",
      props: { title: truncate(e.title, 80), subtitle: e.type, icon: ICONS[e.type] ?? "\u{1F4C4}", status: e.status ?? null, id: e.id, type: e.type, image: null },
      children: []
    }));
  }
  return lines;
}
function render(prompt, queryFn, typesFn) {
  const cmd2 = prompt.trim();
  let patches = [];
  if (cmd2 === "init" || cmd2 === "") {
    patches = generateTypeList(queryFn, typesFn);
  } else if (cmd2.startsWith("navigate:")) {
    const [type, ...idParts] = cmd2.slice("navigate:".length).split(":");
    const id = idParts.join(":");
    if (!id || id === type) patches = generateEntityList(type, queryFn);
    else patches = generateEntityDetail(type, id, queryFn);
  } else if (cmd2 === "back") {
    navStack.pop();
    if (navStack.length <= 1) patches = generateTypeList(queryFn, typesFn);
    else if (navStack.length === 2) patches = generateEntityList(navStack[1], queryFn);
    else patches = generateTypeList(queryFn, typesFn);
  } else if (cmd2.startsWith("search:")) {
    patches = generateSearch(cmd2.slice("search:".length), queryFn);
  } else {
    patches = generateSearch(cmd2, queryFn);
  }
  return patches.join("\n") + "\n";
}
var navStack, ICONS, TYPE_FIELDS, IMAGE_PAT, IMAGE_EXT, IMAGE_HOST;
var init_render = __esm({
  "lib/render.ts"() {
    navStack = [];
    ICONS = {
      issue: "\u{1F41B}",
      deal: "\u{1F4B0}",
      email: "\u{1F4E7}",
      email_reply: "\u{1F4E7}",
      outreach_thread: "\u{1F4E8}",
      release: "\u{1F680}",
      pull_request: "\u{1F500}",
      npm_downloads: "\u{1F4E6}",
      connector: "\u{1F517}",
      dead_deal: "\u{1F480}",
      action: "\u26A1",
      loose_end: "\u{1F9F5}",
      referrer: "\u{1F50D}",
      clone_traffic: "\u{1F4CA}",
      paper: "\u{1F4C4}",
      repo: "\u{1F4C1}",
      metric: "\u{1F4C8}",
      product: "\u{1F3D7}\uFE0F",
      draft: "\u270F\uFE0F",
      stargazer: "\u2B50",
      contributor: "\u{1F464}",
      bug: "\u{1F41B}",
      repo_traffic: "\u{1F4CA}",
      npm_daily: "\u{1F4E6}",
      product_metric: "\u{1F4C8}"
    };
    TYPE_FIELDS = {
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
      dead_deal: ["name", "firm", "reason", "last signal"]
    };
    IMAGE_PAT = /avatar|photo|image|picture|logo|icon|thumb|profile/i;
    IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i;
    IMAGE_HOST = /avatars\.githubusercontent\.com|gravatar\.com|cloudinary\.com|imgur\.com|pbs\.twimg\.com/;
  }
});

// lib/entity-learn.ts
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
var STORE_PATH = join(homedir(), ".agent-org", "pointers.json");
function readStore() {
  if (!existsSync(STORE_PATH)) return { version: 1, pointers: [], cache: {} };
  return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
}
function writeStore(store) {
  mkdirSync(join(homedir(), ".agent-org"), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}
var ID_CANDIDATES = ["id", "number", "ID", "Id", "_id", "key", "slug", "login", "name", "tag_name", "identifier"];
var TITLE_CANDIDATES = ["title", "name", "subject", "text", "summary", "description", "login", "tag_name", "full_name"];
var STATUS_CANDIDATES = ["status", "state", "stage", "phase", "priority", "signal", "customer_signal"];
function inferField(keys, candidates) {
  for (const c of candidates) {
    if (keys.includes(c)) return c;
  }
  return null;
}
function inferEntityType(command, data) {
  const cmd2 = command.toLowerCase();
  if (cmd2.includes("/issues")) return "issue";
  if (cmd2.includes("/pulls")) return "pull_request";
  if (cmd2.includes("/stargazers")) return "stargazer";
  if (cmd2.includes("/releases")) return "release";
  if (cmd2.includes("/commits")) return "commit";
  if (cmd2.includes("gmail") && cmd2.includes("messages")) return "email";
  if (cmd2.includes("gmail") && cmd2.includes("threads")) return "email_thread";
  if (cmd2.includes("npmjs.org") || cmd2.includes("npm")) return "npm_snapshot";
  if (cmd2.includes("linear")) return "ticket";
  if (cmd2.includes("typefully")) return "draft";
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first.title && first.number) return "issue";
    if (first.tag_name) return "release";
    if (first.login) return "user";
    if (first.downloads) return "download";
  }
  const segments = cmd2.split(/[\s/]+/).filter((s) => s.length > 2 && !s.startsWith("-") && !s.startsWith("{"));
  return segments[segments.length - 1]?.replace(/[^a-z_]/g, "") || "entity";
}
function inferSchema(command, rawOutput, forceType) {
  let data;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    return null;
  }
  let shape;
  let sampleItems;
  if (Array.isArray(data)) {
    shape = "array";
    sampleItems = data.slice(0, 5);
  } else if (typeof data === "object" && data !== null) {
    const vals = Object.values(data);
    if (vals.length > 0 && vals.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) {
      shape = "object_of_objects";
      sampleItems = vals.slice(0, 5);
    } else {
      shape = "object";
      sampleItems = [data];
    }
  } else {
    return null;
  }
  if (sampleItems.length === 0) return null;
  const allKeys = /* @__PURE__ */ new Set();
  for (const item of sampleItems) {
    if (typeof item === "object" && item !== null) {
      Object.keys(item).forEach((k) => allKeys.add(k));
    }
  }
  const keys = Array.from(allKeys);
  const entityType = forceType || inferEntityType(command, data);
  const idField = inferField(keys, ID_CANDIDATES);
  const titleField = inferField(keys, TITLE_CANDIDATES);
  const statusField = inferField(keys, STATUS_CANDIDATES);
  let confidence = 0.5;
  if (idField) confidence += 0.2;
  if (titleField) confidence += 0.2;
  if (statusField) confidence += 0.1;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: `ptr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    command,
    entity_type: entityType,
    result_shape: shape,
    id_field: idField,
    title_field: titleField,
    status_field: statusField,
    fields: keys.filter((k) => {
      const sample = sampleItems[0]?.[k];
      if (typeof sample === "object" && sample !== null && !Array.isArray(sample)) return false;
      return true;
    }),
    sample_count: sampleItems.length,
    learned_at: now,
    last_used: now,
    use_count: 0,
    ttl_seconds: 300,
    // 5 min cache
    confidence
  };
}
function learn(command, options) {
  console.error(`Learning from: ${command}`);
  let output;
  try {
    output = execSync(command, {
      encoding: "utf-8",
      timeout: 3e4,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: homedir() },
      shell: "/bin/zsh"
    });
  } catch (e) {
    console.error(`Command failed: ${e.message}`);
    return null;
  }
  const pointer = inferSchema(command, output, options?.type);
  if (!pointer) {
    console.error("Could not infer schema from output (non-JSON or empty)");
    return null;
  }
  if (options?.ttl) pointer.ttl_seconds = options.ttl;
  const store = readStore();
  const existing = store.pointers.findIndex((p2) => p2.command === command);
  if (existing !== -1) {
    store.pointers[existing] = { ...store.pointers[existing], ...pointer, learned_at: store.pointers[existing].learned_at };
  } else {
    store.pointers.push(pointer);
  }
  store.cache[pointer.id] = { data: JSON.parse(output), fetched_at: (/* @__PURE__ */ new Date()).toISOString() };
  writeStore(store);
  console.error(`Learned: ${pointer.entity_type} (${pointer.sample_count} items, confidence: ${pointer.confidence})`);
  console.error(`  id_field: ${pointer.id_field}, title_field: ${pointer.title_field}, status_field: ${pointer.status_field}`);
  console.error(`  fields: ${pointer.fields.join(", ")}`);
  return pointer;
}
function resolve(pointer, store) {
  const cached = store.cache[pointer.id];
  if (cached) {
    const age = (Date.now() - new Date(cached.fetched_at).getTime()) / 1e3;
    if (age < pointer.ttl_seconds) {
      return cached.data;
    }
  }
  try {
    const output = execSync(pointer.command, {
      encoding: "utf-8",
      timeout: 3e4,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: homedir() },
      shell: "/bin/zsh"
    });
    const data = JSON.parse(output);
    store.cache[pointer.id] = { data, fetched_at: (/* @__PURE__ */ new Date()).toISOString() };
    pointer.last_used = (/* @__PURE__ */ new Date()).toISOString();
    pointer.use_count++;
    writeStore(store);
    return data;
  } catch {
    return cached?.data ?? null;
  }
}
function normalizeEntities(pointer, rawData) {
  const entities = [];
  let items;
  if (pointer.result_shape === "array" && Array.isArray(rawData)) {
    items = rawData.map((item, i) => [String(i), item]);
  } else if (pointer.result_shape === "object_of_objects" && typeof rawData === "object" && rawData !== null) {
    items = Object.entries(rawData).filter(([, v]) => typeof v === "object" && v !== null).map(([k, v]) => [k, v]);
  } else if (pointer.result_shape === "object" && typeof rawData === "object" && rawData !== null) {
    items = [["0", rawData]];
  } else {
    return [];
  }
  for (const [key, item] of items) {
    const idVal = pointer.id_field ? String(item[pointer.id_field] ?? key) : key;
    const titleVal = pointer.title_field ? String(item[pointer.title_field] ?? idVal) : idVal;
    const statusVal = pointer.status_field ? String(item[pointer.status_field] ?? "") : void 0;
    const data = {};
    for (const f of pointer.fields) {
      if (item[f] !== void 0) data[f] = item[f];
    }
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const nested = v;
        const nestedKeys = Object.keys(nested);
        if (nestedKeys.length > 20) continue;
        for (const [nk, nv] of Object.entries(nested)) {
          if (typeof nv === "string" || typeof nv === "number" || typeof nv === "boolean") {
            data[`${k}.${nk}`] = nv;
          }
        }
      }
    }
    entities.push({
      id: `${pointer.entity_type}.${idVal}`,
      type: pointer.entity_type,
      title: titleVal,
      status: statusVal || void 0,
      source_command: pointer.command,
      data
    });
  }
  return entities;
}
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9_\-\.@]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}
function bm25Rank(entities, queryStr, k1 = 1.5, b = 0.75) {
  const queryTokens = tokenize(queryStr);
  if (queryTokens.length === 0) return entities;
  const docs = entities.map((e) => {
    const text = [
      e.title,
      e.type,
      e.status ?? "",
      ...Object.values(e.data).map(
        (v) => typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : ""
      )
    ].join(" ");
    return { entity: e, tokens: tokenize(text) };
  });
  const N = docs.length;
  const avgDl = docs.reduce((s, d) => s + d.tokens.length, 0) / (N || 1);
  const df = {};
  for (const qt of queryTokens) {
    df[qt] = docs.filter((d) => d.tokens.includes(qt)).length;
  }
  const scored = docs.map((d) => {
    let score = 0;
    const dl = d.tokens.length;
    for (const qt of queryTokens) {
      const tf = d.tokens.filter((t) => t === qt).length;
      const idf = Math.log((N - (df[qt] ?? 0) + 0.5) / ((df[qt] ?? 0) + 0.5) + 1);
      score += idf * (tf * (k1 + 1) / (tf + k1 * (1 - b + b * (dl / avgDl))));
    }
    return { entity: d.entity, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).map((s) => s.entity);
}
function extractLinkableValues(entity) {
  const linkables = /* @__PURE__ */ new Map();
  const addLink = (type, field, value) => {
    const list = linkables.get(type) ?? [];
    list.push({ field, value });
    linkables.set(type, list);
  };
  for (const [key, val] of Object.entries(entity.data)) {
    if (val === null || val === void 0) continue;
    const strVal = String(val);
    if (!strVal) continue;
    const emails = strVal.match(/[\w.-]+@[\w.-]+\.\w{2,}/g);
    if (emails) for (const e of emails) addLink("email", key, e.toLowerCase());
    const issueRefs = strVal.match(/#(\d+)\b/g);
    if (issueRefs) for (const r of issueRefs) addLink("id_ref", key, r);
    const versions = strVal.match(/\bv\d+\.\d+\.\d+\b/g);
    if (versions) for (const v of versions) addLink("version", key, v);
    if (/^(login|user\.login|author\.login|username|owner|creator|assignee)$/i.test(key)) {
      if (typeof val === "string" && val.length > 1 && val.length < 40) {
        addLink("name", key, val.toLowerCase());
      }
    }
    if (/^(firm|company|org|organization)$/i.test(key)) {
      if (typeof val === "string" && val.length > 2) {
        addLink("name", key, val.toLowerCase());
      }
    }
  }
  const titleEmails = entity.title.match(/[\w.-]+@[\w.-]+\.\w{2,}/g);
  if (titleEmails) for (const e of titleEmails) addLink("email", "title", e.toLowerCase());
  return linkables;
}
function discoverRelations(entities) {
  const valueIndex = /* @__PURE__ */ new Map();
  const entityMap = /* @__PURE__ */ new Map();
  const entityLinks = /* @__PURE__ */ new Map();
  for (const entity of entities) {
    entityMap.set(entity.id, entity);
    const linkables = extractLinkableValues(entity);
    for (const [matchType, items] of linkables) {
      for (const { field, value } of items) {
        const key = `${matchType}:${value}`;
        const set = valueIndex.get(key) ?? /* @__PURE__ */ new Set();
        set.add(entity.id);
        valueIndex.set(key, set);
        const links = entityLinks.get(entity.id) ?? /* @__PURE__ */ new Map();
        links.set(key, { field, value, matchType });
        entityLinks.set(entity.id, links);
      }
    }
  }
  const distinctiveValues = /* @__PURE__ */ new Map();
  for (const entity of entities) {
    for (const [key, val] of Object.entries(entity.data)) {
      if (typeof val !== "string" && typeof val !== "number") continue;
      const strVal = String(val);
      if (strVal.length < 3 || strVal.length > 60) continue;
      if (strVal.startsWith("http")) continue;
      if (/^\d+$/.test(strVal) && parseInt(strVal) < 100) continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(strVal)) continue;
      if (/^(true|false|null|none|open|closed|active|pending)$/i.test(strVal)) continue;
      const existing = distinctiveValues.get(strVal) ?? /* @__PURE__ */ new Set();
      existing.add(entity.id);
      distinctiveValues.set(strVal, existing);
    }
  }
  for (const entity of entities) {
    const related = [];
    const seen = /* @__PURE__ */ new Set();
    const links = entityLinks.get(entity.id);
    if (links) {
      for (const [key, { field, value, matchType }] of links) {
        const sharing = valueIndex.get(key);
        if (!sharing || sharing.size > 8) continue;
        for (const otherId of sharing) {
          if (otherId === entity.id || seen.has(otherId)) continue;
          const other = entityMap.get(otherId);
          if (!other) continue;
          seen.add(otherId);
          related.push({
            targetId: otherId,
            targetType: other.type,
            targetTitle: other.title,
            matchField: field,
            matchValue: value,
            matchType
          });
        }
      }
    }
    for (const [, val] of Object.entries(entity.data)) {
      if (typeof val !== "string" || val.length < 3 || val.length > 60) continue;
      if (val.startsWith("http")) continue;
      const sharing = distinctiveValues.get(val);
      if (!sharing || sharing.size < 2 || sharing.size > 8) continue;
      for (const otherId of sharing) {
        if (otherId === entity.id || seen.has(otherId)) continue;
        const other = entityMap.get(otherId);
        if (!other) continue;
        seen.add(otherId);
        related.push({
          targetId: otherId,
          targetType: other.type,
          targetTitle: other.title,
          matchField: "value",
          matchValue: val,
          matchType: "value_overlap"
        });
      }
      if (related.length >= 10) break;
    }
    if (related.length > 0) {
      entity.related = related.slice(0, 10);
    }
  }
}
function query(type, search, withRelations = false) {
  const store = readStore();
  let results = [];
  const pointersToResolve = withRelations ? store.pointers : type ? store.pointers.filter((p2) => p2.entity_type === type) : store.pointers;
  const allEntities = [];
  for (const pointer of pointersToResolve) {
    const rawData = resolve(pointer, store);
    if (!rawData) continue;
    allEntities.push(...normalizeEntities(pointer, rawData));
  }
  if (withRelations) {
    discoverRelations(allEntities);
  }
  results = type ? allEntities.filter((e) => e.type === type) : allEntities;
  if (search) {
    results = bm25Rank(results, search);
  }
  return results;
}
var [, , cmd, ...args] = process.argv;
switch (cmd) {
  case "learn": {
    const command = args[0];
    if (!command) {
      console.error("Usage: entity-learn learn <command> [--type <type>] [--ttl <seconds>]");
      process.exit(1);
    }
    const typeIdx = args.indexOf("--type");
    const ttlIdx = args.indexOf("--ttl");
    const pointer = learn(command, {
      type: typeIdx !== -1 ? args[typeIdx + 1] : void 0,
      ttl: ttlIdx !== -1 ? Number(args[ttlIdx + 1]) : void 0
    });
    if (pointer) console.log(JSON.stringify(pointer, null, 2));
    break;
  }
  case "query": {
    const typeIdx = args.indexOf("--type");
    const searchIdx = args.indexOf("--search");
    const withRelations = args.includes("--related");
    const type = typeIdx !== -1 ? args[typeIdx + 1] : void 0;
    const search = searchIdx !== -1 ? args[searchIdx + 1] : void 0;
    const results = query(type, search, withRelations);
    console.log(JSON.stringify(results, null, 2));
    break;
  }
  case "render": {
    const prompt = args[0] ?? "init";
    const { render: render2 } = await Promise.resolve().then(() => (init_render(), render_exports));
    const store = readStore();
    const typesFn = () => {
      const counts = {};
      for (const p2 of store.pointers) counts[p2.entity_type] = (counts[p2.entity_type] || 0) + 1;
      return counts;
    };
    const output = render2(prompt, query, typesFn);
    process.stdout.write(output);
    break;
  }
  case "types": {
    const store = readStore();
    const typeCounts = {};
    for (const p2 of store.pointers) {
      typeCounts[p2.entity_type] = (typeCounts[p2.entity_type] || 0) + 1;
    }
    console.log(JSON.stringify(typeCounts, null, 2));
    break;
  }
  case "pointers": {
    const store = readStore();
    console.log(JSON.stringify(store.pointers.map((p2) => ({
      entity_type: p2.entity_type,
      command: p2.command,
      fields: p2.fields.length,
      confidence: p2.confidence,
      use_count: p2.use_count,
      learned_at: p2.learned_at
    })), null, 2));
    break;
  }
  case "serve": {
    const port = args[0] ?? "3001";
    const scriptDir = new URL(".", import.meta.url).pathname;
    const hudServer = join(scriptDir, "..", "hud", "serve.mjs");
    const { execSync: run } = await import("child_process");
    try {
      run(`node "${hudServer}" ${port}`, { stdio: "inherit" });
    } catch {
    }
    break;
  }
  default:
    console.error("Commands: learn, query, render, types, pointers, serve");
    console.error("  learn <command> [--type <type>] [--ttl <seconds>]");
    console.error("  query [--type <type>] [--search <term>] [--related]");
    console.error("  render <prompt>  \u2014 generate JSONL spec patches");
    console.error("  types");
    console.error("  pointers");
    console.error("  serve [port]  \u2014 start the UI");
}
export {
  discoverRelations,
  learn,
  normalizeEntities,
  query,
  readStore,
  resolve,
  writeStore
};

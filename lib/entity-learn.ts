// entity-learn — zero-copy live memory for agents
/**
 * entity-learn — the core primitive.
 *
 * Run any command. Observe the output. Auto-infer entity schema.
 * Save as a pointer. Next query replays the command for live data.
 *
 * Usage:
 *   npx tsx entity-learn.ts learn "gh api repos/unbrowse-ai/unbrowse/issues?state=open"
 *   npx tsx entity-learn.ts learn "gws gmail users messages list --params '{...}'" --type email
 *   npx tsx entity-learn.ts learn "jq '.leads' ~/.hermes/skills/vc-rolodex/data/pipeline.json"
 *   npx tsx entity-learn.ts query --type issue
 *   npx tsx entity-learn.ts query --type issue --search windows
 *   npx tsx entity-learn.ts types
 *   npx tsx entity-learn.ts pointers
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// --- Types ---

interface Pointer {
  id: string;
  command: string;
  entity_type: string;
  result_shape: "array" | "object" | "object_of_objects";
  id_field: string | null;
  title_field: string | null;
  status_field: string | null;
  fields: string[];
  sample_count: number;
  learned_at: string;
  last_used: string;
  use_count: number;
  ttl_seconds: number;
  confidence: number;
}

interface PointerStore {
  version: 1;
  pointers: Pointer[];
  cache: Record<string, { data: unknown; fetched_at: string }>;
}

interface Relation {
  targetId: string;
  targetType: string;
  targetTitle: string;
  matchField: string;   // which field matched
  matchValue: string;    // the value that linked them
  matchType: "email" | "id_ref" | "version" | "name" | "value_overlap";
}

interface ResolvedEntity {
  id: string;
  type: string;
  title: string;
  status?: string;
  source_command: string;
  data: Record<string, unknown>;
  related?: Relation[];
}

// --- Store ---

const STORE_PATH = join(homedir(), ".agent-org", "pointers.json");

function readStore(): PointerStore {
  if (!existsSync(STORE_PATH)) return { version: 1, pointers: [], cache: {} };
  return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
}

function writeStore(store: PointerStore): void {
  mkdirSync(join(homedir(), ".agent-org"), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// --- Schema Inference ---

// Common ID field names, ranked by likelihood
const ID_CANDIDATES = ["id", "number", "ID", "Id", "_id", "key", "slug", "login", "name", "tag_name", "identifier"];
const TITLE_CANDIDATES = ["title", "name", "subject", "text", "summary", "description", "login", "tag_name", "full_name"];
const STATUS_CANDIDATES = ["status", "state", "stage", "phase", "priority", "signal", "customer_signal"];

function inferField(keys: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    if (keys.includes(c)) return c;
  }
  return null;
}

function inferEntityType(command: string, data: unknown): string {
  // Try to infer from the command itself
  const cmd = command.toLowerCase();

  // GitHub patterns
  if (cmd.includes("/issues")) return "issue";
  if (cmd.includes("/pulls")) return "pull_request";
  if (cmd.includes("/stargazers")) return "stargazer";
  if (cmd.includes("/releases")) return "release";
  if (cmd.includes("/commits")) return "commit";

  // Gmail patterns
  if (cmd.includes("gmail") && cmd.includes("messages")) return "email";
  if (cmd.includes("gmail") && cmd.includes("threads")) return "email_thread";

  // npm patterns
  if (cmd.includes("npmjs.org") || cmd.includes("npm")) return "npm_snapshot";

  // Generic patterns
  if (cmd.includes("linear")) return "ticket";
  if (cmd.includes("typefully")) return "draft";

  // Try to infer from data shape
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    if (first.title && first.number) return "issue";
    if (first.tag_name) return "release";
    if (first.login) return "user";
    if (first.downloads) return "download";
  }

  // Fallback: extract from command path segments
  const segments = cmd.split(/[\s/]+/).filter(s => s.length > 2 && !s.startsWith("-") && !s.startsWith("{"));
  return segments[segments.length - 1]?.replace(/[^a-z_]/g, "") || "entity";
}

function inferSchema(command: string, rawOutput: string, forceType?: string): Pointer | null {
  let data: unknown;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    return null; // Non-JSON output, can't learn from it
  }

  let shape: Pointer["result_shape"];
  let sampleItems: Record<string, unknown>[];

  if (Array.isArray(data)) {
    shape = "array";
    sampleItems = data.slice(0, 5) as Record<string, unknown>[];
  } else if (typeof data === "object" && data !== null) {
    // Check if it's an object-of-objects (like pipeline.json sections)
    const vals = Object.values(data as Record<string, unknown>);
    if (vals.length > 0 && vals.every(v => typeof v === "object" && v !== null && !Array.isArray(v))) {
      shape = "object_of_objects";
      sampleItems = vals.slice(0, 5) as Record<string, unknown>[];
    } else {
      shape = "object";
      sampleItems = [data as Record<string, unknown>];
    }
  } else {
    return null;
  }

  if (sampleItems.length === 0) return null;

  // Collect all keys across samples
  const allKeys = new Set<string>();
  for (const item of sampleItems) {
    if (typeof item === "object" && item !== null) {
      Object.keys(item).forEach(k => allKeys.add(k));
    }
  }
  const keys = Array.from(allKeys);

  const entityType = forceType || inferEntityType(command, data);
  const idField = inferField(keys, ID_CANDIDATES);
  const titleField = inferField(keys, TITLE_CANDIDATES);
  const statusField = inferField(keys, STATUS_CANDIDATES);

  // Confidence: higher if we found id + title fields
  let confidence = 0.5;
  if (idField) confidence += 0.2;
  if (titleField) confidence += 0.2;
  if (statusField) confidence += 0.1;

  const now = new Date().toISOString();

  return {
    id: `ptr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    command,
    entity_type: entityType,
    result_shape: shape,
    id_field: idField,
    title_field: titleField,
    status_field: statusField,
    fields: keys.filter(k => {
      // Skip huge nested objects, keep primitives and short arrays
      const sample = sampleItems[0]?.[k];
      if (typeof sample === "object" && sample !== null && !Array.isArray(sample)) return false;
      return true;
    }),
    sample_count: sampleItems.length,
    learned_at: now,
    last_used: now,
    use_count: 0,
    ttl_seconds: 300, // 5 min cache
    confidence,
  };
}

// --- Learn ---

function learn(command: string, options?: { type?: string; ttl?: number }): Pointer | null {
  console.error(`Learning from: ${command}`);

  let output: string;
  try {
    output = execSync(command, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: homedir() },
      shell: "/bin/zsh",
    });
  } catch (e: unknown) {
    console.error(`Command failed: ${(e as Error).message}`);
    return null;
  }

  const pointer = inferSchema(command, output, options?.type);
  if (!pointer) {
    console.error("Could not infer schema from output (non-JSON or empty)");
    return null;
  }

  if (options?.ttl) pointer.ttl_seconds = options.ttl;

  // Save pointer (dedup by command)
  const store = readStore();
  const existing = store.pointers.findIndex(p => p.command === command);
  if (existing !== -1) {
    store.pointers[existing] = { ...store.pointers[existing], ...pointer, learned_at: store.pointers[existing].learned_at };
  } else {
    store.pointers.push(pointer);
  }

  // Cache the result
  store.cache[pointer.id] = { data: JSON.parse(output), fetched_at: new Date().toISOString() };

  writeStore(store);
  console.error(`Learned: ${pointer.entity_type} (${pointer.sample_count} items, confidence: ${pointer.confidence})`);
  console.error(`  id_field: ${pointer.id_field}, title_field: ${pointer.title_field}, status_field: ${pointer.status_field}`);
  console.error(`  fields: ${pointer.fields.join(", ")}`);

  return pointer;
}

// --- Resolve ---

function resolve(pointer: Pointer, store: PointerStore): unknown {
  // Check cache
  const cached = store.cache[pointer.id];
  if (cached) {
    const age = (Date.now() - new Date(cached.fetched_at).getTime()) / 1000;
    if (age < pointer.ttl_seconds) {
      return cached.data;
    }
  }

  // Fetch fresh
  try {
    const output = execSync(pointer.command, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: homedir() },
      shell: "/bin/zsh",
    });
    const data = JSON.parse(output);

    // Update cache + stats
    store.cache[pointer.id] = { data, fetched_at: new Date().toISOString() };
    pointer.last_used = new Date().toISOString();
    pointer.use_count++;
    writeStore(store);

    return data;
  } catch {
    // Return stale cache if available
    return cached?.data ?? null;
  }
}

function normalizeEntities(pointer: Pointer, rawData: unknown): ResolvedEntity[] {
  const entities: ResolvedEntity[] = [];

  let items: [string, Record<string, unknown>][];

  if (pointer.result_shape === "array" && Array.isArray(rawData)) {
    items = rawData.map((item, i) => [String(i), item as Record<string, unknown>]);
  } else if (pointer.result_shape === "object_of_objects" && typeof rawData === "object" && rawData !== null) {
    items = Object.entries(rawData as Record<string, unknown>)
      .filter(([, v]) => typeof v === "object" && v !== null)
      .map(([k, v]) => [k, v as Record<string, unknown>]);
  } else if (pointer.result_shape === "object" && typeof rawData === "object" && rawData !== null) {
    items = [["0", rawData as Record<string, unknown>]];
  } else {
    return [];
  }

  for (const [key, item] of items) {
    const idVal = pointer.id_field ? String(item[pointer.id_field] ?? key) : key;
    const titleVal = pointer.title_field ? String(item[pointer.title_field] ?? idVal) : idVal;
    const statusVal = pointer.status_field ? String(item[pointer.status_field] ?? "") : undefined;

    // Build data: primitive fields + shallow-flattened nested objects
    const data: Record<string, unknown> = {};
    for (const f of pointer.fields) {
      if (item[f] !== undefined) data[f] = item[f];
    }

    // Shallow-flatten nested objects (one level deep)
    // e.g. item.user = { login: "x", avatar_url: "..." } → data["user.login"] = "x"
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const nested = v as Record<string, unknown>;
        const nestedKeys = Object.keys(nested);
        if (nestedKeys.length > 20) continue; // skip bloated objects
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
      status: statusVal || undefined,
      source_command: pointer.command,
      data,
    });
  }

  return entities;
}
// --- BM25 ---

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9_\-\.@]/g, " ").split(/\s+/).filter(t => t.length > 1);
}

function bm25Rank(entities: ResolvedEntity[], queryStr: string, k1 = 1.5, b = 0.75): ResolvedEntity[] {
  const queryTokens = tokenize(queryStr);
  if (queryTokens.length === 0) return entities;

  // Build corpus: each entity becomes a "document" from title + all string data values
  const docs: { entity: ResolvedEntity; tokens: string[] }[] = entities.map(e => {
    const text = [
      e.title,
      e.type,
      e.status ?? "",
      ...Object.values(e.data).map(v =>
        typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : ""
      ),
    ].join(" ");
    return { entity: e, tokens: tokenize(text) };
  });

  const N = docs.length;
  const avgDl = docs.reduce((s, d) => s + d.tokens.length, 0) / (N || 1);

  // Document frequency per query term
  const df: Record<string, number> = {};
  for (const qt of queryTokens) {
    df[qt] = docs.filter(d => d.tokens.includes(qt)).length;
  }

  // Score each document
  const scored = docs.map(d => {
    let score = 0;
    const dl = d.tokens.length;

    for (const qt of queryTokens) {
      const tf = d.tokens.filter(t => t === qt).length;
      const idf = Math.log((N - (df[qt] ?? 0) + 0.5) / ((df[qt] ?? 0) + 0.5) + 1);
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
    }

    return { entity: d.entity, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.entity);
}

// --- Relation Discovery ---

/**
 * Extract linkable values from an entity's data.
 * Returns a map of match_type → values found.
 */
function extractLinkableValues(entity: ResolvedEntity): Map<string, { field: string; value: string }[]> {
  const linkables = new Map<string, { field: string; value: string }[]>();

  const addLink = (type: string, field: string, value: string) => {
    const list = linkables.get(type) ?? [];
    list.push({ field, value });
    linkables.set(type, list);
  };

  for (const [key, val] of Object.entries(entity.data)) {
    if (val === null || val === undefined) continue;
    const strVal = String(val);
    if (!strVal) continue;

    // Emails
    const emails = strVal.match(/[\w.-]+@[\w.-]+\.\w{2,}/g);
    if (emails) for (const e of emails) addLink("email", key, e.toLowerCase());

    // Issue/PR number refs (#76)
    const issueRefs = strVal.match(/#(\d+)\b/g);
    if (issueRefs) for (const r of issueRefs) addLink("id_ref", key, r);

    // Version tags (v3.1.0)
    const versions = strVal.match(/\bv\d+\.\d+\.\d+\b/g);
    if (versions) for (const v of versions) addLink("version", key, v);

    // Logins / usernames (short alphanumeric, from known field patterns)
    if (/^(login|user\.login|author\.login|username|owner|creator|assignee)$/i.test(key)) {
      if (typeof val === "string" && val.length > 1 && val.length < 40) {
        addLink("name", key, val.toLowerCase());
      }
    }

    // Firm/org names
    if (/^(firm|company|org|organization)$/i.test(key)) {
      if (typeof val === "string" && val.length > 2) {
        addLink("name", key, val.toLowerCase());
      }
    }
  }

  // Also extract from title and id
  const titleEmails = entity.title.match(/[\w.-]+@[\w.-]+\.\w{2,}/g);
  if (titleEmails) for (const e of titleEmails) addLink("email", "title", e.toLowerCase());

  return linkables;
}

/**
 * Discover relations between entities by cross-referencing linkable values.
 * Mutates entities in-place, adding `related` arrays.
 */
function discoverRelations(entities: ResolvedEntity[]): void {
  // Build index: value → entity IDs that contain it
  const valueIndex = new Map<string, Set<string>>();
  const entityMap = new Map<string, ResolvedEntity>();
  const entityLinks = new Map<string, Map<string, { field: string; value: string; matchType: string }>>();

  for (const entity of entities) {
    entityMap.set(entity.id, entity);
    const linkables = extractLinkableValues(entity);

    for (const [matchType, items] of linkables) {
      for (const { field, value } of items) {
        const key = `${matchType}:${value}`;
        const set = valueIndex.get(key) ?? new Set();
        set.add(entity.id);
        valueIndex.set(key, set);

        // Store per-entity link info
        const links = entityLinks.get(entity.id) ?? new Map();
        links.set(key, { field, value, matchType });
        entityLinks.set(entity.id, links);
      }
    }
  }

  // Also do value_overlap: scan all string values for exact matches across entities
  // Build a secondary index of distinctive values (emails, IDs, short strings)
  const distinctiveValues = new Map<string, Set<string>>(); // value → entity IDs
  for (const entity of entities) {
    for (const [key, val] of Object.entries(entity.data)) {
      if (typeof val !== "string" && typeof val !== "number") continue;
      const strVal = String(val);
      // Only index distinctive values (not too short, not too long, not URLs, not dates, not common strings)
      if (strVal.length < 3 || strVal.length > 60) continue;
      if (strVal.startsWith("http")) continue;
      if (/^\d+$/.test(strVal) && parseInt(strVal) < 100) continue; // skip small numbers
      if (/^\d{4}-\d{2}-\d{2}/.test(strVal)) continue; // skip dates
      if (/^(true|false|null|none|open|closed|active|pending)$/i.test(strVal)) continue; // skip common statuses

      const existing = distinctiveValues.get(strVal) ?? new Set();
      existing.add(entity.id);
      distinctiveValues.set(strVal, existing);
    }
  }

  // Now build relations from shared values
  for (const entity of entities) {
    const related: Relation[] = [];
    const seen = new Set<string>();

    // From typed linkables (email, id_ref, version, name)
    const links = entityLinks.get(entity.id);
    if (links) {
      for (const [key, { field, value, matchType }] of links) {
        const sharing = valueIndex.get(key);
        if (!sharing || sharing.size > 8) continue; // skip values shared by too many entities (not distinctive)
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
            matchType: matchType as Relation["matchType"],
          });
        }
      }
    }

    // From value_overlap (same distinctive value appears in multiple entities)
    for (const [, val] of Object.entries(entity.data)) {
      if (typeof val !== "string" || val.length < 3 || val.length > 60) continue;
      if (val.startsWith("http")) continue;
      const sharing = distinctiveValues.get(val);
      if (!sharing || sharing.size < 2 || sharing.size > 8) continue; // 2-8 = distinctive
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
          matchType: "value_overlap",
        });
      }
      if (related.length >= 10) break;
    }

    if (related.length > 0) {
      entity.related = related.slice(0, 10);
    }
  }
}

// --- Query ---
function query(type?: string, search?: string, withRelations = false): ResolvedEntity[] {
  const store = readStore();
  let results: ResolvedEntity[] = [];

  // If withRelations, resolve ALL pointers to build the full entity graph
  const pointersToResolve = withRelations
    ? store.pointers
    : (type ? store.pointers.filter(p => p.entity_type === type) : store.pointers);

  const allEntities: ResolvedEntity[] = [];
  for (const pointer of pointersToResolve) {
    const rawData = resolve(pointer, store);
    if (!rawData) continue;
    allEntities.push(...normalizeEntities(pointer, rawData));
  }

  // Discover cross-entity relations on the full set
  if (withRelations) {
    discoverRelations(allEntities);
  }

  // Filter to requested type after relation discovery
  results = type ? allEntities.filter(e => e.type === type) : allEntities;

  if (search) {
    results = bm25Rank(results, search);
  }

  return results;
}

// --- Exports (for library use) ---

export { learn, query, resolve, readStore, writeStore, discoverRelations, normalizeEntities };
export type { Pointer, PointerStore, ResolvedEntity, Relation };

// --- CLI ---

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case "learn": {
    const command = args[0];
    if (!command) { console.error("Usage: entity-learn learn <command> [--type <type>] [--ttl <seconds>]"); process.exit(1); }
    const typeIdx = args.indexOf("--type");
    const ttlIdx = args.indexOf("--ttl");
    const pointer = learn(command, {
      type: typeIdx !== -1 ? args[typeIdx + 1] : undefined,
      ttl: ttlIdx !== -1 ? Number(args[ttlIdx + 1]) : undefined,
    });
    if (pointer) console.log(JSON.stringify(pointer, null, 2));
    break;
  }

  case "query": {
    const typeIdx = args.indexOf("--type");
    const searchIdx = args.indexOf("--search");
    const withRelations = args.includes("--related");
    const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
    const search = searchIdx !== -1 ? args[searchIdx + 1] : undefined;
    const results = query(type, search, withRelations);
    console.log(JSON.stringify(results, null, 2));
    break;
  }

  case "render": {
    const prompt = args[0] ?? "init";
    const { render } = await import("./render.js");
    const store = readStore();
    const typesFn = () => {
      const counts: Record<string, number> = {};
      for (const p of store.pointers) counts[p.entity_type] = (counts[p.entity_type] || 0) + 1;
      return counts;
    };
    const output = render(prompt, query, typesFn);
    process.stdout.write(output);
    break;
  }

  case "types": {
    const store = readStore();
    const typeCounts: Record<string, number> = {};
    for (const p of store.pointers) {
      typeCounts[p.entity_type] = (typeCounts[p.entity_type] || 0) + 1;
    }
    console.log(JSON.stringify(typeCounts, null, 2));
    break;
  }

  case "pointers": {
    const store = readStore();
    console.log(JSON.stringify(store.pointers.map(p => ({
      entity_type: p.entity_type,
      command: p.command,
      fields: p.fields.length,
      confidence: p.confidence,
      use_count: p.use_count,
      learned_at: p.learned_at,
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
    } catch {}
    break;
  }
  default:
    console.error("Commands: learn, query, render, types, pointers, serve");
    console.error("  learn <command> [--type <type>] [--ttl <seconds>]");
    console.error("  query [--type <type>] [--search <term>] [--related]");
    console.error("  render <prompt>  — generate JSONL spec patches");
    console.error("  types");
    console.error("  pointers");
    console.error("  serve [port]  — start the UI");
}

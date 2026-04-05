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

interface ResolvedEntity {
  id: string;
  type: string;
  title: string;
  status?: string;
  source_command: string;
  data: Record<string, unknown>;
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

    entities.push({
      id: `${pointer.entity_type}.${idVal}`,
      type: pointer.entity_type,
      title: titleVal,
      status: statusVal || undefined,
      source_command: pointer.command,
      data: Object.fromEntries(
        pointer.fields
          .filter(f => item[f] !== undefined)
          .map(f => [f, item[f]])
      ),
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

// --- Query ---

function query(type?: string, search?: string): ResolvedEntity[] {
  const store = readStore();
  let results: ResolvedEntity[] = [];

  const matchingPointers = type
    ? store.pointers.filter(p => p.entity_type === type)
    : store.pointers;

  for (const pointer of matchingPointers) {
    const rawData = resolve(pointer, store);
    if (!rawData) continue;
    results.push(...normalizeEntities(pointer, rawData));
  }

  if (search) {
    results = bm25Rank(results, search);
  }

  return results;
}

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
    const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
    const search = searchIdx !== -1 ? args[searchIdx + 1] : undefined;
    const results = query(type, search);
    console.log(JSON.stringify(results, null, 2));
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

  default:
    console.error("Commands: learn, query, types, pointers");
    console.error("  learn <command> [--type <type>] [--ttl <seconds>]");
    console.error("  query [--type <type>] [--search <term>]");
    console.error("  types");
    console.error("  pointers");
}

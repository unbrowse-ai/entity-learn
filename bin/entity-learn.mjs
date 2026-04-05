#!/usr/bin/env node
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
  const existing = store.pointers.findIndex((p) => p.command === command);
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
    entities.push({
      id: `${pointer.entity_type}.${idVal}`,
      type: pointer.entity_type,
      title: titleVal,
      status: statusVal || void 0,
      source_command: pointer.command,
      data: Object.fromEntries(
        pointer.fields.filter((f) => item[f] !== void 0).map((f) => [f, item[f]])
      )
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
function query(type, search) {
  const store = readStore();
  let results = [];
  const matchingPointers = type ? store.pointers.filter((p) => p.entity_type === type) : store.pointers;
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
    const type = typeIdx !== -1 ? args[typeIdx + 1] : void 0;
    const search = searchIdx !== -1 ? args[searchIdx + 1] : void 0;
    const results = query(type, search);
    console.log(JSON.stringify(results, null, 2));
    break;
  }
  case "types": {
    const store = readStore();
    const typeCounts = {};
    for (const p of store.pointers) {
      typeCounts[p.entity_type] = (typeCounts[p.entity_type] || 0) + 1;
    }
    console.log(JSON.stringify(typeCounts, null, 2));
    break;
  }
  case "pointers": {
    const store = readStore();
    console.log(JSON.stringify(store.pointers.map((p) => ({
      entity_type: p.entity_type,
      command: p.command,
      fields: p.fields.length,
      confidence: p.confidence,
      use_count: p.use_count,
      learned_at: p.learned_at
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

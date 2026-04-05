#!/usr/bin/env node
/**
 * Benchmark 2: BM25 vs Vector Retrieval
 *
 * 1. Resolve all entities from entity-learn
 * 2. Embed each entity's text with text-embedding-3-small
 * 3. Run 20 agent-style queries through both BM25 and cosine similarity
 * 4. Compare recall@10 — which system finds the right entities?
 *
 * Agent queries tend to contain specific identifiers (issue numbers,
 * email addresses, version tags) where BM25 should excel.
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

const RESULTS_FILE = join(import.meta.dirname, "results-bm25-vs-vector.json");

function run(cmd, timeout = 60000) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return null; }
}

// --- BM25 implementation (matching entity-learn's) ---
function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9@#._/-]/g, " ").split(/\s+/).filter(t => t.length > 1);
}

function bm25Search(entities, query, k1 = 1.5, b = 0.75) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return entities.map(e => ({ entity: e, score: 0 }));

  const docs = entities.map(e => {
    const text = [e.title, e.type, e.status || "", ...Object.values(e.data || {}).map(v =>
      typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : ""
    )].join(" ");
    return { entity: e, tokens: tokenize(text) };
  });

  const N = docs.length;
  const avgDl = docs.reduce((s, d) => s + d.tokens.length, 0) / (N || 1);

  const df = {};
  for (const qt of queryTokens) {
    df[qt] = docs.filter(d => d.tokens.includes(qt)).length;
  }

  return docs.map(d => {
    let score = 0;
    const dl = d.tokens.length;
    for (const qt of queryTokens) {
      const tf = d.tokens.filter(t => t === qt).length;
      const idf = Math.log((N - (df[qt] || 0) + 0.5) / ((df[qt] || 0) + 0.5) + 1);
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
    }
    return { entity: d.entity, score };
  }).sort((a, b) => b.score - a.score);
}
// --- Vector search with Google Gemini embeddings ---
async function embed(texts) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "AIzaSyCVbIP1FDkNtuxdEzbdpmjDV-U5EbBq38E";

  const allEmbeddings = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: batch.map(text => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
        })),
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    allEmbeddings.push(...data.embeddings.map(e => e.values));
    if (i + 100 < texts.length) await new Promise(r => setTimeout(r, 500));
  }
  return allEmbeddings;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function vectorSearch(entities, embeddings, queryEmbedding) {
  return entities.map((e, i) => ({
    entity: e,
    score: cosineSimilarity(embeddings[i], queryEmbedding),
  })).sort((a, b) => b.score - a.score);
}

// --- Test queries with known relevant entities ---
function buildQueries(entities) {
  const queries = [];

  // Find real entities to build ground-truth queries
  const issues = entities.filter(e => e.type === "issue");
  const deals = entities.filter(e => e.type === "deal");
  const releases = entities.filter(e => e.type === "release");
  const prs = entities.filter(e => e.type === "pull_request");
  const repos = entities.filter(e => e.type === "github_repo");
  const stars = entities.filter(e => e.type === "stargazer");

  // Type 1: Issue number queries (BM25 should dominate)
  for (const issue of issues.slice(0, 3)) {
    const num = issue.data?.number;
    if (num) {
      queries.push({
        query: `issue #${num}`,
        relevant_ids: [issue.id],
        category: "identifier",
      });
    }
  }

  // Type 2: Issue title keyword queries
  for (const issue of issues.slice(0, 3)) {
    const title = issue.title || "";
    const words = title.split(/\s+/).filter(w => w.length > 4).slice(0, 2);
    if (words.length > 0) {
      queries.push({
        query: words.join(" "),
        relevant_ids: [issue.id],
        category: "keyword",
      });
    }
  }

  // Type 3: Version tag queries (cross-source: should match release + PRs)
  for (const rel of releases.slice(0, 2)) {
    const tag = rel.data?.tag_name;
    if (tag) {
      const relatedIds = [rel.id];
      // Any entity mentioning this version
      for (const e of entities) {
        if (e.id === rel.id) continue;
        const text = JSON.stringify(e.data);
        if (text.includes(tag)) relatedIds.push(e.id);
      }
      queries.push({
        query: tag,
        relevant_ids: relatedIds.slice(0, 10),
        category: "version",
      });
    }
  }

  // Type 4: Deal/company name queries
  for (const deal of deals.slice(0, 3)) {
    const firm = deal.data?.firm || deal.data?.name || deal.title;
    if (firm && firm.length > 2) {
      queries.push({
        query: firm,
        relevant_ids: [deal.id],
        category: "entity_name",
      });
    }
  }

  // Type 5: Status-based queries
  queries.push({
    query: "open issues",
    relevant_ids: issues.filter(i => i.data?.state === "open").map(i => i.id).slice(0, 10),
    category: "status",
  });

  // Type 6: Repo name queries
  for (const repo of repos.slice(0, 2)) {
    const name = repo.data?.full_name || repo.data?.name || repo.title;
    if (name) {
      queries.push({
        query: name,
        relevant_ids: [repo.id],
        category: "entity_name",
      });
    }
  }

  // Type 7: Cross-source queries (person/login appearing in multiple types)
  const logins = new Map();
  for (const e of entities) {
    const login = e.data?.login || e.data?.user?.login;
    if (login) {
      const list = logins.get(login) || [];
      list.push(e.id);
      logins.set(login, list);
    }
  }
  for (const [login, ids] of logins) {
    if (ids.length >= 2) {
      queries.push({
        query: login,
        relevant_ids: ids.slice(0, 10),
        category: "cross_source",
      });
      break; // one is enough
    }
  }

  return queries.slice(0, 20);
}

function recallAtK(results, relevantIds, k = 10) {
  const topK = results.slice(0, k).map(r => r.entity.id);
  const found = relevantIds.filter(id => topK.includes(id)).length;
  return found / relevantIds.length;
}

async function main() {
  console.log("=== BM25 vs Vector Retrieval Benchmark ===\n");

  // Step 1: Get all entities
  console.log("Step 1: Resolving all entities...");
  const raw = run("entity-learn query", 120000);
  if (!raw) { console.error("Failed to query entities"); process.exit(1); }
  const entities = JSON.parse(raw);
  console.log(`  Resolved ${entities.length} entities across ${new Set(entities.map(e => e.type)).size} types\n`);

  // Step 2: Build entity texts for embedding
  console.log("Step 2: Preparing entity texts for embedding...");
  const entityTexts = entities.map(e => {
    return [e.title, e.type, e.status || "", ...Object.values(e.data || {}).map(v =>
      typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : ""
    )].join(" ").slice(0, 500); // truncate for embedding
  });
  console.log(`  Prepared ${entityTexts.length} texts\n`);

  // Step 3: Embed all entities
  console.log("Step 3: Embedding entities with text-embedding-004 (Google)...");
  const t0 = Date.now();
  const entityEmbeddings = await embed(entityTexts);
  const embedTime = Date.now() - t0;
  console.log(`  Embedded ${entityEmbeddings.length} entities in ${embedTime}ms\n`);

  // Step 4: Build queries with ground truth
  console.log("Step 4: Building test queries...");
  const queries = buildQueries(entities);
  console.log(`  Built ${queries.length} queries\n`);

  // Step 5: Embed queries
  console.log("Step 5: Embedding queries...");
  const queryEmbeddings = await embed(queries.map(q => q.query));

  // Step 6: Run both retrieval systems
  console.log("Step 6: Running retrieval comparison...\n");

  const results = [];
  let bm25Wins = 0, vectorWins = 0, ties = 0;
  let bm25TotalRecall = 0, vectorTotalRecall = 0;

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];

    // BM25
    const bm25Results = bm25Search(entities, q.query);
    const bm25Recall = recallAtK(bm25Results, q.relevant_ids, 10);

    // Vector
    const vecResults = vectorSearch(entities, entityEmbeddings, queryEmbeddings[i]);
    const vecRecall = recallAtK(vecResults, q.relevant_ids, 10);

    bm25TotalRecall += bm25Recall;
    vectorTotalRecall += vecRecall;

    if (bm25Recall > vecRecall) bm25Wins++;
    else if (vecRecall > bm25Recall) vectorWins++;
    else ties++;

    const winner = bm25Recall > vecRecall ? "BM25" : vecRecall > bm25Recall ? "VECTOR" : "TIE";

    results.push({
      query: q.query,
      category: q.category,
      relevant_count: q.relevant_ids.length,
      bm25_recall: bm25Recall,
      vector_recall: vecRecall,
      winner,
    });

    console.log(`  [${q.category}] "${q.query.slice(0, 40)}" — BM25: ${(bm25Recall*100).toFixed(0)}% | Vec: ${(vecRecall*100).toFixed(0)}% → ${winner}`);
  }

  const n = queries.length;
  const summary = {
    total_queries: n,
    total_entities: entities.length,
    embedding_time_ms: embedTime,
    bm25_mean_recall: bm25TotalRecall / n,
    vector_mean_recall: vectorTotalRecall / n,
    bm25_wins: bm25Wins,
    vector_wins: vectorWins,
    ties,
    by_category: {},
  };

  // Per-category breakdown
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    summary.by_category[cat] = {
      count: catResults.length,
      bm25_mean_recall: catResults.reduce((s, r) => s + r.bm25_recall, 0) / catResults.length,
      vector_mean_recall: catResults.reduce((s, r) => s + r.vector_recall, 0) / catResults.length,
    };
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`BM25 mean Recall@10:   ${(summary.bm25_mean_recall * 100).toFixed(1)}%`);
  console.log(`Vector mean Recall@10: ${(summary.vector_mean_recall * 100).toFixed(1)}%`);
  console.log(`BM25 wins: ${bm25Wins} | Vector wins: ${vectorWins} | Ties: ${ties}`);
  console.log(`\nPer category:`);
  for (const [cat, data] of Object.entries(summary.by_category)) {
    console.log(`  ${cat}: BM25 ${(data.bm25_mean_recall*100).toFixed(0)}% vs Vec ${(data.vector_mean_recall*100).toFixed(0)}%`);
  }

  const output = { summary, results };
  writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${RESULTS_FILE}`);
}

main().catch(console.error);

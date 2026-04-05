#!/usr/bin/env node
/**
 * Benchmark 3: Relation Discovery Precision
 *
 * For each discovered relation, verify it's actually correct:
 * - email: both entities genuinely share the same email address
 * - id_ref: the referenced ID actually exists in the target entity
 * - version: both entities genuinely contain the version string
 * - name: both entities share the same person/org name
 * - value_overlap: the shared value is meaningful (not coincidental)
 *
 * Reports precision = correct_relations / total_relations
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

const RESULTS_FILE = join(import.meta.dirname, "results-relation-precision.json");

function run(cmd, timeout = 120000) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return null; }
}

function verifyRelation(source, target, relation) {
  const sourceText = JSON.stringify(source.data || {}).toLowerCase();
  const targetText = JSON.stringify(target.data || {}).toLowerCase();
  const matchValue = (relation.matchValue || "").toLowerCase();

  if (!matchValue || matchValue.length < 2) {
    return { correct: false, reason: "empty match value" };
  }

  switch (relation.matchType) {
    case "email": {
      // Both entities must genuinely contain this email
      const inSource = sourceText.includes(matchValue);
      const inTarget = targetText.includes(matchValue);
      const isEmail = /^[^@]+@[^@]+\.[^@]+$/.test(matchValue);
      return {
        correct: inSource && inTarget && isEmail,
        reason: inSource && inTarget ? (isEmail ? "valid email in both" : "not a valid email format") : `missing in ${!inSource ? "source" : "target"}`,
      };
    }
    case "id_ref": {
      const inSource = sourceText.includes(matchValue);
      const inTarget = targetText.includes(matchValue);
      return {
        correct: inSource && inTarget,
        reason: inSource && inTarget ? "ID reference found in both" : `missing in ${!inSource ? "source" : "target"}`,
      };
    }
    case "version": {
      const inSource = sourceText.includes(matchValue);
      const inTarget = targetText.includes(matchValue);
      const isVersion = /^v?\d+\.\d+/.test(matchValue);
      return {
        correct: inSource && inTarget && isVersion,
        reason: inSource && inTarget ? (isVersion ? "version tag in both" : "not a version format") : `missing in ${!inSource ? "source" : "target"}`,
      };
    }
    case "name": {
      const inSource = sourceText.includes(matchValue);
      const inTarget = targetText.includes(matchValue);
      const isMeaningful = matchValue.length >= 3 && !/^(the|and|for|with|from|this|that)$/.test(matchValue);
      return {
        correct: inSource && inTarget && isMeaningful,
        reason: inSource && inTarget ? (isMeaningful ? "name found in both" : "too generic") : `missing in ${!inSource ? "source" : "target"}`,
      };
    }
    case "value_overlap": {
      const inSource = sourceText.includes(matchValue);
      const inTarget = targetText.includes(matchValue);
      // Check if the value is meaningful (not just a common word)
      const commonWords = new Set(["open", "closed", "true", "false", "null", "none", "active", "pending", "done", "github", "com", "api", "the", "and", "for"]);
      const isMeaningful = matchValue.length >= 3 && !commonWords.has(matchValue) && !/^\d+$/.test(matchValue);
      // Check cross-type (different entity types makes it more interesting)
      const crossType = source.type !== target.type;
      return {
        correct: inSource && inTarget && isMeaningful,
        reason: inSource && inTarget
          ? (isMeaningful ? `meaningful overlap${crossType ? " (cross-type)" : ""}` : "trivial/common value")
          : `missing in ${!inSource ? "source" : "target"}`,
        cross_type: crossType,
      };
    }
    default:
      return { correct: false, reason: `unknown match type: ${relation.matchType}` };
  }
}

async function main() {
  console.log("=== Relation Discovery Precision Benchmark ===\n");
  // Step 1: Get all entities with relations — use type-by-type to avoid timeout
  console.log("Step 1: Resolving entities with relations (type by type)...");
  const types = JSON.parse(run("entity-learn types") || "{}");
  let entities = [];
  for (const type of Object.keys(types)) {
    const raw = run(`entity-learn query --type ${type} --related`);
    if (!raw) { console.log(`  [skip] ${type}: failed`); continue; }
    try {
      const parsed = JSON.parse(raw);
      entities.push(...parsed);
      console.log(`  [ok] ${type}: ${parsed.length} entities`);
    } catch { console.log(`  [skip] ${type}: parse error`); }
  }
  console.log(`  Total: ${entities.length} entities\n`);

  if (entities.length === 0) {
    console.error("No entities resolved — check API connectivity");
    process.exit(1);
  }

  const entityMap = new Map(entities.map(e => [e.id, e]));
  const withRelations = entities.filter(e => e.related && e.related.length > 0);
  const allRelations = [];
  for (const e of withRelations) {
    for (const r of e.related) {
      allRelations.push({ source: e, relation: r });
    }
  }

  console.log(`  Entities with relations: ${withRelations.length}`);
  console.log(`  Total relations to verify: ${allRelations.length}\n`);

  // Step 2: Verify each relation
  console.log("Step 2: Verifying relations...\n");

  const results = { by_type: {}, details: [] };
  let totalCorrect = 0;
  let totalChecked = 0;
  let crossTypeCorrect = 0;
  let crossTypeTotal = 0;

  for (const { source, relation } of allRelations) {
    const target = entityMap.get(relation.targetId);
    if (!target) continue; // target not in result set

    totalChecked++;
    const verification = verifyRelation(source, target, relation);

    if (verification.correct) totalCorrect++;
    if (verification.cross_type) {
      crossTypeTotal++;
      if (verification.correct) crossTypeCorrect++;
    }

    // Track by type
    const mt = relation.matchType;
    if (!results.by_type[mt]) {
      results.by_type[mt] = { correct: 0, incorrect: 0, total: 0, examples: [] };
    }
    results.by_type[mt].total++;
    if (verification.correct) results.by_type[mt].correct++;
    else results.by_type[mt].incorrect++;

    // Store first few examples per type
    if (results.by_type[mt].examples.length < 3) {
      results.by_type[mt].examples.push({
        source_type: source.type,
        source_title: (source.title || "").slice(0, 50),
        target_type: relation.targetType,
        target_title: (relation.targetTitle || "").slice(0, 50),
        match_value: relation.matchValue,
        correct: verification.correct,
        reason: verification.reason,
      });
    }

    results.details.push({
      source_id: source.id,
      source_type: source.type,
      target_type: relation.targetType,
      match_type: mt,
      match_value: relation.matchValue,
      correct: verification.correct,
      reason: verification.reason,
    });
  }

  // Print results
  console.log("=== RESULTS ===\n");

  const precision = totalCorrect / totalChecked;
  console.log(`Overall precision: ${totalCorrect}/${totalChecked} = ${(precision * 100).toFixed(1)}%`);
  if (crossTypeTotal > 0) {
    console.log(`Cross-type precision: ${crossTypeCorrect}/${crossTypeTotal} = ${(crossTypeCorrect/crossTypeTotal*100).toFixed(1)}%`);
  }
  console.log();

  for (const [type, data] of Object.entries(results.by_type)) {
    const p = data.correct / data.total;
    console.log(`  ${type}: ${data.correct}/${data.total} = ${(p * 100).toFixed(0)}% precision`);
    for (const ex of data.examples.slice(0, 2)) {
      console.log(`    ${ex.correct ? "✓" : "✗"} ${ex.source_type}→${ex.target_type} via "${ex.match_value.slice(0, 30)}" — ${ex.reason}`);
    }
  }

  const summary = {
    total_entities: entities.length,
    entities_with_relations: withRelations.length,
    total_relations_checked: totalChecked,
    correct_relations: totalCorrect,
    precision,
    cross_type_total: crossTypeTotal,
    cross_type_correct: crossTypeCorrect,
    cross_type_precision: crossTypeTotal > 0 ? crossTypeCorrect / crossTypeTotal : null,
    by_type: Object.fromEntries(Object.entries(results.by_type).map(([k, v]) => [k, {
      total: v.total,
      correct: v.correct,
      precision: v.correct / v.total,
    }])),
  };

  writeFileSync(RESULTS_FILE, JSON.stringify({ summary, details: results.details }, null, 2));
  console.log(`\nResults saved to ${RESULTS_FILE}`);
}

main().catch(console.error);

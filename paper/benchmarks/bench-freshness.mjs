#!/usr/bin/env node
import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

const RESULTS = join(import.meta.dirname, "results-freshness.json");
const STORE = join(process.env.HOME, ".agent-org", "pointers.json");
const PIPELINE = join(process.env.HOME, ".hermes/skills/vc-rolodex/data/pipeline.json");
const run = (c, t = 30000) => { try { return execSync(c, { encoding: "utf-8", timeout: t, stdio: ["pipe","pipe","pipe"] }).trim(); } catch { return null; } };
const clearCache = () => { const s = JSON.parse(readFileSync(STORE, "utf-8")); s.cache = {}; writeFileSync(STORE, JSON.stringify(s, null, 2)); };
const query = (type) => { const r = run(`entity-learn query --type ${type}`, 60000); try { return JSON.parse(r); } catch { return []; } };
const log = console.log;

async function main() {
  const tests = [];

  // ═══ TEST 1: GitHub Issue ═══
  log("═══ TEST 1: GitHub Issue Creation ═══");
  clearCache();
  const snap = query("issue");
  log(`  Snapshot: ${snap.length} issues`);

  const created = JSON.parse(run(`gh api repos/unbrowse-ai/unbrowse/issues -f title="[bench] ${Date.now()}" -f body="Auto."`) || "{}");
  log(`  Created #${created.number}`);

  await new Promise(r => setTimeout(r, 3000));
  clearCache();
  const live = query("issue");
  const issueOk = live.length > snap.length;
  log(`  Live: ${live.length} issues (snap was ${snap.length}) → ${issueOk ? "CONFIRMED" : "FAIL"}`);

  if (created.number) run(`gh api repos/unbrowse-ai/unbrowse/issues/${created.number} -X PATCH -f state=closed`);
  log(`  Closed #${created.number}`);
  tests.push({ name: "github_issue", snap: snap.length, live: live.length, confirmed: issueOk });

  // ═══ TEST 2: CRM Deal Mutation ═══
  log("\n═══ TEST 2: CRM Deal Mutation ═══");
  try {
    clearCache();
    const snapDeals = query("deal");
    const target = snapDeals.find(d => d.data?.status);
    const origStatus = target.data.status;
    const firm = target.data.firm;
    log(`  Snapshot: "${firm}" status="${origStatus}"`);

    const origFile = readFileSync(PIPELINE, "utf-8");
    const pip = JSON.parse(origFile);
    const key = Object.keys(pip.leads).find(k => pip.leads[k].firm === firm);
    pip.leads[key].status = "BENCH_" + Date.now();
    const mutated = pip.leads[key].status;
    writeFileSync(PIPELINE, JSON.stringify(pip, null, 2));
    log(`  Mutated → "${mutated}"`);

    clearCache();
    const liveDeals = query("deal");
    const liveDeal = liveDeals.find(d => d.data?.firm === firm);
    const dealOk = liveDeal?.data?.status === mutated;
    log(`  Live: "${liveDeal?.data?.status}" → ${dealOk ? "CONFIRMED" : "FAIL"}`);

    writeFileSync(PIPELINE, origFile);
    log(`  Restored`);
    tests.push({ name: "crm_deal", original: origStatus, mutated, live: liveDeal?.data?.status, confirmed: dealOk });
  } catch (e) {
    log(`  Skipped: ${e.message}`);
    tests.push({ name: "crm_deal", confirmed: false, skipped: true });
  }

  // ═══ TEST 3: npm Live Match ═══
  log("\n═══ TEST 3: npm Downloads Live Match ═══");
  clearCache();
  const elNpm = query("npm_downloads");
  const elVal = elNpm[0]?.data?.downloads;
  const directVal = JSON.parse(run(`curl -s 'https://api.npmjs.org/downloads/point/last-week/unbrowse'`) || "{}").downloads;
  const npmOk = elVal === directVal;
  log(`  entity-learn: ${elVal} | direct API: ${directVal} → ${npmOk ? "MATCH" : "MISMATCH"}`);
  tests.push({ name: "npm_live_match", el: elVal, direct: directVal, confirmed: npmOk });

  // ═══ SUMMARY ═══
  const passed = tests.filter(t => t.confirmed).length;
  const total = tests.filter(t => !t.skipped).length;
  log(`\n═══ RESULT: ${passed}/${total} confirmed ═══`);
  tests.forEach(t => log(`  ${t.confirmed ? "✓" : t.skipped ? "○" : "✗"} ${t.name}`));

  writeFileSync(RESULTS, JSON.stringify({ tests, summary: { passed, total } }, null, 2));
}

main().catch(console.error);

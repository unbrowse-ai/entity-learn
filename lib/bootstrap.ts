/**
 * Bootstrap — Auto-mine Claude Code session history for data-producing commands
 * and teach them to entity-learn as pointers.
 *
 * Usage: entity-learn bootstrap [--max-sessions 100]
 *
 * Scans ~/.claude/projects/ JSONL files for Bash tool calls that:
 * 1. Produce JSON output (curl, gh api, gws, jq, etc.)
 * 2. Were used more than once (signal, not noise)
 * 3. Don't already exist as pointers
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

interface ToolCall {
  command: string;
  count: number;
}

const CLAUDE_DIR = join(homedir(), ".claude", "projects");

// Patterns that produce JSON data worth learning
const DATA_PATTERNS: [RegExp, string][] = [
  [/gh api ['"]?repos\/([^\s'"]+)\/issues/, "issue"],
  [/gh api ['"]?repos\/([^\s'"]+)\/pulls/, "pull_request"],
  [/gh api ['"]?repos\/([^\s'"]+)\/releases/, "release"],
  [/gh api ['"]?repos\/([^\s'"]+)\/contributors/, "contributor"],
  [/gh api ['"]?repos\/([^\s'"]+)\/stargazers/, "stargazer"],
  [/gh api ['"]?repos\/([^\s'"]+)\/traffic\/views/, "repo_traffic"],
  [/gh api ['"]?repos\/([^\s'"]+)\/traffic\/clones/, "clone_traffic"],
  [/gh api ['"]?repos\/([^\s'"]+)['"]\s*$/, "repo"],
  [/curl.*api\.npmjs\.org\/downloads/, "npm_downloads"],
  [/curl.*api\.semanticscholar\.org/, "paper"],
  [/curl.*api\.resend\.com/, "email_campaign"],
  [/curl.*api\.telegram\.org/, "telegram"],
  [/curl.*api\.github\.com\/users\//, "github_user"],
  [/curl.*api\.github\.com\/repos\//, "github_repo"],
  [/curl.*beta-api\.unbrowse\.ai\/v1\/stats/, "product_metric"],
  [/curl.*beta-api\.unbrowse\.ai\/v1\/analytics/, "analytics"],
  [/curl.*cloud\.umami\.is/, "umami_analytics"],
  [/curl.*public-api\.granola\.ai/, "meeting_note"],
  [/gws gmail users messages list/, "email"],
  [/gws calendar \+agenda/, "calendar_event"],
  [/gws sheets/, "spreadsheet"],
  [/jq ['"]?\.\w+['"]?\s+.*\.json/, "json_data"],
];

// Commands to skip (too generic, not data-producing)
const SKIP_PATTERNS = [
  /curl.*localhost/,
  /curl.*127\.0\.0\.1/,
  /curl.*health/,
  /curl.*\.css/,
  /curl.*\.js$/,
  /curl.*\.html/,
  /curl.*install\.sh/,
  /curl.*-X\s*(PUT|DELETE|PATCH)/,
  /gh run/,
  /gh pr create/,
  /gh issue create/,
  /gh auth/,
  /gh release create/,
];

function findJsonlFiles(maxFiles: number): string[] {
  const files: { path: string; mtime: number }[] = [];

  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".jsonl")) {
          try { files.push({ path: full, mtime: statSync(full).mtimeMs }); } catch {}
        }
      }
    } catch {}
  }

  walk(CLAUDE_DIR);
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, maxFiles).map((f) => f.path);
}

function extractDataCommands(jsonlFiles: string[]): Map<string, ToolCall & { type: string }> {
  const commands = new Map<string, ToolCall & { type: string }>();

  for (const fpath of jsonlFiles) {
    try {
      const lines = readFileSync(fpath, "utf-8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        if (obj.type !== "assistant") continue;

        for (const block of obj.message?.content ?? []) {
          if (block?.type !== "tool_use" || block.name !== "Bash") continue;
          const cmd = (block.input?.command as string) ?? "";
          if (!cmd) continue;

          // Check against skip patterns
          if (SKIP_PATTERNS.some((p) => p.test(cmd))) continue;

          // Check against data patterns
          for (const [pattern, type] of DATA_PATTERNS) {
            if (pattern.test(cmd)) {
              // Normalize: strip variable substitutions, trim
              const normalized = cmd
                .replace(/\$\{?\w+\}?/g, "*")
                .replace(/\s+2>&1.*$/, "")
                .replace(/\s*\|.*$/, "")
                .trim();

              const key = `${type}:${normalized}`;
              const existing = commands.get(key);
              if (existing) {
                existing.count++;
              } else {
                commands.set(key, { command: cmd.replace(/\s+2>&1.*$/, "").replace(/\s*\|.*$/, "").trim(), count: 1, type });
              }
              break;
            }
          }
        }
      }
    } catch {}
  }

  return commands;
}

function getExistingCommands(): Set<string> {
  try {
    const storePath = join(homedir(), ".agent-org", "pointers.json");
    const store = JSON.parse(readFileSync(storePath, "utf-8"));
    return new Set((store.pointers ?? []).map((p: { command: string }) => p.command));
  } catch {
    return new Set();
  }
}

export function bootstrap(maxSessions = 200, dryRun = false): { learned: string[]; skipped: string[]; errors: string[] } {
  const scriptDir = new URL(".", import.meta.url).pathname;
  const elBin = join(scriptDir, "..", "bin", "entity-learn.mjs");
  const jsonlFiles = findJsonlFiles(maxSessions);
  console.log(`Scanning ${jsonlFiles.length} session files...`);

  const commands = extractDataCommands(jsonlFiles);
  console.log(`Found ${commands.size} unique data-producing commands`);

  const existing = getExistingCommands();
  const results = { learned: [] as string[], skipped: [] as string[], errors: [] as string[] };

  // Sort by frequency (most used first)
  const sorted = [...commands.values()].sort((a, b) => b.count - a.count);

  for (const { command, count, type } of sorted) {
    if (count < 2) continue; // need at least 2 occurrences
    if (existing.has(command)) {
      results.skipped.push(`[skip] ${type}: ${command.slice(0, 60)} (already learned)`);
      continue;
    }

    if (dryRun) {
      results.learned.push(`[dry] ${type} (${count}x): ${command.slice(0, 80)}`);
      continue;
    }

    // Try to learn it
    try {
      const escaped = command.replace(/"/g, '\\"');
      execSync(`node "${elBin}" learn "${escaped}" --type ${type}`, {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });
      results.learned.push(`[ok] ${type} (${count}x): ${command.slice(0, 80)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      results.errors.push(`[err] ${type}: ${command.slice(0, 60)} — ${msg.slice(0, 40)}`);
    }
  }

  return results;
}

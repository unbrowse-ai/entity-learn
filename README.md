# entity-learn

Zero-copy live memory for agents. Learn tool call pointers, query with BM25 across all sources.

Instead of storing data, `entity-learn` stores **pointers** — the commands that produce data. Every query replays the command and gets live results. The "database" is a list of shell commands + auto-inferred field mappings.

```
learn "gh api '...'"  ->  observes output  ->  infers schema  ->  saves pointer
query --search "..."  ->  replays commands  ->  BM25 ranks     ->  returns live data
```

## Install

```bash
npx entity-learn --help

# Or install globally
npm i -g entity-learn
```

## Usage

```bash
# Teach it a source (run once, saved forever)
entity-learn learn "gh api 'repos/owner/repo/issues?state=open'"
entity-learn learn "curl -s 'https://api.npmjs.org/downloads/point/last-week/pkg'"
entity-learn learn "gws gmail users messages list --params '{\"userId\":\"me\",\"q\":\"in:inbox\"}'" --type email
entity-learn learn "jq '.leads' pipeline.json" --type deal

# Query (always live, BM25 ranked)
entity-learn query --search "windows crash ESM"
entity-learn query --type issue --search "browser timeout"
entity-learn query --type deal

# Inspect
entity-learn types      # what entity types exist
entity-learn pointers   # all learned commands + schemas
```

## How it works

### Learn

Run any command that produces JSON. `entity-learn` executes it, observes the output shape, and auto-infers:
- **entity_type** — from command patterns (`gh`->issue, `gmail`->email) or `--type` override
- **id_field** — scans for `id`, `number`, `key`, `slug`, etc.
- **title_field** — scans for `title`, `name`, `subject`, etc.
- **status_field** — scans for `status`, `state`, `stage`, etc.
- **fields** — all primitive fields in the output

The pointer (command + schema) is saved to `~/.agent-org/pointers.json`. The data itself is NOT saved — only cached briefly (TTL, default 5 min).

### Query

Resolves all matching pointers by re-executing their commands. Results are normalized into a common entity shape:

```json
{
  "id": "issue.76",
  "type": "issue",
  "title": "Windows: Server crashes on startup",
  "status": "open",
  "source_command": "gh api '...'",
  "data": { "number": 76, "title": "...", "state": "open" }
}
```

If `--search` is provided, results are ranked using **BM25** (TF-IDF with document length normalization). Search works across entity types — "Maven fundraising" finds deals, "windows crash" finds issues.

### Cache

Results are cached per-pointer with a TTL (default 300s). Within TTL, queries return cached data instantly. After TTL, the command is re-executed for fresh data. Stale cache is used as fallback if the command fails.

## Architecture

```
pointers.json (the entire "database")
+-- pointer: { command, entity_type, id_field, title_field, fields, ttl }
+-- pointer: { command, entity_type, id_field, title_field, fields, ttl }
+-- cache: { pointer_id -> { data, fetched_at } }
```

No vector DB. No knowledge graph. No embeddings. Just a list of shell commands and the schema of what they return.

## Integration with Claude Code

Add to your `CLAUDE.md`:

```markdown
## Live Memory

Use `entity-learn` for persistent, live-resolving memory across all data sources.

Before searching manually, check if a pointer exists:
  entity-learn query --search "your question"

When you discover a useful command that returns JSON, teach it:
  entity-learn learn "the command" --type entity_type
```

## Key insight

Existing agent memory systems copy data into stores (vector DBs, knowledge graphs, context trees). This copies **nothing**. The "memory" is just a mapping: "to get issues, run this command; to get deals, run that command." Every query is live. The agent builds its own memory by using tools.

## Novel contribution

No existing system (MemGPT, A-MEM, ByteRover, Mem0, MaaS) does pointer-based live resolution from heterogeneous tool calls with BM25 cross-source search. They all copy data in. This doesn't.

## License

MIT

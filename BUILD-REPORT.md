# paperport — Build Report

Wave Tier A, MCP Rebuild 100. Clean-room rebuild of the "arxiv" MCP
server, built from the public tool spec in
`harness/fixtures/arxiv-tools-original.json` only (that fixture is
docs-derived, not hand-probed — see its `_source`), covering the core
documented tools. Local build only — nothing pushed or published.

Identity: repo `paperport`, npm `@reneturcios/paperport`,
MCP name `io.github.CloudCorpRecords/paperport`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `paperport: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Search and read arXiv papers, with
  local paper storage." = **55 chars** (≤100 ✓); npm entry carries
  `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/paperport:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/paperport"`
- `tsconfig.json` (copied unchanged from clockport), `.gitignore`,
  `LICENSE` (copied from clockport, MIT © 2026 Rene Turcios),
  `README.md` (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`mcp`, `search`, `abstract`,
  `download`, `list`, `read`, `--version`; exit 2 usage / 1 lookup
  error), `src/mcp.ts`, `src/types.ts`, `src/papers.ts`
  (core logic, `VERSION = "0.1.0"`)
- `test/papers.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (copied from clockport; image name and smoke-test server name changed)

## Implementation notes

- Search and abstract lookup query the public arXiv API at
  `export.arxiv.org/api/query` (`search_query` with `all:` terms,
  `cat:` filters and a `submittedDate:` range; `id_list` for single
  papers). Its Atom responses are parsed with a small deterministic
  XML reader (string/regex only): entries yield `id` (version suffix
  removed), `title`, `summary`, `authors`, `published`, `categories`,
  and `pdf_url` (explicit pdf link, else constructed).
- All network access goes through an injectable `FetchFn` and all
  storage through an injectable directory, so every test uses a fake
  fetch with fixture Atom strings and a temp dir. **No live arXiv
  call was made or is claimed.**
- Storage: `download_paper` writes `<id>.md` under the storage dir
  (env `PAPERPORT_STORAGE_DIR` or `./papers`); `list_papers` lists
  those files; `read_paper` reads one back and errors when absent.
- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals (clockport pattern), so tools/list matches the
  spec exactly; zod still validates every tools/call.

## Honest gap vs the original

`download_paper` does **not** reproduce the original's PDF-to-markdown
conversion. It fetches the paper's arXiv API entry and stores its
metadata and abstract (title, authors, categories, dates, abstract
page and PDF links) as a local markdown file; `read_paper` returns
that file. The paper's full text is only available via the linked
PDF. This limitation is stated in the README and is not hidden.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc_exit=0
```
`dist/` produced (cli.js with `#!/usr/bin/env node` shebang, papers.js,
mcp.js, index.js, types.js, plus .d.ts/.js.map).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 13
ℹ pass 13
ℹ fail 0
```
Covers: id normalisation (prefix/URL/version, old-style filename
sanitising), search URL building (phrase quoting, category + date
filters, invalid dates, default page size), id_list URL, Atom entry
parsing (multi-line title/summary collapsing, authors, categories,
pdf link fallback), search/abstract via fake fetch, HTTP 503 and
not-found errors, and the full download → list → read cycle in a
temp dir including the missing-dir and unread-paper cases.

### 3. CLI smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage;
`list` (empty default storage) → `[]`, exit 0.

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
Original is tools-file mode, so the harness records
`fixture_results: SKIPPED-TOOLS-FILE-MODE` — expected semantics.
```
$ python3 parity.py --original fixtures/arxiv-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/paperport/dist/cli.js mcp" \
    --out /home/hatch/workspace/mcp-rebuild-100/builds/paperport/parity-out
verdict=PASS parity_pct=100.0 original_tools=5 rebuild_tools=5 missing=[] extra=[] schema_diffs=[]
(exit 0)
```

## Lockfile status

`package-lock.json` was copied from clockport's and edited with the
file edit tool: top-level `name`, root package `name`, and root package
`bin` key changed clockport → paperport (dependency ranges are
identical, so the tree is unchanged). Per TEMPLATE.md §2 item 6, a
lockfile must be generated clean (no `node_modules` present) before
first publish — **clean regeneration is FLAGGED and deferred to the
publish wave**; do not publish from this lockfile as-is.
`node_modules` in this build dir is a `cp -a` copy of clockport's
(local build only, gitignored).

## Blockers

None for the local build. Notes:
- The PDF-to-markdown gap above is the one known functional gap.
- No live arXiv API call was made during this build; behaviour is
  verified only against fixture Atom documents.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
- Clean lockfile regeneration outstanding (above).

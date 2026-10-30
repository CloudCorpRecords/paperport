# paperport

paperport is a small desk for arXiv work. It searches the public arXiv
API, pulls back titles, authors, dates, categories and abstracts in a
tidy shape, fetches the abstract for a single paper when you have its
id, and keeps a local shelf of papers you have downloaded so you can
list and re-read them later without going back to the network.

## Install

```bash
npx @reneturcios/paperport search "small language models"
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/paperport
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

Commands print JSON, except `read`, which prints the stored paper.

```bash
# Search, with optional filters
paperport search "attention patterns" --max-results 5 \
  --date-from 2024-01-01 --date-to 2024-12-31 --categories cs.CL,cs.LG

# One paper's abstract
paperport abstract 2401.12345

# Store a paper locally, then list and read the shelf
paperport download 2401.12345
paperport list
paperport read 2401.12345

paperport --version
```

Downloaded papers are stored as `<paper_id>.md` files in the storage
directory: the `PAPERPORT_STORAGE_DIR` environment variable when set,
otherwise `./papers`.

Exit codes: `0` on success, `1` when a paper cannot be found, fetched
or read, `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/paperport mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "paperport": {
      "command": "npx",
      "args": ["-y", "@reneturcios/paperport", "mcp"]
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `search_papers` | `query` (string, required), `max_results` (integer, optional), `date_from` / `date_to` (strings, optional, `YYYY-MM-DD`), `categories` (array of strings, optional) | A list of papers: `id`, `title`, `summary`, `authors`, `published`, `categories`, and `pdf_url`. |
| `get_abstract` | `paper_id` (string, required) | The paper's `paper_id`, `title`, `abstract`, `authors`, `published`, and `pdf_url`. |
| `download_paper` | `paper_id` (string, required) | Stores the paper locally (see the gap note below) and returns its `paper_id`, `title`, storage `path`, and `pdf_url`. |
| `list_papers` | _(no input)_ | The papers on the local shelf: each stored file's `paper_id` and `path`. |
| `read_paper` | `paper_id` (string, required) | The stored paper's `paper_id` and full text `content`. Errors when the paper has not been downloaded. |

Paper ids may be given bare (`2401.12345`), with a version suffix
(`2401.12345v2`), or as a full `arxiv.org/abs/...` URL; they are
normalised before use.

### Known gap: downloaded papers are abstract files, not converted PDFs

The original tool this rebuilds converts each downloaded paper's PDF
to markdown. paperport does **not** do that conversion: `download_paper`
stores the paper's metadata and abstract — title, authors, categories,
dates, and links to the abstract page and the PDF — as a markdown file,
and `read_paper` returns that file. The full text of the paper is only
available through the linked PDF. This is a deliberate, documented
limitation of this version, not a silent one.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.

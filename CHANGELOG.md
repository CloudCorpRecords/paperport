# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `paperport search <query>`, `paperport abstract <paper_id>`,
  `paperport download <paper_id>`, `paperport list`, and
  `paperport read <paper_id>` print paper data as JSON (or the stored
  text for `read`).
- MCP server (`paperport mcp`, stdio) with five tools: `search_papers`,
  `get_abstract`, `download_paper`, `list_papers`, and `read_paper`.
- Search talks to the public arXiv API at export.arxiv.org and parses
  its Atom responses with a small built-in XML reader. Downloaded
  papers are stored locally as markdown metadata/abstract files; see
  the README for the honest gap versus full PDF conversion.

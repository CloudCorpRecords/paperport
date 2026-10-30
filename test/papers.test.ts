import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildIdUrl,
  buildSearchUrl,
  downloadPaper,
  getAbstract,
  listPapers,
  normalizePaperId,
  paperFileName,
  parseArxivFeed,
  readPaper,
  searchPapers,
} from "../src/papers.js";
import type { FetchFn } from "../src/types.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<title>ArXiv Query</title>
<entry>
<id>http://arxiv.org/abs/2401.12345v2</id>
<title>Attention Patterns in
  Small Models</title>
<summary>We study attention patterns
in small models and report results.</summary>
<published>2024-01-20T10:00:00Z</published>
<author><name>Ada Example</name></author>
<author><name>Ben Sample</name></author>
<category term="cs.CL"/><category term="cs.LG"/>
<link title="pdf" href="https://arxiv.org/pdf/2401.12345v2"/>
</entry>
<entry>
<id>http://arxiv.org/abs/2402.00001v1</id>
<title>Second Paper</title>
<summary>A second abstract.</summary>
<published>2024-02-01T09:30:00Z</published>
<author><name>Cid Demo</name></author>
<category term="cs.AI"/>
</entry>
</feed>`;

function fakeFetch(body: string, capture?: { url: string }): FetchFn {
  return async (url) => {
    if (capture) capture.url = url;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/atom+xml" },
      text: async () => body,
    };
  };
}

const failingFetch: FetchFn = async () => ({
  ok: false,
  status: 503,
  statusText: "Service Unavailable",
  headers: { get: () => null },
  text: async () => "",
});

describe("normalizePaperId / paperFileName", () => {
  it("strips prefixes, URLs and version suffixes", () => {
    assert.equal(normalizePaperId("2401.12345"), "2401.12345");
    assert.equal(normalizePaperId("2401.12345v3"), "2401.12345");
    assert.equal(normalizePaperId("arXiv:2401.12345v1"), "2401.12345");
    assert.equal(normalizePaperId("https://arxiv.org/abs/2401.12345v2"), "2401.12345");
    assert.throws(() => normalizePaperId(""), /paper_id is required/);
  });

  it("sanitises old-style ids for filenames", () => {
    assert.equal(paperFileName("hep-th/9901001"), "hep-th_9901001.md");
    assert.equal(paperFileName("2401.12345v2"), "2401.12345.md");
  });
});

describe("buildSearchUrl / buildIdUrl", () => {
  it("builds a plain query with the default page size", () => {
    const url = buildSearchUrl({ query: "transformers" });
    assert.match(url, /^https:\/\/export\.arxiv\.org\/api\/query\?search_query=/);
    assert.match(url, /max_results=10$/);
    assert.equal(decodeURIComponent(url.split("search_query=")[1].split("&")[0]), "all:transformers");
  });

  it("quotes phrases and adds category and date filters", () => {
    const url = buildSearchUrl({
      query: "small models",
      max_results: 5,
      date_from: "2024-01-01",
      date_to: "2024-12-31",
      categories: ["cs.CL", "cs.LG"],
    });
    const sq = decodeURIComponent(url.split("search_query=")[1].split("&")[0]);
    assert.equal(
      sq,
      'all:"small models" AND cat:cs.CL AND cat:cs.LG AND submittedDate:[202401010000 TO 202412312359]',
    );
    assert.match(url, /max_results=5$/);
  });

  it("rejects bad dates and empty queries", () => {
    assert.throws(() => buildSearchUrl({ query: "x", date_from: "Jan 2024" }), /Invalid date/);
    assert.throws(() => buildSearchUrl({ query: " " }), /query is required/);
  });

  it("builds an id_list URL", () => {
    assert.equal(
      buildIdUrl("2401.12345v2"),
      "https://export.arxiv.org/api/query?id_list=2401.12345",
    );
  });
});

describe("parseArxivFeed", () => {
  it("parses entries with authors, categories and pdf links", () => {
    const entries = parseArxivFeed(FEED);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
      id: "2401.12345",
      title: "Attention Patterns in Small Models",
      summary: "We study attention patterns in small models and report results.",
      authors: ["Ada Example", "Ben Sample"],
      published: "2024-01-20T10:00:00Z",
      categories: ["cs.CL", "cs.LG"],
      pdf_url: "https://arxiv.org/pdf/2401.12345v2",
    });
    // No explicit pdf link in the second entry: one is constructed.
    assert.equal(entries[1].pdf_url, "https://arxiv.org/pdf/2402.00001");
  });

  it("returns an empty list for a feed with no entries", () => {
    assert.deepEqual(parseArxivFeed("<feed></feed>"), []);
  });
});

describe("searchPapers / getAbstract with fake fetch", () => {
  it("searches through the injected fetch and parses results", async () => {
    const capture = { url: "" };
    const results = await searchPapers(fakeFetch(FEED, capture), { query: "attention" });
    assert.equal(results.length, 2);
    assert.match(capture.url, /export\.arxiv\.org/);
  });

  it("returns the abstract shape for one paper", async () => {
    const abs = await getAbstract(fakeFetch(FEED), "2401.12345");
    assert.equal(abs.paper_id, "2401.12345");
    assert.equal(abs.title, "Attention Patterns in Small Models");
    assert.match(abs.abstract, /attention patterns/);
    assert.deepEqual(abs.authors, ["Ada Example", "Ben Sample"]);
  });

  it("throws on HTTP errors and unknown ids", async () => {
    await assert.rejects(() => searchPapers(failingFetch, { query: "x" }), /HTTP 503/);
    await assert.rejects(() => getAbstract(fakeFetch("<feed></feed>"), "2401.99999"), /Paper not found/);
  });
});

describe("storage: download / list / read in a temp dir", () => {
  it("stores a markdown file, lists it, and reads it back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paperport-test-"));
    try {
      const saved = await downloadPaper(fakeFetch(FEED), "2401.12345", dir);
      assert.equal(saved.paper_id, "2401.12345");
      assert.equal(saved.path, path.join(dir, "2401.12345.md"));

      const listed = await listPapers(dir);
      assert.deepEqual(listed, [{ paper_id: "2401.12345", path: saved.path }]);

      const read = await readPaper("2401.12345v9", dir);
      assert.equal(read.paper_id, "2401.12345");
      assert.match(read.content, /# Attention Patterns in Small Models/);
      assert.match(read.content, /## Abstract/);
      assert.match(read.content, /Ada Example, Ben Sample/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists an empty array for a missing directory and errors on unread papers", async () => {
    const missing = path.join(tmpdir(), "paperport-no-such-dir-xyz");
    assert.deepEqual(await listPapers(missing), []);
    await assert.rejects(() => readPaper("2401.00000", missing), /not stored locally/);
  });
});

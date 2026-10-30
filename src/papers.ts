/**
 * paperport core: search arXiv, fetch abstracts, and keep a local
 * library of stored papers.
 *
 * The arXiv API (export.arxiv.org) answers with Atom documents; they
 * are parsed with a small deterministic XML reader built on string and
 * regex processing only. All network access goes through an injected
 * FetchFn and all storage goes through an injectable directory, so
 * tests run entirely on fixture strings and a temporary folder.
 *
 * Honest scope note: download_paper stores the paper's metadata and
 * abstract as a markdown file. It does not download or convert the PDF
 * itself — see the README's gap note.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AbstractResult,
  DownloadResult,
  FetchFn,
  PaperEntry,
  ReadPaperResult,
  SearchPapersOptions,
  StoredPaper,
} from "./types.js";

export const VERSION = "0.1.0";

export const ARXIV_API = "https://export.arxiv.org/api/query";
export const DEFAULT_MAX_RESULTS = 10;

// ---------------------------------------------------------------------------
// identifiers

/** Normalise a user-supplied id / abs URL to the bare arXiv id, version removed. */
export function normalizePaperId(input: string): string {
  let id = typeof input === "string" ? input.trim() : "";
  id = id.replace(/^arxiv:/i, "");
  const absAt = id.indexOf("/abs/");
  if (absAt >= 0) id = id.slice(absAt + "/abs/".length);
  id = id.replace(/v\d+$/i, "");
  if (!id) throw new Error("paper_id is required");
  return id;
}

export function paperFileName(paperId: string): string {
  return `${normalizePaperId(paperId).replace(/\//g, "_")}.md`;
}

export function resolveStorageDir(explicit?: string): string {
  return explicit ?? process.env.PAPERPORT_STORAGE_DIR ?? "./papers";
}

// ---------------------------------------------------------------------------
// tiny Atom reader

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function cleanText(fragment: string): string {
  return decodeXmlEntities(fragment.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function elementText(fragment: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i");
  const m = re.exec(fragment);
  if (!m) return undefined;
  const text = cleanText(m[1]);
  return text === "" ? undefined : text;
}

function elementBlocks(fragment: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  return [...fragment.matchAll(re)].map((m) => m[1]);
}

function attrValue(tagText: string, name: string): string | undefined {
  const dq = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tagText);
  if (dq) return decodeXmlEntities(dq[1]);
  const sq = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tagText);
  return sq ? decodeXmlEntities(sq[1]) : undefined;
}

function pdfLink(entryBlock: string, id: string): string {
  const tags = [...entryBlock.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of tags) {
    if (attrValue(tag, "title") === "pdf") {
      const href = attrValue(tag, "href");
      if (href) return href;
    }
  }
  return `https://arxiv.org/pdf/${id}`;
}

function parseEntry(block: string): PaperEntry {
  const rawId = elementText(block, "id") ?? "";
  let id = rawId;
  try {
    id = normalizePaperId(rawId);
  } catch {
    id = rawId;
  }
  const authors = elementBlocks(block, "author")
    .map((a) => elementText(a, "name"))
    .filter((n): n is string => Boolean(n));
  const categories = [...block.matchAll(/<category\b[^>]*>/gi)]
    .map((m) => attrValue(m[0], "term"))
    .filter((c): c is string => Boolean(c));
  return {
    id,
    title: elementText(block, "title") ?? "",
    summary: elementText(block, "summary") ?? "",
    authors,
    published: elementText(block, "published") ?? "",
    categories,
    pdf_url: pdfLink(block, id),
  };
}

/** Parse an arXiv Atom response into paper entries. */
export function parseArxivFeed(xml: string): PaperEntry[] {
  return elementBlocks(xml ?? "", "entry").map(parseEntry);
}

// ---------------------------------------------------------------------------
// API access

function dateStamp(date: string, endOfDay: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new Error(`Invalid date: '${date}' (expected YYYY-MM-DD)`);
  return `${m[1]}${m[2]}${m[3]}${endOfDay ? "2359" : "0000"}`;
}

export function buildSearchUrl(options: SearchPapersOptions): string {
  const query = typeof options.query === "string" ? options.query.trim() : "";
  if (!query) throw new Error("query is required");
  const parts: string[] = [`all:${/\s/.test(query) ? `"${query}"` : query}`];
  for (const cat of options.categories ?? []) {
    if (cat.trim()) parts.push(`cat:${cat.trim()}`);
  }
  if (options.date_from || options.date_to) {
    const from = options.date_from ? dateStamp(options.date_from, false) : "190001010000";
    const to = options.date_to ? dateStamp(options.date_to, true) : "209912312359";
    parts.push(`submittedDate:[${from} TO ${to}]`);
  }
  const max = options.max_results ?? DEFAULT_MAX_RESULTS;
  return (
    `${ARXIV_API}?search_query=${encodeURIComponent(parts.join(" AND "))}` +
    `&start=0&max_results=${Math.max(1, Math.floor(max))}`
  );
}

export function buildIdUrl(paperId: string): string {
  return `${ARXIV_API}?id_list=${encodeURIComponent(normalizePaperId(paperId))}`;
}

async function fetchEntries(fetchFn: FetchFn, url: string): Promise<PaperEntry[]> {
  let response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/atom+xml, application/xml, text/xml, */*" },
      redirect: "follow",
    });
  } catch (err) {
    throw new Error(
      `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  }
  return parseArxivFeed(await response.text());
}

export async function searchPapers(
  fetchFn: FetchFn,
  options: SearchPapersOptions,
): Promise<PaperEntry[]> {
  return fetchEntries(fetchFn, buildSearchUrl(options));
}

async function fetchEntry(fetchFn: FetchFn, paperId: string): Promise<PaperEntry> {
  const id = normalizePaperId(paperId);
  const entries = await fetchEntries(fetchFn, buildIdUrl(id));
  const entry = entries[0];
  if (!entry) throw new Error(`Paper not found: ${id}`);
  return entry;
}

export async function getAbstract(fetchFn: FetchFn, paperId: string): Promise<AbstractResult> {
  const entry = await fetchEntry(fetchFn, paperId);
  return {
    paper_id: entry.id,
    title: entry.title,
    abstract: entry.summary,
    authors: entry.authors,
    published: entry.published,
    pdf_url: entry.pdf_url,
  };
}

// ---------------------------------------------------------------------------
// local storage

export function renderPaperMarkdown(entry: PaperEntry): string {
  return [
    `# ${entry.title}`,
    "",
    `- arXiv ID: ${entry.id}`,
    `- Published: ${entry.published}`,
    `- Authors: ${entry.authors.join(", ")}`,
    `- Categories: ${entry.categories.join(", ")}`,
    `- Abstract page: https://arxiv.org/abs/${entry.id}`,
    `- PDF: ${entry.pdf_url}`,
    "",
    "## Abstract",
    "",
    entry.summary,
    "",
  ].join("\n");
}

export async function downloadPaper(
  fetchFn: FetchFn,
  paperId: string,
  storageDir?: string,
): Promise<DownloadResult> {
  const entry = await fetchEntry(fetchFn, paperId);
  const dir = resolveStorageDir(storageDir);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, paperFileName(entry.id));
  await writeFile(filePath, renderPaperMarkdown(entry), "utf-8");
  return { paper_id: entry.id, title: entry.title, path: filePath, pdf_url: entry.pdf_url };
}

export async function listPapers(storageDir?: string): Promise<StoredPaper[]> {
  const dir = resolveStorageDir(storageDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => ({ paper_id: n.slice(0, -".md".length), path: path.join(dir, n) }));
}

export async function readPaper(
  paperId: string,
  storageDir?: string,
): Promise<ReadPaperResult> {
  const dir = resolveStorageDir(storageDir);
  const filePath = path.join(dir, paperFileName(paperId));
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(
      `Paper not stored locally: ${normalizePaperId(paperId)} (download it first)`,
    );
  }
  return { paper_id: normalizePaperId(paperId), content };
}

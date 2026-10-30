/**
 * paperport types.
 *
 * A paper entry is the flat shape parsed out of one arXiv Atom entry:
 * the bare arXiv id, bibliographic fields, and the canonical PDF URL.
 * Stored papers are the on-disk markdown files written by
 * download_paper and read back by list_papers / read_paper.
 */

export interface PaperEntry {
  /** Bare arXiv identifier, e.g. "2401.12345" (version suffix removed). */
  id: string;
  title: string;
  summary: string;
  authors: string[];
  /** ISO timestamp from the entry's <published> element. */
  published: string;
  categories: string[];
  pdf_url: string;
}

export interface SearchPapersOptions {
  query: string;
  max_results?: number;
  /** Earliest submission date, YYYY-MM-DD. */
  date_from?: string;
  /** Latest submission date, YYYY-MM-DD. */
  date_to?: string;
  categories?: string[];
}

export interface AbstractResult {
  paper_id: string;
  title: string;
  abstract: string;
  authors: string[];
  published: string;
  pdf_url: string;
}

export interface DownloadResult {
  paper_id: string;
  title: string;
  /** Absolute or relative path of the stored markdown file. */
  path: string;
  pdf_url: string;
}

export interface StoredPaper {
  paper_id: string;
  path: string;
}

export interface ReadPaperResult {
  paper_id: string;
  content: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: string },
) => Promise<HttpResponse>;

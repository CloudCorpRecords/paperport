#!/usr/bin/env node
/**
 * paperport CLI.
 *
 *   paperport search <query> [--max-results n] [--date-from d] [--date-to d] [--categories a,b]
 *   paperport abstract <paper_id>
 *   paperport download <paper_id>
 *   paperport list
 *   paperport read <paper_id>
 *   paperport mcp
 *
 * Output is JSON, except `read`, which prints the stored paper text.
 * Downloaded papers are stored under PAPERPORT_STORAGE_DIR or ./papers.
 * Exit codes: 0 success, 1 lookup/storage error, 2 usage error.
 */
import {
  downloadPaper,
  getAbstract,
  listPapers,
  readPaper,
  searchPapers,
  VERSION,
} from "./papers.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  paperport search <query> [--max-results n] [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD] [--categories a,b]
  paperport abstract <paper_id>
  paperport download <paper_id>
  paperport list
  paperport read <paper_id>
  paperport mcp
  paperport --version`);
  process.exit(2);
}

const VALUE_FLAGS = new Set(["--max-results", "--date-from", "--date-to", "--categories"]);

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++;
    else out.push(args[i]);
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const [first] = positional(rest);
  try {
    if (cmd === "search") {
      if (!first) usage();
      const maxRaw = flagValue(rest, "--max-results");
      const cats = flagValue(rest, "--categories");
      const result = await searchPapers(fetchFn, {
        query: positional(rest).join(" "),
        max_results: maxRaw ? Number.parseInt(maxRaw, 10) : undefined,
        date_from: flagValue(rest, "--date-from"),
        date_to: flagValue(rest, "--date-to"),
        categories: cats ? cats.split(",").map((c) => c.trim()).filter(Boolean) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === "abstract") {
      if (!first) usage();
      console.log(JSON.stringify(await getAbstract(fetchFn, first), null, 2));
    } else if (cmd === "download") {
      if (!first) usage();
      console.log(JSON.stringify(await downloadPaper(fetchFn, first), null, 2));
    } else if (cmd === "list") {
      console.log(JSON.stringify(await listPapers(), null, 2));
    } else if (cmd === "read") {
      if (!first) usage();
      console.log((await readPaper(first)).content);
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();

/**
 * paperport MCP server. Tools: search_papers, get_abstract,
 * download_paper, list_papers, read_paper.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects two keys that are not
 * in this tool's public spec ("$schema" and "additionalProperties"),
 * which breaks exact tool-list/schema parity with the spec. This file
 * therefore serves tools/list with the spec's exact input schemas,
 * while zod still validates every tools/call argument set.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  downloadPaper,
  getAbstract,
  listPapers,
  readPaper,
  searchPapers,
  VERSION,
} from "./papers.js";
import type { FetchFn } from "./types.js";

const SearchArgs = z.object({
  query: z.string().describe("Search query"),
  max_results: z.number().int().optional().describe("Maximum number of results to return"),
  date_from: z.string().optional().describe("Earliest submission date (YYYY-MM-DD)"),
  date_to: z.string().optional().describe("Latest submission date (YYYY-MM-DD)"),
  categories: z
    .array(z.string())
    .optional()
    .describe("arXiv categories to filter by"),
});

const PaperIdArgs = z.object({
  paper_id: z.string().describe("arXiv paper ID"),
});

const NoArgs = z.object({});

const TOOLS = [
  {
    name: "search_papers",
    description: "Search arXiv papers by query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "integer", description: "Maximum number of results to return" },
        date_from: { type: "string", description: "Earliest submission date (YYYY-MM-DD)" },
        date_to: { type: "string", description: "Latest submission date (YYYY-MM-DD)" },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "arXiv categories to filter by",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_abstract",
    description: "Get the abstract for an arXiv paper.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paper_id: { type: "string", description: "arXiv paper ID" },
      },
      required: ["paper_id"],
    },
  },
  {
    name: "download_paper",
    description: "Download an arXiv paper and store it locally.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paper_id: { type: "string", description: "arXiv paper ID" },
      },
      required: ["paper_id"],
    },
  },
  {
    name: "list_papers",
    description: "List papers stored locally.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "read_paper",
    description: "Read a locally stored arXiv paper.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paper_id: { type: "string", description: "arXiv paper ID" },
      },
      required: ["paper_id"],
    },
  },
];

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "paperport", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  try {
    if (name === "search_papers") {
      const parsed = SearchArgs.parse(args ?? {});
      return textResult(await searchPapers(fetchFn, parsed));
    }
    if (name === "get_abstract") {
      const parsed = PaperIdArgs.parse(args ?? {});
      return textResult(await getAbstract(fetchFn, parsed.paper_id));
    }
    if (name === "download_paper") {
      const parsed = PaperIdArgs.parse(args ?? {});
      return textResult(await downloadPaper(fetchFn, parsed.paper_id));
    }
    if (name === "list_papers") {
      NoArgs.parse(args ?? {});
      return textResult(await listPapers());
    }
    if (name === "read_paper") {
      const parsed = PaperIdArgs.parse(args ?? {});
      return textResult(await readPaper(parsed.paper_id));
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();

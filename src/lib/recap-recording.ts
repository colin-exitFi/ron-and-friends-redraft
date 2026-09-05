import "server-only";

/**
 * A generation kept on disk so its research never has to be paid for twice.
 *
 * THE PROBLEM THIS EXISTS FOR. A recap generation does two jobs in one request:
 * it researches (server-side web search, six to eight queries, fifty-odd pages)
 * and then it writes. The search is a LOOP INSIDE the request — every result
 * re-enters the conversation and the whole prefix is re-billed on the next turn
 * — so a 24k-token prompt lands as 305,000–427,000 billed input tokens. Tuning
 * the *voice* means changing the system prompt and reading what comes back,
 * which has nothing to do with the research; but the research got re-run, and
 * re-billed, every single time. Thirteen iterations in one evening, identical
 * searches on all thirteen, about eighteen dollars.
 *
 * So: record the research once, replay it forever. What Anthropic returns for a
 * search is a `server_tool_use` block holding the query and a
 * `web_search_tool_result` block holding one `encrypted_content` blob per page.
 * Those blocks can be handed straight back to the API in a later request, which
 * is what makes this cheap rather than approximate — the replayed model reads
 * the same page text the live model read, not a summary of it.
 *
 * VERIFIED AGAINST THE LIVE API RATHER THAN ASSUMED, because the whole design
 * rests on it:
 *
 *   · Recorded `server_tool_use` + `web_search_tool_result` blocks are accepted
 *     in an assistant turn WITH NO `tools` ARRAY AT ALL. That is the strong
 *     form of "the search tool is disabled" — not a tool asked politely not to
 *     fire, an absent tool. `usage.server_tool_use` comes back empty and the
 *     search fee is not charged.
 *   · The page text inside `encrypted_content` genuinely reaches the model. A
 *     replayed run answers from the pages, not from training data.
 *   · Structured output (`output_config.format`) works over a replayed turn.
 *     Citation SPANS do not come back, which is why `citations` is recorded
 *     alongside the research and re-attached on replay rather than harvested
 *     from the reply.
 *
 * WHAT A RECORDING IS NOT. It is not `scripts/recap-fixture-board.mts` — that
 * is a hand-written recap for the browser check and costs nothing. This is the
 * receipt for a real generation that real money was spent on.
 *
 * PURE AND I/O-FREE, so that `/api/recap` — which imports this by way of
 * `@/lib/recap-llm`, and only ever wanted `extractResearch` and
 * `researchTurns` — does not inherit a traced filesystem read. Reading and
 * writing a recording lives in `@/lib/recap-recording-store`, which explains
 * what the build said when the two were one file.
 */

import type { RecapBlurb, RecapSource } from "@/lib/recap-types";

export const RECORDING_VERSION = 1;

/**
 * The research half of a generation, verbatim.
 *
 * `blocks` are the raw Anthropic content blocks in the order the model produced
 * them, kept unparsed on purpose: the pairing between a `server_tool_use` and
 * the `web_search_tool_result` that answers it is by `tool_use_id`, and the
 * cheapest way not to break it is not to take it apart. `queries` and `pages`
 * are derived on the way in so a recording can be read by a human without
 * decoding anything.
 */
export type RecapResearch = {
  blocks: unknown[];
  queries: string[];
  pages: RecapSource[];
};

export type RecapRecording = {
  version: typeof RECORDING_VERSION;
  recordedAt: string;
  provider: string;
  model: string;
  /** Which variant of the system prompt paid for this. Free-text label. */
  variant: string;
  /**
   * Enough of the board to notice that a recording no longer matches the
   * dossier it is about to be replayed against. Not a hash of the whole prompt:
   * the system prompt is the thing being *varied*, so it must be free to differ.
   */
  board: {
    picksEntered: number;
    keepersOutOfPool: number;
    teamIds: string[];
    /** Of `recapUserMessage`, which is the board as the model actually saw it. */
    userMessageDigest: string;
  };
  research: RecapResearch;
  /** The output that was paid for, so it can be re-read without paying again. */
  blurbs: RecapBlurb[];
  citations: RecapSource[];
  /** What the live run actually cost, for the replay to measure itself against. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    webSearches: number;
    costUsd: number;
  };
};

type Block = { type?: string; name?: string; input?: unknown; content?: unknown };

/** Pulls the research out of a live reply. Empty `blocks` means it never searched. */
export function extractResearch(content: unknown[]): RecapResearch {
  const blocks: unknown[] = [];
  const queries: string[] = [];
  const pages = new Map<string, RecapSource>();

  for (const raw of content) {
    const block = raw as Block;
    if (block?.type === "server_tool_use" && block.name === "web_search") {
      blocks.push(raw);
      const query = (block.input as { query?: unknown } | undefined)?.query;
      if (typeof query === "string") queries.push(query);
      continue;
    }
    if (block?.type === "web_search_tool_result") {
      blocks.push(raw);
      if (Array.isArray(block.content)) {
        for (const result of block.content as Record<string, unknown>[]) {
          const url = result?.url;
          if (typeof url !== "string" || !url || pages.has(url)) continue;
          const title = result?.title;
          pages.set(url, { title: typeof title === "string" && title ? title : url, url });
        }
      }
    }
  }

  return { blocks, queries, pages: [...pages.values()] };
}

/**
 * The turns that stand in for the search loop.
 *
 * An assistant turn holding the recorded blocks, then one short user turn to
 * hand the floor back. The nudge is deliberately about the MECHANISM and says
 * nothing about tone: everything that shapes the voice lives in the system
 * prompt, which is the thing under test, and a bench that quietly editorialised
 * here would be measuring itself.
 *
 * `maxPagesPerSearch` trims each result set. Replaying ALL of them is the
 * default, and the temptation to keep only the pages the recorded blurbs cited
 * should be resisted: the first replay of the first recording cited four pages
 * the live run had read and not used, and dropped two the live run had. What a
 * variant reaches for is part of what is being tested, so it has to be handed
 * the same shelf, not the previous run's selections off it. The knob is for a
 * session that wants turnaround more than fidelity, and it is worth about a
 * third of the bill.
 */
export function researchTurns(
  research: RecapResearch,
  options: { maxPagesPerSearch?: number; cache?: boolean } = {},
): { role: "assistant" | "user"; content: unknown[] }[] {
  const cap = options.maxPagesPerSearch;
  const blocks = research.blocks.map((raw) => {
    const block = raw as Block;
    if (cap === undefined || block?.type !== "web_search_tool_result") return raw;
    if (!Array.isArray(block.content)) return raw;
    return { ...block, content: block.content.slice(0, cap) };
  });

  return [
    { role: "assistant", content: blocks },
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            "The turn above is a RECORDING of the web research from an earlier run of " +
            "this exact request, replayed so the writing can be redone without paying " +
            "for the searches a second time. It is your own research — use it exactly " +
            "as you would have. There is no search tool available on this turn, so " +
            "nothing further can be looked up; write from what is there. Where a page " +
            "does not support a claim, drop the claim rather than guessing at it.\n\n" +
            "Write the blurbs now.",
          /*
           * WHEN IT IS ASKED FOR, THE CACHE BREAKPOINT GOES HERE, on the last
           * block, because a breakpoint caches everything BEFORE it —
           * instructions, board and the whole recorded research in one prefix.
           * It sits on a plain text block rather than on the tool-result blocks,
           * that being the block type `cache_control` is documented for.
           *
           * Off unless the caller asks: it pays off only when the same prefix is
           * sent twice inside five minutes, and the prefix opens with the system
           * prompt, which is the thing voice tuning edits. See `generate` in
           * `@/lib/recap-llm` for the arithmetic.
           */
          ...(options.cache ? { cache_control: { type: "ephemeral" } } : {}),
        },
      ],
    },
  ];
}

/** Cheap, stable and only ever compared for equality. Not a security hash. */
export function digest(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

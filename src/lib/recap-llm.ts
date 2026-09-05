import "server-only";

/**
 * The one place a model is called.
 *
 * PROVIDER-AGNOSTIC BY SHAPE, ANTHROPIC BY IMPLEMENTATION. The commissioner
 * chose Claude Opus and that is the one that has to work, so it is the only
 * provider built out. Everything above this module — the route, the store, the
 * page — talks to `RecapModel`, which is four fields and one method, so adding
 * OpenAI later means writing one more factory function and one more branch in
 * `recapModel()`. Nothing else moves.
 *
 * NO SDK. Two HTTP calls' worth of surface area is not worth a dependency that
 * ships its own retry policy, its own types for a schema this file already
 * knows, and its own release cadence to keep up with. `fetch` is in the
 * runtime.
 *
 * TWO PHASES, ONE REQUEST, AND ONE OF THEM IS OPTIONAL. A generation researches
 * and then writes, and the researching is what costs — see the note on caching
 * inside `generate`. `RecapRequest.research` replays a previous run's searches
 * instead of making new ones, which is how the voice bench iterates on the
 * writing without re-buying the reading. Strictly opt-in: the route does not set
 * it and the live path is byte-for-byte what it was.
 *
 * THE PAGE MUST RENDER WITH NO KEY. `recapModel()` returns null rather than
 * throwing, because the build has to succeed and the tab has to draw its
 * numbers on a machine where nobody has set `ANTHROPIC_API_KEY`. Only the
 * generate route is allowed to care, and it says so in a sentence rather than a
 * stack trace.
 *
 * WHAT WAS VERIFIED AGAINST THE LIVE DOCUMENTATION RATHER THAN REMEMBERED,
 * because both of these have changed more than once and a guess here fails at
 * runtime with the room watching:
 *
 *   · `claude-opus-5` is the current Opus model id.
 *   · Server-side web search is a tool of type `web_search_20250305` named
 *     `web_search`, and citations are always on for it — every result carries
 *     `cited_text`, `title` and `url`, and those fields are not billed as
 *     tokens. Newer versions exist (`web_search_20260209`, `web_search_20260318`)
 *     and add DYNAMIC FILTERING, which routes the search through code execution
 *     to trim results before they reach the context. That is a token
 *     optimisation, and it puts a second server tool between the model and the
 *     citations this feature exists to be able to show. Not worth it for ten
 *     blurbs; `SEARCH_TOOL` is one line to change if it ever is.
 *   · Structured output is `output_config.format` with `type: "json_schema"`,
 *     generally available and needing no beta header. The older
 *     `output_format` field plus the `structured-outputs-2025-11-13` header
 *     still works and is not used.
 */

import { recapStage, recapSystemPrompt, recapUserMessage } from "@/lib/recap-prompt";
import { extractResearch, researchTurns, type RecapResearch } from "@/lib/recap-recording";
import { GRADE_SCALE, type AssignedGrade, type GradeInput } from "@/lib/recap-grade";
import type { RecapDossier } from "@/lib/recap-dossier";
import type { RecapBlurb, RecapSource } from "@/lib/recap-types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Current Claude Opus. Confirmed against the live model list, not recalled. */
const OPUS = "claude-opus-5";

/** See the header for why this version and not a newer one. */
const SEARCH_TOOL = "web_search_20250305";

/**
 * Ceiling on the whole response, THINKING INCLUDED — which is what makes it
 * this large for two thousand words of output. The first live run set it at
 * 16k, spent the lot on adaptive thinking about ten fantasy teams, and came
 * back truncated mid-JSON with nothing to save. Headroom is cheap here; only
 * tokens actually produced are billed.
 */
const MAX_TOKENS = 32_000;

/**
 * How hard the model thinks, in `output_config.effort`. Opus 5 defaults to
 * `high`, which on this task meant nearly five minutes and a blown token
 * ceiling: every comparison it could reason about has already been made in
 * `@/lib/recap-dossier`, so the deliberation was being spent re-deriving
 * arithmetic it was explicitly told not to touch. `medium` writes the same
 * jokes in a fraction of the time, and the latency is not academic — this runs
 * inside a request the commissioner is watching a spinner for.
 */
const EFFORT = "medium";

/**
 * Searches allowed per generation. Ten franchises, a couple of players each
 * worth looking up. Low enough that a model deciding to research the entire
 * NFL cannot run up a bill on a re-roll nobody was watching.
 */
const MAX_SEARCHES = 24;

/**
 * Claude Opus 5's published rates, so a generation can price itself and the
 * page can tell the room what a re-roll costs. A cache write is 1.25× base
 * input and a cache read is 0.1×.
 */
const PRICE = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  perThousandSearches: 10,
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
};

export type RecapUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Searches the model actually ran. Zero means the tool never fired. */
  webSearches: number;
  /** Priced from the published rates, so a re-roll's cost is knowable. */
  costUsd: number;
};

export type RecapGeneration = {
  provider: string;
  model: string;
  blurbs: RecapBlurb[];
  /**
   * The letters, exactly as the model assigned them and unedited.
   *
   * Empty when the request did not ask for grades. NOTHING HERE CHECKS THEM —
   * `validateGrades` is the check and it belongs to the caller, because it
   * needs the dossier and the grade payload side by side and because a model
   * call is the wrong place to decide what gets saved. See the route.
   */
  grades: AssignedGrade[];
  /**
   * Every page the model read, deduplicated across the whole run. Collected
   * from the search results themselves rather than from what the model says it
   * used, so it cannot be overstated.
   */
  citations: RecapSource[];
  usage: RecapUsage;
  /**
   * The searches and pages this run gathered, verbatim, so a later run can be
   * written from them instead of paying for them again. See
   * `@/lib/recap-recording` for what that buys and why the raw blocks are kept.
   *
   * RETURNED, NEVER WRITTEN HERE. The generate route runs on a filesystem that
   * answers `EROFS`, and a model call is the wrong place to own a side effect
   * anyway. `scripts/experiment-recap-voice.mts` is what saves these, because
   * the bench is where the same research was being re-bought.
   *
   * Empty `blocks` on a replay, which never searched and has nothing new to say.
   */
  research: RecapResearch;
};

export type RecapRequest = {
  dossier: RecapDossier;
  /**
   * Franchises to write for. The dossier always carries all ten so the model
   * can compare and cross-reference; this narrows what it must RETURN, which
   * is what makes a single-team re-roll cheap.
   */
  teamIds: string[];
  /**
   * Sampling temperature. Left undefined to take the model's own default.
   * Comedy wants some variance, and a re-roll that returns the same joke is
   * not a re-roll.
   */
  temperature?: number;
  /**
   * Overrides the system prompt. The seam
   * `scripts/experiment-recap-voice.mts` uses to run one board through several
   * candidate prompts and compare what comes back; the route never sets it, and
   * the prompt that wins gets written into `@/lib/recap-prompt`.
   */
  system?: string;
  /**
   * Research from an earlier run, to write from instead of searching.
   *
   * Set means REPLAY: the `web_search` tool is not offered at all and the
   * recorded searches are replayed into the conversation as a completed
   * assistant turn. Same model, same instructions, same board, one un-amplified
   * turn — which is the whole point, because the amplification was the bill.
   *
   * The route never sets it. A saved recap has to be researched against the
   * board as it stands, not against a board from an hour ago.
   */
  research?: RecapResearch;
  /**
   * On a replay, how many pages per recorded search to hand back. Undefined
   * means all of them, which is the material the recorded run wrote from. The
   * pages are most of a replay's billed input, so this is the one honest lever
   * on its cost.
   */
  researchPages?: number;
  /**
   * Whether a replay should leave a prompt cache behind for the next one.
   *
   * Ignored on the live path, which always caches because the search loop reads
   * the cache back inside the same request. On a replay there is no later turn
   * to read it, so writing at 1.25× only pays if the NEXT run sends the same
   * prefix — see the reasoning in `generate`.
   */
  cachePrefix?: boolean;
  /**
   * The grading evidence. Set means GRADE: the rubric is added to the system
   * prompt, the payload to the user turn, and three more fields to the schema.
   *
   * Undefined leaves the request byte-for-byte what it was before grades
   * existed, which is what a per-team re-roll wants. A curve is all or nothing
   * — see `GradeValidation` — so re-grading one franchise against nine letters
   * assigned in a different run is not a cheaper version of grading, it is a
   * different and wrong thing.
   */
  grades?: GradeInput | null;
};

export interface RecapModel {
  readonly provider: string;
  readonly model: string;
  /** Whether this provider is set up to search the web on the way. */
  readonly webSearch: boolean;
  generate(request: RecapRequest): Promise<RecapGeneration>;
}

/**
 * The configured model, or null when no key is set.
 *
 * Null is a first-class answer here rather than an error: the recap tab is
 * useful without a model — it still has every number the blurbs would be
 * arguing from — and a missing key must not be able to break a page or a build.
 */
export function recapModel(): RecapModel | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return anthropicModel(anthropicKey);

  /*
   * Where a second provider goes. `OPENAI_API_KEY` would build an
   * `openaiModel()` against the Responses API, whose equivalents are the
   * `{ type: "web_search" }` tool and `text.format` with a `json_schema`. It is
   * deliberately not written: the league runs on one provider and an untested
   * second path is a liability rather than a fallback.
   */
  return null;
}

/** Why there is no model, in a sentence a page can print. */
export function noModelReason(): string {
  return (
    "No ANTHROPIC_API_KEY is set, so the recap cannot be written. The numbers " +
    "below are the draft as it actually happened and do not need one."
  );
}

/**
 * The research clinging to a failed generation, if the searches got that far.
 *
 * A generation that throws was still billed for whatever it looked up. Handing
 * that back means a retry can be a replay rather than a second purchase of the
 * same fifty pages.
 */
export function researchFromError(err: unknown): RecapResearch | null {
  const research = (err as { research?: RecapResearch } | null)?.research;
  return research?.blocks?.length ? research : null;
}

// --- Anthropic ---------------------------------------------------------------

/**
 * The shape the model must return.
 *
 * An ARRAY keyed by `teamId` rather than an object keyed by team id, because a
 * JSON Schema cannot express "an object whose keys are these ten strings"
 * without naming all ten as properties, and `additionalProperties: false` is
 * mandatory under structured outputs. An array of tagged records says the same
 * thing, validates cleanly, and survives the model returning them out of order.
 */
function blurbSchema(grading: boolean) {
  /*
   * THE SCHEMA IS THE REAL GUARD ON A CITATION, not the rubric.
   *
   * `value` is `number` and not `string | number`, and that is the whole of it.
   * On a bench run against a historical board the model returned
   * `{"label": "Patrick Mahomes"}` with nothing numeric in the record at all —
   * it wanted to cite a THING rather than a figure — and the validator then
   * rejected the grade as uncheckable, correctly and far too late to be useful.
   * A grammar-constrained `number` cannot be a player's name, so the mistake
   * becomes unmakeable rather than merely caught. The rubric says the same
   * thing in words, which is belt and braces on the one field where an
   * unfindable figure drops all ten letters.
   */
  const gradeFields = {
    letter: {
      type: "string",
      enum: [...GRADE_SCALE],
      description: "The grade for this franchise. Exactly one step off the scale.",
    },
    gradeReason: {
      type: "string",
      description:
        "ONE sentence saying why this letter, resting on a figure. Not the blurb.",
    },
    gradeCitations: {
      /*
       * `minItems: 1` AND NOT `2`, WHICH IS THE API'S RULE RATHER THAN A
       * CHANGE OF MIND. Anthropic's structured outputs reject any `minItems`
       * other than 0 or 1 outright — the request comes back 400 before a token
       * is generated — so "two to four" cannot be a grammar constraint. It is
       * stated in the description and again in the rubric, and the floor that
       * MATTERS is still enforced by the grammar: a grade with no citation at
       * all cannot be returned, and `validateGrades` blocks one anyway.
       */
      type: "array",
      minItems: 1,
      description:
        "Two to four figures the letter rests on. Each number must appear in " +
        "this franchise's dossier entry or grade payload.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: {
            type: "string",
            description: "What the number is. A player's name goes here, never in `value`.",
          },
          value: {
            type: "number",
            description: "The figure itself. A number, always — never a name or a word.",
          },
        },
      },
    },
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["teams"],
    properties: {
      teams: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: grading
            ? ["teamId", "verdict", "blurb", "sources", "letter", "gradeReason", "gradeCitations"]
            : ["teamId", "verdict", "blurb", "sources"],
          properties: {
            ...(grading ? gradeFields : {}),
            teamId: {
              type: "string",
              description: "Exactly the teamId from the dossier. Not the name.",
            },
            verdict: {
              type: "string",
              description: "Two to five words. A card, not a sentence.",
            },
            blurb: {
              type: "string",
              description:
                "Three to five sentences of plain prose. No markdown, no lists.",
            },
            sources: {
              type: "array",
              description:
                "Only pages actually used for a claim in this blurb. Empty is fine.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "url"],
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}

type AnthropicBlock = {
  type: string;
  text?: string;
  name?: string;
  content?: unknown;
  citations?: { title?: string; url?: string }[] | null;
};

function anthropicModel(apiKey: string): RecapModel {
  return {
    provider: "anthropic",
    model: OPUS,
    webSearch: true,

    async generate({
      dossier,
      teamIds,
      temperature,
      system,
      research,
      researchPages,
      cachePrefix,
      grades,
    }: RecapRequest) {
      const grading = !!grades;
      /*
       * REPLAY IS THE SAME REQUEST WITH THE LOOP CUT OUT, and it is built from
       * the same two prompt functions so a bench run genuinely tests the prompt
       * production sends. The differences are exactly two: no `tools` array, so
       * the search tool is absent rather than merely discouraged, and the
       * recorded searches sit in the conversation as a finished assistant turn.
       * Model, effort, ceiling and schema are untouched — a voice bench that
       * quietly dropped to a cheaper model would be measuring the wrong writer.
       */
      const replaying = !!research?.blocks?.length;

      /*
       * BOTH BLOCKS ARE CACHED ON THE LIVE PATH, and it is not a
       * micro-optimisation.
       *
       * Server-side web search runs as a loop inside one request: every search
       * result comes back into the conversation and the whole prefix is
       * re-billed on the next turn. Eight searches over a 46k-token prompt is
       * how the first live run reached 373,000 input tokens and $2.20 for ten
       * blurbs. Marking the instructions and the board as cache breakpoints
       * makes every turn after the first read them at a tenth of the price,
       * which is the difference between a re-roll the room does freely and one
       * somebody thinks twice about.
       *
       * ON A REPLAY IT IS OFF BY DEFAULT, AND THAT IS THE SAME ARGUMENT RUN
       * BACKWARDS. A replay is one turn, so there is no later turn inside the
       * request to read the cache back — the only possible reader is the NEXT
       * invocation. A cache write costs 1.25× and a read saves 0.9×, so writing
       * pays only if the following run reuses the prefix; and the prefix starts
       * with the system prompt, which during voice tuning is precisely the thing
       * being edited. Every iteration would write 46k tokens at a 25% surcharge
       * for a cache nothing ever reads — measured at about six cents a run,
       * which is a dollar across the sort of evening this bench exists for.
       * `cachePrefix` is for the case where the prompt is genuinely held still,
       * a temperature sweep being the obvious one.
       */
      const cached = replaying ? !!cachePrefix : true;
      const breakpoint = cached ? { cache_control: { type: "ephemeral" } } : {};

      const body: Record<string, unknown> = {
        model: OPUS,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            /*
             * THE STAGE COMES OFF THE BOARD, not from a caller. This tab is
             * opened before the draft as well as after it, and the two need
             * different instructions — a pre-draft board has no picks in it, so
             * a post-draft brief has the model narrating empty arrays. See
             * `recapStage` and Part 0 in `@/lib/recap-prompt`.
             */
            text: system ?? recapSystemPrompt(recapStage(dossier), { grading }),
            ...breakpoint,
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: recapUserMessage(dossier, teamIds, grades ?? null),
                ...breakpoint,
              },
            ],
          },
          ...(replaying
            ? researchTurns(research!, { maxPagesPerSearch: researchPages, cache: cached })
            : []),
        ],
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: blurbSchema(grading) },
        },
      };
      if (!replaying) {
        body.tools = [{ type: SEARCH_TOOL, name: "web_search", max_uses: MAX_SEARCHES }];
      }
      if (temperature !== undefined) body.temperature = temperature;

      const response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        // The body carries the actual complaint — a wrong model id, a tool the
        // organisation has not enabled — and swallowing it costs an hour.
        throw new Error(
          `Claude refused the request (${response.status}): ${(await response.text()).slice(0, 600)}`,
        );
      }

      const payload = (await response.json()) as {
        content: AnthropicBlock[];
        stop_reason?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
          server_tool_use?: { web_search_requests?: number };
        };
      };

      /*
       * RESEARCH IS EXTRACTED BEFORE ANYTHING IS ALLOWED TO THROW, and carried
       * out on the error when something does.
       *
       * The two throws below — a blown output ceiling, a reply missing a
       * franchise — both happen AFTER Anthropic has run the searches and billed
       * for them. Losing the research at that point means the next attempt buys
       * the identical pages a second time, which is the exact failure this whole
       * recording mechanism exists to stop. The recovery is to hand the paid-for
       * half back and let the caller keep it.
       */
      const research0 = extractResearch(payload.content);
      const failed = (message: string) => {
        const error = new Error(message) as Error & { research?: RecapResearch };
        error.research = research0;
        return error;
      };

      if (payload.stop_reason === "max_tokens") {
        throw failed(
          "Claude ran out of output tokens before finishing the recap, so the " +
            "JSON is truncated. Nothing was saved. Try again, or reduce the " +
            "number of franchises in one request.",
        );
      }

      let blurbs: RecapBlurb[];
      let assigned: AssignedGrade[];
      try {
        ({ blurbs, grades: assigned } = parseBlurbs(payload.content, teamIds, grading));
      } catch (err) {
        throw failed(err instanceof Error ? err.message : String(err));
      }
      const searches =
        payload.usage?.server_tool_use?.web_search_requests ??
        payload.content.filter(
          (b) => b.type === "server_tool_use" && b.name === "web_search",
        ).length;

      const inputTokens = payload.usage?.input_tokens ?? 0;
      const outputTokens = payload.usage?.output_tokens ?? 0;
      const cacheWrites = payload.usage?.cache_creation_input_tokens ?? 0;
      const cacheReads = payload.usage?.cache_read_input_tokens ?? 0;

      /*
       * A REPLAY'S REPLY CARRIES NO TOOL RESULTS, so the pages it read have to
       * come from what was handed to it. Verified: structured output survives a
       * replayed turn but the citation SPANS do not come back, and a card that
       * lost its receipts because the research was cached would be the feature
       * getting caught out loud.
       */
      return {
        provider: "anthropic",
        model: OPUS,
        blurbs,
        grades: assigned,
        citations: replaying
          ? collectCitations([...(research!.blocks as AnthropicBlock[]), ...payload.content])
          : collectCitations(payload.content),
        research: research0,
        usage: {
          // Cached tokens are reported separately and are not in `input_tokens`,
          // so the total has to add them back or a cached run looks free.
          inputTokens: inputTokens + cacheWrites + cacheReads,
          outputTokens,
          webSearches: searches,
          costUsd:
            (inputTokens / 1e6) * PRICE.inputPerMTok +
            (cacheWrites / 1e6) * PRICE.inputPerMTok * PRICE.cacheWriteMultiplier +
            (cacheReads / 1e6) * PRICE.inputPerMTok * PRICE.cacheReadMultiplier +
            (outputTokens / 1e6) * PRICE.outputPerMTok +
            (searches / 1000) * PRICE.perThousandSearches,
        },
      };
    },
  };
}

/**
 * Pulls the blurbs out of the reply and refuses anything that is not one.
 *
 * A malformed model response must not reach the page, and it must not be
 * SAVED either — a stored recap missing four teams looks like a bug in the
 * board rather than a bad generation. So this throws, the route reports it, and
 * the previous recap stays where it is.
 *
 * The JSON is grammar-constrained by `output_config.format`, so the slice
 * fallback below should never fire. It is here because "should never" and
 * "does not" are different claims about somebody else's server.
 */
function parseBlurbs(
  content: AnthropicBlock[],
  teamIds: string[],
  grading: boolean,
): { blurbs: RecapBlurb[]; grades: AssignedGrade[] } {
  const text = content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("")
    .trim();

  if (!text) throw new Error("Claude returned no text at all.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`Claude's reply was not JSON: ${text.slice(0, 300)}`);
    }
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error(`Claude's reply was not JSON: ${text.slice(0, 300)}`);
    }
  }

  const teams = (parsed as { teams?: unknown })?.teams;
  if (!Array.isArray(teams)) {
    throw new Error("Claude's reply had no `teams` array.");
  }

  const wanted = new Set(teamIds);
  const blurbs: RecapBlurb[] = [];
  const grades: AssignedGrade[] = [];
  for (const raw of teams) {
    const entry = raw as Record<string, unknown>;
    const teamId = typeof entry.teamId === "string" ? entry.teamId : null;
    const blurb = typeof entry.blurb === "string" ? entry.blurb.trim() : "";
    if (!teamId || !wanted.has(teamId) || !blurb) continue;

    /*
     * A GRADE IS COLLECTED AS IT CAME BACK, NOT AS IT SHOULD HAVE. Nothing here
     * discards a letter, rounds a citation or invents a missing one — the whole
     * point of `validateGrades` is that a contradiction gets NAMED, and a
     * parser that quietly dropped the bad ones would hand it a set that had
     * already been tidied. A non-numeric value survives as `NaN` for exactly
     * that reason: the validator has a branch for "cites no usable number" and
     * it should be allowed to reach it.
     */
    if (grading && typeof entry.letter === "string" && entry.letter.trim()) {
      grades.push({
        teamId,
        letter: entry.letter.trim(),
        reason: typeof entry.gradeReason === "string" ? entry.gradeReason.trim() : "",
        citations: Array.isArray(entry.gradeCitations)
          ? entry.gradeCitations
              .map((c) => c as Record<string, unknown>)
              .filter((c) => !!c && typeof c.label === "string")
              .map((c) => ({
                label: String(c.label),
                value: typeof c.value === "number" ? c.value : Number.NaN,
              }))
          : [],
      });
    }

    blurbs.push({
      teamId,
      blurb,
      verdict: typeof entry.verdict === "string" ? entry.verdict.trim() : "",
      sources: Array.isArray(entry.sources)
        ? entry.sources
            .map((s) => s as Record<string, unknown>)
            .filter((s) => typeof s?.url === "string")
            .map((s) => ({
              title: typeof s.title === "string" ? s.title : String(s.url),
              url: String(s.url),
            }))
        : [],
    });
  }

  const missing = teamIds.filter((id) => !blurbs.some((b) => b.teamId === id));
  if (missing.length) {
    throw new Error(
      `Claude wrote nothing for ${missing.length} of ${teamIds.length} franchises ` +
        `(${missing.join(", ")}). Nothing was saved — run it again.`,
    );
  }

  return { blurbs, grades };
}

/**
 * Every page the search tool actually returned, deduplicated by URL.
 *
 * Taken from the tool results and from the citation spans attached to the
 * model's own text, not from the `sources` the model chose to report. The two
 * answer different questions — "what did it read" and "what does it claim it
 * read" — and only the first can be trusted to be complete.
 */
function collectCitations(content: AnthropicBlock[]): RecapSource[] {
  const byUrl = new Map<string, RecapSource>();

  const add = (url: unknown, title: unknown) => {
    if (typeof url !== "string" || !url) return;
    if (!byUrl.has(url)) {
      byUrl.set(url, { title: typeof title === "string" && title ? title : url, url });
    }
  };

  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content as Record<string, unknown>[]) {
        add(result?.url, result?.title);
      }
    }
    for (const citation of block.citations ?? []) {
      add(citation?.url, citation?.title);
    }
  }

  return [...byUrl.values()];
}

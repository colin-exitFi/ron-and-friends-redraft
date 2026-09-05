import "server-only";

/**
 * Where a recap recording lives on disk, and nothing else.
 *
 * SPLIT OUT OF `@/lib/recap-recording` BECAUSE OF WHAT IT COST THE DEPLOY. That
 * module is imported by `@/lib/recap-llm`, which is imported by
 * `/api/recap` — and it read a recording with `path.join(process.cwd(), file)`
 * for a `file` that only the local bench ever supplies. A traced path built from
 * the project root and a runtime value is indistinguishable, to the file tracer,
 * from "this function may read anything in the repository", so the build swept
 * the whole project into the recap route's bundle and said so:
 *
 *   Turbopack build encountered 1 warnings:
 *   Encountered unexpected file in NFT list
 *   A file was traced that indicates that the whole project was traced
 *   unintentionally.
 *
 * The route never wanted any of it. It uses `extractResearch` and
 * `researchTurns`, which are pure; the four functions here are used by
 * `scripts/experiment-recap-voice.mts` and by nothing that ships. Keeping them
 * in a module the route does not import is what makes the trace honest again,
 * and it is the same seam `@/lib/recap-grade` and `@/lib/recap-grade-source`
 * are cut along: the pure shape in one file, the thing that comes off disk in
 * the other.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { RECORDING_VERSION, type RecapRecording } from "@/lib/recap-recording";

/**
 * Gitignored, and next to the draft board's own backups for the same reason:
 * these are large, regenerable-in-principle, and a commit of one would be a
 * commit of somebody's API bill rather than of the league's records.
 */
const RECORDINGS_DIR = path.join(process.cwd(), "data", "recap-recordings");

export function writeRecording(recording: RecapRecording, name: string): string {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const target = path.join(RECORDINGS_DIR, `${name}.json`);
  // Temp-then-rename, so a crash mid-write cannot leave half a recording behind
  // and send somebody back to the API for research that is already paid for.
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  renameSync(tmp, target);
  return path.relative(process.cwd(), target);
}

export function readRecording(file: string): RecapRecording {
  const resolved = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const parsed: unknown = JSON.parse(readFileSync(resolved, "utf8"));
  const recording = parsed as RecapRecording;
  if (recording?.version !== RECORDING_VERSION) {
    throw new Error(`${file} is not a recap recording this build understands.`);
  }
  if (!recording.research?.blocks?.length) {
    throw new Error(
      `${file} has no recorded research in it — the run it came from never searched, ` +
        `so there is nothing to replay.`,
    );
  }
  return recording;
}

/** The newest recording on disk, which is what `--replay` with no path means. */
export function latestRecording(): string | null {
  if (!existsSync(RECORDINGS_DIR)) return null;
  const names = readdirSync(RECORDINGS_DIR)
    .filter((n) => n.endsWith(".json"))
    .sort();
  const newest = names.at(-1);
  return newest ? path.relative(process.cwd(), path.join(RECORDINGS_DIR, newest)) : null;
}

export function recordingsDir(): string {
  return path.relative(process.cwd(), RECORDINGS_DIR);
}

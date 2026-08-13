#!/usr/bin/env node
/**
 * Assert that the software descriptors on disk point at THIS working copy's
 * code, not at the published archive.
 *
 * Why this exists: the desktop loads a dev block straight from this folder, so
 * whatever `software/dist/tengo/software/*.sw.json` says at run time is what
 * the backend executes. A plain `pnpm check` / `pnpm build` rebuilds in
 * non-dev mode (turbo's `check` dependsOn `^build`) and rewrites every
 * descriptor to `binary.package: .../<version>.tgz` — the PUBLISHED archive.
 * Since changesets own the version, that archive still carries the old code
 * under the same version string, so the block silently runs stale software and
 * fails in ways that look like fresh bugs.
 *
 * Run this after any check/build and before telling anyone the block is ready:
 *   node scripts/check-dev-build.mjs            # local dev build expected
 *   node scripts/check-dev-build.mjs --remote   # dev-remote (docker) expected
 *
 * Exit 0 = descriptors are dev-wired. Exit 1 = rebuild before running the block.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "software/dist/tengo/software";
const wantRemote = process.argv.includes("--remote");

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".sw.json"));
} catch {
  console.error(`✗ ${DIR} not found — build the block first.`);
  process.exit(1);
}

const problems = [];
for (const file of files) {
  const d = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const entry = file.replace(/\.sw\.json$/, "");
  if (d.isDev !== true) {
    problems.push(`${entry}: not a dev build (points at ${d.binary?.package ?? "the registry"})`);
    continue;
  }
  if (wantRemote && !d.docker?.tag) {
    problems.push(`${entry}: dev build without a docker tag — a remote backend cannot pull it`);
  }
  if (!wantRemote && !d.local?.path && !d.docker?.tag) {
    problems.push(`${entry}: dev build with neither a local path nor a docker tag`);
  }
}

if (problems.length > 0) {
  console.error("✗ software descriptors are NOT wired to this working copy:\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error(
    `\n  Rebuild before running the block:\n` +
      `    pnpm run build:dev-remote     # remote / k8s backend\n` +
      `    pnpm run build:dev-local      # local backend\n`,
  );
  process.exit(1);
}

console.log(`✓ ${files.length} software descriptors wired to this working copy` +
  (wantRemote ? " (docker tags present)" : ""));

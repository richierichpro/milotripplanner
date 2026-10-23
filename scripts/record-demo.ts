// Records one full demo run into demo-data/ so Milo runs without API keys, then
// proves it: replays the demo with no keys and fails if anything wasn't recorded.
// Usage: npm run record-demo   (needs real keys in .env.local; searches already cached cost nothing)
import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const run = (env: Record<string, string>, label: string, withEnvFile: boolean) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync("npx", ["tsx", ...(withEnvFile ? ["--env-file=.env.local"] : []), "scripts/simulate.ts"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...env, MILO_DATA_DIR: ".data-record" },
    encoding: "utf8",
  });
  const out = r.stdout ?? "";
  const highlights = out.split("\n").filter((l) => /Decided|booking list|couldn't|isn't in the demo|No demo data|Listening needs|Error/.test(l));
  console.log(highlights.map((l) => `   ${l}`).join("\n"));
  return r.status === 0 && /booking list/.test(out) && !/No demo data|isn't in the demo recording|Listening needs/.test(out);
};

await rm("demo-data/serpapi", { recursive: true, force: true });
await rm("demo-data/claude", { recursive: true, force: true });
await rm(".data-record", { recursive: true, force: true });

// 1. With real keys (cached answers are reused): copy every response used into demo-data/.
if (!run({ RECORD_DEMO: "true", SERPAPI_OFFLINE: "false" }, "Recording the demo with real keys", true)) throw new Error("The recording run didn't reach the booking list.");

// 2. With no keys at all: the demo must replay entirely from demo-data/.
await rm(".data-record", { recursive: true, force: true });
if (!run({ DEMO_MODE: "true", SERPAPI_API_KEY: "", ANTHROPIC_API_KEY: "" }, "Replaying with DEMO_MODE=true and no keys", false))
  throw new Error("Demo replay failed: some search or Claude answer wasn't recorded.");

// 3. No secrets in the recordings.
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8"))
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split(/=(.*)/s).slice(0, 2) as [string, string]),
);
const secrets = [env.SERPAPI_API_KEY, env.ANTHROPIC_API_KEY, env.TELEGRAM_BOT_TOKEN].filter((v) => v && v.length > 8);
const files: string[] = [];
const walk = async (d: string) => {
  for (const f of await readdir(d, { withFileTypes: true })) {
    if (f.isDirectory()) await walk(path.join(d, f.name));
    else files.push(path.join(d, f.name));
  }
};
await walk("demo-data");
let leaks = 0;
for (const f of files) {
  const text = await readFile(f, "utf8");
  if (/api_key/i.test(text) || secrets.some((s) => text.includes(s))) {
    leaks++;
    console.log(`   ✗ secret-like text in ${f}`);
  }
}
if (leaks) throw new Error(`${leaks} recording(s) contain key material.`);

await writeFile("demo-data/meta.json", JSON.stringify({ recordedAt: new Date().toISOString(), today: "2026-10-11" }, null, 2));
await rm(".data-record", { recursive: true, force: true });
console.log(`\n✓ ${files.length} recordings in demo-data/, replay works with no keys, no secrets found.`);

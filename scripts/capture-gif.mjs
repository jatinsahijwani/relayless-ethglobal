// Records the 0-ETH payment from the running demo and writes docs/img/demo.gif, about 15 s and under 8 MB.
// It spends a note, so run `pnpm demo:reset` before the next take.
// usage: pnpm demo:reset && pnpm demo:gif
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.RELAYLESS_WEB_URL ?? "http://127.0.0.1:5199";
const OUT = "docs/img/demo.gif";
const MAX_BYTES = 8 * 1024 * 1024;
const TARGET_SECONDS = 15;
const dir = mkdtempSync(join(tmpdir(), "relayless-gif-"));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
await page.goto(`${BASE}/?demo=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Use the demo wallet" }).click();
await page.getByRole("heading", { name: "Pay anyone" }).waitFor({ timeout: 60_000 });
await page.getByTestId("balance-before").getByText("0", { exact: false }).waitFor();
await page.getByRole("button", { name: /^Pay 0\.05 ETH$/ }).waitFor();
await page.waitForFunction(() => !document.querySelector("button.w-full")?.hasAttribute("disabled"), null, { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^Pay 0\.05 ETH$/ }).click();
await page.getByText("Nobody funded this wallet").waitFor({ timeout: 180_000 });
await page.waitForTimeout(3000);
const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();

const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]).toString());
const speed = Math.max(1, duration / TARGET_SECONDS);
const filter = `setpts=PTS/${speed.toFixed(3)},fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
const tmp = join(dir, "demo.gif");
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-filter_complex", filter, tmp]);
const size = statSync(tmp).size;
if (size >= MAX_BYTES) throw new Error(`the GIF is ${(size / 1e6).toFixed(1)} MB, over the 8 MB limit`);
renameSync(tmp, OUT);
rmSync(dir, { recursive: true, force: true });
console.log(`${OUT}: ${(size / 1e6).toFixed(1)} MB, ${(duration / speed).toFixed(1)} s, from ${duration.toFixed(1)} s at ${speed.toFixed(2)}x`);

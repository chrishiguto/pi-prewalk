import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import piPrewalk from "../extensions/prewalk/index.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
}

test("loads the extension against the Nixpkgs Pi 0.84.2 boundary", async () => {
  const manifest = await readJson(resolve(packageRoot, "package.json"));
  const installedPi = await readJson(resolve(
    packageRoot,
    "node_modules/@earendil-works/pi-coding-agent/package.json",
  ));

  assert.equal(manifest.devDependencies["@earendil-works/pi-coding-agent"], "catalog:");
  assert.equal(manifest.devDependencies["@earendil-works/pi-ai"], "catalog:");
  assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "^0.84.2");
  assert.equal(installedPi.version, "0.84.2");
  assert.equal(typeof piPrewalk, "function");
});

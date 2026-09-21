import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("exposes exactly the Prewalk extension", async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));

  assert.deepEqual(manifest.pi, {
    extensions: ["./extensions/prewalk/index.ts"],
  });
  assert.deepEqual(manifest.files, ["extensions", "src", "README.md"]);
});

test("commits the standalone pnpm lockfile and no npm one", async () => {
  await access(resolve(packageRoot, "pnpm-lock.yaml"));
  await assert.rejects(access(resolve(packageRoot, "package-lock.json")));
});

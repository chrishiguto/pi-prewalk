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

test("does not establish standalone lockfiles or scratch state", async () => {
  for (const relativePath of ["package-lock.json", "pnpm-lock.yaml", ".scratch"]) {
    await assert.rejects(access(resolve(packageRoot, relativePath)));
  }
});

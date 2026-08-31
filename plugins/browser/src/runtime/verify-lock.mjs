import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = new URL("./", import.meta.url);
const lock = JSON.parse(
  await readFile(new URL("browser-use.lock.json", root), "utf8"),
);
for (const item of [lock.officialSkill, lock.boundedSkill, lock.license]) {
  const bytes = await readFile(new URL(item.path, root));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== item.sha256)
    throw new Error(`integrity mismatch: ${item.path}`);
}
console.log(`browser-use ${lock.browserUse.version} vendored provenance verified (installed wheel not verified)`);

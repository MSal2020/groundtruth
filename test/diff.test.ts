import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, fileDiffFromContents } from "../src/diff.js";

test("parses added and removed lines with new-file line numbers", () => {
  const diff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };
`;
  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 1);
  const f = files[0]!;
  assert.equal(f.path, "src/a.ts");
  assert.deepEqual(f.removed, ["const y = 2;"]);
  assert.equal(f.added.length, 2);
  assert.equal(f.added[0]!.text, "const y = 3;");
  assert.equal(f.added[0]!.line, 2);
  assert.equal(f.added[1]!.text, "const z = 4;");
  assert.equal(f.added[1]!.line, 3);
});

test("flags new files", () => {
  const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
`;
  const files = parseUnifiedDiff(diff);
  assert.equal(files[0]!.isNew, true);
  assert.equal(files[0]!.added.length, 2);
});

test("fileDiffFromContents marks all lines added and drops trailing newline", () => {
  const fd = fileDiffFromContents("x.ts", "a\nb\n");
  assert.equal(fd.isNew, true);
  assert.equal(fd.added.length, 2);
  assert.equal(fd.added[1]!.line, 2);
});

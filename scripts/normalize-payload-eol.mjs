import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const changed = execSync("git diff HEAD --name-only public/r", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const norm = (s) => s.replace(/\\r\\n/g, "\\n");
const hasCrlfEscapes = (s) => s.includes("\\r\\n");

for (const f of changed) {
  let head;
  try {
    head = execSync(`git show HEAD:${f}`, { encoding: "utf8" });
  } catch {
    console.log(`new-kept ${f}`);
    continue;
  }
  const work = readFileSync(f, "utf8");
  if (norm(head) === norm(work)) {
    execSync(`git checkout HEAD -- ${f}`, { stdio: "ignore" });
    console.log(`drift-discarded ${f}`);
  } else if (hasCrlfEscapes(head)) {
    console.log(`real-kept-crlf ${f}`);
  } else {
    writeFileSync(f, norm(work));
    console.log(`real-kept-lf ${f}`);
  }
}
console.log("done");

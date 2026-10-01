import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const toLf = (s) => s.replace(/\r\n/g, "\n");

/** Merges a rebuilt payload into the committed one per embedded file: EOL-only changes keep the committed content. */
export function normalizePayloadText(headText, workText) {
  const head = JSON.parse(headText);
  const work = JSON.parse(workText);
  const headByPath = new Map((head.files ?? []).map((file) => [file.path, file.content]));
  const payloadIsCrlf = [...headByPath.values()].some((content) => content.includes("\r\n"));
  let changed = false;
  work.files = (work.files ?? []).map((file) => {
    const committed = headByPath.get(file.path);
    if (committed !== undefined && toLf(committed) === toLf(file.content)) return { ...file, content: committed };
    changed = true;
    const keepsCrlf = committed === undefined ? payloadIsCrlf : committed.includes("\r\n");
    return { ...file, content: keepsCrlf ? file.content : toLf(file.content) };
  });
  const sameFiles = work.files.length === headByPath.size;
  if (!changed && sameFiles && toLf(JSON.stringify({ ...work, files: undefined })) === toLf(JSON.stringify({ ...head, files: undefined }))) {
    return { status: "drift-discarded", text: headText };
  }
  const eol = workText.includes("\r\n") ? "\r\n" : "\n";
  const text = JSON.stringify(work, null, 2).replace(/\n/g, eol) + (/\r?\n$/.test(workText) ? eol : "");
  return { status: "real-kept", text };
}

function main() {
  const changed = execSync("git diff HEAD --name-only public/r", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const f of changed) {
    let head;
    try {
      head = execSync(`git show HEAD:${f}`, { encoding: "utf8" });
    } catch {
      console.log(`new-kept ${f}`);
      continue;
    }
    const { status, text } = normalizePayloadText(head, readFileSync(f, "utf8"));
    if (status === "drift-discarded") execSync(`git checkout HEAD -- ${f}`, { stdio: "ignore" });
    else writeFileSync(f, text);
    console.log(`${status} ${f}`);
  }
  console.log("done");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

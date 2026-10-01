import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePayloadText } from "../scripts/normalize-payload-eol.mjs";

type PayloadFile = { path: string; content: string };

function payloadText(files: PayloadFile[]): string {
  return JSON.stringify({ name: "demo", files }, null, 2).replace(/\n/g, "\r\n") + "\r\n";
}

function contents(text: string): Record<string, string> {
  const payload = JSON.parse(text) as { files: PayloadFile[] };
  return Object.fromEntries(payload.files.map((file) => [file.path, file.content]));
}

describe("normalizePayloadText", () => {
  it("discards a payload that differs only in line endings", () => {
    const head = payloadText([{ path: "a.ts", content: "one\r\ntwo\r\n" }]);
    const work = payloadText([{ path: "a.ts", content: "one\ntwo\n" }]);
    expect(normalizePayloadText(head, work)).toEqual({ status: "drift-discarded", text: head });
  });

  it("keeps the committed content of a file that differs only in line endings when another file changed", () => {
    const head = payloadText([
      { path: "a.ts", content: "one\r\ntwo\r\n" },
      { path: "b.ts", content: "old\r\n" },
    ]);
    const work = payloadText([
      { path: "a.ts", content: "one\ntwo\n" },
      { path: "b.ts", content: "new\r\n" },
    ]);
    const { status, text } = normalizePayloadText(head, work);
    expect(status).toBe("real-kept");
    expect(contents(text)).toEqual({ "a.ts": "one\r\ntwo\r\n", "b.ts": "new\r\n" });
  });

  it("converts a changed file to LF when its committed content is LF", () => {
    const head = payloadText([{ path: "a.ts", content: "one\n" }]);
    const work = payloadText([{ path: "a.ts", content: "one\r\ntwo\r\n" }]);
    expect(contents(normalizePayloadText(head, work).text)).toEqual({ "a.ts": "one\ntwo\n" });
  });

  it("keeps the line endings of a changed file whose committed content is CRLF", () => {
    const head = payloadText([{ path: "a.ts", content: "one\r\n" }]);
    const work = payloadText([{ path: "a.ts", content: "one\r\ntwo\r\n" }]);
    expect(contents(normalizePayloadText(head, work).text)).toEqual({ "a.ts": "one\r\ntwo\r\n" });
  });

  it("keeps a new file as written and drops a removed one", () => {
    const head = payloadText([{ path: "a.ts", content: "a\r\n" }]);
    const work = payloadText([{ path: "b.ts", content: "b\r\n" }]);
    expect(contents(normalizePayloadText(head, work).text)).toEqual({ "b.ts": "b\r\n" });
  });

  it("keeps the payload's own line-ending style", () => {
    const head = payloadText([{ path: "a.ts", content: "a\r\n" }]);
    const work = payloadText([{ path: "a.ts", content: "b\r\n" }]);
    expect(normalizePayloadText(head, work).text).toBe(work);
  });

  it("keeps a payload whose files only changed order", () => {
    const head = payloadText([
      { path: "a.ts", content: "a\r\n" },
      { path: "b.ts", content: "b\r\n" },
    ]);
    const work = payloadText([
      { path: "b.ts", content: "b\r\n" },
      { path: "a.ts", content: "a\r\n" },
    ]);

    const { status, text } = normalizePayloadText(head, work);

    expect(status).toBe("real-kept");
    expect((JSON.parse(text) as { files: PayloadFile[] }).files.map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("normalize-payload-eol script", () => {
  it("skips a tracked payload that was deleted instead of crashing", () => {
    const repo = mkdtempSync(join(tmpdir(), "payload-eol-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "pipe" });
      git("init", "-q");
      mkdirSync(join(repo, "public", "r"), { recursive: true });
      writeFileSync(join(repo, "public", "r", "gone.json"), payloadText([{ path: "a.ts", content: "a\r\n" }]));
      git("add", ".");
      git("commit", "-q", "-m", "payload");
      rmSync(join(repo, "public", "r", "gone.json"));

      const output = execFileSync("node", [resolve(__dirname, "../scripts/normalize-payload-eol.mjs")], { cwd: repo, encoding: "utf8" });

      expect(output).toContain("deleted-skipped public/r/gone.json");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleGridRequest } from "./handle-grid-request";

const post = (bytes: number) => new Request("http://x/", { method: "POST", body: JSON.stringify({ pad: "x".repeat(bytes) }) });
const echo = async () => ({ ok: true });
const selectionLike = Object.assign(async () => ({ ok: true }), { maxBodyBytes: 8 * 1024 * 1024 });

describe("handleGridRequest body cap", () => {
  it("reads the run's own cap when the route passes none", async () => {
    expect((await handleGridRequest(post(600 * 1024), selectionLike)).status).toBe(200);
    expect((await handleGridRequest(post(600 * 1024), echo)).status).toBe(413);
  });

  it("lets the route's cap win over the run's", async () => {
    expect((await handleGridRequest(post(2048), selectionLike, { maxBodyBytes: 1024 })).status).toBe(413);
  });
});

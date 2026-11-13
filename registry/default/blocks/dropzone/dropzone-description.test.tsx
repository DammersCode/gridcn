import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dropzone } from "./dropzone";

afterEach(cleanup);

const description = () => document.querySelector(".sr-only")?.textContent;

describe("Dropzone screen reader description", () => {
  it("defaults to the accepted types in English", () => {
    render(<Dropzone accept={{ "text/csv": [".csv"] }} />);
    expect(description()).toBe("Accepted file types: .csv.");
  });

  it("takes the description prop in place of the English text", () => {
    render(<Dropzone accept={{ "text/csv": [".csv"] }} description=".csv, bis 2 MB" />);
    expect(description()).toBe(".csv, bis 2 MB");
  });
});

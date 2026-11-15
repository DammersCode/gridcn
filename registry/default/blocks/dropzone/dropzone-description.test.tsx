import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dropzone } from "./dropzone";

afterEach(cleanup);

const description = () => document.querySelector(".sr-only")?.textContent;

describe("Dropzone screen reader description", () => {
  it("defaults to the accepted types in English", () => {
    render(<Dropzone accept={{ "text/csv": [".csv"] }} />);
    expect(description()).toBe("Accepted file types: .csv.");
  });

  it("names an extension once and falls back to the MIME type", () => {
    const { unmount } = render(<Dropzone accept={{ "text/csv": [".csv"], "application/csv": [".csv"] }} />);
    expect(description()).toBe("Accepted file types: .csv.");
    unmount();
    render(<Dropzone accept={{ "text/csv": [] }} />);
    expect(description()).toBe("Accepted file types: text/csv.");
  });

  it("sets the native input accept to MIME keys plus extensions", () => {
    render(<Dropzone accept={{ "text/csv": [] }} />);
    expect(document.querySelector("input")?.getAttribute("accept")).toBe("text/csv");
  });

  it("treats an empty accept as no restriction", () => {
    render(<Dropzone accept={{}} />);
    expect(description()).toBe("All file types accepted.");
    expect(document.querySelector("input")?.hasAttribute("accept")).toBe(false);
  });

  it("takes the accessibleDescription prop in place of the English text", () => {
    render(<Dropzone accept={{ "text/csv": [".csv"] }} accessibleDescription=".csv, bis 2 MB" />);
    expect(description()).toBe(".csv, bis 2 MB");
  });
});

describe("Dropzone onError", () => {
  it("reports a null-prototype throw from onDrop as an Error", () => {
    const onError = vi.fn();
    render(
      <Dropzone
        onDrop={() => {
          throw Object.create(null);
        }}
        onError={onError}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["a"], "a.csv")] } });
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0].message).toBe("Unknown error");
  });
});

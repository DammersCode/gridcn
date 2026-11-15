import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

  it("states the size limit when maxSize is set", () => {
    render(<Dropzone accept={{ "text/csv": [".csv"] }} maxSize={2 * 1024 * 1024} />);
    expect(description()).toBe("Accepted file types: .csv. Up to 2.0 MB.");
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

describe("Dropzone onDrop", () => {
  it("lets a throw from onDrop propagate", () => {
    const boom = new Error("boom");
    render(
      <Dropzone
        onDrop={() => {
          throw boom;
        }}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const thrown: unknown[] = [];
    const onWindowError = (event: ErrorEvent) => {
      thrown.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onWindowError);
    fireEvent.change(input, { target: { files: [new File(["a"], "a.csv")] } });
    window.removeEventListener("error", onWindowError);
    expect(thrown).toContain(boom);
  });
});

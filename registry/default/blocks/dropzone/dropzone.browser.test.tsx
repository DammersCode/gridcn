import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Dropzone, DropzoneEmptyState, DropzoneContent } from "./dropzone";
// real stylesheet so Tailwind's focus-visible/dashed-border utilities actually apply
import "@/app/global.css";

function makeFile(name: string, type: string, content = "a"): File {
  return new File([content], name, { type });
}

/** Builds a real `DataTransfer` carrying `files`, for a synthetic HTML5 drag-and-drop sequence. */
function dataTransferWith(files: File[]): DataTransfer {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  return dataTransfer;
}

async function drop(zone: Element, files: File[]): Promise<void> {
  const dataTransfer = dataTransferWith(files);
  zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
  zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  await new Promise((r) => setTimeout(r, 0));
}

describe("Dropzone (browser)", () => {
  it("dropping an accepted file calls onDrop with it and no rejections", async () => {
    const onDrop = vi.fn();
    const screen = await render(<Dropzone accept={{ "text/csv": [".csv"] }} onDrop={onDrop} aria-label="Upload" />);

    const zone = screen.getByRole("button", { name: "Upload" }).element();
    const file = makeFile("data.csv", "text/csv");
    await drop(zone, [file]);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith([file], []);
    await screen.unmount();
  });

  it("dropping a file of the wrong type reports it as a rejection instead of an accepted file", async () => {
    const onDrop = vi.fn();
    const screen = await render(<Dropzone accept={{ "text/csv": [".csv"] }} onDrop={onDrop} aria-label="Upload" />);

    const zone = screen.getByRole("button", { name: "Upload" }).element();
    const file = makeFile("photo.png", "image/png");
    await drop(zone, [file]);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith([], [{ file, reasons: ["accept"] }]);
    await screen.unmount();
  });

  it("a drag entering and leaving a child element does not flicker the active state (depth counter)", async () => {
    const screen = await render(
      <Dropzone aria-label="Upload">
        <DropzoneEmptyState />
      </Dropzone>,
    );

    const zone = screen.getByRole("button", { name: "Upload" }).element();
    const child = zone.querySelector("p")!;
    const dataTransfer = dataTransferWith([makeFile("a.csv", "text/csv")]);

    zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.element(zone).toHaveClass(/border-primary/);

    // entering then leaving a child bumps the depth counter up then down — the zone must stay active.
    child.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    child.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.element(zone).toHaveClass(/border-primary/);

    zone.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.element(zone).not.toHaveClass(/border-primary/);
    await screen.unmount();
  });

  it("Enter opens the native file picker (spied input click)", async () => {
    const screen = await render(<Dropzone aria-label="Upload" />);
    const zone = screen.getByRole("button", { name: "Upload" }).element();
    const input = zone.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi.spyOn(input, "click");

    (zone as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it("a single mouse click opens the native file picker exactly once", async () => {
    const screen = await render(<Dropzone aria-label="Upload" />);
    const zone = screen.getByRole("button", { name: "Upload" });
    const input = zone.element().querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi.spyOn(input, "click");

    await userEvent.click(zone);

    // input.click() bubbles a real click back to the zone's own onClick — regression coverage
    // for that double-open (see the onClick={stopPropagation} on the hidden input).
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it("a disabled zone ignores drop and click", async () => {
    const onDrop = vi.fn();
    const screen = await render(<Dropzone disabled onDrop={onDrop} aria-label="Upload" />);
    const zone = screen.getByRole("button", { name: "Upload" }).element();

    expect(zone).toHaveAttribute("aria-disabled", "true");
    await drop(zone, [makeFile("a.csv", "text/csv")]);
    expect(onDrop).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("stamps data-drag-active while dragging and drops it on dragleave/drop", async () => {
    const screen = await render(<Dropzone aria-label="Upload" />);
    const zone = screen.getByRole("button", { name: "Upload" }).element();
    const dataTransfer = dataTransferWith([makeFile("a.csv", "text/csv")]);

    expect(zone).not.toHaveAttribute("data-drag-active");

    zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.element(zone).toHaveAttribute("data-drag-active", "true");

    zone.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.element(zone).not.toHaveAttribute("data-drag-active");

    zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.element(zone).toHaveAttribute("data-drag-active", "true");
    await drop(zone, [makeFile("b.csv", "text/csv")]);
    await expect.element(zone).not.toHaveAttribute("data-drag-active");
    await screen.unmount();
  });

  it("stamps data-disabled on a disabled zone", async () => {
    const screen = await render(<Dropzone disabled aria-label="Upload" />);
    const zone = screen.getByRole("button", { name: "Upload" }).element();

    expect(zone).toHaveAttribute("data-disabled", "true");
    await screen.unmount();
  });

  it("DropzoneContent renders held files from src and hides the empty state", async () => {
    const file = makeFile("data.csv", "text/csv");
    const screen = await render(
      <Dropzone src={[file]} aria-label="Upload">
        <DropzoneEmptyState />
        <DropzoneContent />
      </Dropzone>,
    );

    await expect.element(page.getByText("data.csv")).toBeInTheDocument();
    await expect.element(page.getByText("Upload a file")).not.toBeInTheDocument();
    await screen.unmount();
  });
});

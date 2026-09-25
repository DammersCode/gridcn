# Dropzone

## Evaluation

Kibo UI's dropzone (kibo-ui.com/components/dropzone) wraps **react-dropzone**
(react-dropzone.js.org, credited in Kibo's own "Powered by" section) — not Dropzone.js. The
add-on needs only: click-to-open, drag enter/over/leave/drop, an accept/size/count filter, and a
depth counter so child elements don't flicker the active state. That is a few dozen lines over
native HTML5 drag-and-drop events and a hidden `<input type="file">`, against a real dependency
(react-dropzone pulls in `attr-accept`, `file-selector`, and prop-types transitively). No concrete
reason favors the dependency here. Verdict: build a native, dependency-free Dropzone.

## Decision

Its own registry item `dropzone` (`registry/default/blocks/dropzone/dropzone.tsx`), reusable
outside the grid. `data-grid-io` lists it as a registryDependency and imports it; the io barrel
does not re-export it. No new npm dependency.

## API

```tsx
<Dropzone
  accept={{ "text/csv": [".csv"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] }}
  maxFiles={1}
  maxSize={number}
  minSize={number}
  disabled={boolean}
  onDrop={(acceptedFiles: File[], rejections: DropzoneRejection[]) => void}
  onError={(error: Error) => void}
  src={File[] | undefined}
>
  <DropzoneEmptyState />
  <DropzoneContent />
</Dropzone>
```

`multiple` is derived from `maxFiles !== 1`. A `DropzoneRejection` is `{ file: File; reasons:
("accept" | "maxSize" | "minSize" | "maxFiles")[] }`. `matchesAccept(file, accept)` and
`filterFiles(files, options)` are exported as pure functions for unit testing and reuse.

## Accept matching

Checked by MIME type (exact or `type/*` wildcard) OR file extension — browsers often report an
empty or wrong MIME type for `.csv`, so the extension list in the `accept` value must be enough on
its own.

## Accessibility

The drop surface is a focusable element with `role="button"`, `tabIndex={0}`,
`aria-disabled` when disabled, and a visible focus ring. Enter or Space opens the native file
picker, same as a click. `dragover` and `drop` call `preventDefault()` only inside the zone, so a
file dropped elsewhere on the page still triggers the browser's default (navigate away) instead of
silently doing nothing — but a drop inside the zone never navigates the tab.

## Pitfall: the hidden input's own click bubbles

`inputRef.current.click()` dispatches a real `click` event that bubbles up to the wrapping
`role="button"` div, re-triggering that div's own `onClick={openPicker}` — a second, redundant
`.click()` call per open. Fixed with `onClick={(e) => e.stopPropagation()}` on the input itself.
Covered by a regression test asserting exactly one `.click()` call per mouse click and per Enter.

## Compact variant

`compact` (boolean prop) switches the zone to a single-row layout, reused in the import dialog's
column-mapping step so a file can be replaced without leaving that step. Dropping or clicking it
re-enters the same `loadFile` path as the initial pick, including the generation guard and
sheet/delimiter reset.

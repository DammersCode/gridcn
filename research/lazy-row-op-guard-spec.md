# Row create, duplicate and delete over unloaded lazy rows

## Problem

`useDataGridLazyRows` gives the grid a sparse `data` array: an unloaded row is a hole. A select-all
in a lazy grid checks the holes too. `deleteRows` over that selection splices the holes out of the
array and emits no `delete` op for them. The array falls below `total`, a server delete built from
the ops misses the holes, and the next `lazy.reset()` fetches the "deleted" rows again.
`duplicateRows` and `insertRows` have no guard. `reorderRows` already no-ops over holes.

## Rule

An operation whose target set touches an unloaded row is a no-op. It writes nothing, emits no
change, and warns once per grid instance in development.

| Operation | Target set |
|---|---|
| `deleteRows`, `deleteRowsById` | every row in the request |
| `duplicateRows` | every source row |
| `insertRow`, `insertRows` | the anchor row (the view row the new rows go above or below) |

The guard is all-or-nothing: one hole in the request cancels the whole request. A partial delete
would look like success while the checked holes survive.

`deleteRowsById` over loaded rows stays the way to delete ids the consumer knows.

## Modes

| Mode | Behavior |
|---|---|
| Local array, client pagination | no holes; unchanged |
| Server pagination | no holes (the page is the array); unchanged |
| Lazy, any sort or filter mode | guard applies (`sortMode="server"` and `filterMode="server"` are lazy-only in practice) |
| Controlled sort and filter state | no extra rule; the guard reads the data array |
| Write-through (`onDataChange`) | ops never carry a hole row |

## Server contract

The server never receives an op for an unloaded row. A bulk action over "all rows" of a lazy grid
belongs to the consumer's own endpoint (it knows the filter), not to `deleteRows`.

## Tests

One unit test per operation over a sparse array: array, `total`-equivalent length, and emitted
changes stay as before; one warning per instance; a request over loaded rows still runs.

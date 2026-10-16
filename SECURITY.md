# Security policy

## Reporting a vulnerability

Report a vulnerability privately through a GitHub Security Advisory:
<https://github.com/DammersCode/gridcn/security/advisories/new>

Do not open a public issue or pull request for a vulnerability. Include the affected registry
item (for example `data-grid-io`), the version or commit, and steps to reproduce.

Response time: best effort within 7 days. A fix for a confirmed vulnerability ships before the
advisory is published.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| 0.x | No |

## Scope

In scope:

- The registry source under `registry/` and the payloads in `public/r/`.
- The documentation site and its demos.
- Handling of untrusted input: imported CSV, XLSX, and XLS files, clipboard content, URL state,
  cell values rendered as text or links, and CSV export.

Out of scope:

- Code you edited after installing it.
- Vulnerabilities in your own app, in your data source, or in dependencies that gridcn does not
  pin.
- Denial of service through data volume you chose to load, beyond the documented import limits.

The rules the code follows for untrusted input are in the Security section of
[AGENTS.md](AGENTS.md).

---
mode: agent
description: Review the Governance OneLens Fabric app for sensitive-data exposure, over-fetching, client-side-only filtering, hardcoded configuration, debug artifacts, and connector/permission risks — then fix Critical/High findings.
---

Read and follow `.github/skills/fabric-app-security-review/SKILL.md` in full, then
perform that security review against the current state of this repository.

Report findings grouped by Critical, High, Medium, and Low severity (file + line,
issue, why it matters, evidence, recommended fix). Then fix the Critical and High
findings directly, preserving existing app behavior, and re-run the validation gate
described at the end of the skill file (`tsc -b`, `eslint`, `vitest run`, `vite build`,
`py_compile scanner/*.py`). Summarize what changed and flag anything that still needs
human review (e.g., rotating a credential or id that was already shipped historically).

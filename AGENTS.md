# AGENTS.md

Repository-wide instructions for coding agents (GitHub Copilot, Claude Code, Cursor, etc.).

## Security review

Before opening a PR that touches `app/src/services`, `app/rayfin/data`, or `scanner/*.py`,
or before any deployment, run the **fabric-app-security-review** skill:
`.github/skills/fabric-app-security-review/SKILL.md`.

- GitHub Copilot (VS Code): run the `/fabric-app-security-review` prompt
  (`.github/prompts/fabric-app-security-review.prompt.md`).
- Claude Code / Cursor / other agents: read and follow
  `.github/skills/fabric-app-security-review/SKILL.md` directly.

It reviews for sensitive-data exposure (PII, owner/UPN fields), Rayfin GraphQL /
semantic-model over-fetching, client-side-only filtering, hardcoded tenant/workspace/
item ids in client code, debug artifacts, and connector/entity permission scope — then
fixes Critical/High findings and re-runs this repo's CI gate (see
`.github/workflows/ci.yml`: lint, typecheck, unit tests, build, `py_compile` on the
scanner).

## Subproject instructions

- `app/AGENTS.md` — Rayfin-specific doc-loading conventions for the frontend.

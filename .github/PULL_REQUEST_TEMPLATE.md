## What does this PR do?

<!-- A clear, concise description of the change and why it's needed. -->

## Checklist

- [ ] `npm run lint` / `npx tsc -b` / `npm test` / `npm run build` pass locally (from `app/`)
- [ ] `python -m py_compile scanner/*.py` passes locally, if `scanner/` was touched
- [ ] If this touches `app/src/services`, `app/rayfin/data`, or `scanner/*.py`, or is heading
      toward a deployment: ran the
      [`fabric-app-security-review`](../.github/skills/fabric-app-security-review/SKILL.md)
      checklist and fixed any Critical/High findings
- [ ] No hardcoded tenant/workspace/client GUIDs or secrets were added
- [ ] Docs updated if this changes behavior described in `README.md`, `ARCHITECTURE.md`, or `knowledge-base/`

## Related issue

<!-- Closes #... , if applicable -->

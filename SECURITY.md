<!-- BEGIN MICROSOFT SECURITY.MD V0.0.9 BLOCK -->

## Security

Microsoft takes the security of our software products and services seriously, which includes
all source code repositories managed through our GitHub organizations, which include
[Microsoft](https://github.com/microsoft), [Azure](https://github.com/azure), [DotNet](https://github.com/dotnet), [AspNet](https://github.com/aspnet) and [Xamarin](https://github.com/xamarin).

If you believe you have found a security vulnerability in any Microsoft-owned repository that
meets [Microsoft's definition of a security vulnerability](https://aka.ms/security.md/definition),
please report it to us as described below.

## Reporting Security Issues

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them to the Microsoft Security Response Center (MSRC) at [https://msrc.microsoft.com/create-report](https://aka.ms/security.md/msrc/create-report).

If you prefer to submit without logging in, send email to [secure@microsoft.com](mailto:secure@microsoft.com). If possible, encrypt your message with our PGP key; please download it from the [Microsoft Security Response Center PGP Key page](https://aka.ms/security.md/msrc/pgp).

You should receive a response within 24 hours. If for some reason you do not, please follow up via
email to ensure we received your original message. Additional information can be found at
[microsoft.com/msrc](https://aka.ms/security.md/msrc).

Please include the requested information listed below (as much as you can provide) to help us better
understand the nature and scope of the possible issue:

  * Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
  * Full paths of source file(s) related to the manifestation of the issue
  * The location of the affected source code (tag/branch/commit or direct URL)
  * Any special configuration required to reproduce the issue
  * Step-by-step instructions to reproduce the issue
  * Proof-of-concept or exploit code (if possible)
  * Impact of the issue, including how an attacker might exploit the issue

This information will help us triage your report more quickly.

If you are reporting for a bug bounty, more complete reports can contribute to a higher bounty award.
Please visit our [Microsoft Bug Bounty Program](https://aka.ms/security.md/msrc/bounty) page for more details about our active programs.

## Preferred Languages

We prefer all communications to be in English.

## Policy

Microsoft follows the principle of [Coordinated Vulnerability Disclosure](https://aka.ms/security.md/cvd).

<!-- END MICROSOFT SECURITY.MD BLOCK -->

## Project-specific notes

This repository is a template — anyone deploying it stands up their own Fabric workspace,
scan service principal, and (optionally) their own Entra app registration for Ask OneLens.
A few things worth knowing when reporting an issue specific to this codebase:

- **No secrets are ever meant to be committed.** The scanner is secretless (Fabric token
  library, no service-principal secret or Key Vault dependency); the frontend reads all
  environment-specific identifiers from required `VITE_*` env vars that fail fast if unset
  (see [app/.env.example](app/.env.example) and [scanner/.env.example](scanner/.env.example)).
  If you find a hardcoded tenant/workspace/client GUID or a real secret committed anywhere
  in this repo, please report it as above rather than opening a public issue.
- **Access control is a fail-closed allowlist**, not per-item RBAC — see
  [ARCHITECTURE.md § Security & Governance](ARCHITECTURE.md#security--governance) for the
  full model before reporting an access-control concern, since "any allowlisted reader sees
  the whole tenant catalog" is the intended design, not a bug.
- The [`fabric-app-security-review`](.github/skills/fabric-app-security-review/SKILL.md) skill
  documents the review checklist this project runs before any deployment or PR touching
  `app/src/services`, `app/rayfin/data`, or `scanner/*.py`.

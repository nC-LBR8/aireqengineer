---
description: Generate requirement artifacts from a single local use case file
agent: requirements-enricher
---
Generate requirement artifacts from the local file path below:

$ARGUMENTS

Instructions:
- Treat the argument as a local file path and read the file content before deriving artifacts.
- Accept only `.txt` and `.md` files.
- Read the existing `stories/` directory first and continue the current numbering scheme.
- Create one use case subfolder under `stories/` based on the file name and place the new `REQ-*`, derived `FEAT-*`, and derived `US-*` artifacts inside it.
- Create or update `_summary.md` in the same use case subfolder.
- Keep the markdown format aligned with the project's existing files.
- Write all generated artifacts in English.
- Avoid duplicate, overlapping, or unjustified enterprise-style requirements.
- Do not edit existing artifact files unless the user explicitly asked to update them; if the request is already covered, report reuse only.

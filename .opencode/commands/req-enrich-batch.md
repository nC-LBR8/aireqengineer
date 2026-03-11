---
description: Generate requirement artifacts from all txt and md usecase files in a folder
agent: requirements-enricher
---
Generate requirement artifacts from the local directory below:

$ARGUMENTS

Instructions:
- Treat the argument as a local directory path.
- Process only files directly inside that directory, not recursively.
- Process only `*.txt` and `*.md` files.
- Process files in alphabetical order.
- Skip empty files.
- Read the existing `stories/` directory first and continue the current numbering scheme.
- For each valid file, create one use case subfolder under `stories/` based on the file name and place one new `REQ-*` artifact, the derived `FEAT-*` artifacts, and the derived `US-*` artifacts inside it.
- For each valid file, create or update `_summary.md` in the same use case subfolder.
- Keep the markdown format aligned with the project's existing files.
- Write all generated artifacts in English.
- Avoid duplicate, overlapping, or unjustified enterprise-style requirements.
- Do not edit existing artifact files unless the user explicitly asked to update them; if the request is already covered, report reuse only.

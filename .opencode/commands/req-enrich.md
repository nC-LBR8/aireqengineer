---
description: Generate requirement artifacts from direct text or the default usecase file
agent: requirements-enricher
---
If `$ARGUMENTS` is empty, use `usecases/pomodoro-timer.txt` as the input source.
If `$ARGUMENTS` is not empty, treat it as direct free-form product input.

Instructions:
- Read the existing `stories/` directory first and continue the current numbering scheme.
- Create one use case subfolder under `stories/` and place the new `REQ-*`, derived `FEAT-*`, and derived `US-*` artifacts inside it.
- Create or update `_summary.md` in the same use case subfolder.
- Keep the markdown format aligned with the project's existing files.
- Write all generated artifacts in English.
- Avoid duplicate, overlapping, or unjustified enterprise-style requirements.
- Do not edit existing artifact files unless the user explicitly asked to update them; if the request is already covered, report reuse only.
- If `usecases/pomodoro-timer.txt` is missing during a no-argument invocation, report the missing file clearly.

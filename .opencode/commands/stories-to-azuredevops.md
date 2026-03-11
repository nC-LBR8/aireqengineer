---
description: Upload one stories use-case folder or all stories folders to Azure DevOps
agent: azure-devops-uploader
---
Upload aireqengineer story artifacts to Azure DevOps from the local path below:

$ARGUMENTS

Instructions:
- If `$ARGUMENTS` is empty, use `stories/`.
- Treat `stories/<usecase-slug>/` as single-folder upload mode.
- Treat `stories/` as batch mode and process direct child use-case folders alphabetically.
- Validate `.opencode/config/azure-devops.json` and the configured PAT environment variable before upload.
- Honor the config-driven mapping and validate-only mode.
- Run `.opencode/scripts/upload-azure-devops.mjs` and report concise created, linked, reused, skipped, and failed results.

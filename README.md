# OpenCode Requirements Enricher

This project contains a project-local OpenCode setup for generating requirement artifacts from direct text input or files in `usecases/`.

## Get Started

To reuse this setup in any other project, copy the local OpenCode files into that project's `.opencode/` folder and add a `usecases/` folder for the input files.

Minimum structure:

```text
your-project/
  .opencode/
    agents/
      requirements-enricher.md
    commands/
      req-enrich.md
      req-enrich-file.md
      req-enrich-batch.md
  usecases/
    pomodoro-timer.txt
```

Recommended steps:

1. Create `.opencode/agents/` and `.opencode/commands/` in the target project.
2. Copy `requirements-enricher.md`, `req-enrich.md`, `req-enrich-file.md`, and `req-enrich-batch.md` into the same relative locations.
3. Create a `usecases/` folder in the target project.
4. Add one or more use case files as `*.txt` or `*.md`.
5. Run one of these commands from OpenCode in that project:
   - `/req-enrich`
   - `/req-enrich <your prompt>`
   - `/req-enrich-file usecases/<name>.txt`
   - `/req-enrich-batch usecases/`
6. Review the generated output in `stories/<usecase-slug>/`.

Expected generated structure:

```text
your-project/
  stories/
    <usecase-slug>/
      REQ-001.md
      FEAT-001.md
      US-001.md
      _summary.md
```

Recommendation:

- Prefer a project-local setup in `.opencode/` for most teams and repositories.
- Use the global OpenCode area only if you want the exact same commands available everywhere and you accept that changes to the agent affect all projects at once.

Why project-local is usually better:

- Requirements conventions often differ by repository or customer.
- Project-local commands can evolve with the repo's artifact structure and naming rules.
- The setup is versionable together with the project files.
- Team members get the same behavior when they open the repository.

When a global setup can make sense:

- You are the only user and want the same personal workflow in many repos.
- You are still experimenting and do not want to copy the files repeatedly.
- The generated artifact format is intentionally standardized across all your projects.

Practical recommendation:

- Start project-local.
- Move parts to the global OpenCode area only after the workflow has stabilized and you are confident the same defaults should apply everywhere.

### Copy/Paste Checklist

If you want to copy this setup into another project, take these files as-is:

```text
.opencode/agents/requirements-enricher.md
.opencode/commands/req-enrich.md
.opencode/commands/req-enrich-file.md
.opencode/commands/req-enrich-batch.md
```

Then create these project folders if they do not exist yet:

```text
usecases/
stories/
```

At minimum, add one input file such as:

```text
usecases/pomodoro-timer.txt
```

If you want a cleaner starter setup for another repository, you can copy only the `.opencode/` files and then create your own `usecases/*.txt` or `usecases/*.md` files from scratch.

## Files

- `.opencode/agents/requirements-enricher.md` - specialized subagent that derives requirement, feature, and user story artifacts
- `.opencode/agents/azure-devops-uploader.md` - specialized subagent that validates config and uploads story artifacts to Azure DevOps
- `.opencode/commands/req-enrich.md` - command for direct text input or the default use case file
- `.opencode/commands/req-enrich-file.md` - command for a single local use case file
- `.opencode/commands/req-enrich-batch.md` - command for multiple use case files in one folder
- `.opencode/commands/stories-to-azuredevops.md` - command for uploading one or many story folders to Azure DevOps
- `.opencode/config/azure-devops.json` - configurable Azure DevOps endpoint, defaults, and artifact-to-work-item mapping
- `.opencode/scripts/upload-azure-devops.mjs` - REST uploader with validation, idempotent state files, and batch support

## Commands

Generate artifacts from the default file:

```text
/req-enrich
```

The default input file is:

```text
usecases/pomodoro-timer.txt
```

Generate artifacts from a product prompt:

```text
/req-enrich Build a classic Snake Game that runs in a browser
```

Generate artifacts from a local file:

```text
/req-enrich-file usecases/habit-tracker.txt
```

Generate artifacts from all supported use case files in a folder:

```text
/req-enrich-batch usecases/
```

Upload one story folder to Azure DevOps:

```text
/stories-to-azuredevops stories/pomodoro-timer
```

Upload all story folders from `stories/` alphabetically:

```text
/stories-to-azuredevops stories/
```

## Expected output

The commands write markdown artifacts into one subfolder per use case under `stories/`.

Example:

```text
stories/
  snake-browser-game/
    REQ-001.md
    FEAT-001.md
    US-001.md
    _summary.md
  habit-tracker/
    REQ-001.md
    FEAT-001.md
    US-001.md
    _summary.md
```

Inside each use case subfolder, the local naming conventions remain:

- `REQ-*.md`
- `FEAT-*.md`
- `US-*.md`
- `_summary.md`

The `_summary.md` file uses this structure:

```md
# Summary

## Use Case
- ...

## Requirement
- `REQ-001` - ...

## Features
- `FEAT-001` - ...

## Functional Stories
- `US-001` - ...

## Non-Functional Stories
- `US-00X` - ...
```

The agent is instructed to:

- inspect existing `stories/` files first
- continue the numbering scheme
- avoid duplicate artifacts
- keep generated artifacts in English
- avoid editing existing artifacts unless explicitly asked
- keep one use case per `stories/<usecase-slug>/` subfolder for traceability

Supported input files:

- `*.txt`
- `*.md`

Recommended project structure:

```text
usecases/
  pomodoro-timer.txt
  habit-tracker.txt
  expense-tracker.md
```

## Notes

- The current `stories/` folder is treated as reference/sample output.
- The command is designed to be additive. If the request is already covered, it should report reuse instead of rewriting files.
- The generated output is intended to be close to the original `Req.Enricher` workflow, but implemented natively through OpenCode commands and an OpenCode subagent.

## Azure DevOps Upload

The repository also includes a config-driven Azure DevOps backlog export workflow for the generated `stories/` artifacts.

Default hierarchy:

- `REQ` -> `Epic`
- `FEAT` -> `Feature`
- `US` -> backlog item type from config, defaulting to `User Story`

The uploader reads these artifact files from one use-case folder:

- `REQ-*.md`
- `FEAT-*.md`
- `US-*.md`

The uploader ignores `_summary.md` for work item creation, but keeps using the story folder as the traceability boundary.

### Setup

1. Edit `.opencode/config/azure-devops.json`.
2. Replace `organization`, `project`, and any mapping defaults that do not match your Azure DevOps process.
3. Set the PAT environment variable named by `patEnvVar`.
4. Switch `validateOnly` to `false` when you are ready to create or link work items.

PAT example:

```bash
export AZURE_DEVOPS_PAT="your-pat"
```

The PAT is never stored in git. The config stores only the environment variable name.

### Config Shape

Required top-level config:

- `baseUrl`
- `organization`
- `project`
- `apiVersion` default `7.1`
- `patEnvVar`

Optional defaults:

- `validateOnly`
- `areaPath`
- `iterationPath`
- `tags`

Required mapping keys:

- `artifactMappings.REQ`
- `artifactMappings.FEAT`
- `artifactMappings.US.functional`
- `artifactMappings.US.nfr`

Each mapping supports:

- `workItemType`
- `parentKind`
- `parentRelation`
- `extraTags`
- `fieldMap`
- `fixedFields`

The default config uses:

- `REQ -> Epic`
- `FEAT -> Feature`, parent `REQ`
- `US.functional -> User Story`, parent `FEAT`
- `US.nfr -> User Story`, parent first referenced `FEAT`, extra referenced features linked as `Related`

### Process Examples

Agile:

```json
{
  "artifactMappings": {
    "US": {
      "functional": { "workItemType": "User Story" },
      "nfr": { "workItemType": "User Story" }
    }
  }
}
```

Scrum:

```json
{
  "artifactMappings": {
    "US": {
      "functional": { "workItemType": "Product Backlog Item" },
      "nfr": { "workItemType": "Product Backlog Item" }
    }
  }
}
```

Basic:

```json
{
  "artifactMappings": {
    "US": {
      "functional": { "workItemType": "Issue" },
      "nfr": { "workItemType": "Issue" }
    }
  }
}
```

If your Azure DevOps process is customized, update the mapping instead of changing the script.

### Upload Behavior

- Validates config, PAT presence, and configured work item types before upload.
- Accepts a single use-case folder like `stories/pomodoro-timer`.
- Accepts `stories/` for batch processing and handles use-case folders alphabetically.
- Creates work items first, then adds hierarchy and related links after all IDs are known.
- Reuses saved IDs from `stories/<slug>/_ado-upload.json` on rerun to avoid duplicate work items.
- Writes created work item URLs into the state file.
- Supports dry-run validation through `validateOnly`.

The uploader uses the Azure DevOps REST API with `application/json-patch+json` and safe common fields such as:

- `System.Title`
- `System.Description`
- `System.Tags`
- optional `System.AreaPath`
- optional `System.IterationPath`

Parent and traceability links use:

- `System.LinkTypes.Hierarchy-Reverse`
- `System.LinkTypes.Related`

### Commands

Run through OpenCode:

```text
/stories-to-azuredevops stories/pomodoro-timer
/stories-to-azuredevops stories/
```

Run the script directly:

```bash
node .opencode/scripts/upload-azure-devops.mjs stories/pomodoro-timer
node .opencode/scripts/upload-azure-devops.mjs stories/
```

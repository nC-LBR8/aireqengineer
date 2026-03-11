#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const WORKSPACE_ROOT = process.cwd();
const DEFAULT_CONFIG_PATH = path.join(WORKSPACE_ROOT, ".opencode", "config", "azure-devops.json");
const STATE_FILE_NAME = "_ado-upload.json";
const ARTIFACT_ORDER = ["REQ", "FEAT", "US"];
const PRIORITY_MAP = {
  high: 1,
  medium: 2,
  low: 3,
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const targetArg = args[0] || "stories/";
  const config = await loadConfig(DEFAULT_CONFIG_PATH);
  validateConfig(config);

  const pat = process.env[config.patEnvVar];
  if (!pat) {
    throw new Error(`Missing Azure DevOps PAT. Set the ${config.patEnvVar} environment variable before running this command.`);
  }

  const ado = createAdoClient(config, pat);
  const availableTypes = await validateRemoteMappings(ado, config);
  const targetDirs = await resolveUseCaseDirectories(targetArg);

  if (targetDirs.length === 0) {
    throw new Error(`No use-case folders found for '${targetArg}'.`);
  }

  const overall = {
    processed: [],
    created: 0,
    reused: 0,
    linked: 0,
    skippedLinks: 0,
    warnings: [],
  };

  for (const useCaseDir of targetDirs) {
    const result = await processUseCaseDirectory(useCaseDir, config, ado, availableTypes);
    overall.processed.push(result);
    overall.created += result.created;
    overall.reused += result.reused;
    overall.linked += result.linked;
    overall.skippedLinks += result.skippedLinks;
    overall.warnings.push(...result.warnings);
  }

  printOverallSummary(overall, config.validateOnly);
}

function printHelp() {
  console.log(`Usage: node .opencode/scripts/upload-azure-devops.mjs <stories-path>

Uploads aireqengineer story artifacts to Azure DevOps.

Examples:
  node .opencode/scripts/upload-azure-devops.mjs stories/pomodoro-timer
  node .opencode/scripts/upload-azure-devops.mjs stories/

Config file:
  .opencode/config/azure-devops.json`);
}

async function loadConfig(configPath) {
  let raw;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(`Missing config file at ${path.relative(WORKSPACE_ROOT, configPath)}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(WORKSPACE_ROOT, configPath)}: ${error.message}`);
  }

  const config = structuredClone(parsed);
  config.apiVersion = config.apiVersion || "7.1";
  config.validateOnly = Boolean(config.validateOnly);
  config.tags = Array.isArray(config.tags) ? config.tags : [];
  config.areaPath = typeof config.areaPath === "string" ? config.areaPath.trim() : "";
  config.iterationPath = typeof config.iterationPath === "string" ? config.iterationPath.trim() : "";
  return config;
}

function validateConfig(config) {
  const requiredKeys = ["baseUrl", "organization", "project", "patEnvVar", "artifactMappings"];
  for (const key of requiredKeys) {
    if (!config[key]) {
      throw new Error(`Missing required config key '${key}' in .opencode/config/azure-devops.json.`);
    }
  }

  const mappings = [
    ["REQ", config.artifactMappings.REQ],
    ["FEAT", config.artifactMappings.FEAT],
    ["US.functional", config.artifactMappings.US?.functional],
    ["US.nfr", config.artifactMappings.US?.nfr],
  ];

  for (const [name, mapping] of mappings) {
    if (!mapping || typeof mapping !== "object") {
      throw new Error(`Missing required mapping '${name}' in .opencode/config/azure-devops.json.`);
    }
    if (!mapping.workItemType || typeof mapping.workItemType !== "string") {
      throw new Error(`Mapping '${name}' must define workItemType.`);
    }
    if (!mapping.fieldMap || typeof mapping.fieldMap !== "object") {
      throw new Error(`Mapping '${name}' must define fieldMap.`);
    }
    if (mapping.fixedFields && typeof mapping.fixedFields !== "object") {
      throw new Error(`Mapping '${name}' fixedFields must be an object when provided.`);
    }
  }
}

function createAdoClient(config, pat) {
  const basePath = `${config.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}`;
  const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;

  async function request(method, apiPath, { body, expectedStatus, headers, raw = false } = {}) {
    const url = new URL(`${basePath}${apiPath}`);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json-patch+json" } : {}),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;

    if (expectedStatus && response.status !== expectedStatus) {
      throw new Error(formatAdoError(method, url, response.status, payload || text));
    }
    if (!expectedStatus && !response.ok) {
      throw new Error(formatAdoError(method, url, response.status, payload || text));
    }

    return raw ? { response, payload, text } : payload;
  }

  return {
    config,
    request,
    async getWorkItemTypes() {
      const data = await request("GET", `/_apis/wit/workitemtypes?api-version=${encodeURIComponent(config.apiVersion)}`);
      return Array.isArray(data?.value) ? data.value : [];
    },
    async getWorkItem(id, expandRelations = false) {
      const expand = expandRelations ? "&$expand=relations" : "";
      return request("GET", `/_apis/wit/workitems/${id}?api-version=${encodeURIComponent(config.apiVersion)}${expand}`);
    },
    async createWorkItem(type, operations) {
      return request(
        "POST",
        `/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=${encodeURIComponent(config.apiVersion)}`,
        { body: operations, expectedStatus: 200 },
      );
    },
    async updateWorkItem(id, operations) {
      return request(
        "PATCH",
        `/_apis/wit/workitems/${id}?api-version=${encodeURIComponent(config.apiVersion)}`,
        { body: operations, expectedStatus: 200 },
      );
    },
    workItemUrl(id) {
      return `${basePath}/_apis/wit/workItems/${id}`;
    },
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatAdoError(method, url, status, payload) {
  const message = typeof payload === "string"
    ? payload
    : payload?.message || payload?.errorCode || JSON.stringify(payload);
  return `${method} ${url.pathname}${url.search} failed with ${status}: ${message}`;
}

async function validateRemoteMappings(ado, config) {
  const availableTypes = await ado.getWorkItemTypes();
  const typeNames = new Set(availableTypes.map((item) => item.name));
  const requiredTypes = new Set([
    config.artifactMappings.REQ.workItemType,
    config.artifactMappings.FEAT.workItemType,
    config.artifactMappings.US.functional.workItemType,
    config.artifactMappings.US.nfr.workItemType,
  ]);

  const missing = [...requiredTypes].filter((name) => !typeNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Azure DevOps project '${config.project}' does not expose these configured work item types: ${missing.join(", ")}.`);
  }

  return typeNames;
}

async function resolveUseCaseDirectories(targetArg) {
  const resolved = path.resolve(WORKSPACE_ROOT, targetArg);
  const stats = await statOrNull(resolved);
  if (!stats) {
    throw new Error(`Path not found: ${targetArg}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Expected a directory path, got file: ${targetArg}`);
  }

  const artifactsHere = await listArtifactFiles(resolved);
  if (artifactsHere.length > 0) {
    return [resolved];
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resolved, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  const validDirs = [];
  for (const dir of dirs) {
    const artifactFiles = await listArtifactFiles(dir);
    if (artifactFiles.length > 0) {
      validDirs.push(dir);
    }
  }

  return validDirs;
}

async function processUseCaseDirectory(useCaseDir, config, ado) {
  const relativeDir = path.relative(WORKSPACE_ROOT, useCaseDir) || path.basename(useCaseDir);
  const artifactFiles = await listArtifactFiles(useCaseDir);
  if (artifactFiles.length === 0) {
    throw new Error(`No REQ, FEAT, or US artifacts found in ${relativeDir}.`);
  }

  const artifacts = [];
  for (const filePath of artifactFiles) {
    artifacts.push(await parseArtifact(filePath, useCaseDir));
  }

  validateArtifacts(artifacts, relativeDir, config);

  const statePath = path.join(useCaseDir, STATE_FILE_NAME);
  const state = await readStateFile(statePath);
  const warnings = [];
  const existingRelationsCache = new Map();
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  let created = 0;
  let reused = 0;
  let linked = 0;
  let skippedLinks = 0;

  for (const artifact of artifacts) {
    const mapping = getArtifactMapping(config, artifact);
    const saved = state.artifacts[artifact.id];

    if (saved?.workItemId) {
      artifact.workItemId = saved.workItemId;
      artifact.workItemUrl = saved.workItemUrl || ado.workItemUrl(saved.workItemId);
      reused += 1;
      continue;
    }

    const operations = buildCreateOperations(config, mapping, artifact);
    if (config.validateOnly) {
      warnings.push(`Validation only: skipped create for ${artifact.id} (${mapping.workItemType}).`);
      continue;
    }

    const createdItem = await ado.createWorkItem(mapping.workItemType, operations);
    artifact.workItemId = createdItem.id;
    artifact.workItemUrl = createdItem.url || ado.workItemUrl(createdItem.id);
    state.artifacts[artifact.id] = {
      kind: artifact.kind,
      subkind: artifact.subkind,
      title: artifact.title,
      workItemId: artifact.workItemId,
      workItemUrl: artifact.workItemUrl,
      sourceFile: path.basename(artifact.filePath),
    };
    created += 1;
  }

  for (const artifact of artifacts) {
    const mapping = getArtifactMapping(config, artifact);
    const desiredLinks = buildDesiredLinks(artifact, artifactMap, mapping, warnings);
    if (desiredLinks.length === 0) {
      continue;
    }

    if (config.validateOnly) {
      skippedLinks += desiredLinks.length;
      continue;
    }

    if (!artifact.workItemId) {
      throw new Error(`Cannot link ${artifact.id} because it has no Azure DevOps work item ID.`);
    }

    const existingKeys = await getExistingRelationKeys(ado, artifact, existingRelationsCache);
    const operations = [];

    for (const link of desiredLinks) {
      if (!link.target.workItemId) {
        throw new Error(`Cannot link ${artifact.id} to ${link.target.id} because the target has no Azure DevOps work item ID.`);
      }
      const relationUrl = ado.workItemUrl(link.target.workItemId);
      const relationKey = `${link.rel}|${relationUrl}`;
      if (existingKeys.has(relationKey)) {
        skippedLinks += 1;
        continue;
      }
      operations.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: link.rel,
          url: relationUrl,
          attributes: {
            comment: `Linked from ${artifact.id}`,
          },
        },
      });
      existingKeys.add(relationKey);
    }

    if (operations.length > 0) {
      await ado.updateWorkItem(artifact.workItemId, operations);
      linked += operations.length;
    }
  }

  if (!config.validateOnly) {
    state.useCase = path.basename(useCaseDir);
    state.lastUploadAt = new Date().toISOString();
    state.project = config.project;
    state.organization = config.organization;
    state.validateOnly = false;
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  printUseCaseSummary(relativeDir, artifacts, { created, reused, linked, skippedLinks, warnings, validateOnly: config.validateOnly });

  return {
    useCaseDir: relativeDir,
    artifacts,
    created,
    reused,
    linked,
    skippedLinks,
    warnings,
  };
}

async function listArtifactFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^(REQ|FEAT|US)-.+\.md$/i.test(name))
    .sort(compareArtifactNames)
    .map((name) => path.join(dirPath, name));
}

function compareArtifactNames(a, b) {
  const kindA = a.split("-")[0].toUpperCase();
  const kindB = b.split("-")[0].toUpperCase();
  const rankA = ARTIFACT_ORDER.indexOf(kindA);
  const rankB = ARTIFACT_ORDER.indexOf(kindB);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function parseArtifact(filePath, useCaseDir) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const fileName = path.basename(filePath);
  const match = fileName.match(/^(REQ|FEAT|US)-[^.]+\.md$/i);
  if (!match) {
    throw new Error(`Unsupported artifact file name: ${fileName}`);
  }

  const kind = match[1].toUpperCase();
  const headingLine = lines.find((line) => line.startsWith("# ")) || "";
  const headingMatch = headingLine.match(/^#\s+([A-Z]+-\d+):\s*(.+)$/);
  const id = headingMatch?.[1] || fileName.replace(/\.md$/i, "");
  const title = (headingMatch?.[2] || fileName.replace(/\.md$/i, "")).trim();
  const metadata = extractMetadata(lines);
  const sections = extractSections(lines);
  const rawTags = splitCsv(metadata.Tags);
  const subkind = kind === "US" && !rawTags.some((tag) => tag.toLowerCase() === "functional") ? "nfr" : "functional";

  return {
    id,
    kind,
    subkind,
    filePath,
    useCaseDir,
    useCaseSlug: path.basename(useCaseDir),
    title,
    description: sections.Description || "",
    acceptanceCriteria: extractAcceptanceCriteria(sections["Acceptance Criteria"] || ""),
    priority: normalizePriority(metadata.Priority),
    tags: rawTags,
    requirementRefs: splitCsv(metadata["Requirement-Refs"]),
    featureRefs: splitCsv(metadata["Feature-Refs"]),
  };
}

function extractMetadata(lines) {
  const metadata = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) {
      break;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    metadata[key] = value;
  }
  return metadata;
}

function extractSections(lines) {
  const sections = {};
  let current = null;
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      current = sectionMatch[1].trim();
      sections[current] = [];
      continue;
    }
    if (current) {
      sections[current].push(line);
    }
  }
  const normalized = {};
  for (const [key, value] of Object.entries(sections)) {
    normalized[key] = value.join("\n").trim();
  }
  return normalized;
}

function extractAcceptanceCriteria(sectionText) {
  if (!sectionText) {
    return [];
  }
  return sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-\s*/, ""));
}

function splitCsv(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePriority(priority) {
  const normalized = String(priority || "medium").trim().toLowerCase();
  return PRIORITY_MAP[normalized] ? normalized : "medium";
}

function validateArtifacts(artifacts, relativeDir, config) {
  const ids = new Set();
  const byId = new Map();

  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID '${artifact.id}' in ${relativeDir}.`);
    }
    ids.add(artifact.id);
    byId.set(artifact.id, artifact);
  }

  for (const artifact of artifacts) {
    for (const ref of artifact.requirementRefs) {
      const target = byId.get(ref);
      if (!target || target.kind !== "REQ") {
        throw new Error(`${artifact.id} references missing requirement '${ref}' in ${relativeDir}.`);
      }
    }
    for (const ref of artifact.featureRefs) {
      const target = byId.get(ref);
      if (!target || target.kind !== "FEAT") {
        throw new Error(`${artifact.id} references missing feature '${ref}' in ${relativeDir}.`);
      }
    }
  }

  for (const artifact of artifacts) {
    const mapping = getArtifactMapping(config, artifact);
    if (!mapping.parentKind) {
      continue;
    }
    const parent = resolveParentArtifact(artifact, byId, mapping.parentKind);
    if (!parent) {
      throw new Error(`${artifact.id} requires a parent of kind '${mapping.parentKind}' based on mapping, but none could be resolved.`);
    }
  }
}

function getArtifactMapping(config, artifact) {
  if (artifact.kind === "REQ") {
    return config.artifactMappings.REQ;
  }
  if (artifact.kind === "FEAT") {
    return config.artifactMappings.FEAT;
  }
  return artifact.subkind === "nfr"
    ? config.artifactMappings.US.nfr
    : config.artifactMappings.US.functional;
}

function resolveParentArtifact(artifact, artifactMap, parentKind) {
  if (!parentKind) {
    return null;
  }

  const refs = parentKind === "REQ" ? artifact.requirementRefs : artifact.featureRefs;
  if (refs.length > 0) {
    return artifactMap.get(refs[0]) || null;
  }

  if (artifact.kind === "US" && parentKind === "FEAT") {
    const fallback = [...artifactMap.values()].find((item) => item.kind === "FEAT");
    return fallback || null;
  }

  return null;
}

function buildCreateOperations(config, mapping, artifact) {
  const fields = buildMappedFields(config, mapping, artifact);
  return Object.entries(fields).map(([field, value]) => ({
    op: "add",
    path: `/fields/${field}`,
    value,
  }));
}

function buildMappedFields(config, mapping, artifact) {
  const fields = {};
  const input = {
    artifactId: artifact.id,
    title: artifact.title,
    description: markdownToHtml(artifact.description),
    acceptanceCriteria: acceptanceCriteriaToHtml(artifact.acceptanceCriteria),
    priority: mapPriorityValue(artifact.priority),
    tags: buildTagString(config, mapping, artifact),
    useCase: artifact.useCaseSlug,
  };

  for (const [sourceKey, targetField] of Object.entries(mapping.fieldMap || {})) {
    const value = input[sourceKey];
    if (value !== undefined && value !== null && value !== "") {
      fields[targetField] = value;
    }
  }

  if (config.areaPath && !fields["System.AreaPath"]) {
    fields["System.AreaPath"] = config.areaPath;
  }
  if (config.iterationPath && !fields["System.IterationPath"]) {
    fields["System.IterationPath"] = config.iterationPath;
  }

  for (const [field, value] of Object.entries(mapping.fixedFields || {})) {
    fields[field] = value;
  }

  return fields;
}

function markdownToHtml(text) {
  if (!text) {
    return "";
  }

  const lines = text.split(/\r?\n/);
  const chunks = [];
  let listBuffer = [];
  let paragraphBuffer = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      chunks.push(`<p>${escapeHtml(paragraphBuffer.join(" "))}</p>`);
      paragraphBuffer = [];
    }
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      chunks.push(`<ul>${listBuffer.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      listBuffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushParagraph();
      listBuffer.push(trimmed.replace(/^-\s*/, ""));
      continue;
    }
    flushList();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();
  return chunks.join("");
}

function acceptanceCriteriaToHtml(criteria) {
  if (!criteria || criteria.length === 0) {
    return "";
  }
  return `<ul>${criteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildTagString(config, mapping, artifact) {
  const merged = new Set();
  for (const tag of config.tags || []) {
    if (tag) merged.add(tag);
  }
  merged.add(artifact.id);
  for (const tag of artifact.tags || []) {
    if (tag) merged.add(tag);
  }
  for (const tag of mapping.extraTags || []) {
    if (tag) merged.add(tag);
  }
  return [...merged].join("; ");
}

function mapPriorityValue(priority) {
  return PRIORITY_MAP[priority] || PRIORITY_MAP.medium;
}

function buildDesiredLinks(artifact, artifactMap, mapping, warnings) {
  const links = [];
  const parent = resolveParentArtifact(artifact, artifactMap, mapping.parentKind);
  if (parent && mapping.parentRelation) {
    if (artifact.kind === "US" && artifact.subkind === "nfr" && artifact.featureRefs.length === 0) {
      warnings.push(`Inferred FEAT parent for ${artifact.id} as ${parent.id} because Feature-Refs is missing.`);
    }
    links.push({ rel: mapping.parentRelation, target: parent });
  }

  if (artifact.kind === "US" && artifact.featureRefs.length > 1) {
    const secondaryRefs = artifact.featureRefs.slice(1);
    for (const ref of secondaryRefs) {
      const target = artifactMap.get(ref);
      if (target) {
        links.push({ rel: "System.LinkTypes.Related", target });
      }
    }
  }

  return dedupeLinks(links);
}

function dedupeLinks(links) {
  const seen = new Set();
  const unique = [];
  for (const link of links) {
    const key = `${link.rel}|${link.target.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(link);
  }
  return unique;
}

async function readStateFile(statePath) {
  const existing = await statOrNull(statePath);
  if (!existing) {
    return { artifacts: {} };
  }

  const raw = await fs.readFile(statePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      artifacts: parsed.artifacts && typeof parsed.artifacts === "object" ? parsed.artifacts : {},
    };
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(WORKSPACE_ROOT, statePath)}: ${error.message}`);
  }
}

async function getExistingRelationKeys(ado, artifact, cache) {
  if (cache.has(artifact.workItemId)) {
    return cache.get(artifact.workItemId);
  }
  const workItem = await ado.getWorkItem(artifact.workItemId, true);
  const keys = new Set((workItem.relations || []).map((relation) => `${relation.rel}|${relation.url}`));
  cache.set(artifact.workItemId, keys);
  return keys;
}

function printUseCaseSummary(useCaseDir, artifacts, result) {
  console.log(`\n[${useCaseDir}] ${result.validateOnly ? "validation only" : "uploaded"}`);
  console.log(`- artifacts: ${artifacts.length}`);
  console.log(`- created: ${result.created}`);
  console.log(`- reused: ${result.reused}`);
  console.log(`- linked: ${result.linked}`);
  console.log(`- skipped links: ${result.skippedLinks}`);
  for (const artifact of artifacts) {
    const status = artifact.workItemId ? `ADO ${artifact.workItemId}` : "pending";
    const suffix = artifact.workItemUrl ? ` ${artifact.workItemUrl}` : "";
    console.log(`- ${artifact.id}: ${status}${suffix}`);
  }
  for (const warning of result.warnings) {
    console.log(`! ${warning}`);
  }
}

function printOverallSummary(overall, validateOnly) {
  console.log("\nOverall");
  console.log(`- mode: ${validateOnly ? "validate-only" : "upload"}`);
  console.log(`- use cases: ${overall.processed.length}`);
  console.log(`- created: ${overall.created}`);
  console.log(`- reused: ${overall.reused}`);
  console.log(`- linked: ${overall.linked}`);
  console.log(`- skipped links: ${overall.skippedLinks}`);
}

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(`Azure DevOps upload failed: ${error.message}`);
  process.exitCode = 1;
});

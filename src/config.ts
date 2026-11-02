import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { findNodeAtLocation, parse, parseTree, visit, type ParseError } from "jsonc-parser";

export type PluginConfigSource = "server" | "tui";

export interface PluginItem {
  id: string;
  pkg: string;
  enabled: boolean;
  options?: Record<string, unknown>;
  offset: number;
  length: number;
  raw: string;
  source?: PluginConfigSource;
  configPath?: string;
}

export function extractPluginId(pkg: string): string {
  if (pkg.startsWith("file://")) {
    let clean = pkg.slice("file://".length).replace(/\/+$/, "");
    if (clean.endsWith("/dist")) {
      clean = clean.slice(0, -"/dist".length);
    }
    return basename(clean);
  }
  // npm packages, e.g. @opencode/plugin-foo or opencode-foo
  return pkg.replace(/^@[\w.-]+\//, "");
}

export function isSelfPlugin(pkg: string): boolean {
  const lower = pkg.toLowerCase();
  return lower.includes("better-plugins") || lower.includes("opencode-better-plugins");
}

function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg || join(homedir(), ".config"), "opencode");
}

export function findConfigFile(preferredPath?: string): string | null {
  if (preferredPath && existsSync(preferredPath)) {
    return preferredPath;
  }

  const globalDir = globalConfigDir();
  const candidates = [
    join(globalDir, "opencode.jsonc"),
    join(globalDir, "opencode.json"),
    resolve("opencode.jsonc"),
    resolve("opencode.json"),
    resolve(".opencode", "opencode.jsonc"),
    resolve(".opencode", "opencode.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function findTuiConfigFile(preferredPath?: string): string | null {
  if (preferredPath && existsSync(preferredPath)) {
    return preferredPath;
  }
  const candidate = join(globalConfigDir(), "cli.json");
  return existsSync(candidate) ? candidate : null;
}

export interface ConfigFileEntry {
  path: string;
  source: PluginConfigSource;
}

export function findAllConfigFiles(): ConfigFileEntry[] {
  const entries: ConfigFileEntry[] = [];
  const serverPath = findConfigFile();
  if (serverPath) entries.push({ path: serverPath, source: "server" });
  const tuiPath = findTuiConfigFile();
  if (tuiPath && tuiPath !== serverPath) entries.push({ path: tuiPath, source: "tui" });
  return entries;
}

export function validateJsonc(content: string): { valid: boolean; errors: ParseError[] } {
  const errors: ParseError[] = [];
  parse(content, errors, { allowTrailingComma: true });
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function parsePluginItems(
  content: string,
  meta?: { source?: PluginConfigSource; configPath?: string }
): PluginItem[] {
  const tree = parseTree(content);
  if (!tree) return [];

  const pluginsNode = findNodeAtLocation(tree, ["plugins"]);
  if (!pluginsNode || !pluginsNode.children) return [];

  const items: PluginItem[] = [];

  // 1. Active plugins in AST
  for (const child of pluginsNode.children) {
    const raw = content.slice(child.offset, child.offset + child.length);
    const val = parse(raw);
    const pkg = typeof val === "string" ? val : val?.package;
    if (pkg && !isSelfPlugin(pkg)) {
      items.push({
        id: extractPluginId(pkg),
        pkg,
        enabled: true,
        options: typeof val === "object" && val !== null ? (val.options as Record<string, unknown> | undefined) : undefined,
        offset: child.offset,
        length: child.length,
        raw,
        ...(meta?.source ? { source: meta.source } : {}),
        ...(meta?.configPath ? { configPath: meta.configPath } : {}),
      });
    }
  }

  // 2. Disabled plugins in comments
  visit(content, {
    onComment(offset, length) {
      if (offset >= pluginsNode.offset && offset <= pluginsNode.offset + pluginsNode.length) {
        const commentRaw = content.slice(offset, offset + length);
        let inner: string | null = null;

        if (commentRaw.startsWith("/*") && commentRaw.endsWith("*/")) {
          inner = commentRaw.slice(2, -2).trim();
          if (inner.startsWith("@disabled")) {
            inner = inner.slice("@disabled".length).trim();
          }
        } else if (commentRaw.startsWith("//")) {
          inner = commentRaw.slice(2).trim();
          if (inner.startsWith("@disabled")) {
            inner = inner.slice("@disabled".length).trim();
          }
        }

        if (inner) {
          const cleaned = inner.replace(/,\s*$/, "");
          const val = parse(cleaned);
          const pkg = typeof val === "string" ? val : val?.package;
          if (pkg && !isSelfPlugin(pkg)) {
            items.push({
              id: extractPluginId(pkg),
              pkg,
              enabled: false,
              options:
                typeof val === "object" && val !== null
                  ? (val.options as Record<string, unknown> | undefined)
                  : undefined,
              offset,
              length,
              raw: commentRaw,
              ...(meta?.source ? { source: meta.source } : {}),
              ...(meta?.configPath ? { configPath: meta.configPath } : {}),
            });
          }
        }
      }
    },
  });

  return items.sort((a, b) => a.offset - b.offset);
}

export function togglePlugin(
  content: string,
  target: PluginItem
): { newContent: string; toggledTo: boolean } {
  if (target.enabled) {
    // Disable plugin: wrap in /* @disabled ... */
    let end = target.offset + target.length;
    const rest = content.slice(end);
    const match = rest.match(/^(\s*,)/);
    if (match) {
      end += match[1].length;
    }

    const textToComment = content.slice(target.offset, end).trimEnd();
    const before = content.slice(0, target.offset);
    const after = content.slice(end);

    const replacement = `/* @disabled\n    ${textToComment}\n    */`;
    const newContent = before + replacement + after;

    const validation = validateJsonc(newContent);
    if (!validation.valid) {
      throw new Error(`Disabling ${target.id} would produce invalid JSONC: ${JSON.stringify(validation.errors)}`);
    }

    return { newContent, toggledTo: false };
  } else {
    // Enable plugin: strip comment markers
    let inner = target.raw;
    if (inner.startsWith("/*") && inner.endsWith("*/")) {
      inner = inner.slice(2, -2).trim();
    } else if (inner.startsWith("//")) {
      inner = inner.slice(2).trim();
    }

    if (inner.startsWith("@disabled")) {
      inner = inner.slice("@disabled".length).trim();
    }

    const before = content.slice(0, target.offset);
    const after = content.slice(target.offset + target.length);
    // Ensure a trailing comma (valid in OpenCode's JSONC parser for both
    // opencode.jsonc and cli.json), without duplicating an existing comma.
    inner = inner.replace(/,\s*$/, "");
    if (!after.match(/^\s*,/)) {
      inner += ",";
    }

    const newContent = before + inner + after;

    const validation = validateJsonc(newContent);
    if (!validation.valid) {
      throw new Error(`Enabling ${target.id} would produce invalid JSONC: ${JSON.stringify(validation.errors)}`);
    }

    return { newContent, toggledTo: true };
  }
}

export function readConfigFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

export function writeConfigFile(filePath: string, content: string): void {
  const validation = validateJsonc(content);
  if (!validation.valid) {
    throw new Error(`Refusing to write invalid JSONC to ${filePath}`);
  }
  writeFileSync(filePath, content, "utf8");
}

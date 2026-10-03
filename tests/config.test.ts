import { describe, expect, it } from "bun:test";
import {
  extractPluginId,
  isSelfPlugin,
  parsePluginItems,
  togglePlugin,
  validateJsonc,
} from "../src/config.js";

describe("config plugin manager", () => {
  it("extracts clean plugin identifiers", () => {
    expect(extractPluginId("file:///Users/krishna/Dev/opencode-antigravity/dist")).toBe("opencode-antigravity");
    expect(extractPluginId("file:///Users/krishna/Dev/opencode-todos/dist/")).toBe("opencode-todos");
    expect(extractPluginId("@opencode/plugin-foo")).toBe("plugin-foo");
    expect(extractPluginId("simple-plugin")).toBe("simple-plugin");
  });

  it("identifies self plugin to filter it out", () => {
    expect(isSelfPlugin("file:///Users/krishna/Dev/opencode-better-plugins/dist")).toBe(true);
    expect(isSelfPlugin("better-plugins")).toBe(true);
    expect(isSelfPlugin("opencode-better-plugins")).toBe(true);
    expect(isSelfPlugin("opencode-antigravity")).toBe(false);
  });

  it("parses active and disabled plugins from jsonc", () => {
    const jsonc = `{
  "model": "antigravity-proxy/gemini",
  "plugins": [
    {
      "package": "file:///Users/krishna/Dev/opencode-antigravity/dist",
      "options": { "port": 7438 }
    },
    /* @disabled
    {
      "package": "file:///Users/krishna/Dev/opencode-claude-proxy/dist",
      "options": { "port": 7439 }
    },
    */
    {
      "package": "file:///Users/krishna/Dev/opencode-better-plugins/dist"
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-codex/dist"
    }
  ]
}`;

    const items = parsePluginItems(jsonc);
    // opencode-better-plugins should be filtered out
    expect(items.length).toBe(3);

    const [antigravity, claudeProxy, codex] = items;
    expect(antigravity.id).toBe("opencode-antigravity");
    expect(antigravity.enabled).toBe(true);
    expect(antigravity.options).toEqual({ port: 7438 });

    expect(claudeProxy.id).toBe("opencode-claude-proxy");
    expect(claudeProxy.enabled).toBe(false);
    expect(claudeProxy.options).toEqual({ port: 7439 });

    expect(codex.id).toBe("opencode-codex");
    expect(codex.enabled).toBe(true);
  });

  it("toggles active to disabled and disabled to active while maintaining valid JSONC", () => {
    let jsonc = `{
  "model": "test-model",
  "plugins": [
    {
      "package": "file:///Users/krishna/Dev/opencode-antigravity/dist",
      "options": { "port": 7438 }
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-claude-proxy/dist",
      "options": { "port": 7439 }
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-codex/dist"
    }
  ]
}`;

    // 1. Disable middle plugin
    let items = parsePluginItems(jsonc);
    const claude = items.find((p) => p.id === "opencode-claude-proxy")!;
    expect(claude.enabled).toBe(true);

    const res1 = togglePlugin(jsonc, claude);
    expect(res1.toggledTo).toBe(false);
    jsonc = res1.newContent;

    const val1 = validateJsonc(jsonc);
    expect(val1.valid).toBe(true);

    // Verify it is now disabled in parsed items
    items = parsePluginItems(jsonc);
    const claudeDisabled = items.find((p) => p.id === "opencode-claude-proxy")!;
    expect(claudeDisabled.enabled).toBe(false);
    expect(claudeDisabled.options).toEqual({ port: 7439 });

    // 2. Disable first plugin
    const antigrav = items.find((p) => p.id === "opencode-antigravity")!;
    const res2 = togglePlugin(jsonc, antigrav);
    jsonc = res2.newContent;
    expect(validateJsonc(jsonc).valid).toBe(true);

    // 3. Disable last plugin
    items = parsePluginItems(jsonc);
    const codex = items.find((p) => p.id === "opencode-codex")!;
    const res3 = togglePlugin(jsonc, codex);
    jsonc = res3.newContent;
    expect(validateJsonc(jsonc).valid).toBe(true);

    items = parsePluginItems(jsonc);
    expect(items.every((p) => !p.enabled)).toBe(true);

    // 4. Re-enable all plugins one by one
    for (const item of items) {
      const currentList = parsePluginItems(jsonc);
      const target = currentList.find((p) => p.id === item.id)!;
      const res = togglePlugin(jsonc, target);
      jsonc = res.newContent;
      expect(validateJsonc(jsonc).valid).toBe(true);
    }

    const finalItems = parsePluginItems(jsonc);
    expect(finalItems.every((p) => p.enabled)).toBe(true);
    expect(finalItems.length).toBe(3);
  });

  it("handles user's actual opencode.jsonc structure without corruption", () => {
    const actualJsonc = `{
  "$schema": "https://opencode.ai/config.json",
  "lsp": true,
  "model": "antigravity-proxy/antigravity-gemini-3.8-flash",
  "default_agent": "plan",
  "plugins": [
    {
      "package": "file:///Users/krishna/Dev/opencode-antigravity/dist",
      "options": { "port": 7438, "systemPrompt": "prompts/antigravity.md" }
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-claude-proxy/dist",
      "options": { "port": 7439 }
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-codex/dist",
      "options": { "port": 7440 }
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-commandcode/dist",
      "options": { "port": 7442 }
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-claude-memory/dist"
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-hud/dist"
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-todos/dist"
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-session-ref/dist"
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-artifact/dist"
    },
    {
      "package": "file:///Users/krishna/Dev/opencode-warp/dist"
    }
  ]
}`;

    let content = actualJsonc;
    let items = parsePluginItems(content);
    expect(items.length).toBe(10);

    // Disable todos and session-ref
    const todos = items.find((p) => p.id === "opencode-todos")!;
    content = togglePlugin(content, todos).newContent;

    items = parsePluginItems(content);
    const sessionRef = items.find((p) => p.id === "opencode-session-ref")!;
    content = togglePlugin(content, sessionRef).newContent;

    expect(validateJsonc(content).valid).toBe(true);

    items = parsePluginItems(content);
    expect(items.find((p) => p.id === "opencode-todos")?.enabled).toBe(false);
    expect(items.find((p) => p.id === "opencode-session-ref")?.enabled).toBe(false);
    expect(items.find((p) => p.id === "opencode-antigravity")?.enabled).toBe(true);

    // Re-enable todos
    const todosDisabled = items.find((p) => p.id === "opencode-todos")!;
    content = togglePlugin(content, todosDisabled).newContent;
    expect(validateJsonc(content).valid).toBe(true);

    items = parsePluginItems(content);
    expect(items.find((p) => p.id === "opencode-todos")?.enabled).toBe(true);
    expect(items.find((p) => p.id === "opencode-session-ref")?.enabled).toBe(false);
  });
});

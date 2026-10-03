/** @jsxImportSource @opentui/solid */

import { RGBA, TextAttributes } from "@opentui/core";
import { Plugin } from "@opencode/plugin/tui";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import {
  findConfigFile,
  parsePluginItems,
  readConfigFile,
  togglePlugin,
  writeConfigFile,
  type PluginItem,
} from "./config.js";

type Ctx = Plugin.Context;

const id = "better-plugins";
const PAGE_SIZE = 8;

interface ThemePalette {
  headerBg: RGBA;
  bodyBg: RGBA;
  selectedBg: RGBA;
  textColor: RGBA;
  mutedColor: RGBA;
  successColor: RGBA;
}

function getColors(ctx: Ctx): ThemePalette {
  const isLight = ctx.themeMode === "light";
  if (isLight) {
    return {
      headerBg: RGBA.fromHex("#f4f5f9"),
      bodyBg: RGBA.fromHex("#e2e4ed"),
      selectedBg: RGBA.fromHex("#cdd0e0"),
      textColor: RGBA.fromHex("#1a1a1a"),
      mutedColor: RGBA.fromHex("#70707d"),
      successColor: RGBA.fromHex("#188554"),
    };
  }
  return {
    headerBg: RGBA.fromHex("#12131e"),
    bodyBg: RGBA.fromHex("#2b2e42"),
    selectedBg: RGBA.fromHex("#3e4362"),
    textColor: RGBA.fromHex("#eeeeee"),
    mutedColor: RGBA.fromHex("#8c90a8"),
    successColor: RGBA.fromHex("#77c599"),
  };
}

function formatDetails(p: PluginItem): string {
  if (p.options && typeof p.options === "object") {
    const parts = Object.entries(p.options).map(
      ([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`
    );
    return parts.join(", ");
  }
  return "";
}

interface DialogProps {
  ctx: Ctx;
  configPath: string;
  onClose: () => void;
}

function PluginManagerDialog(props: DialogProps): JSX.Element {
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [plugins, setPlugins] = createSignal<PluginItem[]>([]);
  const [loading, setLoading] = createSignal<string | null>(null);

  const colors = createMemo(() => getColors(props.ctx));

  const loadPlugins = () => {
    try {
      const content = readConfigFile(props.configPath);
      const items = parsePluginItems(content);
      setPlugins(items);
    } catch (err) {
      props.ctx.ui.toast.show({
        title: "Plugins Manager",
        message: `Erreur lecture config: ${err instanceof Error ? err.message : String(err)}`,
        variant: "error",
      });
    }
  };

  onMount(() => {
    props.ctx.ui.dialog.set({ size: "large" });
    loadPlugins();
  });

  const filtered = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const list = plugins();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.pkg.toLowerCase().includes(q)
    );
  });

  // Clamp selected index when filter changes
  createEffect(() => {
    const total = filtered().length;
    if (total === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex() >= total) {
      setSelectedIndex(total - 1);
    }
  });

  const startIndex = createMemo(() => {
    const idx = selectedIndex();
    const total = filtered().length;
    if (total <= PAGE_SIZE) return 0;
    return Math.min(Math.max(0, idx - Math.floor(PAGE_SIZE / 2)), total - PAGE_SIZE);
  });

  const visibleItems = createMemo(() => {
    const start = startIndex();
    return filtered().slice(start, start + PAGE_SIZE);
  });

  const activeCount = createMemo(() => plugins().filter((p) => p.enabled).length);

  const toggle = async (p: PluginItem) => {
    if (loading()) return;
    setLoading(p.id);
    props.ctx.renderer.requestRender();

    try {
      const content = readConfigFile(props.configPath);
      const latestItems = parsePluginItems(content);
      const freshTarget = latestItems.find((item) => item.id === p.id);

      if (!freshTarget) {
        throw new Error(`Plugin "${p.id}" introuvable dans ${props.configPath}`);
      }

      const { newContent, toggledTo } = togglePlugin(content, freshTarget);
      writeConfigFile(props.configPath, newContent);

      const refreshed = parsePluginItems(newContent);
      setPlugins(refreshed);

      await props.ctx.client.location.reload();

      props.ctx.ui.toast.show({
        title: "Plugins Manager",
        message: `${p.id} ${toggledTo ? "activé" : "désactivé"}`,
        variant: "success",
        duration: 2000,
      });
    } catch (err) {
      props.ctx.ui.toast.show({
        title: "Plugins Manager",
        message: `Erreur: ${err instanceof Error ? err.message : String(err)}`,
        variant: "error",
        duration: 3500,
      });
    } finally {
      setLoading(null);
      props.ctx.renderer.requestRender();
    }
  };

  const onKey = (event: any) => {
    if (event.name === "escape" || (event.ctrl && (event.name === "c" || event.name === "g"))) {
      props.onClose();
      return;
    }

    if (event.ctrl && event.name === "u") {
      setFilter("");
      setSelectedIndex(0);
      props.ctx.renderer.requestRender();
      return;
    }

    if (event.name === "up" || (event.name === "k" && event.ctrl)) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      props.ctx.renderer.requestRender();
      return;
    }

    if (event.name === "down" || (event.name === "j" && event.ctrl)) {
      setSelectedIndex((prev) => Math.min(Math.max(0, filtered().length - 1), prev + 1));
      props.ctx.renderer.requestRender();
      return;
    }

    if (event.name === "space" || event.name === "return" || event.name === "enter") {
      const list = filtered();
      const target = list[selectedIndex()];
      if (target) {
        void toggle(target);
      }
      return;
    }

    if (event.name === "backspace") {
      setFilter((prev) => prev.slice(0, -1));
      props.ctx.renderer.requestRender();
      return;
    }

    if (event.sequence && event.sequence.length === 1 && !event.ctrl && !event.meta) {
      setFilter((prev) => prev + event.sequence);
      props.ctx.renderer.requestRender();
      return;
    }
  };

  props.ctx.renderer.keyInput.prependListener("keypress", onKey);
  onCleanup(() => {
    props.ctx.renderer.keyInput.off("keypress", onKey);
  });

  return (
    <box flexDirection="column" width="100%" backgroundColor={colors().headerBg}>
      {/* 1. Header bar (Dark: #12131e) */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={0}
        paddingBottom={1}
        backgroundColor={colors().headerBg}
      >
        <box flexDirection="row" alignItems="center" backgroundColor={colors().headerBg}>
          <text fg={colors().textColor} attributes={TextAttributes.BOLD}>
            /better-plugins
          </text>
          <Show when={filter()}>
            <text fg={colors().textColor}> {filter()}</text>
          </Show>
        </box>
        <text fg={colors().mutedColor} onMouseUp={() => props.onClose()}>
          esc
        </text>
      </box>

      {/* 2. Middle Body (Lighter elevated container: #2b2e42) */}
      <box
        flexDirection="column"
        backgroundColor={colors().bodyBg}
        paddingTop={1}
        paddingBottom={1}
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <box paddingLeft={2} paddingRight={2} backgroundColor={colors().bodyBg}>
              <text fg={colors().mutedColor}>Aucun plugin ne correspond à la recherche.</text>
            </box>
          }
        >
          <For each={visibleItems()}>
            {(p, visibleIdx) => {
              const actualIdx = () => startIndex() + visibleIdx();
              const isSelected = () => actualIdx() === selectedIndex();
              const isBusy = () => loading() === p.id;
              const rowBg = () => (isSelected() ? colors().selectedBg : colors().bodyBg);

              return (
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  paddingLeft={2}
                  paddingRight={2}
                  backgroundColor={rowBg()}
                  onMouseUp={() => void toggle(p)}
                >
                  <box flexDirection="row" alignItems="center" backgroundColor={rowBg()}>
                    <Show when={!isBusy()} fallback={<text fg={colors().mutedColor}>⋯ </text>}>
                      <Show
                        when={p.enabled}
                        fallback={<text fg={colors().mutedColor}>○ </text>}
                      >
                        <text fg={colors().successColor} attributes={TextAttributes.BOLD}>
                          ●{" "}
                        </text>
                      </Show>
                    </Show>
                    <text
                      fg={p.enabled ? colors().textColor : colors().mutedColor}
                      attributes={isSelected() ? TextAttributes.BOLD : undefined}
                    >
                      {p.id}
                    </text>
                  </box>

                  <Show when={formatDetails(p)}>
                    <box backgroundColor={rowBg()} marginLeft={2} flexShrink={1}>
                      <text fg={colors().mutedColor} truncate>
                        {formatDetails(p)}
                      </text>
                    </box>
                  </Show>
                </box>
              );
            }}
          </For>
        </Show>
      </box>

      {/* 3. Footer bar (Dark: #12131e) */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={colors().headerBg}
      >
        <box flexDirection="row" gap={2} backgroundColor={colors().headerBg}>
          <text fg={colors().textColor} attributes={TextAttributes.BOLD}>
            space <span style={{ fg: colors().mutedColor }}>toggle</span>
          </text>
          <text fg={colors().textColor} attributes={TextAttributes.BOLD}>
            ↑/↓ <span style={{ fg: colors().mutedColor }}>scroll</span>
          </text>
        </box>
        <text fg={colors().mutedColor}>
          {activeCount()}/{plugins().length} actifs
        </text>
      </box>
    </box>
  );
}

function openPluginManager(ctx: Ctx) {
  const configPath = findConfigFile();
  if (!configPath) {
    ctx.ui.toast.show({
      title: "Plugins Manager",
      message: "Fichier de configuration opencode.jsonc introuvable.",
      variant: "error",
    });
    return;
  }

  ctx.ui.dialog.show(
    () => <PluginManagerDialog ctx={ctx} configPath={configPath} onClose={() => ctx.ui.dialog.clear()} />,
    () => {}
  );
  ctx.ui.dialog.set({ size: "large" });
}

export default Plugin.define({
  id,
  setup(ctx) {
    ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "plugins.manage",
              title: "Manage Plugins",
              group: "Plugins",
              bind: false,
              slash: { name: "better-plugins" },
              run: () => openPluginManager(ctx),
            },
          ],
        }));
        return null;
      },
    });
  },
});

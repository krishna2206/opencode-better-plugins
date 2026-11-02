/**
 * better-plugins server plugin.
 *
 * Empty on purpose: OpenCode V2 requires a server entrypoint to load a local plugin,
 * while the interactive plugin manager UI lives in the TUI module (see tui.tsx).
 */

import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-better-plugins",
  setup: () => {},
});

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setWahaRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getWahaRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WAHA runtime not initialized");
  }
  return runtime;
}

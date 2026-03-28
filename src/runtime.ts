import type { PluginRuntime } from "./platform-types.js";

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

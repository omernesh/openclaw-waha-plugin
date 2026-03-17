/**
 * WAHA Plugin Module Registry
 *
 * Manages registered WahaModule instances. Provides:
 *  - register/unregister modules
 *  - enable/disable modules globally
 *  - query which modules are active for a given chat (via SQLite module_assignments)
 *
 * Singleton: use getModuleRegistry() — one registry per process.
 *
 * Added Phase 17 (2026-03-17). DO NOT CHANGE singleton pattern.
 */

import type { WahaModule } from "./module-types.js";
import { getDirectoryDb } from "./directory.js";

export class ModuleRegistry {
  private _modules: Map<string, WahaModule> = new Map();
  private _enabled: Map<string, boolean> = new Map();

  /**
   * Register a module. Defaults to enabled.
   * Calling registerModule with the same id replaces the previous registration.
   */
  registerModule(mod: WahaModule): void {
    this._modules.set(mod.id, mod);
    if (!this._enabled.has(mod.id)) {
      this._enabled.set(mod.id, true);
    }
  }

  /**
   * Unregister a module by id. No-op if not registered.
   */
  unregisterModule(id: string): void {
    this._modules.delete(id);
    this._enabled.delete(id);
  }

  /**
   * Return all registered modules with their enabled state.
   */
  listModules(): Array<{ id: string; name: string; description: string; version: string; enabled: boolean }> {
    return Array.from(this._modules.values()).map((mod) => ({
      id: mod.id,
      name: mod.name,
      description: mod.description,
      version: mod.version,
      enabled: this._enabled.get(mod.id) ?? false,
    }));
  }

  /**
   * Enable a module globally. Has no effect on chat assignments.
   */
  enableModule(id: string): void {
    if (!this._modules.has(id)) return;
    this._enabled.set(id, true);
  }

  /**
   * Disable a module globally. The module will not fire even for assigned chats.
   */
  disableModule(id: string): void {
    if (!this._modules.has(id)) return;
    this._enabled.set(id, false);
  }

  /**
   * Return all enabled modules that have an assignment for the given chat.
   *
   * Queries DirectoryDb module_assignments table for the accountId to find which
   * module IDs are assigned to chatJid, then filters to only enabled registered modules.
   *
   * Returns [] if no modules are registered or none are assigned+enabled.
   */
  getModulesForChat(accountId: string, chatJid: string): WahaModule[] {
    if (this._modules.size === 0) return [];

    const db = getDirectoryDb(accountId);
    const assignedIds = db.getChatModules(chatJid);
    if (assignedIds.length === 0) return [];

    const result: WahaModule[] = [];
    for (const id of assignedIds) {
      const mod = this._modules.get(id);
      if (mod && this._enabled.get(id) === true) {
        result.push(mod);
      }
    }
    return result;
  }
}

// Module-level singleton
let _registryInstance: ModuleRegistry | null = null;

/**
 * Get the process-wide module registry singleton.
 * Always use this — do NOT instantiate ModuleRegistry directly.
 */
export function getModuleRegistry(): ModuleRegistry {
  if (!_registryInstance) {
    _registryInstance = new ModuleRegistry();
  }
  return _registryInstance;
}

/**
 * Convenience re-exports for callers that only need specific functions.
 */
export function registerModule(mod: WahaModule): void {
  getModuleRegistry().registerModule(mod);
}

export function unregisterModule(id: string): void {
  getModuleRegistry().unregisterModule(id);
}

export function listModules(): ReturnType<ModuleRegistry["listModules"]> {
  return getModuleRegistry().listModules();
}

export function enableModule(id: string): void {
  getModuleRegistry().enableModule(id);
}

export function disableModule(id: string): void {
  getModuleRegistry().disableModule(id);
}

export function getModulesForChat(accountId: string, chatJid: string): WahaModule[] {
  return getModuleRegistry().getModulesForChat(accountId, chatJid);
}

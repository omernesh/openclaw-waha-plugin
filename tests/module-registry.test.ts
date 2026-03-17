import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock directory.js before importing module-registry
const mockDb = {
  getChatModules: vi.fn(() => []),
};

vi.mock("../src/directory.js", () => ({
  getDirectoryDb: () => mockDb,
}));

import { ModuleRegistry } from "../src/module-registry.js";
import type { WahaModule } from "../src/module-types.js";

function makeModule(overrides?: Partial<WahaModule>): WahaModule {
  return {
    id: "test-module",
    name: "Test Module",
    description: "A test module",
    version: "1.0.0",
    ...overrides,
  };
}

describe("ModuleRegistry", () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ModuleRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("registerModule", () => {
    it("stores a module", () => {
      const mod = makeModule({ id: "my-mod" });
      registry.registerModule(mod);

      const list = registry.listModules();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("my-mod");
    });

    it("defaults newly registered modules to enabled", () => {
      registry.registerModule(makeModule({ id: "new-mod" }));

      const list = registry.listModules();
      expect(list[0].enabled).toBe(true);
    });

    it("replaces module with same id on re-register", () => {
      registry.registerModule(makeModule({ id: "mod-1", name: "First" }));
      registry.registerModule(makeModule({ id: "mod-1", name: "Second" }));

      const list = registry.listModules();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("Second");
    });
  });

  describe("listModules", () => {
    it("returns all registered modules with metadata", () => {
      registry.registerModule(makeModule({ id: "mod-a", name: "Module A", description: "Desc A", version: "1.0.0" }));
      registry.registerModule(makeModule({ id: "mod-b", name: "Module B", description: "Desc B", version: "2.0.0" }));

      const list = registry.listModules();
      expect(list.length).toBe(2);

      const modA = list.find((m) => m.id === "mod-a");
      expect(modA).toBeDefined();
      expect(modA!.name).toBe("Module A");
      expect(modA!.description).toBe("Desc A");
      expect(modA!.version).toBe("1.0.0");
      expect(modA!.enabled).toBe(true);
    });

    it("returns empty array when no modules are registered", () => {
      expect(registry.listModules()).toEqual([]);
    });
  });

  describe("enableModule / disableModule", () => {
    it("disableModule sets enabled to false", () => {
      registry.registerModule(makeModule({ id: "mod-1" }));
      registry.disableModule("mod-1");

      const list = registry.listModules();
      expect(list[0].enabled).toBe(false);
    });

    it("enableModule re-enables a disabled module", () => {
      registry.registerModule(makeModule({ id: "mod-1" }));
      registry.disableModule("mod-1");
      registry.enableModule("mod-1");

      const list = registry.listModules();
      expect(list[0].enabled).toBe(true);
    });

    it("enableModule is a no-op for unregistered IDs", () => {
      // Should not throw
      registry.enableModule("nonexistent");
      expect(registry.listModules()).toEqual([]);
    });

    it("disableModule is a no-op for unregistered IDs", () => {
      // Should not throw
      registry.disableModule("nonexistent");
      expect(registry.listModules()).toEqual([]);
    });
  });

  describe("unregisterModule", () => {
    it("removes a registered module", () => {
      registry.registerModule(makeModule({ id: "mod-1" }));
      registry.unregisterModule("mod-1");

      expect(registry.listModules()).toEqual([]);
    });

    it("is a no-op for unregistered IDs", () => {
      registry.unregisterModule("nonexistent");
      expect(registry.listModules()).toEqual([]);
    });
  });

  describe("getModulesForChat", () => {
    it("returns modules assigned to a chat JID", () => {
      const modA = makeModule({ id: "mod-a", name: "Module A" });
      const modB = makeModule({ id: "mod-b", name: "Module B" });
      registry.registerModule(modA);
      registry.registerModule(modB);

      mockDb.getChatModules.mockReturnValue(["mod-a", "mod-b"]);

      const result = registry.getModulesForChat("test-account", "972544329000@c.us");
      expect(result.length).toBe(2);
      expect(result[0].id).toBe("mod-a");
      expect(result[1].id).toBe("mod-b");
    });

    it("returns only enabled modules (skips disabled)", () => {
      registry.registerModule(makeModule({ id: "mod-a" }));
      registry.registerModule(makeModule({ id: "mod-b" }));
      registry.disableModule("mod-b");

      mockDb.getChatModules.mockReturnValue(["mod-a", "mod-b"]);

      const result = registry.getModulesForChat("test-account", "972544329000@c.us");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("mod-a");
    });

    it("returns empty array when no modules are registered", () => {
      mockDb.getChatModules.mockReturnValue(["mod-a"]);

      const result = registry.getModulesForChat("test-account", "972544329000@c.us");
      expect(result).toEqual([]);
    });

    it("returns empty array when no modules are assigned to the chat", () => {
      registry.registerModule(makeModule({ id: "mod-a" }));
      mockDb.getChatModules.mockReturnValue([]);

      const result = registry.getModulesForChat("test-account", "972544329000@c.us");
      expect(result).toEqual([]);
    });

    it("skips assigned module IDs that are not registered", () => {
      registry.registerModule(makeModule({ id: "mod-a" }));
      mockDb.getChatModules.mockReturnValue(["mod-a", "mod-unknown"]);

      const result = registry.getModulesForChat("test-account", "972544329000@c.us");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("mod-a");
    });
  });
});

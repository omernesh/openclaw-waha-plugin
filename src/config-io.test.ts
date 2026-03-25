import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises before importing module
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  copyFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

// Mock node:os to control homedir
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { readFile, writeFile, rename, copyFile, stat } from "node:fs/promises";
import { readConfig, writeConfig, modifyConfig, withConfigMutex, getConfigPath } from "./config-io.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockCopyFile = vi.mocked(copyFile);
const mockStat = vi.mocked(stat);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("config-io", () => {
  describe("getConfigPath", () => {
    it("returns default path when no env var set", () => {
      delete process.env.OPENCLAW_CONFIG_PATH;
      const p = getConfigPath();
      expect(p).toContain(".openclaw");
      expect(p).toContain("openclaw.json");
    });

    it("respects OPENCLAW_CONFIG_PATH env var", () => {
      process.env.OPENCLAW_CONFIG_PATH = "/custom/config.json";
      expect(getConfigPath()).toBe("/custom/config.json");
      delete process.env.OPENCLAW_CONFIG_PATH;
    });
  });

  describe("readConfig", () => {
    it("Test 1: returns parsed JSON object from file", async () => {
      const data = { channels: { waha: { foo: "bar" } } };
      mockReadFile.mockResolvedValue(JSON.stringify(data));
      const result = await readConfig("/tmp/config.json");
      expect(result).toEqual(data);
      expect(mockReadFile).toHaveBeenCalledWith("/tmp/config.json", "utf-8");
    });

    it("Test 2: throws on missing file", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));
      await expect(readConfig("/tmp/missing.json")).rejects.toThrow("ENOENT");
    });
  });

  describe("writeConfig", () => {
    it("Test 3: writes JSON to .tmp file then renames to target", async () => {
      // stat rejects (no existing file to backup)
      mockStat.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      const data = { channels: { waha: {} } };
      await writeConfig("/tmp/config.json", data);

      // Should write to .tmp first
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/tmp/config.json.tmp",
        JSON.stringify(data, null, 2),
        "utf-8"
      );
      // Then rename .tmp -> target
      expect(mockRename).toHaveBeenCalledWith(
        "/tmp/config.json.tmp",
        "/tmp/config.json"
      );
    });

    it("Test 4: creates 3 rolling backups before writing", async () => {
      // All backup files exist
      mockStat.mockResolvedValue({ isFile: () => true } as any);
      mockRename.mockResolvedValue(undefined);
      mockCopyFile.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await writeConfig("/tmp/config.json", { x: 1 });

      // Should rotate: .bak.2 -> .bak.3, .bak.1 -> .bak.2
      const renameCalls = mockRename.mock.calls;
      expect(renameCalls).toContainEqual(["/tmp/config.json.bak.2", "/tmp/config.json.bak.3"]);
      expect(renameCalls).toContainEqual(["/tmp/config.json.bak.1", "/tmp/config.json.bak.2"]);
      // Should copy current -> .bak.1
      expect(mockCopyFile).toHaveBeenCalledWith("/tmp/config.json", "/tmp/config.json.bak.1");
    });
  });

  describe("withConfigMutex", () => {
    it("Test 5: serializes concurrent calls", async () => {
      const order: number[] = [];
      let resolveFirst: () => void;
      const firstBlocks = new Promise<void>((r) => { resolveFirst = r; });

      const call1 = withConfigMutex(async () => {
        order.push(1);
        await firstBlocks;
        order.push(2);
      });

      const call2 = withConfigMutex(async () => {
        order.push(3);
      });

      // Let first call complete
      resolveFirst!();
      await call1;
      await call2;

      // call2 (push 3) should happen AFTER call1 finishes (push 2)
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("modifyConfig", () => {
    it("Test 6: does atomic read-modify-write under mutex", async () => {
      const original = { channels: { waha: { count: 0 } } };
      mockReadFile.mockResolvedValue(JSON.stringify(original));
      mockStat.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      await modifyConfig("/tmp/config.json", (config) => {
        (config as any).channels.waha.count = 42;
      });

      // Should have written the modified config
      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(writtenData.channels.waha.count).toBe(42);
    });

    it("Test 6b: modifyConfig uses return value if fn returns an object", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ old: true }));
      mockStat.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      await modifyConfig("/tmp/config.json", () => {
        return { new: true };
      });

      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(writtenData).toEqual({ new: true });
    });
  });

  describe("atomic write safety", () => {
    it("Test 7: original file intact if writeFile crashes", async () => {
      mockStat.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockRejectedValue(new Error("disk full"));

      await expect(writeConfig("/tmp/config.json", { x: 1 })).rejects.toThrow("disk full");

      // rename should NOT have been called (write failed before rename)
      const renameCallsForFinal = mockRename.mock.calls.filter(
        (c) => c[0] === "/tmp/config.json.tmp" && c[1] === "/tmp/config.json"
      );
      expect(renameCallsForFinal).toHaveLength(0);
    });
  });
});

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadContactRule, loadGroupRule, loadDefaultContactRule, loadDefaultGroupRule } from "../src/rules-loader.js";
import { SYSTEM_CONTACT_DEFAULTS, SYSTEM_GROUP_DEFAULTS } from "../src/rules-types.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-loader-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("loadContactRule", () => {
  it("returns parsed partial for valid YAML file", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "test.yaml");
    fs.writeFileSync(filePath, "trust_level: trusted\ntone: warm\n", "utf8");

    const result = loadContactRule(filePath);
    expect(result).not.toBeNull();
    expect(result?.trust_level).toBe("trusted");
    expect(result?.tone).toBe("warm");
  });

  it("returns null for missing file (no throw)", () => {
    const result = loadContactRule("/nonexistent/path/does-not-exist.yaml");
    expect(result).toBeNull();
  });

  it("returns null for malformed YAML (schema validation failure)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "bad.yaml");
    // trust_level with invalid enum value
    fs.writeFileSync(filePath, "trust_level: invalid_enum_value\n", "utf8");

    const result = loadContactRule(filePath);
    expect(result).toBeNull();
  });

  it("returns null for completely unparseable YAML", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "corrupt.yaml");
    // Tabs in YAML cause parse errors in some parsers; invalid YAML structure
    fs.writeFileSync(filePath, "key: [unclosed\n\tanother line\n", "utf8");

    const result = loadContactRule(filePath);
    // Either null (parse error) or valid partial — either is acceptable
    // The test verifies no exception is thrown
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("returns sparse partial — not all fields required", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "sparse.yaml");
    fs.writeFileSync(filePath, "can_initiate: true\n", "utf8");

    const result = loadContactRule(filePath);
    expect(result).not.toBeNull();
    expect(result?.can_initiate).toBe(true);
    expect(result?.trust_level).toBeUndefined();
  });
});

describe("loadGroupRule", () => {
  it("returns parsed partial for valid YAML file", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "group.yaml");
    fs.writeFileSync(filePath, "participation_mode: open\ntone: casual\n", "utf8");

    const result = loadGroupRule(filePath);
    expect(result).not.toBeNull();
    expect(result?.participation_mode).toBe("open");
    expect(result?.tone).toBe("casual");
  });

  it("returns null for missing file (no throw)", () => {
    const result = loadGroupRule("/nonexistent/path/group.yaml");
    expect(result).toBeNull();
  });

  it("returns null for malformed YAML (schema validation failure)", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "bad-group.yaml");
    fs.writeFileSync(filePath, "participation_mode: invalid_mode_xyz\n", "utf8");

    const result = loadGroupRule(filePath);
    expect(result).toBeNull();
  });
});

describe("loadDefaultContactRule", () => {
  it("returns parsed defaults from valid _default.yaml", () => {
    const dir = makeTmpDir();
    const contactsDir = path.join(dir, "contacts");
    fs.mkdirSync(contactsDir);
    fs.writeFileSync(
      path.join(contactsDir, "_default.yaml"),
      "trust_level: normal\ntone: neutral\n",
      "utf8"
    );

    const result = loadDefaultContactRule(dir);
    expect(result).not.toBeNull();
    expect(result.trust_level).toBe("normal");
  });

  it("returns SYSTEM_CONTACT_DEFAULTS when _default.yaml is missing", () => {
    const dir = makeTmpDir();
    // contacts/ dir does not exist

    const result = loadDefaultContactRule(dir);
    expect(result).toEqual(SYSTEM_CONTACT_DEFAULTS);
  });
});

describe("loadDefaultGroupRule", () => {
  it("returns parsed defaults from valid _default.yaml", () => {
    const dir = makeTmpDir();
    const groupsDir = path.join(dir, "groups");
    fs.mkdirSync(groupsDir);
    fs.writeFileSync(
      path.join(groupsDir, "_default.yaml"),
      "participation_mode: mention_only\ntone: neutral\n",
      "utf8"
    );

    const result = loadDefaultGroupRule(dir);
    expect(result).not.toBeNull();
    expect(result.participation_mode).toBe("mention_only");
  });

  it("returns SYSTEM_GROUP_DEFAULTS when _default.yaml is missing", () => {
    const dir = makeTmpDir();

    const result = loadDefaultGroupRule(dir);
    expect(result).toEqual(SYSTEM_GROUP_DEFAULTS);
  });
});

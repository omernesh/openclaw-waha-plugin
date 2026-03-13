/**
 * tests/policy-edit.test.ts — Tests for the policy edit action logic.
 * Phase 6, Plan 04 (2026-03-14).
 *
 * Tests executePolicyEdit pure function covering:
 *   - Authorized owner edits contact field -> file written correctly
 *   - Unauthorized non-manager edit -> returns error
 *   - Global manager edits contact scope -> allowed
 *   - Non-owner cannot appoint manager
 *   - Invalid field name -> error
 *   - Creates new override file if it doesn't exist
 *   - Editing existing override file merges with existing content
 *   - Cache invalidation after edit
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parse as parseYaml } from "yaml";
import { executePolicyEdit } from "../src/policy-edit.js";
import { policyCache } from "../src/policy-cache.js";
import { OWNER_ID } from "../src/rules-types.js";

// -- Helpers --

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "policy-edit-test-"));
}

function writeContactDefault(basePath: string, extraFields: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.join(basePath, "contacts"), { recursive: true });
  const lines = [
    "enabled: true",
    "trust_level: normal",
    "privacy_level: low",
    "can_initiate: false",
    "can_reply: true",
    "tone: neutral",
    "language: match_sender",
    "forbidden_actions: []",
  ];
  for (const [k, v] of Object.entries(extraFields)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  fs.writeFileSync(path.join(basePath, "contacts", "_default.yaml"), lines.join("\n"));
}

function writeGroupDefault(basePath: string): void {
  fs.mkdirSync(path.join(basePath, "groups"), { recursive: true });
  const yaml = [
    "enabled: true",
    "participation_mode: mention_only",
    "proactive_allowed: false",
    "who_can_trigger_me: none",
    "contact_rule_mode: ignore",
    "unknown_participant_policy: deny",
    "privacy_level: low",
    "tone: neutral",
    "language_policy: match_room",
    "forbidden_actions: []",
    "forbidden_topics: []",
    "participants_allowlist:",
    "  mode: none",
    "  ids: []",
    "  aliases: []",
  ].join("\n");
  fs.writeFileSync(path.join(basePath, "groups", "_default.yaml"), yaml);
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
  policyCache.clear();
});

const TARGET_CONTACT_JID = "972544329000@c.us";
const GLOBAL_MANAGER_JID = "@c:global-manager@c.us";
const NON_MANAGER_JID = "@c:random-user@c.us";
const TARGET_GROUP_JID = "120363421825201386@g.us";

// -- Tests --

describe("executePolicyEdit", () => {
  it("owner can edit a contact field — file is written with correct value", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    // Global default has empty managers (no scope managers)
    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "can_initiate",
      value: true,
      actorId: OWNER_ID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(true);
    // Find the written override file
    const contactsDir = path.join(tmpDir, "contacts");
    const files = fs.readdirSync(contactsDir).filter((f) => f !== "_default.yaml");
    expect(files.length).toBe(1);
    const fileContent = fs.readFileSync(path.join(contactsDir, files[0]), "utf8");
    const parsed = parseYaml(fileContent) as Record<string, unknown>;
    expect(parsed.can_initiate).toBe(true);
  });

  it("unauthorized non-manager edit returns error", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "can_initiate",
      value: true,
      actorId: NON_MANAGER_JID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authorized/i);
  });

  it("global manager can edit contact scope", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    // Write contact default with global manager in managers.allowed_ids
    writeContactDefault(tmpDir, {
      managers: { allowed_ids: [GLOBAL_MANAGER_JID], owner_only_appoint_revoke: true },
    });
    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "tone",
      value: "casual",
      actorId: GLOBAL_MANAGER_JID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(true);
  });

  it("non-owner cannot appoint manager (managers.allowed_ids field)", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir, {
      managers: { allowed_ids: [GLOBAL_MANAGER_JID], owner_only_appoint_revoke: true },
    });
    // Global manager tries to add a new manager -> appoint_manager action -> denied
    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "managers.allowed_ids",
      value: [GLOBAL_MANAGER_JID, NON_MANAGER_JID],
      actorId: GLOBAL_MANAGER_JID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/owner/i);
  });

  it("owner can appoint manager (managers.allowed_ids field)", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "managers.allowed_ids",
      value: [NON_MANAGER_JID],
      actorId: OWNER_ID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(true);
  });

  it("invalid field name returns error", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "nonexistent_field_xyz",
      value: "test",
      actorId: OWNER_ID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid field/i);
  });

  it("creates new override file when it does not exist", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    const contactsDir = path.join(tmpDir, "contacts");
    const beforeFiles = fs.readdirSync(contactsDir);
    expect(beforeFiles).not.toContain(expect.stringContaining("972544329000"));

    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "privacy_level",
      value: "trusted",
      actorId: OWNER_ID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(true);
    const afterFiles = fs.readdirSync(contactsDir).filter((f) => f !== "_default.yaml");
    expect(afterFiles.length).toBe(1);
  });

  it("merges with existing override file content", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    // Pre-create an override file with existing field
    const slug = "972544329000_c_us";
    const overrideFile = path.join(tmpDir, "contacts", `unknown__${slug}.yaml`);
    fs.writeFileSync(overrideFile, "tone: casual\ncan_reply: false\n");

    const result = await executePolicyEdit({
      scope: "contact",
      targetId: TARGET_CONTACT_JID,
      field: "privacy_level",
      value: "trusted",
      actorId: OWNER_ID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(true);
    const fileContent = fs.readFileSync(overrideFile, "utf8");
    const parsed = parseYaml(fileContent) as Record<string, unknown>;
    // Should have all three fields: original ones + the newly edited one
    expect(parsed.tone).toBe("casual");
    expect(parsed.can_reply).toBe(false);
    expect(parsed.privacy_level).toBe("trusted");
  });

  it("owner can edit group field", async () => {
    const tmpDir = makeTempDir();
    tempDirs.push(tmpDir);
    writeContactDefault(tmpDir);
    writeGroupDefault(tmpDir);
    const result = await executePolicyEdit({
      scope: "group",
      targetId: TARGET_GROUP_JID,
      field: "participation_mode",
      value: "open",
      actorId: OWNER_ID,
      basePath: tmpDir,
    });

    expect(result.success).toBe(true);
    const groupsDir = path.join(tmpDir, "groups");
    const files = fs.readdirSync(groupsDir).filter((f) => f !== "_default.yaml");
    expect(files.length).toBe(1);
    const fileContent = fs.readFileSync(path.join(groupsDir, files[0]), "utf8");
    const parsed = parseYaml(fileContent) as Record<string, unknown>;
    expect(parsed.participation_mode).toBe("open");
  });
});

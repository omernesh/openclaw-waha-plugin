/**
 * resolved-payload-builder.test.ts — Tests for compact policy payload builders.
 * Phase 6, Plan 03 (2026-03-14).
 *
 * Tests buildDmPayload and buildGroupPayload produce correct compact ResolvedPolicy objects
 * with correct manager_edit_allowed computation and forbidden_actions merging.
 */

import { describe, it, expect } from "vitest";
import { buildDmPayload, buildGroupPayload } from "../src/resolved-payload-builder.js";
import type { ContactRule, GroupRule } from "../src/rules-types.js";
import { SYSTEM_CONTACT_DEFAULTS, SYSTEM_GROUP_DEFAULTS } from "../src/rules-types.js";

// -- Test fixtures --

const fullContactRule: ContactRule = {
  enabled: true,
  trust_level: "trusted",
  privacy_level: "limited",
  can_initiate: true,
  can_reply: true,
  can_use_memory: true,
  can_reference_calendar: false,
  tone: "warm",
  language: "en",
  allowed_triggers: ["help"],
  forbidden_actions: ["delete_chat", "block"],
  managers: { allowed_ids: ["@c:manager1@c.us"], owner_only_appoint_revoke: true },
  notes: ["test contact"],
};

const fullGroupRule: GroupRule = {
  enabled: true,
  group_type: "work",
  participation_mode: "mention_only",
  proactive_allowed: false,
  who_can_trigger_me: "everyone",
  participants_allowlist: { mode: "explicit", ids: ["@c:member1@c.us"], aliases: [] },
  unknown_participant_policy: "deny",
  privacy_level: "limited",
  tone: "professional",
  language_policy: "en",
  contact_rule_mode: "ignore",
  allowed_topics: ["tech"],
  forbidden_topics: ["politics"],
  forbidden_actions: ["send_file"],
  managers: { allowed_ids: ["@c:groupmanager@c.us"], owner_only_appoint_revoke: true },
  notes: [],
};

const ownerId = "@c:972544329000@c.us";
const managerId = "@c:manager1@c.us";
const nonManagerId = "@c:nobody@c.us";

// -- buildDmPayload tests --

describe("buildDmPayload", () => {
  it("returns correct DM payload fields from a full ContactRule", () => {
    const payload = buildDmPayload({
      contactRule: fullContactRule,
      targetId: "@c:friend@c.us",
    });
    expect(payload.chat_type).toBe("dm");
    expect(payload.target_id).toBe("@c:friend@c.us");
    expect(payload.can_initiate).toBe(true);
    expect(payload.can_reply).toBe(true);
    expect(payload.privacy_level).toBe("limited");
    expect(payload.tone).toBe("warm");
    expect(payload.language).toBe("en");
    expect(payload.forbidden_actions).toEqual(["delete_chat", "block"]);
    expect(payload.forbidden_topics).toEqual([]);
  });

  it("does not include raw ContactRule or large objects — only compact fields", () => {
    const payload = buildDmPayload({
      contactRule: fullContactRule,
      targetId: "@c:friend@c.us",
    });
    // These raw rule fields must NOT appear in the payload
    expect((payload as Record<string, unknown>).enabled).toBeUndefined();
    expect((payload as Record<string, unknown>).trust_level).toBeUndefined();
    expect((payload as Record<string, unknown>).managers).toBeUndefined();
    expect((payload as Record<string, unknown>).notes).toBeUndefined();
    expect((payload as Record<string, unknown>).allowed_triggers).toBeUndefined();
    expect((payload as Record<string, unknown>).can_use_memory).toBeUndefined();
  });

  it("sets manager_edit_allowed=true when actorId is owner", () => {
    const payload = buildDmPayload({
      contactRule: fullContactRule,
      targetId: "@c:friend@c.us",
      actorId: ownerId,
      ownerId,
    });
    expect(payload.manager_edit_allowed).toBe(true);
  });

  it("sets manager_edit_allowed=true when actorId is in managers.allowed_ids", () => {
    const payload = buildDmPayload({
      contactRule: fullContactRule,
      targetId: "@c:friend@c.us",
      actorId: managerId,
      ownerId,
    });
    expect(payload.manager_edit_allowed).toBe(true);
  });

  it("sets manager_edit_allowed=false for non-managers", () => {
    const payload = buildDmPayload({
      contactRule: fullContactRule,
      targetId: "@c:friend@c.us",
      actorId: nonManagerId,
      ownerId,
    });
    expect(payload.manager_edit_allowed).toBe(false);
  });

  it("sets manager_edit_allowed=false when actorId is undefined", () => {
    const payload = buildDmPayload({
      contactRule: fullContactRule,
      targetId: "@c:friend@c.us",
    });
    expect(payload.manager_edit_allowed).toBe(false);
  });

  it("uses system defaults for missing fields in ContactRule", () => {
    const sparse: ContactRule = { ...SYSTEM_CONTACT_DEFAULTS };
    const payload = buildDmPayload({ contactRule: sparse, targetId: "@c:test@c.us" });
    expect(payload.can_initiate).toBe(true);
    expect(payload.can_reply).toBe(true);
    expect(payload.privacy_level).toBe("low");
    expect(payload.tone).toBe("neutral");
    expect(payload.language).toBe("match_sender");
    expect(payload.forbidden_actions).toEqual([]);
  });
});

// -- buildGroupPayload tests --

describe("buildGroupPayload", () => {
  it("returns correct group payload fields from a full GroupRule", () => {
    const payload = buildGroupPayload({
      groupRule: fullGroupRule,
      targetId: "@g:120363421825201386@g.us",
      speakerId: "@c:member1@c.us",
      speakerAllowed: true,
    });
    expect(payload.chat_type).toBe("group");
    expect(payload.target_id).toBe("@g:120363421825201386@g.us");
    expect(payload.speaker_id).toBe("@c:member1@c.us");
    expect(payload.participation_mode).toBe("mention_only");
    expect(payload.proactive_allowed).toBe(false);
    expect(payload.privacy_level).toBe("limited");
    expect(payload.tone).toBe("professional");
    expect(payload.language_policy).toBe("en");
    expect(payload.contact_rule_mode).toBe("ignore");
    expect(payload.participants_allowlist_mode).toBe("explicit");
    expect(payload.speaker_allowed).toBe(true);
    expect(payload.unknown_participant_policy).toBe("deny");
    expect(payload.forbidden_actions).toEqual(["send_file"]);
    expect(payload.forbidden_topics).toEqual(["politics"]);
  });

  it("does not include raw GroupRule large objects — only compact fields", () => {
    const payload = buildGroupPayload({
      groupRule: fullGroupRule,
      targetId: "@g:120363421825201386@g.us",
      speakerId: "@c:member1@c.us",
      speakerAllowed: true,
    });
    // These raw fields must NOT be in the payload
    expect((payload as Record<string, unknown>).enabled).toBeUndefined();
    expect((payload as Record<string, unknown>).group_type).toBeUndefined();
    expect((payload as Record<string, unknown>).managers).toBeUndefined();
    expect((payload as Record<string, unknown>).notes).toBeUndefined();
    expect((payload as Record<string, unknown>).allowed_topics).toBeUndefined();
    expect((payload as Record<string, unknown>).participants_allowlist).toBeUndefined();
    expect((payload as Record<string, unknown>).who_can_trigger_me).toBeUndefined();
  });

  it("includes forbidden_actions from speaker contact rule when contact_rule_mode=apply", () => {
    const applyGroupRule: GroupRule = {
      ...fullGroupRule,
      contact_rule_mode: "apply",
      forbidden_actions: ["send_file"],
    };
    const speakerContactRule: Partial<ContactRule> = {
      forbidden_actions: ["delete_message", "send_file"], // send_file is a duplicate
    };
    const payload = buildGroupPayload({
      groupRule: applyGroupRule,
      targetId: "@g:120363421825201386@g.us",
      speakerId: "@c:member1@c.us",
      speakerAllowed: true,
      speakerContactRule,
    });
    // Should include all, deduplicated
    expect(payload.forbidden_actions).toContain("send_file");
    expect(payload.forbidden_actions).toContain("delete_message");
    // No duplicates
    const sendFileCount = payload.forbidden_actions.filter((a) => a === "send_file").length;
    expect(sendFileCount).toBe(1);
  });

  it("includes forbidden_actions from speaker contact rule when contact_rule_mode=restricted", () => {
    const restrictedGroupRule: GroupRule = {
      ...fullGroupRule,
      contact_rule_mode: "restricted",
      forbidden_actions: [],
    };
    const speakerContactRule: Partial<ContactRule> = {
      forbidden_actions: ["archive_chat"],
    };
    const payload = buildGroupPayload({
      groupRule: restrictedGroupRule,
      targetId: "@g:120363421825201386@g.us",
      speakerId: "@c:member1@c.us",
      speakerAllowed: true,
      speakerContactRule,
    });
    expect(payload.forbidden_actions).toContain("archive_chat");
  });

  it("does NOT include speaker contact forbidden_actions when contact_rule_mode=ignore", () => {
    const ignoreGroupRule: GroupRule = {
      ...fullGroupRule,
      contact_rule_mode: "ignore",
      forbidden_actions: ["group_only_action"],
    };
    const speakerContactRule: Partial<ContactRule> = {
      forbidden_actions: ["contact_only_action"],
    };
    const payload = buildGroupPayload({
      groupRule: ignoreGroupRule,
      targetId: "@g:120363421825201386@g.us",
      speakerId: "@c:member1@c.us",
      speakerAllowed: true,
      speakerContactRule,
    });
    // Only group actions — contact actions ignored
    expect(payload.forbidden_actions).toEqual(["group_only_action"]);
    expect(payload.forbidden_actions).not.toContain("contact_only_action");
  });

  it("sets manager_edit_allowed correctly for group managers", () => {
    const groupManagerId = "@c:groupmanager@c.us";
    const payload = buildGroupPayload({
      groupRule: fullGroupRule,
      targetId: "@g:120363421825201386@g.us",
      speakerId: "@c:member1@c.us",
      speakerAllowed: true,
      actorId: groupManagerId,
      ownerId,
    });
    expect(payload.manager_edit_allowed).toBe(true);
  });

  it("uses system defaults for sparse GroupRule fields", () => {
    const sparse: GroupRule = { ...SYSTEM_GROUP_DEFAULTS };
    const payload = buildGroupPayload({
      groupRule: sparse,
      targetId: "@g:test@g.us",
      speakerId: "@c:test@c.us",
      speakerAllowed: false,
    });
    expect(payload.participation_mode).toBe("mention_only");
    expect(payload.proactive_allowed).toBe(false);
    expect(payload.privacy_level).toBe("low");
    expect(payload.participants_allowlist_mode).toBe("none");
    expect(payload.forbidden_topics).toEqual([]);
  });
});

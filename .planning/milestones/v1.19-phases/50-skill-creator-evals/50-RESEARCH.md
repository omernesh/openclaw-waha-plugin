# Phase 50: Skill Creator & Evals - Research

**Researched:** 2026-03-26
**Domain:** Anthropic skill-creator validation + eval authoring for Claude Code skills
**Confidence:** HIGH

## Summary

Phase 50 takes the 10 per-category skill files produced in Phase 49 and runs them through the Anthropic skill-creator validation + eval loop. The skill-creator plugin is already installed at `/c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/`. It provides: structure validation (SKILL.md format checks via `quick_validate.py`), eval authoring (`evals/evals.json`), subagent test runs, grading (`agents/grader.md`), benchmark aggregation (`scripts/aggregate_benchmark.py`), and an eval viewer (`eval-viewer/generate_review.py`). The current skill files (groups.md, contacts.md, channels.md, chats.md, messaging.md, media.md, status.md, presence.md, profile.md, slash-commands.md) plus the SKILL.md index are all valid targets.

The constraint from the success criteria: evals must cover correct action selection, correct parameter construction, and graceful error handling for at least 3 categories. Results must be saved alongside skill files. This is an improvement-on-existing-skill workflow (not new skill creation) so baselines are `without_skill` or old skill snapshots.

**Primary recommendation:** Run skill-creator in "improving existing skill" mode against each category file. Author evals in `skills/evals/evals.json`, save results to `skills/evals-workspace/`, skip the browser viewer (use `--static` flag for headless Windows environment).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — all implementation choices at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure/tooling phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKL-04 | Anthropic skill-creator used to structure files and write evals | skill-creator plugin at `/c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/` — `quick_validate.py` checks structure, `evals/evals.json` schema defined |
| SKL-05 | Evals verify agent can find correct action, use correct params, handle errors | eval format: `evals.json` with `expectations[]` per eval; grader agent checks pass/fail; results saved to `evals-workspace/` alongside skill files |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| skill-creator plugin | b10b583de281 | Structure validation, eval authoring, grading, benchmarking | Official Anthropic plugin — the specified tool |
| Python 3 | 3.13.3 (available) | Run skill-creator scripts (`aggregate_benchmark.py`, `generate_review.py`, `quick_validate.py`) | skill-creator scripts are Python |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `quick_validate.py` | bundled | Fast structure check without running evals | First pass before authoring evals |
| `aggregate_benchmark.py` | bundled | Produce `benchmark.json` from run results | After grading all eval runs |
| `generate_review.py --static` | bundled | Generate static HTML review file (no browser server) | Windows/headless — avoids browser dependency |

### Skill-Creator Plugin Path
```
/c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/skills/skill-creator/
├── SKILL.md                    # Main skill instructions
├── agents/
│   ├── grader.md               # Grader subagent instructions
│   ├── comparator.md
│   └── analyzer.md
├── references/
│   └── schemas.md              # JSON schemas for evals.json, grading.json, benchmark.json
├── scripts/
│   ├── quick_validate.py       # Structure validation
│   ├── aggregate_benchmark.py  # Benchmark aggregation
│   └── generate_report.py
└── eval-viewer/
    └── generate_review.py      # Static HTML reviewer
```

## Architecture Patterns

### Recommended Project Structure for Evals
```
skills/
├── messaging.md               # Category skill files (Phase 49 output)
├── groups.md
├── contacts.md
├── channels.md
├── chats.md
├── status.md
├── presence.md
├── profile.md
├── media.md
├── slash-commands.md
├── evals/
│   └── evals.json             # Master eval definitions for whatsapp-actions skill
└── evals-workspace/           # Generated — eval run results saved here
    └── iteration-1/
        ├── eval-action-selection/
        │   ├── with_skill/outputs/
        │   ├── without_skill/outputs/
        │   ├── eval_metadata.json
        │   ├── grading.json
        │   └── timing.json
        ├── eval-param-construction/
        └── eval-error-handling/
```

### Pattern 1: Skill Structure Validation (quick_validate.py)
**What:** Run `quick_validate.py` against each category file to check for structural issues before authoring evals.
**When to use:** Before eval authoring — catches missing frontmatter, over-long files, broken references.

```bash
# Source: skill-creator scripts/
python /c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/skills/skill-creator/scripts/quick_validate.py \
  D:/docker/waha-oc-plugin/skills/groups.md
```

Note: `quick_validate.py` may expect a skill directory, not a standalone `.md` file. The category files do not have `SKILL.md` frontmatter headers — they are sub-files of the `whatsapp-actions` skill (which lives in SKILL.md). Validation should target the top-level SKILL.md + the category files it references.

### Pattern 2: Evals JSON Structure
**What:** `skills/evals/evals.json` defines test prompts, expected outputs, and expectations.
**When to use:** The primary deliverable for SKL-04 and SKL-05.

```json
// Source: skill-creator references/schemas.md
{
  "skill_name": "whatsapp-actions",
  "evals": [
    {
      "id": 1,
      "prompt": "Add Michael Greenberg (972556839823) to the sammie test group",
      "expected_output": "Action: addParticipants, Parameters: {groupId: '120363421825201386@g.us', participants: ['972556839823@c.us']}",
      "files": [],
      "expectations": [
        "Agent selects addParticipants action (not createGroup or send)",
        "groupId parameter is a @g.us JID",
        "participants array contains @c.us JID"
      ]
    },
    {
      "id": 2,
      "prompt": "Send a poll to the test group asking about meeting time with options 9am, 10am, 11am",
      "expected_output": "Action: poll with correct parameters",
      "files": [],
      "expectations": [
        "Agent selects poll action (not sendPoll or send)",
        "Parameters include name (poll question), options array with 3 items",
        "target resolves to test group (not explicit chatId)"
      ]
    },
    {
      "id": 3,
      "prompt": "Get the invite link for the sammie test group",
      "expected_output": "Action: getInviteCode",
      "files": [],
      "expectations": [
        "Agent selects getInviteCode (not joinGroup or getGroup)",
        "groupId parameter is present and is a @g.us JID"
      ]
    }
  ]
}
```

### Pattern 3: Grading.json Fields (CRITICAL)
**What:** Grader output must use exact field names `text`, `passed`, `evidence` (NOT `name`/`met`/`details`).
**When to use:** When spawning grader subagent or generating grading.json manually.

```json
// Source: skill-creator references/schemas.md — field names are exact, viewer breaks on variants
{
  "expectations": [
    {
      "text": "Agent selects addParticipants action",
      "passed": true,
      "evidence": "Transcript shows: Action: addParticipants, Parameters: ..."
    }
  ],
  "summary": { "passed": 3, "failed": 0, "total": 3, "pass_rate": 1.0 }
}
```

### Pattern 4: Static HTML Viewer (Windows/headless)
**What:** Generate standalone HTML review file instead of browser server.
**When to use:** Always in this project — Windows environment, no display server.

```bash
# Source: skill-creator SKILL.md — Cowork/headless instructions
python /path/to/eval-viewer/generate_review.py \
  skills/evals-workspace/iteration-1 \
  --skill-name "whatsapp-actions" \
  --benchmark skills/evals-workspace/iteration-1/benchmark.json \
  --static /tmp/whatsapp-actions-review.html
```

### Anti-Patterns to Avoid
- **Validating category files as standalone skills:** The category files (groups.md, contacts.md, etc.) do NOT have SKILL.md frontmatter — they are reference files within the `whatsapp-actions` skill. Validate the parent SKILL.md, not the sub-files directly.
- **Skipping the `--static` flag:** Running `generate_review.py` without `--static` will attempt `webbrowser.open()` which fails silently on headless Windows.
- **Grading.json with wrong field names:** Using `name`/`met`/`details` instead of `text`/`passed`/`evidence` breaks the benchmark viewer.
- **Evals that test only the happy path:** Success criteria requires error handling coverage. Include at least one eval where the agent must handle an invalid JID, missing required param, or wrong action name.
- **Saving results outside skills/:** The success criteria says "saved alongside skill files" — results must live in `skills/evals-workspace/` or `skills/evals/`, not in a separate top-level directory.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Eval result aggregation | Custom Python script | `scripts/aggregate_benchmark.py` | Schema-compatible output, handles mean/stddev, delta |
| HTML review UI | Custom HTML template | `eval-viewer/generate_review.py --static` | Includes Outputs + Benchmark tabs, prev/next nav, feedback form |
| Structure validation | Manual SKILL.md review | `scripts/quick_validate.py` | Catches schema issues programmatically |
| Grader logic | Inline Claude judgment | `agents/grader.md` subagent | Consistent evidence-based grading with `grading.json` output |

**Key insight:** The skill-creator scripts are the right tools — hand-rolling equivalents would diverge from the expected JSON schemas the viewer depends on.

## Common Pitfalls

### Pitfall 1: Category files vs. skill root
**What goes wrong:** `quick_validate.py` is called on `skills/groups.md` which has no YAML frontmatter — validation fails or gives misleading results.
**Why it happens:** Phase 49 created reference files, not standalone skills. The actual skill root is `SKILL.md` in the project root.
**How to avoid:** Run validation against the project root's `SKILL.md` (the index). For category files, validate manually: check that each has an H1 title, action tables with Action/Parameters/Notes columns, Examples section, and Gotchas section.
**Warning signs:** `quick_validate.py` exits with "No SKILL.md found" or "Missing name field in frontmatter".

### Pitfall 2: Evals test against agent simulation, not actual WAHA calls
**What goes wrong:** Evals run `claude -p` with the skill but the agent can't actually call WAHA API (no SSH, wrong environment). Evals succeed trivially because the agent just describes what it would do.
**Why it happens:** Eval runs are Claude Code subagent tasks — they don't have live WAHA access.
**How to avoid:** Frame eval prompts to test decision-making (action selection, parameter construction) not execution. Expectations check "agent selected correct action" and "parameters are correctly formed", not "WAHA returned 200".
**Warning signs:** All evals pass at 100% with no errors — too good to be true.

### Pitfall 3: Error handling evals require explicit bad-input prompts
**What goes wrong:** No evals test error handling, so SKL-05 ("graceful error handling") is not satisfied.
**Why it happens:** It's tempting to only test the happy path.
**How to avoid:** Include at least 3 error-scenario evals: invalid JID format, conflicting action names (e.g., "delete the group" — should that be deleteGroup or delete?), and ambiguous target resolution.
**Warning signs:** All eval prompts are well-formed happy-path requests.

### Pitfall 4: benchmark.json field name mismatch
**What goes wrong:** Viewer shows empty/zero values in Benchmark tab.
**Why it happens:** `configuration` field must be exactly `"with_skill"` or `"without_skill"` (not `"skill"` or `"base"`). `pass_rate` must be nested under `result`, not at top level.
**How to avoid:** Always generate benchmark.json via `scripts/aggregate_benchmark.py`, or reference `references/schemas.md` exactly when generating manually.
**Warning signs:** Benchmark tab shows 0% pass rate when grading.json shows passes.

### Pitfall 5: Skill description triggering vs. action-selection evals
**What goes wrong:** Evals are designed to test whether the skill *triggers* (description optimization), not whether the agent selects the *right action within the skill*.
**Why it happens:** Conflating two different eval types.
**How to avoid:** Phase 50 evals test action selection and parameter construction within an already-triggered skill context. Description optimization (`run_loop.py`) is optional and separate.
**Warning signs:** All eval prompts are "would this trigger WhatsApp skill?" style queries.

## Code Examples

### Minimal evals.json for SKL-05 compliance
```json
// Covers: action selection (3 categories), param construction, error handling
{
  "skill_name": "whatsapp-actions",
  "evals": [
    {
      "id": 1,
      "prompt": "Add Michael Greenberg (972556839823) to the sammie test group and promote him to admin",
      "expected_output": "Two actions: addParticipants then promoteToAdmin",
      "files": [],
      "expectations": [
        "Agent uses addParticipants (not send or createGroup)",
        "participants array contains a @c.us JID",
        "Agent also uses promoteToAdmin as a follow-up action",
        "groupId is a @g.us JID in both actions"
      ]
    },
    {
      "id": 2,
      "prompt": "Send a location to the test group at coordinates 32.0853, 34.7818 titled 'Office'",
      "expected_output": "Action: sendLocation with correct lat/lng/title",
      "files": [],
      "expectations": [
        "Agent selects sendLocation (not send or sendImage)",
        "latitude is 32.0853",
        "longitude is 34.7818",
        "title is 'Office' or equivalent"
      ]
    },
    {
      "id": 3,
      "prompt": "Block the contact 972556839823",
      "expected_output": "Action: blockContact with contactId as @c.us JID",
      "files": [],
      "expectations": [
        "Agent selects blockContact (not unblockContact or delete)",
        "contactId uses @c.us suffix (972556839823@c.us)"
      ]
    },
    {
      "id": 4,
      "prompt": "Follow the WhatsApp channel at https://whatsapp.com/channel/0029VaXXXXXXXX",
      "expected_output": "Agent resolves invite code before following — NOT passing the URL directly",
      "files": [],
      "expectations": [
        "Agent does NOT call followChannel with the full URL as channelId",
        "Agent identifies need to resolve code first OR uses resolveChannelInvite",
        "If agent falls back to a single action, it uses the correct JID format (@newsletter)"
      ]
    },
    {
      "id": 5,
      "prompt": "Delete the sammie test group",
      "expected_output": "Agent should use deleteGroup (not delete which deletes a chat, not leaveGroup)",
      "files": [],
      "expectations": [
        "Agent selects deleteGroup (not leaveGroup, not delete)",
        "groupId parameter is present"
      ]
    },
    {
      "id": 6,
      "prompt": "Mark all messages in the test group as read",
      "expected_output": "Action: read (sends read receipts) NOT readMessages (fetches content)",
      "files": [],
      "expectations": [
        "Agent selects read action (not readMessages)",
        "chatId is the test group JID"
      ]
    }
  ]
}
```

### Benchmark aggregation command
```bash
# Source: skill-creator SKILL.md — Step 4
python -m scripts.aggregate_benchmark \
  D:/docker/waha-oc-plugin/skills/evals-workspace/iteration-1 \
  --skill-name whatsapp-actions
# Run from: /c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/skills/skill-creator/
```

### Static viewer generation
```bash
# Source: skill-creator SKILL.md — Cowork/headless section
python /c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/skills/skill-creator/eval-viewer/generate_review.py \
  D:/docker/waha-oc-plugin/skills/evals-workspace/iteration-1 \
  --skill-name "whatsapp-actions" \
  --benchmark D:/docker/waha-oc-plugin/skills/evals-workspace/iteration-1/benchmark.json \
  --static /tmp/whatsapp-actions-review.html
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic SKILL.md (~500 lines) | Index + 10 category files | Phase 49 (v1.19) | Eval scope is per-category, not per-action |
| Manual skill testing (send WhatsApp, check logs) | skill-creator eval loop with grader subagent | Phase 50 (v1.19) | Repeatable, quantifiable results |

## Open Questions

1. **Does `quick_validate.py` accept standalone .md files or only skill directories?**
   - What we know: The script is designed for skills with `SKILL.md` at the root
   - What's unclear: Whether it can validate individual reference files (like groups.md)
   - Recommendation: Run it against the project root `SKILL.md`; validate category files manually against the 3-section structure (Actions table, Examples, Gotchas)

2. **Can eval subagents resolve WAHA action names without live API access?**
   - What we know: Evals run as Claude Code subagents with skill in context; they don't have WAHA API access
   - What's unclear: Whether evals should test "what action would you use?" (decision-making) or "execute this action" (live run)
   - Recommendation: Test decision-making only — prompt format "Given this task, which action and parameters would you use?" The subagent outputs its reasoning, expectations verify correctness

3. **Where exactly to save eval results to satisfy "alongside skill files"?**
   - What we know: Success criteria says "saved alongside skill files"
   - Recommendation: `skills/evals/evals.json` for definitions, `skills/evals-workspace/` for run results — both inside the `skills/` directory

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 | skill-creator scripts | Yes | 3.13.3 | — |
| skill-creator plugin | SKL-04 | Yes | b10b583de281 | — |
| `generate_review.py` | Eval viewer | Yes | bundled | Skip viewer, review grading.json directly |
| Browser display | Eval viewer server mode | No (Windows/headless) | — | Use `--static` flag |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- Browser display: Use `--static /tmp/review.html` flag on `generate_review.py`

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | skill-creator eval loop (not jest/pytest) |
| Config file | `skills/evals/evals.json` |
| Quick run command | `python quick_validate.py D:/docker/waha-oc-plugin/SKILL.md` |
| Full suite command | skill-creator subagent eval runs via `aggregate_benchmark.py` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKL-04 | Skill files pass structure validation | validation | `python quick_validate.py SKILL.md` | ❌ Wave 0 |
| SKL-05 | Agent selects correct action for task | eval | skill-creator subagent run + grader | ❌ Wave 0 |
| SKL-05 | Agent constructs correct parameters | eval | skill-creator subagent run + grader | ❌ Wave 0 |
| SKL-05 | Agent handles errors gracefully | eval | skill-creator subagent run + grader | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Run `quick_validate.py` against SKILL.md
- **Per wave merge:** Run grader against eval outputs
- **Phase gate:** benchmark.json shows ≥3 evals covering action selection, param construction, error handling; results saved in `skills/evals-workspace/`

### Wave 0 Gaps
- [ ] `skills/evals/evals.json` — covers SKL-05 (min 6 evals across 3+ categories)
- [ ] `skills/evals-workspace/` — output directory for run results

## Sources

### Primary (HIGH confidence)
- `/c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/skills/skill-creator/SKILL.md` — full skill-creator workflow, eval loop, grading, viewer
- `/c/Users/omern/.claude/plugins/cache/claude-plugins-official/skill-creator/b10b583de281/skills/skill-creator/references/schemas.md` — exact JSON schemas for evals.json, grading.json, benchmark.json
- `D:/docker/waha-oc-plugin/skills/` — all 10 category skill files from Phase 49
- `D:/docker/waha-oc-plugin/SKILL.md` — parent skill index (v6.0.0, 145 lines)

### Secondary (MEDIUM confidence)
- `D:/docker/waha-oc-plugin/.planning/REQUIREMENTS.md` — SKL-04, SKL-05 requirements verbatim
- `D:/docker/waha-oc-plugin/CLAUDE.md` — project conventions (DO NOT CHANGE comments, backup pattern, deploy pitfalls)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — skill-creator plugin verified present, Python 3 verified available
- Architecture: HIGH — schemas read directly from skill-creator references/schemas.md
- Pitfalls: HIGH — derived from skill-creator SKILL.md warnings + project-specific gotchas from CLAUDE.md

**Research date:** 2026-03-26
**Valid until:** 2026-05-26 (skill-creator is stable, cache version b10b583de281)

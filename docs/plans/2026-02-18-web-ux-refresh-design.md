# DispatchOS Web UX Refresh (2026-02-18)

## Objective
Upgrade the dashboard UX/UI so non-technical dispatchers can move from login to action quickly, with lower cognitive load and clearer decision guidance.

## Target audience
- Small/medium field-service teams (owner + dispatchers).
- Time-constrained operators handling urgent inbound requests.
- Users who need confidence and clarity more than configuration depth.

## Design direction
- Swiss-inspired visual system: clean grid, restrained palette, strong type hierarchy, high contrast, minimal noise.
- Professional but modern look: soft glass surfaces, concise cards, clear status chips.
- "AI as copilot" model: guidance appears as plain-language next actions, not hidden automation.

## Flow updates
1. Login
- Added a clear value proposition and "what happens next" overview.
- Kept auth path simple (magic link or demo fallback).

2. Onboarding
- Reframed to a guided 4-step progression with visible step index and progress bar.
- Reduced ambiguity in each step through short outcome-focused descriptions.

3. Job Board (core operating screen)
- Added AI priority scoring per job card (Critical/High/Medium/Low).
- Added AI queue brief with immediate next actions.
- Added search and focus mode for faster triage.
- Improved urgency cues, button hierarchy, and at-a-glance metadata.

4. Calendar
- Added manual-only toggle and next appointment callout.
- Improved readability of day/event structure.

5. Insights
- Added AI queue brief to turn metrics into concrete recommended actions.
- Kept operational KPI and health cards but simplified copy.

6. Settings
- Grouped controls by operational intent: operations, profile, AI context, languages, integrations, team access.

## Implementation notes
- New frontend utility: `apps/web/src/ops-intelligence.ts`
  - `scoreJobPriority()`
  - `buildQueueAssistantBrief()`
- Added tests: `apps/web/test/ops-intelligence.test.ts`
- Updated global style system: `apps/web/src/styles.css`

## UX principles applied
- Clarity over decoration.
- One primary action per context.
- Progressive disclosure for advanced details.
- Mobile-first interaction patterns preserved.
- Consistent visual language across screens.

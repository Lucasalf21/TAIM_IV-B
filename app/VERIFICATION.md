# IV-3 rendering verification — protocol 3

## UI makeover review — 2026-11-09

Reviewed the complete uncommitted makeover in `src/main.ts`, `src/style.css` and
`src/chart/frame.ts`, including the existing session and feedback callers. No
blocking defects were found. Consent, scoring, response validation, episode order,
timing, persistence and real-session readiness gates retain their existing logic.
The shared chart's right margin increases from 24 to 96 pixels to place the limit
label outside the data; the window label is centred. Domains, ticks, box summaries
and the class palette are unchanged for both conditions.

The production Chrome walkthrough at `127.0.0.1:4186` covered researcher setup,
consent acceptance/refusal, instructions, both practices and their feedback, all
20 measured trials (including probability questions), between-trial screens,
questionnaire, results, completed-session researcher controls, withdrawal and the
local-deletion dialog. Results showed 9/20 decision-quality matches for all-GO test
responses and pending weather outcomes, as expected without a debrief import.
At 390 × 844, results had no page-level horizontal overflow; the table scrolled
inside its container. The desktop results Lighthouse snapshot scored 100 for
accessibility and 100 for best practices; no console errors or warnings appeared.
Screenshots and that report are in ignored `test-results/ui-makeover-review/`.

A final isolated-browser check confirmed keyboard Tab focuses the GO radio with
a visible 3-pixel orange outline on its label, confidence starts blank with bounds
50–100, and both chart annotations fit inside the SVG. Final `npm run verify`
passed 19 Node tests, 5 Python tests, TypeScript, the production build and the
participant-bundle scoring-field guard. `git diff --check` passed.

This is a software/UI review, not a human pilot. Real pilot/study modes remain
blocked. Browser debrief file-picker verification remains incomplete because the
upload tool denied workspace file access; the scorer-to-feedback integration is
covered by automated tests. No dependencies or IV-4 project files were changed.

## End-of-session feedback addition

The app now computes decision-quality feedback only after the questionnaire. The
researcher scorer generates a session-specific `.debrief.json` alongside its scored
CSV; loading it from the completed session's researcher screen enables recorded-weather
agreement and realised scenario costs. Ground truth remains outside the participant
bundle. Imported outcomes are memory-only and cleared on withdrawal/deletion/new session.

Automated tests cover the 12.5% expected-cost rule, presentation order, missing/mismatched
files, incomplete sessions, withdrawal, and the full Python-scorer-to-TypeScript-feedback
handoff. The real source data with synthetic all-GO responses yields 9/20 cost-minimising
decisions, 13/20 outcome matches and €280,000 realised scenario cost. Output overwrite
protection is checked. These are software-test inputs, not participant results.

Chrome traversed both practices and all 20 trials on a separate origin, with no early
results shown. After completing Raw TLX, the page displayed 9/20 decision-quality
matches and a 20-row table; outcome columns correctly remained pending until a
researcher file is loaded. Actual exported session/trial CSVs generated the expected
debrief and scored totals. **Browser file-picker verification is incomplete:** the
Chrome upload tool denied access to workspace files as outside its configured roots.
No workaround to that file-access restriction was attempted. JSON validation and the
same data-to-feedback calculation were exercised directly in automated integration tests.
The results page scored 100 accessibility / 100 best practices in a Lighthouse snapshot;
no console warnings/errors or external requests were recorded. Leaving from that page
returned to the withdrawn state without results. Final verification passed 19 Node and
5 Python tests, TypeScript, the production build and participant-bundle guard.

IV-3 renders the supplied episodes as one box per actual timestep, with linearly
interpolated p25/median/p75, minimum–maximum whiskers and no outlier dots. IV-4's
shared-app renderer remains a placeholder. `implemented` is separate from
`readyForStudy`: actual charts are visible in simulation while real sessions remain
blocked pending the agreed pilot/readiness review. Old protocol-1/2 placeholder
sessions cannot resume into the new visualization. Source weather files are unchanged.

## Automated checks

`npm run verify` passes 15 Node tests, 4 Python tests, TypeScript, the production build
and the participant-bundle guard. New tests cover known quartiles with an extreme
value (the extreme stays on the whisker), unchanged input arrays, all source timesteps,
truncated E13/E19 histories, both synthetic practices, invalid member alignment,
nonfinite values, and separation of rendering availability from study readiness.

## Actual Chrome walkthrough

Chrome DevTools MCP exercised the production preview at `127.0.0.1:4181`:

- Accepted consent, rendered both synthetic practices, and traversed all 20 real
  episode charts. IV-3 showed no placeholder in either practice or measured trials.
- Independently computed expected summaries using Python `statistics.quantiles`
  (`method='inclusive'`) and `statistics.median`. Browser assertions checked all
  **331** rendered boxes: upper quartile/height, whisker minimum/maximum, median, and
  timestep x-position agreed with source-derived expectations. E13 had 16 boxes;
  E19 had 9. No gaps were padded/interpolated. SVGs contained no circles or titles.
- Preserved the shared 0–16 y-axis, −48 to +3 x-axis, dashed 5 m/s limit, labelled
  transfer window and class palette. Marks are clipped to the shared frame so the
  left boundary box cannot overlap y-axis labels.
- Checked refresh/recovery during practice; the repeated attempt retained the same
  rendering and was flagged rather than silently replacing prior exposure.
- Completed questionnaire and actual session/trials/questionnaire/JSON downloads.
  The protocol-3 CSVs scored 20 measured responses with the explicit simulation
  override and matching session record. The default simulation guard is unchanged.
- No console errors/warnings and no external requests in the production walkthrough.
  The IV-3 chart's Lighthouse snapshot scored 100 accessibility / 100 best practices.
- Launched IV-4 separately in the shared app: its frame still displayed its placeholder
  without IV-3 marks; attempting a real pilot remained blocked.

Screenshots, independent-geometry results and simulation exports are under ignored
`test-results/iv3/`. They are software-verification artifacts, not human-pilot or
participant results. A human review of readability/colour vision and the two-person
pilot remain outstanding. No IV-4 source, database or virtual-environment files were
modified by this implementation; its pre-existing worktree diff digest was unchanged.

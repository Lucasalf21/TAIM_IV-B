# Verification record — 2026-11-05

This record describes software checks using synthetic responses. It is not a human
pilot, participant evidence, or validation of either visual encoding.

## Automated checks

`npm run verify` passed:

- Eight Node tests: participant data allowlist and truncated lead-ups; invalid source
  rejection; Latin-square position/adjacency balance; real-mode guard and ID validation;
  complete session including scheduled questions and Raw TLX; invalid/blank responses;
  recovery and damaged history; failed storage writes and CSV escaping.
- Two Python tests distinguishing normative decisions, hindsight correctness,
  asymmetric loss, and confidence error.
- Strict TypeScript check and Vite production build.
- Participant JavaScript bundle guard against supplied researcher-only fields.

Data preparation cross-checked the source JSON, 20 summary rows, and all 3,310 member
CSV rows. Source data files were not changed. The prepared dataset version is
`taim-ivb-8b1d28cc14cf5832`.

## Actual Chrome walkthrough

Chrome DevTools MCP exercised the production preview at `http://127.0.0.1:4173/`:

- Real study and pilot selection rejected with an explicit renderer-readiness error.
- IV-3 simulated session completed instructions, both practices, all 20 trials,
  questionnaire, and completion screen using UI controls.
- All numeric response fields began empty; exactly five measured episodes requested
  probability. Episode identifiers were absent from participant screens.
- Refresh during the second practice preserved the first submitted response. Recovery
  recorded the interrupted attempt and a retry with attempt 2/repeated exposure.
- Keyboard Tab reached the GO radio with visible focus. Labels, radio groups,
  headings, alerts and input bounds were checked in accessibility snapshots.
- Actual partial and complete CSV downloads and JSON backup were read back from disk.
  The final trials file had 23 rows: 20 measured submissions, two practice submissions,
  and one interrupted practice. All measured durations were nonnegative. Quoted,
  multiline comments survived CSV round-trip. Raw TLX matched the six supplied values.
- The default scorer rejected the downloaded simulation. With the explicit software-test
  override, it scored exactly 20 measured responses. It excluded practices/interruption.
- IV-4 setup with order row 10 reached the shared practice chart. This was a smoke check;
  the full walkthrough used IV-3. Their simulation render path is identical.
- No console warnings/errors during the complete walkthrough. The network log after
  reload contained only the local HTML, JS and CSS requests, with no external requests.
- A 390px emulated viewport had no horizontal page overflow. Study use remains on
  supervised laptops with matching display settings, not phones.

An initial trial accessibility audit found Plot's labelled SVG groups missing group
roles. The shared frame now assigns explicit roles. After rebuilding/reloading, the
trial Lighthouse snapshot scored **100 accessibility / 100 best practices**. The setup
navigation audit also scored 100/100. These scores are bounded automated checks, not
proof of complete accessibility. SEO and agent-discovery findings were left alone
because this is a local experiment, not a discoverable public site.

Final browser assertions confirmed 12 labelled SVG groups had valid roles, the
`3 h window` label was inside the chart bounds and used `rgb(188, 244, 236)`, response
inputs were blank, and no participant episode ID was visible. The final build also
accepted the actual complete backup under the stricter recovery-history validation.

Local evidence is kept under ignored `test-results/browser/`: downloaded CSVs, backup,
scored simulation, screenshots and Lighthouse reports. These files are software test
artifacts and must never be pooled with study exports.

## Limits and readiness gates

- Storage failure and malformed-session handling were checked by automated core tests;
  browser quota exhaustion/disabled storage were not deliberately induced.
- Other-tab change detection is a defensive stop, not a concurrent-session system.
  Run one tab per origin. A simultaneous multi-tab race was not tested.
- No cross-browser study, screen-reader user evaluation, timing calibration on study
  hardware, or human pilot has been performed.
- Both chart renderers remain unimplemented and real sessions stay blocked.
- Validate both encodings, add their participant explanations, agree the protocol with
  IV-4, perform the two-person pilot, then freeze the study build before recruitment.

The root README's previous pipeline documentation is preserved, with an app link
added. The pre-existing deletions of `IV-3/.gitkeep` and `IV-4/.gitkeep` were not changed.

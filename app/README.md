# IV-B shared experiment template

English-only, supervised browser experiment shared by IV-3 (box-plot series) and IV-4
(unconnected dot series). IV-3 renders real box-plot series; IV-4 remains a placeholder
in this shared app. Both renderers have `readyForStudy: false`. Only **simulated** sessions
can run. A simulated session is software verification, not a human pilot or study.

## Run locally

Requires Node.js 22.18+ (Node 24 recommended), npm, and Python 3 for scoring/tests.

```bash
cd app
npm ci
npm run dev
```

For testing sessions use a production build, without hot reload:

```bash
npm run build
npm run preview -- --port 4173 --strictPort
```

Open the URL printed by Vite. Keep the same browser profile, host, and port when
recovering a session: browser storage belongs to that origin. Dependencies are
bundled locally; the production app uses no CDN, fonts, telemetry, or external API.
The dev server uses its own local hot-reload connection. No ERA5 download is run.
Run one tab and one session at a time; do not use private browsing for data collection.

## Researcher procedure

1. Enter an anonymous ID (e.g. `P01`), condition and order row. Do not enter names.
2. Select **Simulated walkthrough**. Real pilot/study modes intentionally fail until
   the selected renderer is ready. Setup does not expose a condition switch during trials.
3. Hand over the laptop. Mandatory information/consent precedes instructions, two
   synthetic practices, then 20 trials. No checkbox is preselected; declining is terminal.
4. Each trial requires GO/CANCEL and confidence 50–100%, with no default. Five
   episodes also require probability 0–100%, with no default. Inputs accept decimals.
5. Submission locks the response. The next trial starts only when requested.
6. After trial 20, complete the six Raw NASA-TLX dimensions and optional comments.
7. Return to **Researcher screen** and download **all three CSVs separately**.
   Preserve the JSON backup as well. Confirm downloaded files before replacing a session.

The researcher screen is a supervised control, not authenticated access. Opening it
mid-trial marks that attempt interrupted; resuming replays the trial as a flagged
repeated exposure. Participants must not operate researcher controls. This app stores
only the current session; replacing it overwrites that browser copy after an explicit
acknowledgement. Export files to your research storage after every session.

On refresh/restart, select **Recover saved session**. Completed responses remain locked.
An active trial becomes interrupted; a retry gets a new attempt number and
`repeated_exposure=true`. Unsaved input is not restored. Failed storage writes block
progression. Open the researcher screen to export partial CSVs/JSON before recovery.
If saved JSON is damaged, export its raw backup; do not overwrite it without review.

## Protocol fixed by this template

- Costs: CANCEL €5,000; GO then abort €40,000; successful GO €0.
- Limit: wind **strictly greater than 5 m/s at 100 m**, within the 3-hour window.
- Same 20 source episodes and datasets for both conditions.
- Two synthetic practices, all members clearly safe then clearly unsafe. Practice
  feedback describes these distributions; IV-3 draws them with the same box-plot renderer.
- No feedback during measured trials, no return to submitted responses.
- Probability questions: E01 (0%), E07 (10%), E10 (20%), E13 (30%), E16 (100%).
  These fixed identifiers are used internally and in researcher exports, not shown to
  participants. Their selection is by difficulty, not presentation position.
- A 20-row even balanced Latin square controls episode order. Assign the same 10
  distinct rows across conditions for 10 participants each; not every position can be
  fully balanced with only 10 people. The full 20-row square balances directed adjacency.
- Timer begins after chart insertion and two animation frames, and stops on valid
  submission, before saving. It includes all responses, including probability questions,
  but excludes the subsequent Next screen. Never compare probability-question trial
  times with ordinary trial times without accounting for that difference.
- Switching away from the page keeps the clock running and adds `page-hidden`; reloading
  or opening researcher controls creates an interrupted attempt. Review these flags and
  repeated exposures when defining analysis exclusions. Do not silently discard them.
- Raw TLX uses 0–100 in steps of 5; all dimensions have higher=worse orientation,
  including performance (0 perfect, 100 failure). Raw TLX is their unweighted mean.
  No pairwise weighting is implemented. Comments are optional, maximum 4,000 characters.

## Implement the two charts

Entry points:

- `src/chart/iv3.ts`: one box per timestep; median, p25–p75 box, min–max whiskers;
  no individual outlier points. Do not use a default 1.5-IQR whisker algorithm.
- `src/chart/iv4.ts`: ten member values at each timestep as unconnected dots.
- `src/chart/frame.ts`: shared Observable Plot frame, palette, practice generator,
  and renderer interface. Each renderer returns Plot marks from its `ChartContext`.

Retain shared dimensions (900×440), fixed x domain (−48 to +3 hours), common y domain
(0–16 with integer ticks), 5 m/s
line, and 3-hour window. Palette tokens are transcribed from the supplied class slide;
confirm them with the partner group before a human pilot. Do not add zoom, tooltips,
filters, per-member emphasis, or participant chart controls.

Input `episode.hours`, `members` (member × timestep), and `windowStart` contain the actual
samples. E13 has 16 timesteps; E19 has 9; the rest have 17. Do not pad or interpolate
missing lead-up. All have one decision-window sample at relative hour zero: the window
duration is 3 hours, even though its sampled start/end timestamp is identical.

IV-3 draws one box for each actual timestep, using all ten member values. Quartiles
use linear interpolation (R-7, matching NumPy's default percentile convention); whiskers
reach the true minimum and maximum, with no outlier dots. Boxes use the class teal
palette and a light median line. Marks are clipped to the shared frame; missing lead-up
is not filled, and a boundary box at −48 h is clipped at that axis boundary. The
instructions and chart legend explain the encoding. The transfer-time box is at 0 h;
the 0–3 h shading indicates duration, not extra interpolated samples.

Implemented encodings render in simulated mode too. `implemented` controls actual
chart availability; `readyForStudy` remains false until the real-session readiness
review. Select IV-3 + Simulated walkthrough to inspect both practices and all 20
actual episodes. Simulation exports remain marked and rejected by the scorer by default.
IV-4 still shows an empty frame here; its separate Flask project is not changed.

Before collecting human data, review the implementation and agreed protocol with IV-4,
arrange the two-person pilot, then enable the appropriate real-session readiness flag
for that approved stage. Correct any pilot issues and freeze the study build before
main-study recruitment. Rendering tests are not human-pilot evidence.

## Data boundary and provenance

`npm run prepare:data` checks JSON shape, finite nonnegative trajectories, 10 members,
3-hour sample spacing, one window timestep, all 20 summary rows, derived probabilities,
and every member CSV row against the JSON. It preserves source files and writes:

- `src/generated/stimuli.json`: allowlisted participant data with relative times only;
  no supplied probabilities, truth, normative answers, or summary statistics.
- `scripts/source-manifest.json`: source SHA-256 values and participant dataset version,
  for researcher-side scoring. Never import this manifest into the frontend.

The build scans bundled JavaScript for supplied scoring fields. The data needed for a
visualization still permits a technically knowledgeable person to derive ensemble
probabilities: this is a supervised experiment, not a security boundary against
developer tools. Recorded truth stays outside the served production directory.

Serve **only `app/dist`** for participant use, not the repository root. Vite development
mode is for implementation, not collecting study data.

## Exports and scoring

### End-of-session feedback

After all 20 trials **and** the workload questionnaire, the participant sees a results
page with decision-quality totals and a per-trial table. This is calculated from the
ensemble trajectories using the stated €5,000/€40,000 cost rule. It is not shown during
measured trials or before the questionnaire. Practice trials are excluded.

Recorded weather and realised costs remain researcher-only until the debrief. To show
both kinds of feedback in a supervised session:

1. Export the **session CSV** and **trials CSV** from the completed session.
2. Run the scoring command below. Alongside `new-scored.csv`, it automatically creates
   **`new-scored.debrief.json`**. For software simulations only, add `--allow-simulated`.
3. On the completed session's **Researcher screen**, choose that file under
   **Completed-session debrief file**. Then open **Participant screen**.
4. The results now also show recorded-weather agreement, total realised scenario cost,
   and each trial's recorded outcome and loss. Both feedback types are labelled
   separately: a good decision under uncertainty can have an unlucky outcome.

The JSON is validated against session ID, dataset, protocol, mode, condition, all 20
episode IDs in presentation order, and the actual choices. Mismatched, incomplete,
invalid or oversized files are rejected. It does not modify responses, timestamps or
questionnaire answers. Imported outcomes are held only in memory: reload requires
loading the file again; withdrawal, deletion or starting another session clears them.

This manual step keeps recorded outcomes out of the shipped participant JavaScript.
No outcome file is served or fetched automatically. File selection reads the local file;
it does not upload it to a server. Treat debrief JSONs like other session-level exports
for retention/deletion, including any copies generated for a subsequently withdrawn
session. Do not give participants debrief files before they finish.

Every CSV includes session ID, participant ID, condition, mode, protocol, dataset version
and order row. Session CSV adds exact sequence and lifecycle state. Trials CSV includes
practices, interrupted attempts, submitted responses, timing and flags. Questionnaire
CSV has a header only until answered. Spreadsheet-formula prefixes in free text are
escaped; JSON backups preserve the original comments. Treat comments as potentially
identifying information when sharing exports.

Score exports outside the browser:

```bash
python3 scripts/score.py /path/to/trials.csv /path/to/new-scored.csv --session /path/to/latest-session.csv
```

Scoring rejects simulation by default and refuses to overwrite an existing output.
Both the scored CSV and its `.debrief.json` must have fresh filenames. Complete scoring
requires all 20 measured responses matching the session's stored episode sequence.
The latest session CSV is mandatory: it must be complete, have current recorded consent,
and not be withdrawn. Every trial's session metadata must match it. Partial exports
remain available for recovery/audit but cannot enter the scorer. Never supply an older
complete session record after withdrawal: no offline tool can detect a newer record it
has not been given. Remove withdrawn exports and all derived scored copies yourself.
`--allow-simulated` exists only to check software; resulting rows are not study evidence.
Pilot and study modes remain labelled and must be analysed separately. Practice and
unsubmitted attempts are excluded from scoring. Repeated exposures and flagged trials
remain present for an explicit exclusion decision. The scorer checks source hashes and
the export's dataset/protocol before joining against `../data/episodes.csv`.

Scored columns distinguish:

- `outcome_correct`: GO when no exceedance occurred, CANCEL otherwise (hindsight).
- `normative_agreement`: agreement with expected-cost minimisation, threshold 12.5%.
- `realised_cost_eur`: observed loss under the asymmetric cost rule.
- `confidence_brier`: squared error of confidence (0–1) against hindsight correctness.
- `probability_brier`: squared error of the estimated exceedance chance against the
  binary outcome, when a probability estimate was collected.

Confidence calibration needs aggregate reliability analysis too; a single Brier score
is not a calibration curve. Summarise outcomes by participant before comparing groups;
trials are repeated observations, not 200 independent participants. No inferential
statistics are automatically chosen by this template.

ERA5 ensemble spread is reanalysis uncertainty, not operational forecast uncertainty.
Include that distinction and 10-member probability granularity in the report.
Source citation: Copernicus Climate Change Service, Climate Data Store (2023), *ERA5
hourly data on single levels from 1940 to present*, DOI: 10.24381/cds.adbb2d47. Add the
actual retrieval date to your report; it is not recorded in these supplied files.
The programme attribution is shown in the app footer. See the root README §18.

## Verification

```bash
npm run verify
```

Runs Node assert-based tests, Python scoring tests, strict TypeScript checking, the
production build, and the participant-bundle guard. TypeScript explicitly resolves
Plot's shipped declarations because Plot 0.6.18's exports omit the types entry.
See `VERIFICATION.md` for the actual browser walkthrough and remaining readiness gates.

## Consent, withdrawal and deletion (protocol 2)

Editable participant wording lives in **`src/consent.ts`**. This is a draft for the
two teams to review before recruitment. It describes the purpose, approximately
15–20-minute duration, collected data, fictional costs, voluntary participation,
possible fatigue, data access, retention and deletion. The chosen draft policy is:

- IV-3, IV-4 and course teaching staff may access session-level coursework data.
- Only aggregates are used in public presentations; raw exports are not published.
- The teams delete session-level data and backups within **90 days of the session**.
- Participants ask the supervising researcher for deletion using the participant/session
  codes shown on completion/exit. Provide a real team contact route during recruitment;
  add it to the wording when agreed. There is no invented email address in the draft.
- Unlinked aggregate statistics may no longer support individual removal.

Confirm that the professor accepts this procedure, the retention period, storage access
and actual follow-up contact route. Change the consent version whenever wording changes,
and update the scorer's accepted version and tests to match. Record that frozen wording
with the study materials. This app is not an institutional ethics approval or legal review.

The header keeps **Leave experiment** available throughout participant screens, including
the questionnaire and completion page. Leaving is immediate; it does not require filling
inputs, answering a reason, or clicking a confirmation. It discards attempts/questionnaire
and marks the session `withdrawn` (or `declined` before consent). Only setup/consent/exit
metadata remains. That exit record cannot resume into trials. All CSVs include session
phase, consent version/time and withdrawal time; withdrawn trial/questionnaire CSVs are
header-only. Timers stop immediately. If saving the exit record fails, the app tries to
delete the local session; if both operations fail it clearly requests researcher cleanup.

**Delete local session** is available after leaving/completing and on the researcher
screen (also for damaged/legacy saves). Its confirmation shows the target session codes
where available and explains the boundary. It removes only the experiment's storage key
and in-memory session; it does not clear unrelated site/browser data or source weather
files. Keep session codes before deleting if downloaded copies need removal.

For a withdrawal/deletion request, the researcher must:

1. Re-export the latest exit/session record if an audit record is needed, before local deletion.
2. Locate copies by participant/session ID across **both teams**: session/trial/questionnaire
   CSVs, JSON backups, scored CSVs and shared/backup storage. Remove the requested
   response data and exclude it from any pending analysis. Do not retain an old complete
   status as permission to score withdrawn responses.
3. Remove or recompute derived results while the participant remains identifiable.
   Explain the limit once only unlinked aggregates remain.
4. Delete the local session as requested and follow the agreed retention policy for all
   other copies. File-system deletion of downloads is a human procedure; browser code
   cannot erase them. Any necessary request log should contain no experimental answers.

Consent was introduced in `ivb-template-2`; the current `ivb-template-3` introduces real
IV-3 chart rendering in simulation. Version-1/2 saves are not silently migrated to a
different stimulus: recovery rejects them while raw-backup/delete controls remain
available. Keep earlier simulation artifacts separate from new exports.

The class teal/orange palette is the shared default, not an optional participant mode.
The limit also has a dashed line and text label; the window has a boundary and text label,
so meaning does not depend on hue alone. Keep those cues and the same palette across
conditions. Review the IV-3 marks for colour-vision accessibility during the pilot;
the IV-4 empty frame is not evidence of a completed accessible chart. Integer
y ticks were checked at the desktop study size; do not use phones for the main study.

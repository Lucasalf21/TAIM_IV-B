# IV-B shared experiment template

English-only, supervised browser experiment shared by IV-3 (box-plot series) and IV-4
(unconnected dot series). This branch supplies the experiment shell, not the two
encodings. Both renderers have `readyForStudy: false`. Only **simulated** sessions
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
3. Hand over the laptop. Instructions precede two synthetic practices, then 20 trials.
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
  feedback describes these distributions; the simulated placeholder does not draw them.
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
(0 to one above the ceiling of the dataset-wide maximum, minimum upper limit 9), 5 m/s
line, and 3-hour window. Palette tokens are transcribed from the supplied class slide;
confirm them with the partner group before a human pilot. Do not add zoom, tooltips,
filters, per-member emphasis, or participant chart controls.

Input `episode.hours`, `members` (member × timestep), and `windowStart` contain the actual
samples. E13 has 16 timesteps; E19 has 9; the rest have 17. Do not pad or interpolate
missing lead-up. All have one decision-window sample at relative hour zero: the window
duration is 3 hours, even though its sampled start/end timestamp is identical.

The template uses no Plot marks for simulation, so its measured-trial placeholder cannot
be mistaken for an implemented encoding. Before enabling real sessions, implement and
validate the renderer with both synthetic practices and all 20 episodes; add matching
encoding instructions/legend, remove placeholder-only copy for real mode, and review
the protocol with IV-4. Only then change its readiness flag. Run a two-person human
pilot, make agreed corrections, and freeze the protocol/build before the main study.

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

Every CSV includes session ID, participant ID, condition, mode, protocol, dataset version
and order row. Session CSV adds exact sequence and lifecycle state. Trials CSV includes
practices, interrupted attempts, submitted responses, timing and flags. Questionnaire
CSV has a header only until answered. Spreadsheet-formula prefixes in free text are
escaped; JSON backups preserve the original comments. Treat comments as potentially
identifying information when sharing exports.

Score exports outside the browser:

```bash
python3 scripts/score.py /path/to/trials.csv /path/to/new-scored.csv
```

Scoring rejects simulation by default and refuses to overwrite an existing output.
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

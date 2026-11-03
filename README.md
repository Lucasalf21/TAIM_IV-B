# taim_era5.py — building the TAIM episode pool from ERA5

Tool for the TAIM 2026-27 InfoVis challenge. It turns archived ECMWF ERA5 data into the
fixed set of ~20 forecast episodes every student group tests against. Three commands —
`retrieve` → `build` → `select` → `export` — plus an offline `selftest`.

---

## 1. Overview

The deliverable is a stimulus set of ~20 episodes — `episodes.xlsx` (the episode list:
probability, outcome, costs) plus `episodes_members.csv`/`.json` (the per-member
trajectories needed to render member-view encodings). Each episode is a real wind
scenario with an ensemble of plausible outcomes (the stimulus) and a record of what
actually happened (the ground truth). The ensemble can be visualised with different
uncertainty encodings and an experiment run on this shared set.

The pipeline:

| command | does | reads / writes |
|---|---|---|
| `retrieve` | downloads ERA5 data for a date range | → `era5/*.nc` |
| `build` | computes each episode's exceedance probability and attaches the outcome | `era5/*.nc` → `era5_archive.csv` |
| `select` | draws and freezes the stratified ~20-episode set | `era5_archive.csv` → `episodes.csv`/`.xlsx` |
| `export` | writes per-member trajectories for member-view encodings | `era5/*.nc` + `episodes.csv` → `episodes_members.csv`/`.json` |
| `selftest` | verifies the logic offline | nothing |

---

## 2. What the data is

Two ERA5 products, both using **100 m wind** (u/v components), so there is no height
conversion and the stimulus and the truth are the same variable at the same level:

- **Stimulus — ERA5 "ensemble members".** ERA5's data assimilation runs as a
  10-member ensemble; the spread between members is the uncertainty the challenge asks
  participants to read. 10 members, 3-hourly, ~63 km resolution. `build` collapses these
  to one probability per episode; `export` (§12) writes the full member trajectories out,
  which is what the member-view encodings render from.
- **Ground truth — ERA5 "reanalysis".** The single best-estimate field. Hourly,
  ~31 km. This defines what actually happened for scoring decisions.

**Framing note for the report.** An ERA5 ensemble expresses *reanalysis* uncertainty
about the past, not *forecast* uncertainty, and has 10 members rather than an
operational forecast ensemble's ~51. The participant's task — read a probability off a
spread — is identical, but the stimulus is "a distribution of plausible winds", not
literally "a weather forecast". State this in threats to validity. The 10-member count
also has a concrete consequence for stimulus difficulty, covered in §19.

---

## 3. Prerequisites

Python 3.9 or newer, then:

```bash
pip install cdsapi xarray netCDF4 numpy pandas openpyxl
```

`xarray` + `netCDF4` read the downloaded `.nc` files; `openpyxl` writes the Excel
output; `cdsapi` talks to the data store. If `netCDF4` fails to build via pip, install
it with conda (`conda install -c conda-forge netCDF4`).

---

## 4. Account registration

The data comes from the Copernicus Climate Data Store (CDS). Getting access is **three
separate acts** — doing one does not do the others, and this is the most common source
of confusion:

1. **Register** an ECMWF/Copernicus account at
   <https://cds.climate.copernicus.eu> and confirm your email.
2. **Get your Personal Access Token** from your profile at the new account (§5).
3. **Accept the dataset licence** on the dataset's own page (§6).

A retrieval fails until all three are done. Registration can take a little while to
activate, so do this a day ahead, not at the moment you need the data.

---

## 5. One-time setup: the API key

### Where the key comes from

Log in and open your profile:

```
https://cds.climate.copernicus.eu/profile
```

It shows a **Personal Access Token** and the two lines to copy.

### Where the key file must live — read this carefully

The file is named `.cdsapirc` and it must sit in your **user home (root) directory** —
**not** the project folder, **not** next to `taim_era5.py`. The `~` in `~/.cdsapirc`
*means* that home directory:

- **Windows:** `C:\Users\<you>\.cdsapirc` — for you, `C:\Users\alexa\.cdsapirc`
- **macOS / Linux:** `/home/<you>/.cdsapirc` or `/Users/<you>/.cdsapirc`

If the file is anywhere else, the client will not find it and you get an
authentication error that looks like a bad token but isn't. This is the single most
common setup mistake.

### What the file must contain — current format

```
url: https://cds.climate.copernicus.eu/api
key: <your Personal Access Token>
```

Do **not** use the older form you'll see in many tutorials
(`url: .../api/v2`, `key: <UID>:<APIKEY>`, `verify: 0`) — the current CDS uses a single
token and the `/api` URL, and the old form fails.

### Creating a dot-file on Windows

Windows Explorer resists filenames that begin with a dot. Easiest route:

```
notepad %USERPROFILE%\.cdsapirc
```

Notepad offers to create it; say yes, paste the two lines, save. `%USERPROFILE%` is
exactly your home directory, so this guarantees the right location.

---

## 6. One-time setup: accepting the licence

Open the dataset's Download tab and accept **every** licence listed under
"Terms of use / Manage licences":

```
https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=download#manage-licences
```

Typically this is the *Licence to use Copernicus Products*, possibly with an additional
ERA5 term. Accept all of them — if even one is outstanding, `retrieve` fails with:

```
403 Client Error: Forbidden ... required licences not accepted
```

The error message includes this same link, so if you hit it, that is the fix.

---

## 7. Verifying the install

Do these three checks in order, before any download.

### 7a. Logic works (no network)

```bash
python taim_era5.py selftest
```

Prints `OK — logic verified` and shows the 10-member aggregation. Confirms numpy,
pandas, and the computation are sound.

### 7b. The key file is in the right place

The commonest failure is `.cdsapirc` being in the wrong folder. This one-liner resolves
`~` to the actual path Python will use and tells you whether the file is there:

```bash
python -c "import os;p=os.path.expanduser('~/.cdsapirc');print(p,'EXISTS' if os.path.exists(p) else 'MISSING')"
```

It must print **EXISTS** and a path in your **home directory** (e.g.
`C:\Users\alexa\.cdsapirc`). If it says MISSING, or the path is your project folder,
move the file to the home directory shown and rerun — see §5.

### 7c. The key parses and the client initialises

```bash
python -c "import cdsapi; cdsapi.Client()"
```

No error = the file was found, read, and parsed. (This does not yet prove the licence
is accepted — that shows up on the first real retrieve, §6.)

---

## 8. Choosing the physical parameters

Fix these once, before downloading — changing any of them invalidates what you pulled.

| argument | default | meaning |
|---|---|---|
| `--lat` / `--lon` | `41.15 / -8.75` | the forecast point (offshore Porto by default) |
| `--threshold` | `5.0` | wind speed in m/s at 100 m above which the transfer is blocked |
| `--window-h` | `3` | operational window length in hours (ensemble is 3-hourly, so 3 h = 1 step) |

**The threshold is the consequential one.** It sets the distribution of the exceedance
probability *p*, and that distribution is the experiment: too high and every episode is
a certain GO, too low and every one a certain CANCEL, with nothing in the ambiguous
band the challenge depends on. You tune it empirically after a first `build`, which is
free to repeat.

Keep `--lat`, `--lon`, `--threshold`, and `--window-h` identical across `build` and
`select` runs.

### Finding a working threshold

The default of **5 m/s** is the tuned value for the reference point (41.15, −8.75) in
spring — it gives a well-populated ambiguous band (see the worked result below). It is
**not** a universal constant: a different point or season will have a different wind
climatology, so if you change `--lat`/`--lon` or the period, re-tune the threshold. The
original 12 m/s was far too high here (710/735 episodes trivial), which is why the
default was lowered to 5.

To tune for a new point or season, rebuild across a range of thresholds with
`--no-truth` (fast, and it never re-downloads), reading the `.09-.35 AMBIG` count each
time:

```bash
python taim_era5.py build --no-truth --threshold 10
python taim_era5.py build --no-truth --threshold 8
python taim_era5.py build --no-truth --threshold 6
python taim_era5.py build --no-truth --threshold 5
```

Aim for **15–25 ambiguous candidates** — a surplus, not just the 7 the stratum needs,
because the near-threshold guard and the one-episode-per-day thinning in `select` both
reduce the usable count.

**Worked result for the reference point (41.15, −8.75), spring 2026, 3-hourly, 3 h
window.** The sweep showed the threshold must come right down (the counts below are
indicative; re-run the sweep for your own window and period):

| `--threshold` (m/s) | ambiguous (.09–.35) | verdict |
|---|---|---|
| 12 | 6 | far too high — 710/735 episodes trivial GO |
| 5 | 47 | healthy shoulder across all bands |

**The working threshold for this dataset is 5 m/s.** At 5 m/s the distribution is
262 (`<.02`) / 47 (ambiguous) / 29 (middle) / 33 / 364 (`>.98`) — bimodal, as wind
always is, but with a well-populated decision-relevant shoulder. Record this value so a
later rebuild does not restart from the lopsided 12. See §19 for how to read this
balance and for the unit and scenario-plausibility implications of a 5 m/s limit.

After settling the threshold, inspect how the ambiguous episodes split across the three
attainable levels (0.1, 0.2, 0.3 — a consequence of 10 members, see §19):

```bash
python -c "import pandas as pd; d=pd.read_csv('era5_archive.csv'); a=d[(d.p_ensemble>=0.09)&(d.p_ensemble<=0.35)]; print(a.p_ensemble.round(2).value_counts().sort_index())"
```

If they pile onto a single level, widen the ambiguous band (accept 0.05–0.45) so the
drawn stimuli span more than one difficulty.

---

## 9. Retrieving the data

A single call pulls both products for a span of months. Three spring months is a good
balance — enough distinct weather regimes to make the calibration check meaningful and
to keep stimuli from being near-duplicates, without the volume of six:

```bash
python taim_era5.py retrieve --start 2026-03-01 --end 2026-05-31 --box 0.25
```

Points to understand:

- **It is month-granular.** `retrieve` iterates over *months* and pulls *every day* of
  each month; the day part of `--start` / `--end` is ignored. `--start 2026-03-01
  --end 2026-05-31` and `--start 2026-03-15 --end 2026-05-02` download exactly the
  same thing: all of March, April, May. This is deliberate — month-blocks are far more
  efficient than daily requests.
- **`--box 0.25`** downloads a small area around the point instead of the 1° default.
  You only use the nearest gridpoint, so a smaller box means a much smaller, faster
  download for identical results. Use it.
- **`--product`** defaults to `both` (ensemble + reanalysis). Pass `ens` or `rea` to
  pull just one — useful when iterating.
- **ERA5 lags real time by ~5 days.** Very recent dates are not yet available; use a
  span that has fully matured.
- **Requests queue.** A pause with no output while CDS processes server-side is normal,
  not a hang. Re-running skips files already present, so an interrupted download
  resumes safely.

---

## 10. Building the archive

```bash
python taim_era5.py build --threshold 5
```

For every rolling window `build` computes *p* — the fraction of the 10 members whose
maximum wind over the window exceeds the threshold — attaches the reanalysis outcome,
and writes `era5_archive.csv`. It prints the distribution of *p* and the count of
ambiguous candidates.

**Tune the threshold with `--no-truth` first** — the fast, free loop for finding a
value that populates the ambiguous band. The full procedure, the sweep, and the working
value for the reference dataset (5 m/s) are in §8; §19 explains how to read the
resulting balance. Once the threshold is settled, run a full `build` (without
`--no-truth`) to attach outcomes.

**The reliability table.** A full `build` reports observed exceedance rate against mean
*p*, per bin. This is the empirical check that the ensemble is calibrated — that
episodes labelled 20% actually happen about 20% of the time — which the normative rule
depends on (§19). Over three months this check is meaningful; if a bin with a real
count is badly off, that is a signal to add another month rather than push on.

---

## 11. Selecting the stimulus set

```bash
python taim_era5.py select
```

This draws the stratified set — 6 clear-GO, 7 ambiguous, 2 middle, 5 clear-CANCEL by
default — one episode per day to avoid near-duplicates, and writes `episodes.csv` and
`episodes.xlsx`.

**The guard defaults to 0.02, which is the right value for this 10-member data.** With
10 members, *p* can only take the values 0.0, 0.1, 0.2, … The ensemble-scaled guard
(`--guard auto` = 1/members = 0.1) would exclude a 0.1-wide band around p\* = 0.125 and
wipe out most of the ambiguous levels. Even 0.03 is too wide: 0.1 is only 0.025 from
p\* = 0.125, so a 0.03 guard deletes every *p* = 0.1 episode and collapses the ambiguous
band to 0.2 and 0.3. The default 0.02 excludes only the strip [0.105, 0.145], which
contains no attainable 10-member value, so it drops nothing and keeps 0.1, 0.2 and 0.3
all usable. See §19.

**Levers** (all optional):

```bash
python taim_era5.py select --abort-cost 20000        # moves p* to 0.25
python taim_era5.py select --n-ambiguous 9 --seed 7  # reshape / redraw
```

`select` prints a **calibration gap** — the sum of the chosen episodes' *p* against the
number that actually exceeded. If it is large, the drawn set is unrepresentative by
chance; redraw with a different `--seed` and note in the report that you did. Sweep a
few seeds and compare: prefer the smallest `|gap|`, and glance at the `exceeded` column
of the high-confidence (*p* = 1.0) and ambiguous rows — you want the certainties to have
verified and the ambiguous band to contain both outcomes.

### The frozen set for 2026-27

> **To be finalised after the 3-hour re-selection.** An earlier set was drawn with a
> 6-hour window (threshold 5 m/s, `--guard 0.02 --seed 3`, calibration gap −0.70). The
> window is now 3 hours, which changes every episode's *p*, so the set must be re-drawn:
> run `build --window-h 3`, re-tune the threshold, then sweep seeds on
> `select --guard 0.02` and record the chosen command, threshold, seed, and calibration
> gap here once settled.

The procedure for choosing the set: run a seed sweep, prefer the smallest `|calibration
gap|`, and confirm the ambiguous band spans 0.1/0.2/0.3 and contains both outcomes while
the high-confidence episodes verify (see the paragraph above).

`episodes.xlsx` is the frozen artefact. **Use the identical file across the whole
comparison** — the cross-group comparison is only valid if every condition is tested on
the same stimulus set.

---

## 12. Exporting member data for rendering

`select` produces the episode *summary* — `p_ensemble` and a median — which is enough
for a fan chart or a percentile band, but **not** for the member-view encodings
(spaghetti, HOPs, dotplot). Those need every member's full trajectory, which `build`
collapses away when it computes *p*. `export` recovers it from the NetCDF already in
`era5/` — no new download:

```bash
python taim_era5.py export
```

Run it after `select`. It reads `episodes.csv` and, for each of the 20 episodes, pulls
the full 10-member × timestep wind matrix, writing two files. On finishing it also prints
a short guide — "which files each visualization reads" — mapping the summary and member
encodings, and the evaluation, to the files just written (the table below is the same
mapping):

- **`episodes_members.csv`** — long format, one row per member per timestep:
  `episode, member, step, time, in_window, wind_speed_100m`. The primary render source.
  `in_window` is 1 for the decision-window steps and 0 for the lead-up.
- **`episodes_members.json`** — the same data nested per episode, plus precomputed
  `p10`/`p50`/`p90` per timestep and a `window_start_index`. Handier for a JS prototype,
  and gives the summary encodings their fan-chart inputs ready-made.

**Lead-up.** By default `export` includes 48 h before the window (`--lead-h 48`) as well
as the 3 h window itself — on the 3-hourly grid that is 16 lead-up steps + 1 window step
= 17 timesteps per episode per member. The lead-up is what makes a member view
compelling — the fan of trajectories visibly widening as it approaches the decision
point is the whole visual argument for an ensemble. Set `--lead-h 0` for window-only, or
another value to taste.

Both files carry the **same** underlying 10 members; the JSON's percentiles are derived
from them. So a fan chart and a spaghetti plot of the same episode are genuinely the
same distribution shown two ways — the property that makes the between-group comparison
valid (§2).

### Which files each encoding needs

| encoding | family | needs | from |
|---|---|---|---|
| Fan chart / percentile band | summary | `p10`, `p50`, `p90` per timestep | `episodes_members.json` → `percentiles` |
| Box plot | summary | per-member values (or precomputed quartiles) | `episodes_members.csv`, reduce per member |
| Ensemble spaghetti | member | every member's full trajectory | `episodes_members.csv` — group by `member`, line over `step` |
| Animated HOPs | member | same as spaghetti, one member per frame | `episodes_members.csv` — filter one `member`, cycle |
| Quantile dotplot | member | one value per member (e.g. max over window) → quantiles | `episodes_members.csv` — filter `in_window`, max per member |

Two things to tell students:

- **The CSV is sufficient for everything; the JSON is a convenience.** The JSON is the
  CSV plus precomputed percentiles and the window index. Member groups usually prefer
  the CSV's long format; summary groups usually prefer the JSON's ready percentiles.
  Either can be derived from the CSV alone.
- **Reduce over the window, not the lead-up.** Any encoding that collapses a trajectory
  to a single number — the dotplot, and the decision itself — must compute it over the
  decision window only: filter `in_window == 1`. The lead-up is visual context, not part
  of the probability.

---

## 13. Command reference

| command | what it does | network |
|---|---|---|
| `selftest` | verify aggregation logic | none |
| `retrieve` | download ERA5 ensemble + reanalysis to `era5/*.nc` | CDS |
| `build` | `*.nc` → *p* → outcome → `era5_archive.csv` | CDS (unless `--no-truth`) |
| `select` | draw and freeze the ~20-episode set | none |
| `export` | write member-level render data for the selected episodes | none |

---

## 14. Argument reference

### Shared by `retrieve`, `build`, `select`, `export`

| argument | default | meaning | example |
|---|---|---|---|
| `--lat` | `41.15` | point latitude | `--lat 41.70` |
| `--lon` | `-8.75` | point longitude (east +, so Portugal is negative) | `--lon -8.95` |
| `--threshold` | `5.0` | m/s at 100 m, the exceedance threshold | `--threshold 8` |
| `--window-h` | `3` | window length in hours (3 h = 1 step on the 3-hourly grid) | `--window-h 6` |
| `--archive` | `era5_archive.csv` | the candidate archive path | `--archive spring.csv` |
| `--data-dir` | `era5` | folder for downloaded `.nc` files | `--data-dir C:\taim_data` |

### `retrieve` only

| argument | default | meaning | example |
|---|---|---|---|
| `--start` | *required* | first month to cover (day ignored) | `--start 2026-03-01` |
| `--end` | *required* | last month to cover (day ignored) | `--end 2026-05-31` |
| `--product` | `both` | `both`, `ens`, or `rea` | `--product ens` |
| `--box` | `1.0` | degrees-wide area around the point | `--box 0.25` |
| `--overwrite` | off | re-download files already present | `--overwrite` |

### `build` only

| argument | default | meaning | example |
|---|---|---|---|
| `--no-truth` | off | compute *p* only, skip the reanalysis attach | `--no-truth` |

### `select` only

| argument | default | meaning | example |
|---|---|---|---|
| `--cancel-cost` | `5000` | € cost of cancelling | `--cancel-cost 5000` |
| `--abort-cost` | `40000` | € cost of going then aborting (ratio sets p\*) | `--abort-cost 20000` |
| `--n-clear-go` | `6` | episodes with *p* ≤ 0.08 | `--n-clear-go 4` |
| `--n-ambiguous` | `7` | episodes with 0.09 ≤ *p* ≤ 0.35 | `--n-ambiguous 9` |
| `--n-middle` | `2` | episodes with 0.36 ≤ *p* ≤ 0.64 | `--n-middle 4` |
| `--n-clear-cancel` | `5` | episodes with *p* ≥ 0.65 | `--n-clear-cancel 3` |
| `--guard` | `0.02` | exclude episodes within this abs. *p* of p\* (`auto` = 1/members) | `--guard auto` |
| `--seed` | `1` | random seed for the draw | `--seed 7` |
| `--out` | `episodes` | output basename (`.csv` + `.xlsx`) | `--out spring_set` |

### `export` only

| argument | default | meaning | example |
|---|---|---|---|
| `--episodes` | `episodes` | basename of the `select` output to read (`episodes.csv`) | `--episodes spring_set` |
| `--lead-h` | `48` | hours of lead-up before the window to include | `--lead-h 24` |
| `--out` | `episodes` | output basename (`_members.csv` + `_members.json`) | `--out spring_set` |

---

## 15. Troubleshooting

**`FileNotFoundError: [WinError 2] ... 'era5'`** — you ran `build` or `select` before a
`retrieve` succeeded, so the data folder does not exist. Run `retrieve` first and
confirm it wrote non-zero `.nc` files (`dir era5`).

**`403 ... required licences not accepted`** — the licence has not been accepted on the
dataset page. Open the link in the error (or §6) and accept all licences, then rerun.

**Authentication / credentials error** — almost always `.cdsapirc` in the wrong folder
(the project directory instead of the home directory) rather than a bad token. Run the
check in §7b; the file must be in your home directory.

**OneDrive path problems** — if your project sits under
`Documents` that is redirected to OneDrive, directory creation or file writes can fail
from Python when files are "cloud-only". Run from a local path instead, e.g.
`--data-dir C:\taim_data\era5`.

**Empty or zero-byte `.nc` files** — the retrieve was rejected (usually licence or
token) but left a stub. Delete the folder, fix the cause, re-run with `--overwrite`.

**`build` errors on variable names or axis order** — ERA5 NetCDF coordinate names
differ slightly between CDS backends. `build` auto-detects `u100`/`v100` and the
member/time axis, but if it fails, send the exact message — it is a one-line fix.

**Lopsided *p* distribution (everything at `<.02` or `>.98`)** — `--threshold` is wrong
for the site. Re-tune it with `build --no-truth` (free, no re-download) until the
ambiguous band is populated.

---

## 16. Output files

| path | what it is | role |
|---|---|---|
| `era5/*.nc` | raw downloaded ERA5 data | intermediate — not used directly |
| `era5_archive.csv` | every candidate episode with *p* and outcome | intermediate; usable as a worked example |
| `episodes.csv` | the selected ~20-episode set, plain text | the stimulus set (plain) |
| **`episodes.xlsx`** | the selected set, formatted (summary only) | **the stimulus set — task, outcome, costs** |
| **`episodes_members.csv`** | per-member trajectories, long format | **member-view encodings read this** |
| **`episodes_members.json`** | per-member trajectories + percentiles, nested | **convenience form; summary encodings read the percentiles** |

Freeze the stimulus set once drawn and use the identical files everywhere a comparison
is made — the cross-group comparison is only valid on a shared set. `episodes.xlsx`
alone supports only summary encodings; the two `episodes_members` files are what
spaghetti, HOPs, and dotplot read (§12).

---

## 17. Why this preserves the challenge

The challenge is about reading the *spread between ensemble members*. The ensemble
product supplies that spread as genuine, physically-based disagreement; the reanalysis
supplies an objective outcome for every episode. Because every stimulus is a real
scenario with a known result, "was the participant's decision correct?" is a fact, not
a preference — so the students' statistics test a hypothesis about the encodings rather
than summarising opinions. That objectivity is what makes the 70% project's required
statistical analysis meaningful.

---

## 18. Data licensing and attribution

ERA5 is distributed through the Copernicus Climate Data Store and is free to use,
including for research and teaching. In addition to the applicable licence(s), users
must cite the CDS catalogue entry and provide clear, visible attribution to the
Copernicus programme, attributing each data product used.

**CDS catalogue entry (citation).** Replace the access date with the date you retrieved
the data:

> Copernicus Climate Change Service, Climate Data Store, (2023): ERA5 hourly data on
> single levels from 1940 to present. Copernicus Climate Change Service (C3S) Climate
> Data Store (CDS). DOI: 10.24381/cds.adbb2d47 (Accessed on DD-MMM-YYYY)

**Attribution (Copernicus programme).**

> Generated using Copernicus Climate Change Service information [year]. Neither the
> European Commission nor ECMWF is responsible for any use that may be made of the
> Copernicus information or data it contains.

Both the citation and the attribution should appear in any report, publication, or
presentation that uses these episodes.

---

## 19. Methodological notes

Reference for students writing the report.

### The normative decision threshold

Each trial is a binary choice with asymmetric costs. CANCEL costs a fixed amount
regardless of outcome. GO costs nothing if the wind stays below the threshold and a
large amount if it exceeds. Expected cost of GO is `p × abort_cost`; expected cost of
CANCEL is `cancel_cost` for any *p* (the outcome does not change it). Setting them
equal:

```
p* = cancel_cost / abort_cost = 5000 / 40000 = 0.125
```

GO minimises expected cost when *p* < 0.125, CANCEL when *p* > 0.125. The 8:1 cost
ratio places the threshold at 0.125 rather than 0.5, which is what makes a participant
who reads only the ensemble *mean* systematically wrong on episodes between 0.125 and
0.5 — the error the encodings are meant to reduce. "Normative" means optimal given the
stated costs and risk-neutrality; a risk-averse operator might rationally use a lower
threshold, which is worth a sentence in the report.

### Computing *p* — per-member maximum, not hourly mean

For each episode, `build` takes each member's **maximum** wind over the window, then
counts the fraction of members whose maximum exceeds the threshold. This preserves the
temporal correlation inside each member: a member that is windy for the whole window
counts once, as it should. Averaging the per-hour exceedance fractions instead would
understate the probability, because the crew is blocked if the threshold is breached at
*any* point in the window, not on average. The ground truth uses the same
maximum-over-window rule, so stimulus and outcome are scored identically — any
asymmetry there would masquerade as participant error.

### Window length — why 3 hours

The window is set to 3 hours, which on the 3-hourly ensemble is exactly **one
timestep**. Two reasons. First, it is the native resolution: a 3-hour window needs no
rounding or interpolation, so the window is a single real ensemble state rather than a
max over several steps — the cleanest thing to defend in the report. Second, because *p*
is a max-over-window, a longer window can only raise *p* (more timesteps, more chances to
exceed), inflating every episode's probability and pushing the distribution toward the
high end. The 3-hour window is therefore the least-inflated, most discriminating choice,
which tends to spread *p* more evenly across the bands. The operational cost is that a
3-hour transfer slot is short; frame the scenario as a go/no-go check at the transfer
time rather than a long operation, and it stays coherent. A longer window
(`--window-h 6`) remains available but shifts the distribution upward and needs the
threshold re-tuned.

### The calibration assumption

The normative rule is only "correct" if the ensemble is calibrated: episodes it labels
20% should exceed about 20% of the time. The reliability table printed by `build` is
the empirical check. A well-calibrated ensemble makes *p* a trustworthy basis for the
correct answer; a mis-calibrated one means participants are scored against a rule that
does not hold, which is why three months of data (more distinct weather, more resolved
episodes) gives a sounder check than one.

### 10-member granularity and its consequence

With 10 members, *p* can only take the values 0.0, 0.1, 0.2, … 1.0 — eleven levels, of
which only 0.10, 0.20, 0.30 fall in the ambiguous band [0.09, 0.35]. This limits how
finely stimulus difficulty can be graded, and it interacts with the near-threshold
guard. The ensemble-scaled guard (`--guard auto` = 1/members = 0.1) would exclude
everything within 0.1 of p\* = 0.125, removing 0.10 and 0.20 and collapsing the
ambiguous stratum to a single level. This is why the guard defaults to **0.02** instead:
it keeps 0.10, 0.20 and 0.30 usable (0.03 is still too wide — it clips 0.10, which is
only 0.025 from p\*). A forecast ensemble with ~51 members would give ~13 distinct
ambiguous levels and far finer control, and `--guard auto` would then be appropriate;
the trade-off is the subject of the framing note in §2.

### Dataset balance — what a usable distribution looks like

Wind exceedance is naturally bimodal: most windows are clearly below the threshold and a
minority are clearly above, so the healthy signal is not a flat distribution but a
**populated shoulder** between the two piles. The reference dataset at 5 m/s —
262 (`<.02`) / 47 (ambiguous) / 29 (middle) / 33 / 364 (`>.98`) — is a good example: the
tails are large, but 109 episodes sit across the decision-relevant middle, which is what
the experiment draws from.

A bad distribution is one where the shoulder is empty — the 12 m/s case, with 710 at
`<.02` and only 6 ambiguous. That is under-population of the band, and the fix is the
threshold sweep in §8, not more data. More data is the fix only when the shoulder stays
thin at *every* threshold, which indicates the season genuinely lacks variable-wind
situations; then add a month from a different season.

Why aim for 15–25 ambiguous candidates rather than exactly 7: the near-threshold guard
removes episodes adjacent to p\*, and `select` keeps only one episode per day to avoid
near-duplicate stimuli. Both cut the raw count, so a surplus is needed to end up with 7
genuinely distinct ambiguous trials.

### Units and scenario plausibility

The threshold is specified in **m/s at 100 m**. For judging whether a chosen value tells
a believable operational story, convert it:

| m/s | km/h | knots | Beaufort |
|---|---|---|---|
| 5 | 18.0 | 9.7 | 3 (gentle breeze) |
| 6 | 21.6 | 11.7 | 4 (moderate breeze) |
| 12 | 43.2 | 23.3 | 6 (strong breeze) |

Two things matter for the report. First, **marine operations are specified in knots**,
so the 5 m/s working threshold is a ~10-knot limit — on the cautious side, but realistic
for sensitive offshore work such as walk-to-work gangway transfers or precision crane
lifts, which do cap around 8–12 knots. Frame the scenario as one of these rather than a
generic transfer, and the low limit reads as deliberate caution, not an artefact.
Second, this is wind at **100 m**, which is stronger than the 10 m wind marine forecasts
usually quote; 5 m/s at 100 m corresponds to a lighter wind at deck level, which makes
the cautious-limit framing easier to defend. The experiment is indifferent to the
absolute value — it needs only a populated ambiguous band — but the narrative handed to
participants should name a limit and an operation that fit each other.

---

## 20. Authorship

Created by Alexandre Valle (DEI/FEUP, INESC TEC) for the InfoVis challenge of TAIM
(Advanced Topics in Interaction and Multimedia), M.EIC, FEUP — academic year 2026-2027.

The design of the challenge (research question, task, cost structure, episode strata,
the ERA5-based data pipeline, and all methodological decisions) is the author's. This
script and its accompanying README were developed with the assistance of Claude
(Anthropic, Opus 5.5 and Opus 4.8), used as a drafting and implementation tool and
analysis tool under the author's direction and review.

The author ran and tested the commands against real ERA5 data, inspected the outputs at
each stage, and set the default parameter values (threshold 5 m/s, 3-hour window,
guard 0.02, seed 1, 3-month timespan in spring) from that empirical tuning.

Weather data: ERA5, generated using Copernicus Climate Change Service information (see
§18, Data licensing and attribution).

**Disclaimer.** The author is not affiliated with Copernicus nor the European
Commission. The author is not a meteorologist and does not provide any weather forecasts
or advice. The data are used for research and educational purposes only. Use at your own
risk. The author may not be responsible for any consequences of using the data or the
code.

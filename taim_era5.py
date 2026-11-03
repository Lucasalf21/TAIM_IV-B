#!/usr/bin/env python3
"""

Data comes from the Copernicus Climate Data Store (CDS):

  * STIMULUS  — ERA5 "ensemble members" (10 members, 3-hourly, ~63 km). The spread
                between members is the uncertainty the challenge visualizes.
  * TRUTH     — ERA5 "reanalysis" (single best estimate, hourly, ~31 km).

Both use 100 m wind (u/v components): stimulus and truth are the same variable at the same level.

Commands
  retrieve   pull ensemble members + reanalysis for a date range into NetCDF.
  build      compute p from the members, attach reanalysis truth, write the archive.
  select     draw the stratified ~20-episode stimulus set.
  export     write per-member trajectories for member-view encodings.
  selftest   no network; verify the aggregation logic.

One-time setup
  pip install cdsapi xarray netCDF4 numpy pandas openpyxl
  Register at https://cds.climate.copernicus.eu , accept the licence on the dataset
  page (reanalysis-era5-single-levels, Download tab), put your Personal Access Token
  in ~/.cdsapirc:
      url: https://cds.climate.copernicus.eu/api
      key: <your Personal Access Token>
"""

# -----------------------------------------------------------------------------
# Authorship
# -----------------------------------------------------------------------------
# Created by Alexandre Valle (DEI/FEUP, INESC TEC) for the InfoVis
# challenge of TAIM (Advanced Topics in Interaction and Multimedia), M.EIC, FEUP
# — academic year 2026-2027.
#
# The design of the challenge (research question, task, cost structure, episode
# strata, the ERA5-based data pipeline, and all methodological decisions) is the
# author's. This script and its accompanying README were developed with the
# assistance of Claude (Anthropic, Opus 5.5 and Opus 4.8), used as a drafting and
# implementation tool and analysis tool under the author's direction and review.
#
# The author ran and tested the command against real ERA5 data, inspected the
# outputs at each stage, and set the default parameter values (threshold 5 m/s,
# 3-hour window, guard 0.02, seed 1, 3 months timespan in spring) from that
# empirical tuning.
#
# Weather data: ERA5, generated using Copernicus Climate Change Service
# information (see README, "Data licensing and attribution").
#
# Disclaimer: The author is not affiliated with Copernicus nor the European Commission.
# The author is not a meteorologist and does not provide any weather forecasts or advice.
# The data are used for research and educational purposes only. Use at your own risk.
# The author may not responsible for any consequences of using the data or the code.
# -----------------------------------------------------------------------------
import argparse, os, sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

DATASET = "reanalysis-era5-single-levels"
U, V = "100m_u_component_of_wind", "100m_v_component_of_wind"
ARCHIVE = "era5_archive.csv"


# --------------------------------------------------------------------------
# retrieve
# --------------------------------------------------------------------------
def months_in(start, end):
    """Yield (year, month) pairs spanning the range, for month-at-a-time requests."""
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def cmd_retrieve(a):
    try:
        import cdsapi
    except Exception:
        raise SystemExit("pip install cdsapi  (and set ~/.cdsapirc — see docstring)")
    client = cdsapi.Client()
    a.data_dir = os.path.abspath(a.data_dir)
    try:
        os.makedirs(a.data_dir, exist_ok=True)
    except OSError as e:
        raise SystemExit(
            f"could not create data directory:\n  {a.data_dir}\n  {e}\n"
            f"check that the parent folder exists and is writable, and that "
            f"you are running from a valid working directory."
        )
    print(f"  data directory: {a.data_dir}")
    start, end = date.fromisoformat(a.start), date.fromisoformat(a.end)
    half = a.box / 2.0
    area = [a.lat + half, a.lon - half, a.lat - half, a.lon + half]  # N/W/S/E

    for product, tag, times in (
        ("ensemble_members", "ens", [f"{h:02d}:00" for h in range(0, 24, 3)]),
        ("reanalysis", "rea", [f"{h:02d}:00" for h in range(24)]),
    ):
        if a.product not in ("both", tag):
            continue
        for y, m in months_in(start, end):
            out = os.path.join(a.data_dir, f"{y}{m:02d}_{tag}.nc")
            if os.path.exists(out) and not a.overwrite:
                print(f"  skip {out}")
                continue
            ndays = (date(y + (m == 12), (m % 12) + 1, 1) - date(y, m, 1)).days
            print(f"  retrieve {product} {y}-{m:02d} -> {out}")
            try:
                client.retrieve(
                    DATASET,
                    {
                        "product_type": product,
                        "variable": [U, V],
                        "year": str(y),
                        "month": f"{m:02d}",
                        "day": [f"{d:02d}" for d in range(1, ndays + 1)],
                        "time": times,
                        "area": area,
                        "grid": [0.25, 0.25] if tag == "rea" else [0.5, 0.5],
                        "data_format": "netcdf",
                    },
                    out,
                )
            except Exception as e:
                print(f"    FAILED: {e}", file=sys.stderr)
    print("done. next: python taim_era5.py build")


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------
def _open_point(path, lat, lon):
    import xarray as xr

    ds = xr.open_dataset(path)
    latn = "latitude" if "latitude" in ds.coords else "lat"
    lonn = "longitude" if "longitude" in ds.coords else "lon"
    ds = ds.sel({latn: lat, lonn: lon}, method="nearest")
    uname = "u100" if "u100" in ds else [v for v in ds if "u" in v.lower()][0]
    vname = "v100" if "v100" in ds else [v for v in ds if "v" in v.lower()][0]
    return ds, uname, vname


def _timecoord(ds):
    for c in ("valid_time", "time", "forecast_reference_time"):
        if c in ds.coords:
            return c
    raise SystemExit("no recognizable time coordinate in NetCDF")


def load_ensemble(data_dir, lat, lon):
    """Read every *_ens.nc at the point and return (times, speed matrix (member, T))."""
    import glob

    ens = sorted(glob.glob(os.path.join(data_dir, "*_ens.nc")))
    if not ens:
        raise SystemExit(
            f"no *_ens.nc in '{data_dir}' — the retrieve step wrote "
            f"nothing. Re-run retrieve and check it succeeded (non-zero "
            f".nc files)."
        )
    frames = []
    for path in ens:
        ds, un, vn = _open_point(path, lat, lon)
        tc = _timecoord(ds)
        spd = np.hypot(ds[un].values, ds[vn].values)  # (member, time) or (time, member)
        memdim = "number" if "number" in ds[un].dims else ds[un].dims[0]
        if ds[un].dims[0] != memdim:  # orient as (member, time)
            spd = spd.T
        frames.append((pd.to_datetime(ds[tc].values), spd))
    all_times = np.concatenate([t.values for t, _ in frames])
    all_spd = np.concatenate([s for _, s in frames], axis=1)
    order = np.argsort(all_times)
    return pd.to_datetime(all_times[order]), all_spd[:, order]


def cmd_build(a):
    a.data_dir = os.path.abspath(a.data_dir)
    if not os.path.isdir(a.data_dir):
        raise SystemExit(
            f"data directory '{a.data_dir}' does not exist yet — "
            f"run 'retrieve' first (it creates it and downloads into it)"
        )
    import xarray as xr

    all_times, all_spd = load_ensemble(a.data_dir, a.lat, a.lon)
    M = all_spd.shape[0]
    print(
        f"  stimulus: {M} members, {all_spd.shape[1]} timesteps "
        f"{all_times.min()} .. {all_times.max()}"
    )

    # --- episodes: rolling window over the 3-hourly steps ------------------
    step_h = int((all_times[1] - all_times[0]) / np.timedelta64(1, "h"))
    win = max(1, a.window_h // step_h)
    rows = []
    for i in range(all_spd.shape[1] - win + 1):
        sl = slice(i, i + win)
        per_member_max = np.nanmax(all_spd[:, sl], axis=1)
        p = float(np.mean(per_member_max > a.threshold))
        rows.append(
            dict(
                window_start=all_times[i].isoformat(),
                window_end=all_times[i + win - 1].isoformat(),
                n_members=M,
                p_ensemble=round(p, 6),
                ens_median=round(float(np.median(per_member_max)), 3),
                threshold=a.threshold,
                height=100,
                window_h=a.window_h,
            )
        )
    df = pd.DataFrame(rows)
    print(f"  {len(df)} candidate episodes")

    # --- truth: reanalysis max over the same window ------------------------
    if a.no_truth:
        df["exceeded"] = np.nan
        print("  --no-truth: skipping reanalysis attach")
    else:
        rea = sorted(__import__("glob").glob(os.path.join(a.data_dir, "*_rea.nc")))
        if not rea:
            print("  no *_rea.nc found — leaving exceeded blank", file=sys.stderr)
            df["exceeded"] = np.nan
        else:
            rframes = []
            for path in rea:
                ds, un, vn = _open_point(path, a.lat, a.lon)
                tc = _timecoord(ds)
                rframes.append(
                    pd.Series(
                        np.hypot(ds[un].values, ds[vn].values),
                        index=pd.to_datetime(ds[tc].values),
                    )
                )
            truth = pd.concat(rframes).sort_index()
            truth = truth[~truth.index.duplicated()]
            ws = pd.to_datetime(df.window_start)
            we = pd.to_datetime(df.window_end)
            out = []
            for a0, b0 in zip(ws, we):
                seg = truth.loc[a0:b0]
                out.append(np.nan if seg.empty else int(seg.max() > a.threshold))
            df["exceeded"] = out
            print(
                f"  reanalysis resolved {int(pd.Series(out).notna().sum())} of {len(df)}"
            )

    df.to_csv(a.archive, index=False)
    print(f"  wrote {a.archive}")
    _report(df)


def _report(df):
    h = pd.cut(
        df.p_ensemble,
        [-0.001, 0.02, 0.09, 0.35, 0.65, 0.98, 1.001],
        labels=["<.02", ".02-.09", ".09-.35 AMBIG", ".35-.65", ".65-.98", ">.98"],
    )
    print("\n  distribution of p:")
    for k, v in h.value_counts().sort_index().items():
        print(f"    {k:>14s} {v:5d}")
    amb = ((df.p_ensemble >= 0.09) & (df.p_ensemble < 0.35)).sum()
    print(f"  ambiguous candidates: {amb}")


# --------------------------------------------------------------------------
# select  (shared draw logic)
# --------------------------------------------------------------------------
def cmd_select(a):
    if not os.path.exists(a.archive):
        raise SystemExit(f"archive '{a.archive}' not found — run 'build' first")
    df = pd.read_csv(a.archive)
    if "exceeded" in df and df["exceeded"].notna().any():
        df = df.dropna(subset=["exceeded"])
        df["exceeded"] = df["exceeded"].astype(int)
    M = int(df.n_members.median())
    pstar = a.cancel_cost / a.abort_cost
    guard = (
        a.guard if a.guard is not None else 1.0 / M
    )  # None (= --guard auto) scales with ensemble size
    before = len(df)
    df = df[(df.p_ensemble - pstar).abs() > guard]
    print(
        f"  p* = {pstar:.3f}, guard = {guard:.3f}  ->  excluded {before - len(df)} near-threshold episodes"
    )
    # thin near-duplicate windows: keep one per day to avoid overlapping stimuli
    df["day"] = pd.to_datetime(df.window_start).dt.date
    df = df.sort_values("window_start")

    strata = [
        ("clear GO", 0.00, 0.08, a.n_clear_go),
        ("ambiguous", 0.09, 0.35, a.n_ambiguous),
        ("middle", 0.36, 0.64, a.n_middle),
        ("clear CANCEL", 0.65, 1.00, a.n_clear_cancel),
    ]
    rng = np.random.default_rng(a.seed)
    picks = []
    for name, lo, hi, n in strata:
        sub = df[(df.p_ensemble >= lo) & (df.p_ensemble <= hi)].drop_duplicates(
            subset=["day"]
        )
        take = sub.sample(min(n, len(sub)), random_state=int(rng.integers(1e9)))
        if len(take) < n:
            print(
                f"  {name:13s} want {n:2d}  available {len(sub):4d}  took {len(take):2d}  SHORT"
            )
        else:
            print(
                f"  {name:13s} want {n:2d}  available {len(sub):4d}  took {len(take):2d}"
            )
        picks.append(take)
    sel = pd.concat(picks).sort_values("p_ensemble").reset_index(drop=True)
    sel.insert(0, "episode", [f"E{i + 1:02d}" for i in range(len(sel))])
    sel["normative"] = np.where(sel.p_ensemble < pstar, "GO", "CANCEL")
    sel["ambiguous"] = ((sel.p_ensemble >= 0.09) & (sel.p_ensemble <= 0.35)).astype(int)
    if "exceeded" in sel:
        gap = sel.exceeded.sum() - sel.p_ensemble.sum()
        print(
            f"\n  sum p = {sel.p_ensemble.sum():.2f}  exceedances = {int(sel.exceeded.sum())}"
            f"  calibration gap = {gap:+.2f}"
        )
    sel = sel.drop(columns=["day"], errors="ignore")
    sel.to_csv(a.out + ".csv", index=False)
    try:
        sel.to_excel(a.out + ".xlsx", index=False, sheet_name="Episodes")
        print(f"  wrote {a.out}.csv and {a.out}.xlsx")
    except Exception as e:
        print(f"  wrote {a.out}.csv  (xlsx skipped: {e})")
    cols = ["episode", "window_start", "p_ensemble", "normative", "ambiguous"]
    if "exceeded" in sel:
        cols.insert(3, "exceeded")
    print(sel[cols].to_string(index=False))


# --------------------------------------------------------------------------
# export — member-level render data for the selected episodes
# --------------------------------------------------------------------------
def cmd_export(a):
    """Write the full 10-member trajectories for each selected episode, so students
    can render member views (spaghetti, HOPs, dotplot), not just summaries."""
    import json

    a.data_dir = os.path.abspath(a.data_dir)
    if not os.path.isdir(a.data_dir):
        raise SystemExit(
            f"data directory '{a.data_dir}' does not exist — run 'retrieve' first"
        )
    sel_path = a.episodes + (".csv" if not a.episodes.endswith(".csv") else "")
    if not os.path.exists(sel_path):
        raise SystemExit(
            f"'{sel_path}' not found — run 'select' first (it writes episodes.csv)"
        )
    sel = pd.read_csv(sel_path)

    all_times, all_spd = load_ensemble(a.data_dir, a.lat, a.lon)
    M = all_spd.shape[0]
    step_h = int((all_times[1] - all_times[0]) / np.timedelta64(1, "h"))
    win = max(1, a.window_h // step_h)
    lead = max(0, a.lead_h // step_h)

    long_rows = []
    nested = {}
    for ep_row in sel.itertuples(index=False):
        ep = ep_row.episode
        ws = pd.Timestamp(ep_row.window_start)
        i = int(np.searchsorted(all_times.values, np.datetime64(ws)))
        start = max(0, i - lead)
        stop = min(all_spd.shape[1], i + win)  # window = [i, i+win)
        seg_times = all_times[start:stop]
        seg = all_spd[:, start:stop]  # (member, seg_T)
        win_from = i - start  # index within seg where window starts
        # percentiles per timestep (for fan / band groups)
        p10 = np.percentile(seg, 10, axis=0)
        p50 = np.percentile(seg, 50, axis=0)
        p90 = np.percentile(seg, 90, axis=0)
        nested[ep] = {
            "p_ensemble": float(ep_row.p_ensemble),
            "exceeded": (
                None
                if "exceeded" not in sel.columns or pd.isna(ep_row.exceeded)
                else int(ep_row.exceeded)
            ),
            "threshold": a.threshold,
            "window_start_index": int(win_from),
            "window_len": int(win),
            "times": [t.isoformat() for t in seg_times],
            "members": [[round(float(x), 3) for x in seg[m]] for m in range(M)],
            "percentiles": {
                "p10": [round(float(x), 3) for x in p10],
                "p50": [round(float(x), 3) for x in p50],
                "p90": [round(float(x), 3) for x in p90],
            },
        }
        for m in range(M):
            for k, t in enumerate(seg_times):
                long_rows.append(
                    dict(
                        episode=ep,
                        member=m + 1,
                        step=k,
                        time=t.isoformat(),
                        in_window=int(win_from <= k < win_from + win),
                        wind_speed_100m=round(float(seg[m, k]), 3),
                    )
                )

    long = pd.DataFrame(long_rows)
    long_csv = a.out + "_members.csv"
    json_out = a.out + "_members.json"
    long.to_csv(long_csv, index=False)
    with open(json_out, "w") as f:
        json.dump(
            {
                "threshold": a.threshold,
                "n_members": M,
                "window_h": a.window_h,
                "lead_h": a.lead_h,
                "episodes": nested,
            },
            f,
            indent=1,
        )
    print(
        f"  {len(sel)} episodes x {M} members x "
        f"{len(nested[sel.episode.iloc[0]]['times'])} steps "
        f"({a.lead_h}h lead-up + {a.window_h}h window)"
    )
    print(
        f"  wrote {long_csv}  (long format: episode, member, step, time, in_window, wind)"
    )
    print(f"  wrote {json_out}  (nested: per-episode members + percentiles)")

    xlsx = a.episodes + ".xlsx"
    print(f"""
  ------------------------------------------------------------------
  WHICH FILES EACH VISUALIZATION READS

  Summary encodings (fan chart, percentile band, box plot):
      {json_out}   -> percentiles p10/p50/p90 per step
      {xlsx}            -> episode list (p, outcome, costs)

  Member encodings (ensemble spaghetti, animated HOPs, quantile dotplot):
      {long_csv}    -> per-member trajectories (long format)
      {xlsx}            -> episode list

  Every encoding also reads {xlsx} for the task, outcome and costs.
  The two member files hold the SAME data; .csv suits member views,
  .json adds ready-made percentiles for summary views.

  EVALUATION / SCORING reads:
      {xlsx}            -> p_ensemble, exceeded, normative action,
                               cancel/abort costs, p* = 0.125
      Reduce single-value encodings (dotplot) and the decision over the
      window only: filter in_window == 1. Lead-up steps are context.
  ------------------------------------------------------------------""")


# --------------------------------------------------------------------------
def cmd_selftest(a):
    print("selftest — no network")
    rng = np.random.default_rng(0)
    M, T = 10, 40
    spd = 9.0 + np.cumsum(rng.normal(0, 0.5, (M, T)), axis=1)
    w = slice(4, 6)
    correct = float(np.mean(np.nanmax(spd[:, w], axis=1) > 11.0))
    mean_hourly = float((spd[:, w] > 11.0).mean(axis=0).mean())
    assert 0 <= correct <= 1
    print(f"  members               : {M}  (ERA5 ensemble)")
    print(f"  per-member-max p      : {correct:.4f}   <- used")
    print(f"  mean-hourly p         : {mean_hourly:.4f}   <- not used")
    print(f"  p granular in 1/{M} = {1 / M:.4f}   (coarser than a 51-member forecast)")
    print("\n  OK — logic verified. On your machine: retrieve -> build -> select.")


# --------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def geom(q):
        q.add_argument("--lat", type=float, default=41.15)
        q.add_argument("--lon", type=float, default=-8.75)
        q.add_argument("--threshold", type=float, default=5.0, help="m/s at 100 m")
        q.add_argument(
            "--window-h",
            type=int,
            default=3,
            help="window length in hours; ensemble is 3-hourly, so 3 h = 1 step",
        )
        q.add_argument("--archive", default=ARCHIVE)
        q.add_argument("--data-dir", default="era5")

    r = sub.add_parser("retrieve", help="pull ensemble members + reanalysis")
    geom(r)
    r.add_argument("--start", required=True, help="YYYY-MM-DD")
    r.add_argument("--end", required=True, help="YYYY-MM-DD")
    r.add_argument("--product", choices=["both", "ens", "rea"], default="both")
    r.add_argument("--box", type=float, default=1.0)
    r.add_argument("--overwrite", action="store_true")
    r.set_defaults(func=cmd_retrieve)

    b = sub.add_parser("build", help="members -> p, reanalysis -> truth")
    geom(b)
    b.add_argument("--no-truth", action="store_true")
    b.set_defaults(func=cmd_build)

    s = sub.add_parser("select", help="draw the stratified stimulus set")
    geom(s)
    s.add_argument("--cancel-cost", type=float, default=5000.0)
    s.add_argument("--abort-cost", type=float, default=40000.0)
    s.add_argument("--n-clear-go", type=int, default=6)
    s.add_argument("--n-ambiguous", type=int, default=7)
    s.add_argument("--n-middle", type=int, default=2)
    s.add_argument("--n-clear-cancel", type=int, default=5)
    s.add_argument(
        "--guard",
        default=0.02,
        type=lambda v: None if str(v).lower() == "auto" else float(v),
        help="exclude episodes within this abs. p of p* "
        "(default 0.02, tuned for the 10-member ensemble; "
        "pass 'auto' to scale as 1/n_members)",
    )
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--out", default="episodes")
    s.set_defaults(func=cmd_select)

    x = sub.add_parser(
        "export", help="write member-level render data for the selected episodes"
    )
    geom(x)
    x.add_argument(
        "--episodes",
        default="episodes",
        help="basename of the select output to read (episodes.csv)",
    )
    x.add_argument(
        "--lead-h",
        type=int,
        default=48,
        help="hours of lead-up before the window to include (default 48)",
    )
    x.add_argument("--out", default="episodes")
    x.set_defaults(func=cmd_export)

    t = sub.add_parser("selftest", help="verify logic without network")
    t.set_defaults(func=cmd_selftest)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()

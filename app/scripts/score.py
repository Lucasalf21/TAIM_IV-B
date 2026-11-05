"""Researcher-only scorer. Never copied into the participant build."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def score(row, truth):
    """Keep hindsight accuracy, normative agreement, cost and confidence distinct."""
    decision = row['decision']
    if decision not in ('GO', 'CANCEL'):
        raise ValueError('Invalid decision')
    probability = float(truth['p_ensemble'])
    exceeded = int(truth['exceeded'])
    confidence = float(row['confidence']) / 100
    if not 0 <= probability <= 1 or exceeded not in (0, 1) or not .5 <= confidence <= 1:
        raise ValueError('Invalid probability, outcome or confidence')
    correct = int(decision == ('CANCEL' if exceeded else 'GO'))
    expected = 'CANCEL' if probability > 5000 / 40000 else 'GO'
    estimate = row.get('probability', '')
    if estimate and not 0 <= float(estimate) <= 100:
        raise ValueError('Invalid probability estimate')
    return {
        'outcome_correct': correct,
        'normative_agreement': int(decision == expected),
        'realised_cost_eur': 5000 if decision == 'CANCEL' else 40000 * exceeded,
        'confidence_brier': (confidence - correct) ** 2,
        'probability_brier': (float(estimate) / 100 - exceeded) ** 2 if estimate else '',
        'ensemble_probability': probability,
        'observed_exceedance': exceeded,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trials', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--allow-simulated', action='store_true', help='For software verification only; never participant evidence')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; choose a new filename to preserve previous results.')
    manifest = json.loads((APP / 'scripts/source-manifest.json').read_text())
    for name, digest in manifest['sources'].items():
        if hashlib.sha256((APP.parent / 'data' / name).read_bytes()).hexdigest() != digest:
            parser.error('Source data changed; regenerate and review the data manifest first.')
    with (APP.parent / 'data/episodes.csv').open(newline='') as f:
        truth = {r['episode']: r for r in csv.DictReader(f)}
    with args.trials.open(newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        required = {'session_id', 'participant_id', 'condition', 'mode', 'protocol', 'dataset_version', 'episode',
                    'practice', 'status', 'decision', 'confidence', 'attempt', 'repeated_exposure', 'flags', 'duration_ms'}
        if not required <= set(reader.fieldnames or []):
            parser.error('Input is not a template trials export.')
        headers = reader.fieldnames
        rows = list(reader)
    result, seen = [], set()
    for row in rows:
        if row['mode'] not in ('study', 'pilot', 'simulated') or row['condition'] not in ('IV-3', 'IV-4'):
            parser.error('Unknown mode or condition.')
        if row['protocol'] != 'ivb-template-1' or row['dataset_version'] != manifest['version']:
            parser.error('Export protocol or dataset version does not match this scorer.')
        if row['mode'] == 'simulated' and not args.allow_simulated:
            parser.error('Simulation export rejected. --allow-simulated is for software checks only.')
        if row['practice'] != 'false' or row['status'] != 'submitted':
            continue
        key = row['session_id'], row['episode']
        if key in seen:
            parser.error('Duplicate submitted episode within a session.')
        seen.add(key)
        try:
            duration = float(row['duration_ms'])
            if not math.isfinite(duration) or duration < 0:
                raise ValueError('Invalid duration')
            calculated = score(row, truth[row['episode']])
        except (KeyError, ValueError) as e:
            parser.error(f'Invalid submitted trial: {e}')
        result.append({**row, **calculated})
    extra = ['outcome_correct', 'normative_agreement', 'realised_cost_eur', 'confidence_brier',
             'probability_brier', 'ensemble_probability', 'observed_exceedance']
    with args.output.open('x', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=headers + extra)
        writer.writeheader()
        writer.writerows(result)
    print(f'Scored {len(result)} submitted measured trials. Review repeated exposures and flags before analysis.')


if __name__ == '__main__':
    main()

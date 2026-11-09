import unittest
import csv
import subprocess
import sys
import tempfile
from pathlib import Path
from score import score, validate_session, make_debrief


class ScoringTest(unittest.TestCase):
    def test_debrief_uses_exact_session_order_and_requires_all_trials(self):
        sequence = [f'E{i:02}' for i in range(1, 21)]
        metadata = {'session_id': 'test', 'dataset_version': 'dataset', 'protocol': 'ivb-template-3',
                    'condition': 'IV-3', 'mode': 'simulated', 'sequence': '|'.join(sequence)}
        rows = [{'episode': id, 'decision': 'GO', 'observed_exceedance': 0} for id in reversed(sequence)]
        d = make_debrief(rows, metadata)
        self.assertEqual([r['episode'] for r in d['trials']], sequence)
        self.assertEqual(d['sessionId'], 'test')
        self.assertEqual(d['trials'][0]['observed'], 0)
        with self.assertRaises(ValueError):
            make_debrief(rows[:-1], metadata)

    def test_cli_refuses_stale_trials_after_withdrawal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            session = root / 'session.csv'
            with session.open('w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=['phase', 'session_phase', 'withdrawn_at', 'consent_version', 'consent_at'])
                writer.writeheader()
                writer.writerow({'phase': 'withdrawn', 'session_phase': 'withdrawn', 'withdrawn_at': '2026-11-09T13:00:00Z',
                                 'consent_version': 'ivb-consent-2026-11-09', 'consent_at': '2026-11-09T12:00:00Z'})
            # Reject the latest exit record before even reading a stale trials file.
            output = root / 'scored.csv'
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('score.py')),
                                     str(root / 'stale-trials.csv'), str(output), '--session', str(session), '--allow-simulated'], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('withdrawn', result.stderr)
            self.assertFalse(output.exists())

    def test_scoring_requires_complete_current_consent_and_no_withdrawal(self):
        row = {'phase': 'complete', 'session_phase': 'complete', 'withdrawn_at': '',
               'consent_version': 'ivb-consent-2026-11-09', 'consent_at': '2026-11-09T12:00:00Z'}
        validate_session(row)
        for change in [{'phase': 'withdrawn'}, {'session_phase': 'trial'}, {'withdrawn_at': '2026-11-09T13:00:00Z'},
                       {'consent_version': ''}, {'consent_at': ''}, {'consent_at': 'broken'}]:
            with self.assertRaises(ValueError):
                validate_session({**row, **change})

    def test_good_decision_can_have_bad_outcome(self):
        row = {'decision': 'GO', 'confidence': '80', 'probability': '10'}
        result = score(row, {'p_ensemble': '.1', 'exceeded': '1'})
        self.assertEqual(result['normative_agreement'], 1)
        self.assertEqual(result['outcome_correct'], 0)
        self.assertEqual(result['realised_cost_eur'], 40000)
        self.assertAlmostEqual(result['confidence_brier'], .64)

    def test_cancel_has_fixed_cost_even_if_wind_was_safe(self):
        result = score({'decision': 'CANCEL', 'confidence': '50'}, {'p_ensemble': '.2', 'exceeded': '0'})
        self.assertEqual(result['normative_agreement'], 1)
        self.assertEqual(result['outcome_correct'], 0)
        self.assertEqual(result['realised_cost_eur'], 5000)


if __name__ == '__main__':
    unittest.main()

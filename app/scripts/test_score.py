import unittest
from score import score


class ScoringTest(unittest.TestCase):
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

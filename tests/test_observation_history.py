"""First-seen tracking distinguishes agency observations from Nexus ingestion."""
from datetime import datetime
from unittest import TestCase
try:
    from scripts import observation_history as tracker
except ModuleNotFoundError:
    import observation_history as tracker


def snapshot(at, observed, minutes=5, status='reported', reuse=False):
    return {
        'generated_at': at,
        'sources': {'cbp': {
            'status': 'ok',
            'last_success_at': at,
            'retrieved_at': at,
            'cache_reused': reuse,
        }, 'cbsa': {'status':'error'}},
        'directions': {'us': {'ambassador': {'standard': {
            'minutes': minutes, 'status': status, 'lanes_open': 2,
            'reported_status': 'delay', 'observation_at': observed
        }}}, 'ca': {}},
        'collection': {},
    }


class ObservationHistoryTests(TestCase):
    def test_first_seen_initial_and_repeated_observation(self):
        original = snapshot('2026-11-19T10:10:00Z', '2026-11-19T10:00:00Z')
        tracker.record_primary_observations(original, None)
        rec = original['collection']['observation_tracker']['records']['cbp.ambassador.standard']
        self.assertEqual(rec['first_seen_at'], original['generated_at'])
        self.assertIsNone(rec['previous_checked_at'])
        repeat = snapshot('2026-11-19T10:20:00Z', '2026-11-19T10:00:00Z')
        tracker.record_primary_observations(repeat, original)
        rec2 = repeat['collection']['observation_tracker']['records']['cbp.ambassador.standard']
        self.assertEqual(rec2['first_seen_at'], original['generated_at'])
        self.assertEqual(repeat['collection']['observation_tracker']['summary']['cbp']['new_observation_times'], 0)

    def test_new_agency_time_with_same_wait_is_new_report(self):
        first = snapshot('2026-11-19T10:10:00Z', '2026-11-19T10:00:00Z')
        tracker.record_primary_observations(first, None)
        second = snapshot('2026-11-19T11:12:00Z', '2026-11-19T11:00:00Z')
        tracker.record_primary_observations(second, first)
        row = second['collection']['observation_tracker']['records']['cbp.ambassador.standard']
        self.assertEqual(row['first_seen_at'], second['generated_at'])
        self.assertEqual(row['last_value_change_at'], first['generated_at'])
        self.assertEqual(row['previous_checked_at'], first['generated_at'])
        summary=second['collection']['observation_tracker']['summary']['cbp']
        self.assertEqual(summary['new_observation_times'], 1)
        self.assertEqual(summary['changed_values'], 0)

    def test_same_agency_time_value_revision_is_distinct(self):
        first = snapshot('2026-11-19T10:10:00Z', '2026-11-19T10:00:00Z')
        tracker.record_primary_observations(first, None)
        changed = snapshot('2026-11-19T10:30:00Z', '2026-11-19T10:00:00Z', minutes=12)
        tracker.record_primary_observations(changed, first)
        s=changed['collection']['observation_tracker']['summary']['cbp']
        self.assertEqual(s['new_observation_times'], 0)
        self.assertEqual(s['changed_values'], 1)

    def test_cached_source_cannot_become_new_report(self):
        first = snapshot('2026-11-19T10:10:00Z', '2026-11-19T10:00:00Z')
        tracker.record_primary_observations(first, None)
        reused = snapshot('2026-11-19T10:12:00Z', '2026-11-19T10:00:00Z', reuse=True)
        tracker.record_primary_observations(reused, first)
        record = reused['collection']['observation_tracker']['records']['cbp.ambassador.standard']
        self.assertEqual(record, first['collection']['observation_tracker']['records']['cbp.ambassador.standard'])
        self.assertFalse(reused['collection']['observation_tracker']['summary']['cbp']['source_fetched'])

    def test_failed_source_does_not_renew_first_seen(self):
        first = snapshot('2026-11-19T10:10:00Z', '2026-11-19T10:00:00Z')
        tracker.record_primary_observations(first, None)
        failed = snapshot('2026-11-19T10:30:00Z', '2026-11-19T10:00:00Z')
        failed['sources']['cbp'] = {'status':'error','retained_previous':True}
        tracker.record_primary_observations(failed, first)
        self.assertEqual(
            failed['collection']['observation_tracker']['records']['cbp.ambassador.standard'],
            first['collection']['observation_tracker']['records']['cbp.ambassador.standard'])

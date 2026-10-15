import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('review_transformer', Path(__file__).resolve().parents[2] / 'review_transformer.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def fixture():
    cards = [{'product_id': '1', 'title': 'A белый', 'description': 'серебристый и белый',
              'requested_attributes': ['color']}]
    gold = {'dataset_id': 'participant3_manual_dev_v1', 'tasks': {'1:color': {
        'status': 'present', 'spans': [
            {'field': 'title', 'start': 2, 'end': 7, 'quote': 'белый'},
            {'field': 'description', 'start': 0, 'end': 11, 'quote': 'серебристый'},
            {'field': 'description', 'start': 14, 'end': 19, 'quote': 'белый'}]}}}
    predictions = [{'product_id': '1', 'status': 'ok', 'requested_attributes': ['color'], 'warnings': [],
                    'candidates': [{'attribute_id': 'color', 'evidence': [gold['tasks']['1:color']['spans'][0]]}]}]
    return cards, gold, predictions


def test_multivalue_and_repeated_occurrences_are_required():
    result = review.score(*fixture())
    assert (result['tp'], result['fp'], result['fn']) == (1, 0, 2)
    assert result['task_accuracy'] == 0
    assert result['f1'] == 0.5


def test_confirmed_absence_counts_false_alarm():
    cards, gold, pred = fixture()
    gold['tasks']['1:color'] = {'status': 'absent', 'spans': []}
    result = review.score(cards, gold, pred)
    assert result['false_positive_absent_tasks'] == 1
    assert result['fp'] == 1
    assert result['recall'] is None


def test_correct_absence_does_not_invent_span_f1():
    cards, gold, pred = fixture()
    gold['tasks']['1:color'] = {'status': 'absent', 'spans': []}
    pred[0]['candidates'] = []
    result = review.score(cards, gold, pred)
    assert result['task_accuracy'] == 1
    assert result['f1'] is None


def test_incomplete_review_is_not_final_quality():
    cards, gold, pred = fixture()
    gold['tasks']['1:color'] = {'status': 'unreviewed', 'spans': []}
    with pytest.raises(ValueError, match='Still unreviewed'):
        review.score(cards, gold, pred)
    assert review.score(cards, gold, pred, allow_partial=True)['incomplete']


def test_missing_and_failed_predictions_cannot_count_as_absence():
    cards, gold, pred = fixture()
    with pytest.raises(ValueError, match='cover every card'):
        review.score(cards, gold, [])
    pred[0]['status'] = 'partial'
    with pytest.raises(ValueError, match='Incomplete/failed'):
        review.score(cards, gold, pred)


def test_evidence_must_match_source():
    cards, gold, pred = fixture()
    gold['tasks']['1:color']['spans'][0]['quote'] = 'чёрный'
    with pytest.raises(ValueError, match='Evidence does not match'):
        review.score(cards, gold, pred)


def test_ambiguous_tasks_reported_and_excluded():
    cards, gold, pred = fixture()
    gold['tasks']['1:color'] = {'status': 'ambiguous', 'spans': [], 'note': 'Неясно, к чему относится цвет'}
    result = review.score(cards, gold, pred)
    assert result['review_states']['ambiguous'] == 1
    assert result['tasks'] == 0
    assert result['f1'] is None


def test_duplicate_predictions_rejected():
    cards, gold, pred = fixture()
    with pytest.raises(ValueError, match='duplicate'):
        review.score(cards, gold, pred + pred)

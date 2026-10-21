from datetime import date

import pytest

from lineup_card.models import (CONTEXT_METRICS, METRICS, Domain, DomainAssessment,
                                LoadContext, Reading, Status)


def test_two_response_domains():
    assert set(METRICS) == {Domain.PERCEPTUAL, Domain.NEUROMUSCULAR}
    assert METRICS[Domain.NEUROMUSCULAR].column == "rsi_mod"
    assert METRICS[Domain.PERCEPTUAL].column == "wellness_score"


def test_context_metrics():
    assert CONTEXT_METRICS == {"jump_height_cm", "player_load", "throw_count", "pitch_count"}


def test_reading_accepts_context_metric_and_rejects_unknown():
    Reading(athlete_id="LC01", name="A. B", pos="RP", day=date(2026, 9, 1),
            metric="throw_count", value=40, source="catapult")
    with pytest.raises(ValueError):
        Reading(athlete_id="LC01", name="A. B", pos="RP", day=date(2026, 9, 1),
                metric="hrv_lnrmssd", value=4.0)


def test_reading_rejects_negative():
    with pytest.raises(ValueError):
        Reading(athlete_id="LC01", name="A. B", pos="RP", day=date(2026, 9, 1),
                metric="rsi_mod", value=-0.1)


def test_domain_assessment_has_noise_fields():
    d = DomainAssessment(domain=Domain.NEUROMUSCULAR, status=Status.CLEARED, fresh=True,
                         today=0.5, base=None, pct=None, decline_z=None)
    assert d.beyond_noise is None and d.te is None


def test_load_context_fields():
    lc = LoadContext()
    assert lc.throws_7d is None and lc.player_load_today is None

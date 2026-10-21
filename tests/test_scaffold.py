def test_engine_imports():
    from lineup_card import engine, models
    assert engine.BASELINE_DAYS == 28
    assert models.Status.REVIEW.value == "review"

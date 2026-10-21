"""Data models for Lineup Card (from Readiness 09435aa, trimmed).

A Reading is one athlete-day-metric value (what an adapter delivers).
DomainAssessment is what the engine computes for one response domain;
AthleteAssessment aggregates the response domains into an availability
status by convergence, with load/ACWR carried as context. A Brief is the
assembled morning message.

Every number a coach reads exists on an assessment before any language
model is involved. The model phrases; it never computes. Nothing here
predicts injury — it surfaces individual change in readiness.
"""

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Status(str, Enum):
    REVIEW = "review"
    MONITOR = "monitor"
    CLEARED = "cleared"
    INSUFFICIENT = "insufficient_data"


class Domain(str, Enum):
    PERCEPTUAL = "perceptual"        # wellness questionnaire
    NEUROMUSCULAR = "neuromuscular"  # CMJ RSI-mod


class ReadinessDriver(str, Enum):
    PERCEPTUAL = "perceptual"
    NEUROMUSCULAR = "neuromuscular"


class MetricSpec(BaseModel):
    domain: Domain
    column: str          # matches Reading.metric
    label: str
    unit: str
    higher_is_worse: bool
    rolling_days: int    # 7 for HRV (rolling mean), 1 otherwise


METRICS: dict[Domain, MetricSpec] = {
    Domain.PERCEPTUAL: MetricSpec(
        domain=Domain.PERCEPTUAL, column="wellness_score",
        label="Wellness", unit="pts", higher_is_worse=False, rolling_days=1),
    Domain.NEUROMUSCULAR: MetricSpec(
        domain=Domain.NEUROMUSCULAR, column="rsi_mod",
        label="RSI-mod", unit="m/s", higher_is_worse=False, rolling_days=1),
}

# context metrics: shown on the card, never set a status
JUMP_HEIGHT = "jump_height_cm"
PLAYER_LOAD = "player_load"
THROWS = "throw_count"
PITCHES = "pitch_count"
CONTEXT_METRICS = {JUMP_HEIGHT, PLAYER_LOAD, THROWS, PITCHES}


def goodness_specs() -> dict[Domain, str]:
    """Map each response domain to its metric column (helper for callers)."""
    return {d: s.column for d, s in METRICS.items()}


class Reading(BaseModel):
    """One athlete-day-metric value, as delivered by an adapter."""

    model_config = ConfigDict(allow_inf_nan=False, str_strip_whitespace=True)

    athlete_id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    pos: str = Field(min_length=1, max_length=100)
    day: date
    metric: str
    value: float
    source: str = Field(default="synthetic", min_length=1, max_length=200)

    @field_validator("metric")
    @classmethod
    def known_metric(cls, value: str) -> str:
        if value not in {s.column for s in METRICS.values()} | CONTEXT_METRICS:
            raise ValueError("Unknown metric; map export columns to an engine metric")
        return value

    @model_validator(mode="after")
    def nonnegative_metrics(self):
        if self.value < 0:
            raise ValueError("This metric cannot be negative")
        return self


class Baseline(BaseModel):
    mean: float
    sd: float
    n: int
    swc: float  # 0.2 x SD, on the goodness scale


class DomainAssessment(BaseModel):
    domain: Domain
    status: Status
    fresh: bool                    # a recent-enough reading exists
    observed_on: date | None = None
    today: float | None            # raw scale, human units
    base: Baseline | None
    pct: float | None
    decline_z: float | None        # goodness scale: a decline is negative
    consecutive_declines: int = 0
    te: float | None = None              # typical error, raw units
    beyond_noise: bool | None = None     # None when TE unknown
    reasons: list[str] = Field(default_factory=list)

    @property
    def assessable(self) -> bool:
        return self.fresh and self.decline_z is not None


class LoadContext(BaseModel):
    """Workload CONTEXT from Catapult. Never sets a status."""

    player_load_today: float | None = None
    throws_today: int | None = None
    pitches_today: int | None = None
    throws_7d: int | None = None        # throws + pitches, last 7 days, None if no rows


class AthleteAssessment(BaseModel):
    athlete_id: str
    name: str
    pos: str
    status: Status                       # convergence across response domains
    domains: list[DomainAssessment]
    drivers: list[ReadinessDriver]       # non-cleared domains, worst first
    load: LoadContext
    reasons: list[str] = Field(default_factory=list)

    def flagged_domains(self) -> list[DomainAssessment]:
        return [d for d in self.domains if d.status in (Status.REVIEW, Status.MONITOR)]

    @property
    def missing_domains(self) -> list[Domain]:
        assessed = {d.domain for d in self.domains if d.assessable}
        return [domain for domain in Domain if domain not in assessed]

    @property
    def data_complete(self) -> bool:
        return not self.missing_domains

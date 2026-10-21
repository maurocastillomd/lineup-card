"""Data models for the multi-domain Readiness pipeline.

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
    PERCEPTUAL = "perceptual"      # subjective wellness
    AUTONOMIC = "autonomic"        # HRV
    NEUROMUSCULAR = "neuromuscular"  # CMJ strategy


class ReadinessDriver(str, Enum):
    PERCEPTUAL = "perceptual"
    AUTONOMIC = "autonomic"
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
    Domain.AUTONOMIC: MetricSpec(
        domain=Domain.AUTONOMIC, column="hrv_lnrmssd",
        label="HRV (ln rMSSD)", unit="", higher_is_worse=False, rolling_days=7),
    Domain.NEUROMUSCULAR: MetricSpec(
        domain=Domain.NEUROMUSCULAR, column="rsi_mod",
        label="RSI-mod", unit="", higher_is_worse=False, rolling_days=1),
}

# context metric column names (never flag)
SRPE = "srpe_au"
HSR = "hsr_m"
TOTAL = "total_m"


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
        if value not in {s.column for s in METRICS.values()} | {SRPE, HSR, TOTAL}:
            raise ValueError("Unknown metric; map export columns to an engine metric")
        return value

    @model_validator(mode="after")
    def nonnegative_metrics(self):
        if self.metric != "hrv_lnrmssd" and self.value < 0:
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
    reasons: list[str] = Field(default_factory=list)

    @property
    def assessable(self) -> bool:
        return self.fresh and self.decline_z is not None


class LoadContext(BaseModel):
    """Load/workload CONTEXT. Never sets availability status."""

    srpe_today: float | None = None
    srpe_z: float | None = None
    spike: bool = False
    hsr_today: float | None = None
    total_today: float | None = None
    acwr: float | None = None


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


class Flag(BaseModel):
    assessment: AthleteAssessment
    note: str


class Brief(BaseModel):
    day: date
    summary: str
    flags: list[Flag]
    cleared: list[AthleteAssessment]
    total: int
    insufficient: list[AthleteAssessment] = Field(default_factory=list)

    @property
    def cleared_count(self) -> int:
        return len(self.cleared)


class DailyPoint(BaseModel):
    day: date
    z: float


class AthleteWeek(BaseModel):
    athlete_id: str
    name: str
    pos: str
    week_status: Status
    watch: bool
    days_tested: int
    days_flagged: int
    week_mean_z: float | None
    prior_mean_z: float | None
    delta_z: float | None
    drivers: list[ReadinessDriver]
    acwr_end: float | None
    load_spike: bool
    daily_z: list[DailyPoint]
    worst_day: AthleteAssessment
    note: str = ""
    days_assessed: int = 0
    complete_days: int = 0


class WeeklyReport(BaseModel):
    week_start: date
    week_end: date
    summary: str
    athletes: list[AthleteWeek]
    total: int

    @property
    def flagged(self) -> list[AthleteWeek]:
        return [w for w in self.athletes if w.week_status in (Status.REVIEW, Status.MONITOR)]

    @property
    def insufficient(self) -> list[AthleteWeek]:
        return [w for w in self.athletes if w.week_status is Status.INSUFFICIENT]

    @property
    def watch(self) -> list[AthleteWeek]:
        return [w for w in self.athletes if w.watch]

    @property
    def cleared_count(self) -> int:
        return sum(w.week_status is Status.CLEARED and not w.watch for w in self.athletes)

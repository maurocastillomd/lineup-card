# Vendor API readers: plan

Date: 2026-10-26. Approved by Mauro ("Go").
Goal: pull VALD ForceDecks and Catapult OpenField data through their APIs and
write the same inbox CSVs a manual export would, so the tested pipeline
(clean, flag, review, card) is unchanged.

Status label everywhere: **built to the vendors' published documents, tested
against mocked responses, not yet tested against a live account.**

## Facts this is built on (sources in docs/api-sources.md)

VALD (public Swagger + support guides, read 2026-10-26):
- Token: POST https://auth.prd.vald.com/oauth/token, form body
  grant_type=client_credentials, client_id, client_secret,
  audience=vald-api-external. Response access_token, expires_in. Cache it.
- Hosts: prd-{use|aue|euw}-api-extforcedecks.valdperformance.com,
  prd-{region}-api-externalprofile.valdperformance.com.
- GET /profiles?TenantId= -> {"profiles":[{profileId, givenName, familyName, externalId, ...}]} or 204.
- GET /tests?tenantId=&modifiedFromUtc=YYYY-MM-DDTHH:MM:SS.000Z ->
  {"tests":[{testId, profileId, modifiedDateUtc, recordedDateUtc,
  recordedDateOffset (minutes), testType, ...}]}. Page by setting
  modifiedFromUtc to the last test's modifiedDateUtc until 204; dedupe by testId.
- GET /v2019q3/teams/{tenantId}/tests/{testId}/trials -> array of trials
  {id, hubAthleteId, recordedUTC, recordedOffset, limb, results:[{resultId,
  value, limb, repeat, definition{...}}]}.
- GET /resultdefinitions -> {"resultDefinitions":[{resultId, resultIdString,
  resultName, resultUnit, resultUnitScaleFactor, ...}]}. value x
  resultUnitScaleFactor = value in resultUnit.
- 429 on rate limit. Unknown: resultIds for jump height (Imp-Mom) and
  RSI-modified, and the CMJ testType code. Resolved by name at runtime and
  configurable.

Catapult (official catapultR client source, read 2026-10-26; docs site not
publicly readable):
- Long-lived API token from OpenField Cloud (enabled per account).
  Header Authorization: Bearer <token>.
- Hosts: us.catapultsports.com, eu.catapultsports.com,
  openfield.catapultsports.com (APAC); prefix /api/v6/.
- GET /api/v6/activities?startTime=<epoch>&endTime=<epoch> -> [{id, name,
  start_time, end_time, ...}].
- POST /api/v6/stats?requested_only=TRUE, JSON body {"filters":[{"name":
  "activity_id","comparison":"=","values":["<id>"]}], "parameters":[...],
  "group_by":["athlete","period"]} -> rows with athlete_name, period_id,
  period_name, start_time, end_time, total_player_load, ...
- Times are UNIX epoch seconds. 429 on rate limit.
- Unknown: baseball throw and pitch parameter slugs (account-specific).
  Configurable; omitted with a log line when not set.

## Tasks (TDD each)

1. `src/lineup_card/vendors/http.py`: tiny JSON client on urllib with an
   injectable transport (tests replay fixtures), bearer header, retry on 429
   (3 tries, backoff), clear errors on 401/403.
2. `vendors/vald_api.py`: ValdClient (token cache, profiles, result
   definitions, paged tests with dedupe, trials) and `pull_cmj(since, until)`
   -> list[CmjTrial] using definitions found by name, scale factor applied,
   only trial-level results, local date from UTC + offset, ExternalId =
   profile externalId (fallback profileId).
3. `vendors/catapult_api.py`: CatapultClient (activities in a window, stats
   per activity grouped by athlete and period) and `pull_periods(since,
   until)` -> list[CatapultPeriod], period_number by start time within the
   activity, configurable throw/pitch slugs.
4. `src/lineup_card/inbox.py`: write CmjTrial / CatapultPeriod lists to the
   inbox CSVs in exactly the reader formats; round-trip tests (write ->
   read_vald / read_catapult gives the same rows).
5. `scripts/pull.py`: CLI for one date or a range. Credentials and settings
   only from environment variables (VALD_CLIENT_ID, VALD_CLIENT_SECRET,
   VALD_TENANT_ID, VALD_REGION, VALD_CMJ_TEST_TYPE, CATAPULT_TOKEN,
   CATAPULT_HOST, CATAPULT_THROW_SLUG, CATAPULT_PITCH_SLUG). Missing
   settings -> plain message, non-zero exit, nothing written. Writes to a temp
   file then renames, so a failed pull never leaves half a CSV.
6. Retire `adapters/api_stub.py` (replaced). `.env.example` with empty
   values; `.env` in .gitignore. README "Real data" section rewritten with a
   built / tested / not-tested table, how a club gets keys, and the schedule
   (launchd / cron) for pull + build. docs/api-sources.md lists every fact
   with its source URL.

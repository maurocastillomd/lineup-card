# Vendor API sources

Every fact the API readers rely on, with where it came from. All sources were read on 2026-10-26.
Status: built to these documents and tested against mocked replies. Not yet tested against a live account.

## VALD ForceDecks

| Fact used in the code | Source |
|---|---|
| Token: POST `https://auth.prd.vald.com/oauth/token`, form body `grant_type=client_credentials`, `client_id`, `client_secret`, `audience=vald-api-external`. Reply has `access_token` and `expires_in` (seconds). | [B] example code; [C] (the older security.valdperformance.com token URL is deprecated as of March 2026) |
| Token requests are rate limited, so the token is cached and reused until it expires. | [B] "Getting production-ready" |
| Rate limit answer is HTTP 429. | [B] |
| Region hosts: `prd-use-`, `prd-aue-`, `prd-euw-` for United States East, Australia East, Europe West. Data is only reachable through its own region. | [A] "Identify your region"; [B] |
| ForceDecks host `https://prd-{region}-api-extforcedecks.valdperformance.com`; Profiles host `https://prd-{region}-api-externalprofile.valdperformance.com`. | [A], [S1], [S2], [R] `R/config.R` |
| `GET /profiles?tenantId=` returns `{"profiles":[{profileId, givenName, familyName, externalId, ...}]}` or 204. | [S2] schema `GetProfileSearchResponse`; [R] `R/profiles.R` uses `tenantId` |
| `GET /tests?tenantId=&modifiedFromUtc=` returns `{"tests":[{testId, profileId, modifiedDateUtc, recordedDateUtc, recordedDateOffset, testType, ...}]}` or 204. First value format `YYYY-MM-DDT00:00:00.000Z`. | [A] Scenario 1; [S1] schema `GetCursorPagedTestsResponse` / `TestResponse` |
| Paging: tests come ordered by `modifiedDateUtc`; set `modifiedFromUtc` to the last test's `modifiedDateUtc` and repeat until 204. The last test can repeat, so tests are de-duplicated by `testId`. Tie handling (our choice, not from VALD): when a page ends on the time it was asked from, the cursor moves 1 ms past it so paging cannot stall; if several tests share that time, a warning names it, since tests with that time beyond the page are not reachable this way. | [A] Scenario 1; [R] `R/forcedecks_tests.R` |
| `GET /v2019q3/teams/{teamId}/tests/{testId}/trials` returns an array of trials `{id, hubAthleteId, recordedUTC, recordedOffset, limb, results:[{resultId, value, limb, repeat, definition}]}`. teamId is the tenant ID. | [A] Scenario 2; [S1] schema `TrialDTO`, `TeamDTO` ("Team/Tenant Id") |
| `recordedOffset` / `recordedDateOffset` are minutes to add to the UTC time. | [A] FAQ |
| Whole-body metrics such as jump height have one result with limb `Both` (the guide) or `Trial` (the Swagger enum). Both are accepted. `repeat` is zero-based; only repeat 0 is used. | [A] FAQ; [S1] `ResultLimb` enum |
| `GET /resultdefinitions` returns `{"resultDefinitions":[{resultId, resultIdString, resultName, resultUnit, resultUnitName, resultUnitScaleFactor, ...}]}`. `value x resultUnitScaleFactor` = value in `resultUnit`. | [A] Scenario 4 and FAQ; [S1] `GetResultDefinitionResponse` |
| `resultUnit` values include `Centimeter`, `Meter`, `Millimeter`, `Inch`, `MeterPerSecond`, `CentimeterPerSecond`, `MillimeterPerSecond`, `RSIModified`. | [S1] enum `UnitType` |
| Access: email support@vald.com with the Hub organization ID, sign the API License Agreement, then VALD sends clientId and clientSecret through a link that expires in 7 days. Keep credentials in environment variables. | [B] "Requesting API access" |

Sources:
- [A] VALD, "A guide to using the External ForceDecks API", https://support.vald.com/hc/en-au/articles/38086939480729-A-guide-to-using-the-External-ForceDecks-API (updated 2026-01-19)
- [B] VALD, "How to integrate with VALD APIs", https://support.vald.com/hc/en-au/articles/23415335574553 (updated 2026-03-10)
- [C] VALD, "API Updates, March 2026", https://support.vald.com/hc/en-au/articles/55205316766233
- [S1] ForceDecks Swagger, https://prd-use-api-extforcedecks.valdperformance.com/swagger/v2019q3/swagger.json
- [S2] Profiles Swagger, https://prd-use-api-externalprofile.valdperformance.com/swagger/v1/swagger.json
- [S3] Tenants Swagger, https://prd-use-api-externaltenants.valdperformance.com/swagger/v1/swagger.json
- [R] valdr R package 4.0.0 (VALD's own R client, CRAN), files `R/config.R`, `R/forcedecks_tests.R`, `R/forcedecks_trials.R`, `R/profiles.R`

## Catapult OpenField Cloud

Catapult's API documentation site (docs.connect.catapultsports.com) refused outside reads (HTTP 403). The facts below come from Catapult's own R client, catapultR, and its published demos.

| Fact used in the code | Source |
|---|---|
| A long-lived API token is generated in OpenField Cloud when API access is enabled on the account. Sent as `Authorization: Bearer <token>`. | [K1] `R/ofCloud.R`; [K3] |
| Hosts: `us.catapultsports.com` (Americas), `eu.catapultsports.com` (EMEA), `openfield.catapultsports.com` (APAC). Path prefix `/api/v6/`. | [K1] `R/ofCloud.R` |
| `GET /api/v6/activities?startTime=<epoch>&endTime=<epoch>` returns a list of activities with `id`, `name`, `start_time`, `end_time`, `periods`, `tags`. | [K1]; [K3] |
| `POST /api/v6/stats?requested_only=TRUE` with JSON body `{"filters":[{"name":"activity_id","comparison":"=","values":["<id>"]}],"parameters":["total_player_load"],"group_by":["athlete","period"]}`. Filter values are strings. | [K1]; [K2] |
| Stats rows include `athlete_name`, `activity_name`, `activity_id`, `period_id`, `period_name`, `start_time`, `end_time`, one column per requested parameter (for example `total_player_load`), `date`. | [K2] |
| Times are UNIX epoch seconds (UTC). | [K1]; [K2] |
| Rate limit answer is HTTP 429. | [K1] |
| Baseball throw and pitch metrics come from the Baseball module and are account specific. Their parameter slugs are listed by `GET /api/v6/parameters` on an account that has the module. | [K4]; [K1] |

Sources:
- [K1] Catapult Sports, catapultR source, https://github.com/SBGSports/catapultr (file `R/ofCloud.R`)
- [K2] catapultR demo, https://catapultr.catapultsports.com/get_summary_stats_demo.html
- [K3] catapultR OpenField Cloud notes, https://catapultr.catapultsports.com/other_files/ofCloud.html
- [K4] Catapult support, "How to Detect Baseball Metrics", https://support.catapultsports.com/hc/en-us/articles/360001439835-How-to-Detect-Baseball-Metrics

## Not verified against a live account

Each item below is handled in the code so it can be fixed with a setting, not a code change, and the tool stops with a clear message instead of guessing.

1. **VALD CMJ test type code.** Default `CMJ`. Set `VALD_CMJ_TEST_TYPE` if the account uses another code.
2. **VALD result definitions for "Jump Height (Imp-Mom)" and RSI-modified.** Their resultIds are not public. The tool finds them by name at run time (exact name or idString first, then a single name that contains the text). If none or several match, it stops and lists the closest names. Set `VALD_JUMP_RESULT` / `VALD_RSI_RESULT` to the exact name, idString or id.
3. **VALD units.** The tool multiplies by `resultUnitScaleFactor` and then converts the `resultUnit` to cm or m/s. It treats VALD's `RSIModified` unit as m/s (RSI-modified is jump height in metres over time to take-off in seconds, and ForceDecks exports label it [m/s]). Any other unit (for example `CentimeterSI` or `NoUnit`) stops the pull.
4. **VALD limb value for jump height.** The guide says `Both`, the Swagger enum says `Trial`. Both are accepted.
5. **Which VALD profile field the club fills.** Identity uses the profile's External ID, falling back to the VALD profileId. The crosswalk must hold the same value.
6. **VALD paging edge cases.** If a page ends on the same time it was asked from (the last test repeats, or several tests share one `modifiedDateUtc`), the tool moves 1 ms past that time and asks again. When more than one test shares the time it prints a warning, because tests with that exact time beyond that page cannot be reached. Paging still stops after 1000 pages. Not seen live.
7. **Catapult activities window.** Assumed to return activities that start between `startTime` and `endTime`. The tool asks from one day early and keeps only periods whose own start falls on the requested local day.
8. **Catapult stats row fields.** Field names come from the catapultR demo, not from a live reply. Numbers sent as strings are accepted.
9. **Catapult throw and pitch slugs.** Not public. Columns stay blank until `CATAPULT_THROW_SLUG` and `CATAPULT_PITCH_SLUG` are set.
10. **Catapult load slug.** `total_player_load` is the demo's parameter. The tool writes it as `player_load`. Set `CATAPULT_LOAD_SLUG` if the club uses another.
11. **Catapult period IDs.** Periods are told apart by `period_id` (or the name when missing). Activity and period IDs are assumed to be strings or numbers; either works.
12. **Rate limit headers.** A `Retry-After` header in seconds is honored if present, up to 60 seconds. Neither vendor documents one. A server error (5xx) is retried once.
13. **VALD token life.** If the token reply has no `expires_in`, the token is treated as good for 300 seconds.

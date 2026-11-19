# Nexus inspection wait source-to-UI matrix

**Verification date:** November 19, 2026  
**Status:** Feed-field mapping inspected in the repository; per-crossing lane eligibility and current availability remain **Unverified**.  
**Authority:** Nexus Product & UX Decisions v0.2, D2-04/D2-06 and questions O-01/O-02/O-03. Evidence only; no product decision changed.

## Source field mapping

| Direction / publisher | Passenger Regular | Passenger NEXUS | Passenger Ready | Commercial Regular | Commercial FAST |
|---|---|---|---|---|---|
| Into **USA** — CBP | passenger_vehicle_lanes.standard_lanes | passenger_vehicle_lanes.NEXUS_SENTRI_lanes | passenger_vehicle_lanes.ready_lanes | commercial_vehicle_lanes.standard_lanes | commercial_vehicle_lanes.FAST_lanes |
| Into **Canada** — CBSA | Travellers flow | **No separate wait published** | **No separate wait published** | Commercial flow | **No separate FAST wait published** |

The mapping applies to Ambassador Bridge, Detroit–Windsor Tunnel and Gordie Howe International Bridge. It does **not** assert that any category is physically supported or operating at every crossing. CBP can return a numeric wait, N/A, Lanes Closed or Update Pending for each lane field. The existing CBSA parser treats a commercial Not Applicable value as **unavailable**, not independently verified physical ineligibility. Do not promote that to an N/A physical-lane claim without further evidence.

## Provenance and clocks

| Field | Meaning / limitation |
|---|---|
| CBP category observation_at | Derived from its own lane update_time plus the port record date. **Agency measurement time**, not fetch time |
| CBSA category observation_at | Crossing-row Updated timestamp; separate traveller and commercial fields share that source row |
| sources.cbp/cbsa.retrieved_at | Nexus retrieval/cache time, **not new agency measurement proof** |
| generated_at | Time Nexus assembled the snapshot, **not source observation time** |
| CBP category lanes_open | Field specific to USA-bound vehicle/lane category, usable only with a fresh matching report. Do not substitute maximum_lanes |
| CBSA traveller/commercial feed | No confirmed matching open-lane count in the current normalized source |
| CBSA directory cbsa_nexus_hours | Published Canada-bound NEXUS schedule only, **not live availability or a NEXUS wait** |
| Tunnel operator dwt lane_counts | Operator-reported counts, **not verified live open-lane counts or NEXUS inspection waits** |

The dashboard uses a provisional internal 20-minute measurement/source freshness threshold. CBP's official FAQ says its app refreshes about every five minutes while estimates can still be up to an hour old, and defines the wait as time to the primary inspection booth, **not total driving time**.

## Dynamic matrix generated during publishing

The new scripts/source_coverage.py uses the *existing sanitized* nexus-live-v2 document and appends six crossing-direction rows by five requested categories to the existing GitHub Actions health summary. It makes **no external requests**, reads **no credentials**, and makes **no changes** to published JSON. The matrix distinguishes recent observations, older observations, source/snapshot delays, missing records, missing timestamps, CBP agency N/A, source-reported closures, source failures and categories **not separately published**.

The labels describe *feed evidence*, not crossing eligibility, actual live operation or verified navigation. A source-recorded closure is not proof of present physical gate status; a schedule is not a current lane-category wait.

## Runtime verification (November 19)

The [latest inspected publishing run](https://github.com/dotsthewarlock/nexus/actions/runs/44636826669) collected CBP and CBSA records for all three crossing keys (3/3) and confirmed the public Pages JSON and HTML matched the staged files. Its job summary reported CBP standard observations approximately **20.8 minutes old**, and CBSA standard observations **8.8–125.8 minutes old**, even though retrieval succeeded. This verifies collection at that specific run, **not** full special-lane coverage or a dependable 10-minute schedule.

## Unverified and next tests

- Exact physical lane/vehicle restrictions for every crossing/direction and passenger NEXUS/Ready/commercial FAST category.
- Whether agency N/A means physically unsupported, not presently operating or not reported.
- Canada-bound separate NEXUS/Ready/FAST waits and counts; the current CBSA feed does not publish them.
- Official agency update cadence, source licensing and reuse detail beyond currently inspected documentation.
- Map-provider crossing enforcement across six direction/crossing pairs ([route issue #23](https://github.com/dotsthewarlock/nexus/issues/23)).
- GitHub cron execution reliability ([M2 issue #19](https://github.com/dotsthewarlock/nexus/issues/19)).

## Source URLs, checked November 19, 2026

- [CBP Border Wait Times API](https://bwt.cbp.gov/api/waittimes); normalized in scripts/fetch_live.py; fixture examples in tests/test_fetch.py and tests/test_rc14_sources.py.
- [Official CBP Border Wait Times FAQ](https://bwt.cbp.gov/mfaq.html) for refresh and measurement semantics.
- [CBSA border wait times](https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html) and [official traveller/commercial CSV](https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv); direct independent CSV retrieval was unavailable in this review, while the Actions runner fetched it successfully.
- [CBSA offices and services directory](https://www.cbsa-asfc.gc.ca/data/cbsa-offices-services-bureaux-asfc-en.json) for schedule-only NEXUS data.
- [Nexus public-file verification run](https://github.com/dotsthewarlock/nexus/actions/runs/44636826669).

**Recommendation:** Keep strict category-only inspection waits and conservative missing/closed labels. Review multiple generated matrices and separately validate category-specific eligibility and official lane restrictions before asserting universal service, physical availability or a fastest route. Preserve the compact dashboard layout.

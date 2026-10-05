# Release gates and evidence (GRD-4670)

A v2 release passes only with saved evidence tied to the exact build, model or adapter version,
fixture manifest and (for stereo) device profile it was tested on. Demo screenshots alone never
satisfy a gate. The registry and the gate logic are in `backend/lib/release-evidence.js`; the API is
`/film/release-gates/...` (`backend/routes/release-gates.js`).

## The acceptance tests

From the 4 October 2026 tool scope, page 11.

| Test | Links | Track | Who judges |
|------|-------|-------|------------|
| AT01 | ST01 ST09 PL10 | stereo | automated |
| AT02 | ST02 ST03 ST10 | stereo | automated, with reviewer diagnostics |
| AT03 | ST07 ST11 | stereo | a person, on the target device (comfort approval) |
| AT04 | ST09 ST12 | stereo | automated |
| AT05 | WR01 WR02 WR05 | writing | automated |
| AT06 | WR06 WR08 WR09 | writing | the author (verdict) |
| AT07 | PL04 PL06 PL07 | writing | automated |
| AT08 | BL04 BL06 BL08 | blender | a person (stale-state review) |
| AT09 | BL05 BL07 BL10 | blender | a person (drift comparison) |
| AT10 | PL03 PL09 | writing, blender | automated |
| AT11 | WR01 PL04 | writing | automated |
| AT12 | PL10 | blender, stereo | automated legacy regression fixtures |

The three tracks are independent. Writing needs AT05, AT06, AT07, AT10 and AT11 and is never held
by stereo. Blender needs AT08, AT09, AT10 and AT12. Stereo needs AT01–AT04 and the AT12 (PL10)
regression on a named device profile.

## How a gate decides

For one version set, each required test is one of:

- **passed**: the latest counted evidence for exactly this version set passed;
- **failing**: the latest counted evidence failed (shown with its report);
- **stale**: evidence exists only for another version; it never carries over;
- **requalify**: the evidence was flagged by a provider or model change and needs a focused rerun;
- **missing**: nothing, only a screenshot, or only automation where a person must judge.

The gate also requires the retained artifacts for that version set. Every track keeps
`endpoint_inventory`, `fixture_manifest`, `automated_report`, `dependency_license_checklist` and
`known_limitations`. Writing adds `author_evaluation`, Blender adds `drift_comparisons`, and stereo
adds `stereo_device_review`. The report lists which are present and which are missing, every
failure, and the known limitations. A release is recorded only on a passing gate, by a named person
(an agent is refused), and it covers that version set only.

## Supported workflows

1. Run the automated suite for the build and record each test's result with
   `POST /film/release-gates/<track>/evidence` (`at`, `kind: automated`, `result`, `versions`, `report`).
2. Record the human checks (`kind: human`, with `reviewer`). For AT06 include the author verdict:
   `{ decision: release | hold, basis: pilot_report | direct_instruction, reviewer, pilot_id? }`.
3. Attach the retained artifacts with `POST /film/release-gates/<track>/artifacts`.
4. Read the gate with `POST /film/release-gates/<track>/report` and `{ versions }`.
5. A person records the release with `POST /film/release-gates/<track>/release`.

## Failure recovery

A failing or missing test leaves the gate closed, and the report names it. Fix the cause, rerun,
and record new evidence for the same version set; the latest counted record wins. A changed build,
model, adapter, fixture set or device profile is a new version set, so the gate starts empty for it.
Jobs interrupted by a restart recover through the job contracts (AT10); a cancelled job never
corrupts the approved version.

## Approvals

The author verdict (AT06), stereo comfort (AT03) and the Blender reviews (AT08, AT09) are a person's
and need `kind: human` evidence; automation alone leaves them missing. A release is a separate
person's decision against the report. No approval is inherited from another version.

## Privacy and retention

Evidence holds reports and references, not source prose. AT11 checks that deleted samples and
revoked access stop being served while provenance still shows a deleted source. Provider retention
limits are listed among the known limitations.

## Provenance

Every record keeps its version set and its fingerprint (sha256 of the version fields). Builds are
commit hashes, not branch names; fixtures are the sha256 of the fixture manifest.

## Fallbacks

When stereo is not qualified, the flat SBS fallback (`flat_sbs`, GRD-4667) is the only enabled
adapter, and AT04 requires any approved flat fallback to be identified in the delivery manifest.
The writing release does not wait for stereo.

## Requalification

A provider or model change is recorded with `POST /film/release-gates/<track>/requalify`
(`field: model | adapter`, `from`, `to`, `reason`). All evidence for the old value is flagged and no
longer counts until the affected tests are rerun.

## Support

Read the gate report first: it names each failing, stale or missing test and artifact. Evidence
records are in `film_release_evidence`, artifacts in `film_release_artifacts`, releases in
`film_releases`. Rerun the named test against the same version set and record the result.

## Current status (5 October 2026)

- **Writing:** automated test evidence exists in the repository suites. The author verdict was
  given by direct instruction: GRD-4664 was marked Done on Manny's instruction on 5 October 2026, and
  no blinded pilot has been run in the app. Record AT06 with `basis: direct_instruction`; the report
  labels it as not a pilot report. Nothing has been recorded in the production database yet.
- **Blender:** needs the AT08 and AT09 human checks against the approved reference workflow, plus
  the AT12 legacy fixtures.
- **Stereo:** blocked on GRD-4667 (qualification needs footage, a device run, a benchmark and a
  decision) and GRD-4669 (SBS delivery gate). Only the flat SBS fallback is available.

# Legacy Archive

This directory keeps retired code out of the live runtime and out of GitHub Actions discovery.

## Live Pipelines

- `services/automationService.js`
  Hourly queue + engagement automation only.
- `scripts/run-hourly-automation.js`
  Entry point for the live hourly automation worker.
- `services/igRepostService.js`
- `services/igRepostPublisherService.js`
- `services/igRepostStateService.js`
- `services/igRepostStorageService.js`
- `scripts/run-ig-repost-pipeline.js`
- `.github/workflows/ig-repost-pipeline.yml`
  The live isolated Instagram repost microservice.
- `scripts/fire-post.js`
- `.github/workflows/fire-post.yml`
  The live FirePost worker.

## Archived Legacy IG Files

- `legacy/services/automationService.legacy-with-ig.js`
  Old hourly service copy that still contained the retired queue-coupled Instagram repost path.
- `legacy/scripts/ig-pinterest-pipeline.legacy.js`
  Retired standalone IG-to-Pinterest affiliate pipeline.
- `legacy/scripts/test-ig-pipeline.legacy.js`
  Retired test script for the old IG affiliate pipeline.
- `legacy/workflows/ig-to-pinterest-affiliate.archived.yml`
  Removed from `.github/workflows`, so GitHub no longer treats it as a live workflow.
- `legacy/workflows/instant-mission.archived.yml`
  Removed from `.github/workflows`, so GitHub no longer treats it as a live workflow.

## Notes

- Nothing under `legacy/` is imported by the live app or scheduled by GitHub Actions.
- Legacy IG channel data migration is still intentionally active inside `services/igRepostService.js` so existing saved channels can be preserved safely.

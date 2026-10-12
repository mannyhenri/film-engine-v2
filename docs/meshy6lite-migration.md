# Meshy 6 Lite migration (V2 only)

V2 now defaults to `meshy-6-lite` for text/image-to-3D. Standard model choices are
`meshy-6-lite`, `meshy-6`, `meshy-7.1`, and `latest`. Unsupported explicit names
fail locally instead of selecting a different model. Text refinement carries the
same `ai_model`. No `model_type: lowpoly` is sent.

The API health response includes a V2 contract identity. Electron only reuses a
backend with that identity and the matching version. A legacy server occupying
3100 is left running; V2 starts its backend on an available port and passes that
address to the renderer. The persistent data directory remains shared.

## Rollout and shared data

No live database mutation or server restart is part of this source change.
When V2 next starts, migration 129 changes explicit `model3d_model: meshy-5`
selections to `meshy-6-lite` if `model3d` is Meshy or unset. It backs up each
original configuration and its migrated value in `film_meshy6lite_config_backup`.
Other providers, settings, historical assets and jobs are untouched.

Because the database is shared, the retiring legacy application will see the
migrated settings too. Finish active jobs before starting V2 for rollout; avoid
running both applications against the shared database during the transition.

For rollback, first stop V2 safely after its jobs finish, then run the SQL in
`docs/meshy6lite-rollback.sql` against the same database. It restores only rows
whose configuration still matches the migration output, preserving later edits.
Keep the backup table and migration tracking entry. Restore the previous V2 code
before using restored Meshy 5 settings; Meshy 5 retires October 10, 2026.

Pricing uses API mesh-only rates of 5 credits for 6 Lite and 20 for 6/7.1/latest.
The adapter estimates 15 credits for textured 6 Lite and 30 for textured
6/7.1/latest, marking estimates as unconfirmed. Historical Meshy 5 metadata is
retained. No provider-side generation was used for validation.

Sources: https://docs.meshy.ai/en/api/changelog and https://docs.meshy.ai/en/api/pricing

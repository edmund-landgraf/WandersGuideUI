# Content update boundaries

Wanderer's Guide content follows its existing update process. The separate PF2 database is maintained through PathfinderUtilities. WGUI must not introduce a parallel automated Monster Core 2 ingestion pipeline.

The dedicated Monster Core 2 download/import button, pack downloader, special publication routing, skip-existing preflight and pack-audit workflow from #84 and #91 are shelved. The original manual upload path is restored. Generic Foundry creature conversion fixes (including prepared spell slots, damage, senses and reaction handling), source metadata schema and regression/build checks remain.

Archived implementation: branch `archive/monster-core-2-bulk-import`, based on `ea52a3de808a8c626366918bd06e36aafc854666`. Do not run or resurrect the bulk import without an explicit architectural decision. Existing catalog records are not deleted or changed by this cleanup; no database migration is required.

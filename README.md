# Wanderer's Guide — Campaign UI

A parallel frontend for [Wanderer's Guide](https://wanderersguide.app): Pathfinder and Starfinder Second Edition campaigns and encounters.

This repo keeps the existing character builder and character sheet as the source of truth. It adds a campaign workspace that GMs and players share. Role and combatant ownership control what you can see and edit.

## Interfaces

The local launcher at `/` lets you pick which UI to run:

| Route | Name | Purpose |
| --- | --- | --- |
| `/` | Launcher | Choose Phase 0 or Phase 1 |
| `/phase0` | Parity clone | Read-only check of current campaign and encounter data |
| `/phase1` | Replacement workspace | New campaign / encounter UI (Tailwind) |

Phase 1 routes:

- `/phase1` — campaign list
- `/phase1/campaign/:campaignId` — campaign workspace
- `/phase1/campaign/:campaignId/encounters/:encounterId` — encounter
- `/phase1/campaign/:campaignId/notes/:noteIndex` — campaign notes

The original character builder and sheet still live in this codebase and can be linked from the campaign UI (`VITE_OLD_UI_ORIGIN`, default `http://localhost:5193`).

## Setup

Requires Node.js 20+ and a Wanderer's Guide Supabase project.

```bash
npm install
cp .env.local.template .env.local

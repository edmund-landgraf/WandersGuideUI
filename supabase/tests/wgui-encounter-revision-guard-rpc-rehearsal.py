#!/usr/bin/env python3
"""Disposable Postgres only: deterministic cross-session races of the production RPCs."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

GM = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
TIMEOUT = 20

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def js(value):
    return literal(json.dumps(value, separators=(",", ":"))) + "::jsonb"

def require(condition, message):
    if not condition:
        raise AssertionError(message)

def execute(sql, role=None, expected=None):
    command = ("SET statement_timeout='15s'; " +
               ("SET ROLE " + role + "; " if role else "") + sql)
    result = subprocess.run(PSQL + ["-c", command], capture_output=True, text=True, timeout=TIMEOUT)
    if expected:
        require(result.returncode != 0 and "ERROR:  " + expected + ":" in result.stderr,
                f"Expected SQLSTATE {expected}; got {result.returncode}: {result.stderr}")
        return None
    require(result.returncode == 0, result.stderr)
    return result.stdout.strip()

def row(encounter):
    return json.loads(execute(f"select to_jsonb(e) from public.encounter e where id={encounter}"))

def save(encounter, revision, patch, caller=GM):
    return f"select public.wgui_save_encounter_revision('{caller}',{encounter},{revision},{js(patch)});"

def archive(encounter, payload, caller=GM, campaign=1):
    return f"select public.wgui_append_foundry_combat_archive('{caller}',{campaign},{encounter},{js(payload)});"

def payload(export_id, total=12):
    at = "2026-11-24T00:00:00.000Z"
    return {"worldId": "fixture-world", "exportId": export_id, "foundryCombatId": "combat",
            "foundrySceneId": "scene", "startedAt": at, "endedAt": at, "rounds": 1,
            "transcript": [{"messageId": "roll-1", "at": at, "round": 1,
                            "speaker": {"alias": "Goblin", "actor": "actor", "token": "token"},
                            "rolls": [{"total": total, "formula": "1d20"}]}]}

def wait_for(predicate, description):
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("Timed out: " + description)

def race(label, first, second, expected_second=None):
    """Hold first transaction open, prove second is blocked by it, then commit."""
    leader_name = "rehearsal-" + label + "-leader"
    follower_name = "rehearsal-" + label + "-follower"
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        leader_log = directory / "leader.log"
        follower_log = directory / "follower.log"
        leader = follower = None
        try:
            with leader_log.open("w") as out, follower_log.open("w") as out2:
                leader = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=out,
                                          stderr=subprocess.STDOUT, text=True,
                                          env={**os.environ, "PGAPPNAME": leader_name})
                leader.stdin.write("BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='45s'; SET LOCAL ROLE service_role;\n" +
                                   first + "\n\\echo LEADER_READY\n")
                leader.stdin.flush()
                wait_for(lambda: "LEADER_READY" in leader_log.read_text() or leader.poll() is not None, "leader executes first RPC")
                require(leader.poll() is None and "LEADER_READY" in leader_log.read_text(), leader_log.read_text())
                follower = subprocess.Popen(
                    PSQL + ["-c", "SET statement_timeout='15s'; SET ROLE service_role; " + second],
                    stdout=out2, stderr=subprocess.STDOUT, text=True,
                    env={**os.environ, "PGAPPNAME": follower_name})
                blocked_sql = ("select exists(select 1 from pg_stat_activity f "
                               "join pg_stat_activity l on l.pid=any(pg_blocking_pids(f.pid)) "
                               f"where f.application_name={literal(follower_name)} "
                               f"and l.application_name={literal(leader_name)} and f.wait_event_type='Lock')")
                wait_for(lambda: execute(blocked_sql) == "t" or follower.poll() is not None,
                         "follower waits on the leader transaction")
                require(follower.poll() is None and execute(blocked_sql) == "t",
                        "Follower did not actually contend on the leader lock: " + follower_log.read_text())
                leader.stdin.write("COMMIT;\n\\q\n")
                leader.stdin.flush()
                require(leader.wait(timeout=TIMEOUT) == 0, leader_log.read_text())
                status = follower.wait(timeout=TIMEOUT)
            first_text = leader_log.read_text()
            second_text = follower_log.read_text()
            require("ERROR:" not in first_text, first_text)
            first_result = json.loads(next(line for line in first_text.splitlines() if line.startswith("{")))
            if expected_second:
                require(status != 0 and "ERROR:  " + expected_second + ":" in second_text, second_text)
                second_result = None
            else:
                require(status == 0 and "ERROR:" not in second_text, second_text)
                second_result = json.loads(next(line for line in second_text.splitlines() if line.startswith("{")))
            print("PASS " + label + ": verified actual lock contention", flush=True)
            return first_result, second_result
        finally:
            for process in (follower, leader):
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=TIMEOUT)

def assert_state(encounter, revision, roster, logs, name="Fixture", dice=None):
    state = row(encounter)
    meta = state["meta_data"]
    require(meta["encounter_revision"] == revision, f"Unexpected revision: {state}")
    require(state["name"] == name and state["combatants"] == roster, f"Lost name or roster: {state}")
    require(meta["untouched"] is True and meta["foundry"]["other"] == 1, "Lost unrelated metadata")
    require(meta["dice_roll_log"] == ([1] if dice is None else dice), "Lost dice log")
    require(meta["foundry"].get("combat_logs", []) == logs, "Archive mirror differs")
    canonical = json.loads(execute(f"select coalesce(jsonb_agg(archive order by export_id),'[]'::jsonb) from public.wgui_foundry_combat_archive where encounter_id={encounter}"))
    require(canonical == sorted(logs, key=lambda value: value["exportId"]), "Canonical archives differ")
    return state

def main():
    require(os.environ.get("PGDATABASE") == "revision_test" and os.environ.get("WGUI_DISPOSABLE_DB") == "1",
            "Refusing to run outside explicitly marked disposable revision_test")
    # Separate rows for each scenario; no dependency on prior contract revision counts.
    execute("alter table public.encounter add column user_id uuid; "
            "alter table public.encounter add column name text default 'Fixture'; "
            "alter table public.encounter add column icon text default 'combat'; "
            "alter table public.encounter add column color text default 'blue';")
    roster = {"list": [{"_id": "goblin", "hp": 7, "initiative": 12}, {"_id": "pc", "hp": 18}]}
    meta = {"untouched": True, "dice_roll_log": [1], "foundry": {"other": 1}, "encounter_revision": 0}
    for encounter in (11, 12, 13, 14):
        execute(f"insert into public.encounter(id,campaign_id,user_id,meta_data,combatants) values ({encounter},1,'{GM}',{js(meta)},{js(roster)})")
    # Archive wins; stale browser snapshot cannot replace roster, dice or archive.
    a = payload("archive-first")
    first, _ = race("archive-first", archive(11, a), save(11, 0, {"combatants": {"list": []}, "meta_data": meta}), "40001")
    assert_state(11, 1, roster, [a])
    reloaded = row(11)
    changed = {"list": [{**roster["list"][0], "hp": 4}, roster["list"][1]]}
    updated = json.loads(execute(save(11, reloaded["meta_data"]["encounter_revision"], {"combatants": changed, "name": "After reload"}), "service_role"))
    require(updated["meta_data"]["encounter_revision"] == 2, "Reloaded save did not advance")
    retry = json.loads(execute(archive(11, a), "service_role"))
    require(first["receipt"] == retry["receipt"] and retry["idempotent"], "Retry changed receipt")
    assert_state(11, 2, changed, [a], "After reload")

    # Browser wins; the append must wait, then preserve its committed roster/dice.
    b = payload("save-first")
    modified_meta = {**meta, "dice_roll_log": [1, 2]}
    first, receipt = race("save-first", save(12, 0, {"combatants": changed, "meta_data": modified_meta, "name": "Saved first"}), archive(12, b))
    require(first["meta_data"]["encounter_revision"] == 1 and not receipt["idempotent"], "Unexpected initial results")
    assert_state(12, 2, changed, [b], "Saved first", [1, 2])

    # Concurrent identical delivery: one canonical row, one revision increment.
    c = payload("identical")
    first, second = race("identical", archive(13, c), archive(13, c))
    require(first["receipt"] == second["receipt"] and not first["idempotent"] and second["idempotent"], "Concurrent duplicate not idempotent")
    assert_state(13, 1, roster, [c])
    execute(archive(13, payload("identical", 99)), "service_role", "23505")
    execute(archive(13, payload("foreign"), OTHER), "service_role", "42501")
    execute(archive(13, payload("wrong-campaign"), GM, 2), "service_role", "42501")
    execute(save(13, 1, {"name": "unauthorized"}, OTHER), "service_role", "42501")
    execute(save(13, 1, {"name": "direct caller"}), "authenticated", "42501")
    execute(archive(13, payload("direct-caller")), "authenticated", "42501")
    assert_state(13, 1, roster, [c])

    # Two simultaneous browser saves: exactly one can commit the observed revision.
    first, _ = race("two-saves", save(14, 0, {"combatants": changed}), save(14, 0, {"name": "stale second"}), "40001")
    require(first["meta_data"]["encounter_revision"] == 1, "Winner did not advance revision")
    assert_state(14, 1, changed, [])
    print("All four concurrent production RPC rehearsals passed.", flush=True)

if __name__ == "__main__":
    main()

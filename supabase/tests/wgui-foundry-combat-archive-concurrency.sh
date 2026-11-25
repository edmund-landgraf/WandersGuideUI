#!/usr/bin/env bash
# Disposable PostgreSQL fixture only, never run on a production DB.
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gm=00000000-0000-0000-0000-000000000001
sql() { psql -X -qAt -v ON_ERROR_STOP=1 "$@"; }
append() {
  sql -c "select public.wgui_append_foundry_combat_archive('$gm',1,1,'{\"worldId\":\"world\",\"exportId\":\"$1\",\"transcript\":[{\"messageId\":\"one\"}]}'::jsonb)->>'receipt'"
}
# Two separate connections racing the exact same delivery must return one receipt.
append 'concurrent:1' > "$work/first" & p1=$!
append 'concurrent:1' > "$work/retry" & p2=$!
wait "$p1"; wait "$p2"
test -s "$work/first"
cmp "$work/first" "$work/retry"
# Concurrent distinct deliveries and a stale whole-metadata update.
append 'concurrent:2' > "$work/second" & p1=$!
append 'concurrent:3' > "$work/third" & p2=$!
sql -c "update public.encounter set meta_data = '{\"untouched\":true,\"dice_roll_log\":[3],\"foundry\":{\"other\":1}}' where id=1" & p3=$!
wait "$p1"; wait "$p2"; wait "$p3"
sql -c "do \$\$ begin
  if (select count(*) from public.wgui_foundry_combat_archive where encounter_id=1) <> 3 then raise exception 'Lost or duplicate canonical archives'; end if;
  if not exists (select 1 from public.encounter where id=1 and jsonb_array_length(meta_data#>'{foundry,combat_logs}')=3 and meta_data->'dice_roll_log'='[3]'::jsonb and meta_data#>'{foundry,other}'='1'::jsonb and combatants='{\"list\":[{\"hp\":7}]}'::jsonb) then raise exception 'Concurrent update lost data'; end if;
end \$\$"
echo 'Concurrent receipt and metadata preservation checks passed.'

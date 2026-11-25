#!/usr/bin/env bash
# Disposable CI database only. The preceding SQL contract leaves revision 3.
set -euo pipefail
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
meta=$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select meta_data::text from public.encounter where id=1")
write_snapshot() {
  psql -X -qAt -v ON_ERROR_STOP=1 -v meta="$meta" -v hp="$1" <<'SQL'
update public.encounter set meta_data=:'meta'::jsonb,
  combatants=jsonb_build_object('list',jsonb_build_array(jsonb_build_object('hp',:hp)))
where id=1;
SQL
}
write_snapshot 8 >"$dir/a" 2>&1 & a=$!
write_snapshot 9 >"$dir/b" 2>&1 & b=$!
set +e
wait "$a"; ra=$?
wait "$b"; rb=$?
set -e
if [ "$ra" -eq 0 ] && [ "$rb" -ne 0 ]; then
  grep -q 'Reload it and retry' "$dir/b"
elif [ "$rb" -eq 0 ] && [ "$ra" -ne 0 ]; then
  grep -q 'Reload it and retry' "$dir/a"
else
  cat "$dir/a" "$dir/b"; echo "Expected exactly one committed snapshot" >&2; exit 1
fi
psql -X -v ON_ERROR_STOP=1 -c "do \$\$ begin
  if not exists(select 1 from public.encounter where id=1 and meta_data->>'encounter_revision'='4' and (combatants#>>'{list,0,hp}') in ('8','9') and jsonb_array_length(meta_data#>'{foundry,combat_logs}')=1) then raise exception 'Race lost roster, revision, or archive'; end if;
end \$\$"
echo "One concurrent full-row save committed; the stale one was rejected."

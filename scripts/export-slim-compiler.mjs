// WG_DIR is a separate upstream checkout. Keep the slim-only compiler hook
// explicit and fail closed if the upstream export signature or store changes.
// The full/PDF paths continue using the original snapshot.
export function patchSlimCompiler(source) {
  const signature = /export async function getJsonV4Content\(entity: LivingEntity, inputStoreID\?: StoreID(, contentPackage\?: ContentPackage)?\)\s*\{/g;
  const matches = [...source.matchAll(signature)];
  const rawDump = 'const rawData = exportVariableStore(STORE_ID);';
  if (matches.length !== 1 || source.split(rawDump).length !== 2 || !source.includes('getVariables,')) {
    throw new Error('Unsupported WG json-v4 compiler: review the slim export hook before rebuilding.');
  }
  const hasPackage = Boolean(matches[0][1]);
  const patched = source.replace(signature, (_match, pkg) =>
    `export async function getJsonV4Content(entity: LivingEntity, inputStoreID?: StoreID${pkg ?? ''}, wguiSlim = false) {`
  ).replace(rawDump,
    // Serialize inside the export queue, before the variable store is reset.
    // Keep placeholder keys for the existing slim.dropped metadata.
    'const rawData = wguiSlim ? { variables: getVariables(STORE_ID), bonuses: undefined, history: undefined } : exportVariableStore(STORE_ID);'
  );
  return patched + `\nexport function getWguiSlimJsonV4Content(entity: LivingEntity) { return getJsonV4Content(entity, undefined, ${hasPackage ? 'undefined, ' : ''}true); }\n`;
}

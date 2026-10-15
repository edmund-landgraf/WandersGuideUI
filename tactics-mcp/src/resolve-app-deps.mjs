import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageFiles = [
  path.resolve(here, "../package.json"),
  path.resolve(here, "../../package.json"),
  path.resolve(here, "../../../node-sites/WandersGuideUI/package.json"),
].filter((file) => existsSync(file));

function bare(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:") && !specifier.startsWith("file:") && !specifier.startsWith("data:");
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const inApp = url.includes("/WandersGuideUI/src/") || url.includes("\\WandersGuideUI\\src\\");
  const source = typeof result.source === "string" ? result.source : result.source ? Buffer.from(result.source).toString("utf8") : "";
  if (!inApp || !source.includes("import.meta.env")) return result;
  return { ...result, source: source.replaceAll("import.meta.env", "(globalThis.__WGUI_ENV||{})"), shortCircuit: true };
}

export async function resolve(specifier, context, nextResolve) {
  if (!bare(specifier)) return nextResolve(specifier, context);
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    for (const file of packageFiles) {
      try {
        const resolved = createRequire(file).resolve(specifier);
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      } catch {
        // This install does not have the package.
      }
    }
    throw error;
  }
}

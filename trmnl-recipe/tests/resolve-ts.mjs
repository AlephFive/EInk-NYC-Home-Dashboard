/**
 * Let Node's ESM loader follow the dashboard's extensionless imports.
 *
 * The shared transit modules were written for Vite, which resolves
 * `./departures` to `departures.ts` and `./bus` to `bus/index.ts`. Node's
 * loader does neither, so importing them under `node --test` fails on the
 * first hop.
 *
 * Rewriting all 23 imports to carry extensions would work, but it would
 * change files whose only consumer today is a build that already resolves
 * them — churn in the dashboard to satisfy a test runner in the Worker. This
 * hook keeps the change on the testing side.
 *
 * Used via `node --import ./tests/resolve-ts.mjs --test`.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { register } from "node:module";

/** Extensions Vite would try, in its order. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

export function resolve(specifier, context, nextResolve) {
  // Vite imports JSON without an attribute; Node requires `with { type: "json" }`.
  // Supplying it here keeps the shared modules unchanged.

  // Only relative specifiers that already failed to carry an extension.
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    const parentPath = context.parentURL?.startsWith("file:")
      ? dirname(fileURLToPath(context.parentURL))
      : undefined;

    if (parentPath) {
      const base = resolvePath(parentPath, specifier);

      // `./departures` -> `departures.ts`
      for (const ext of EXTENSIONS) {
        if (existsSync(base + ext)) {
          return nextResolve(pathToFileURL(base + ext).href, context);
        }
      }

      // `./bus` -> `bus/index.ts`
      for (const ext of EXTENSIONS) {
        const index = resolvePath(base, `index${ext}`);
        if (existsSync(index)) {
          return nextResolve(pathToFileURL(index).href, context);
        }
      }
    }
  }

  return nextResolve(specifier, context);
}

/**
 * Declare JSON modules as JSON.
 *
 * Vite imports them bare; Node requires `with { type: "json" }` and rejects
 * the module otherwise. Setting the format here, rather than adding the
 * attribute in `resolve`, is what actually satisfies the loader — attributes
 * passed from `resolve` do not reach the validation step.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    return nextLoad(url, { ...context, importAttributes: { type: "json" } });
  }
  return nextLoad(url, context);
}

register(import.meta.url, import.meta.url);

/**
 * inventory.ts — Horizon Coverage Inventory for Graph v2.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type HorizonGraphScope,
  type CoverageManifest,
  type CoverageFailure,
  validateHorizonGraphScope,
  validateArtifactId,
} from "./relationship-types";
import { DEFAULT_IGNORE } from "./scan";

export type InventoryItemStatus = "analyzed" | "excluded" | "failed";

export type ArtifactInventoryItem = {
  artifactId: string;
  format: string;
  family: string;
  status: InventoryItemStatus;
  failureReason?: string;
  content?: string;
};

export type InventoryPolicy = {
  jsonAllowlist?: string[];
  ignoreList?: string[];
  maxFileSize?: number;
};

export type ArtifactInventory = {
  scope: HorizonGraphScope;
  items: ArtifactInventoryItem[];
  coverage: CoverageManifest;
};

const DEFAULT_JSON_ALLOWLIST = ["package.json", "tsconfig.json", "tsconfig.*.json"];

function isJsonAllowlisted(relPath: string, allowlist: string[]): boolean {
  const fileName = path.posix.basename(relPath);
  for (const pattern of allowlist) {
    if (pattern === fileName) return true;
    if (pattern.includes("*")) {
      const reg = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      if (reg.test(fileName)) return true;
    }
  }
  return false;
}

export function buildHorizonArtifactInventory(opts: {
  root: string;
  scope: HorizonGraphScope;
  policy?: InventoryPolicy;
}): ArtifactInventory {
  const scope = validateHorizonGraphScope(opts.scope);
  const root = path.resolve(opts.root);
  const jsonAllowlist = opts.policy?.jsonAllowlist ?? DEFAULT_JSON_ALLOWLIST;
  const ignoreList = opts.policy?.ignoreList ?? DEFAULT_IGNORE;

  const items: ArtifactInventoryItem[] = [];
  const failures: CoverageFailure[] = [];
  const byFormat: Record<string, number> = {};
  const byFamily: Record<string, number> = {};

  let eligibleCount = 0;
  let analyzedCount = 0;
  let excludedCount = 0;

  function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (ignoreList.includes(e.name)) continue;
      const fullPath = path.join(dir, e.name);

      // Symlink confinement check
      if (e.isSymbolicLink()) {
        try {
          const target = statSync(fullPath);
          // If symlink escapes root or invalid, exclude/fail
          const real = path.resolve(fullPath);
          if (!real.startsWith(root)) {
            failures.push({
              artifactId: path.relative(root, fullPath).replace(/\\/g, "/"),
              reason: "UNSAFE_SYMLINK",
            });
            continue;
          }
        } catch {
          continue;
        }
      }

      if (e.isDirectory()) {
        walk(fullPath);
      } else if (e.isFile()) {
        const relPosix = path.relative(root, fullPath).split(path.sep).join("/");
        let artifactId: string;
        try {
          artifactId = validateArtifactId(relPosix);
        } catch {
          failures.push({ artifactId: relPosix, reason: "INVALID_ARTIFACT_ID" });
          continue;
        }

        const ext = path.posix.extname(relPosix).toLowerCase();
        let format = ext.replace(/^\./, "");
        let family = "unknown";
        let isEligible = false;

        if (ext === ".md" || ext === ".markdown") {
          format = "md";
          family = "markdown";
          isEligible = true;
        } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"].includes(ext)) {
          format = ext.replace(/^\./, "");
          family = "code";
          isEligible = true;
        } else if (ext === ".json") {
          format = "json";
          family = "config";
          if (isJsonAllowlisted(relPosix, jsonAllowlist)) {
            isEligible = true;
          } else {
            // Non-allowlisted JSON is excluded
            items.push({
              artifactId,
              format,
              family: "excluded-json",
              status: "excluded",
              failureReason: "NON_ALLOWLISTED_JSON",
            });
            excludedCount++;
            continue;
          }
        } else {
          // Other format
          items.push({
            artifactId,
            format: format || "none",
            family: "other",
            status: "excluded",
            failureReason: "UNSUPPORTED_FORMAT",
          });
          excludedCount++;
          continue;
        }

        if (isEligible) {
          eligibleCount++;
          try {
            const content = readFileSync(fullPath, "utf8");
            items.push({
              artifactId,
              format,
              family,
              status: "analyzed",
              content,
            });
            analyzedCount++;
            byFormat[format] = (byFormat[format] ?? 0) + 1;
            byFamily[family] = (byFamily[family] ?? 0) + 1;
          } catch (err: any) {
            const reason = err?.code === "EACCES" ? "UNREADABLE_FILE" : "READ_ERROR";
            items.push({
              artifactId,
              format,
              family,
              status: "failed",
              failureReason: reason,
            });
            failures.push({ artifactId, reason });
          }
        }
      }
    }
  }

  walk(root);

  // Sort items deterministically
  items.sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  failures.sort((a, b) => a.artifactId.localeCompare(b.artifactId) || a.reason.localeCompare(b.reason));

  const coverage: CoverageManifest = {
    scope,
    byFormat,
    byFamily,
    failures,
    eligibleCount,
    analyzedCount,
    excludedCount,
  };

  return {
    scope,
    items,
    coverage,
  };
}

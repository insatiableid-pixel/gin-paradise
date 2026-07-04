import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const budgetPath = path.join(root, "quality", "bundle-budget.json");
const assetsDir = path.join(root, "dist", "assets");

if (!existsSync(budgetPath)) {
  console.error("Missing quality/bundle-budget.json");
  process.exit(1);
}

if (!existsSync(assetsDir)) {
  console.error("Missing dist/assets. Run npm run build before checking bundle budgets.");
  process.exit(1);
}

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const assets = readdirSync(assetsDir).map((name) => {
  const filePath = path.join(assetsDir, name);
  return { name, size: statSync(filePath).size };
});

const jsAssets = assets.filter((asset) => asset.name.endsWith(".js"));
const cssAssets = assets.filter((asset) => asset.name.endsWith(".css"));
const totalJsBytes = jsAssets.reduce((sum, asset) => sum + asset.size, 0);
const violations = [];

for (const asset of jsAssets) {
  if (asset.size > budget.maxJsAssetBytes) {
    violations.push(`${asset.name} is ${asset.size} bytes, above ${budget.maxJsAssetBytes}`);
  }
}

for (const asset of cssAssets) {
  if (asset.size > budget.maxCssAssetBytes) {
    violations.push(`${asset.name} is ${asset.size} bytes, above ${budget.maxCssAssetBytes}`);
  }
}

if (totalJsBytes > budget.maxTotalJsBytes) {
  violations.push(`total JS is ${totalJsBytes} bytes, above ${budget.maxTotalJsBytes}`);
}

if (violations.length > 0) {
  console.error("Bundle budget failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Bundle budget passed: ${jsAssets.length} JS assets, total JS ${totalJsBytes} bytes.`);

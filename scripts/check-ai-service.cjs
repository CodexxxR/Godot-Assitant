const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const serviceRoot = path.resolve(__dirname, "..", "services", "ai-service");
const entriesToCheck = ["index.js", "routes", "services", "utils", "config", "test"];

function collectJavaScriptFiles(targetPath, files = []) {
  const stats = fs.statSync(targetPath);

  if (stats.isFile()) {
    if (targetPath.endsWith(".js")) {
      files.push(targetPath);
    }
    return files;
  }

  if (!stats.isDirectory()) {
    return files;
  }

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    collectJavaScriptFiles(path.join(targetPath, entry.name), files);
  }

  return files;
}

const files = entriesToCheck
  .flatMap((entry) => collectJavaScriptFiles(path.join(serviceRoot, entry)))
  .sort((left, right) => left.localeCompare(right));

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], {
    cwd: serviceRoot,
    stdio: "inherit",
  });
}

execFileSync(process.execPath, ["--test", "test/*.test.js"], {
  cwd: serviceRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

console.log(`Checked ${files.length} AI service JavaScript files.`);

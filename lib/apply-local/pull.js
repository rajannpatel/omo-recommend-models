import { execFileSync } from "node:child_process";

export function pullModel(modelName) {
  try {
    execFileSync("ollama", ["pull", modelName], {
      stdio: "inherit",
      timeout: 600000,
    });
    return true;
  } catch (error) {
    console.error(`  \u2716 Failed to pull ${modelName}: ${error.message}`);
  }

  try {
    console.log("  \u2192 Retrying via curl API at http://localhost:11434/api/pull ...");
    execFileSync(
      "curl",
      [
        "-N",
        "-X",
        "POST",
        "http://localhost:11434/api/pull",
        "-d",
        JSON.stringify({ name: modelName }),
        "--max-time",
        "600",
      ],
      { stdio: "inherit", timeout: 610000 },
    );
    console.log(`  \u2713 ${modelName} pulled via curl`);
    return true;
  } catch (error) {
    console.error(`  \u2716 Also failed via curl: ${error.message}`);
    return false;
  }
}

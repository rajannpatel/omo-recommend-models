export function defaultConfig() {
  return {
    $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-opencode.schema.json",
    runtime_fallback: true,
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    agents: {
      sisyphus: { description: "Primary orchestrator and architectural planner" },
      hephaestus: { description: "Autonomous deep worker for writing large code files and refactoring" },
      oracle: { description: "High-IQ consultation agent for complex architecture and debugging" },
      librarian: { description: "Reads local documentation, markdown files, and generates summaries" },
      explore: { description: "Fast codebase exploration and pattern matching" },
      "multimodal-looker": { description: "Analyzes images, PDFs, and other media files" },
      prometheus: { description: "Generates, runs, and evaluates comprehensive unit tests" },
      metis: { description: "Pre-planning consultant for ambiguous requirements" },
      momus: { description: "Expert reviewer for work plans and quality assurance" },
      atlas: { description: "Codebase exploration and structural analysis" },
      "sisyphus-junior": { description: "Focused task executor under orchestration" },
      scout: { description: "Fast context gathering and file search" },
      sysadmin: { description: "Scripting, automation, and system configuration" },
    },
    categories: {
      "visual-engineering": { description: "Frontend, UI/UX, design, styling, animation" },
      ultrabrain: { description: "Hard logic, architecture decisions, algorithms" },
      deep: { description: "Goal-oriented autonomous problem-solving" },
      artistry: { description: "Complex problem-solving with creative approaches" },
      quick: { description: "Single file changes, typo fixes, simple modifications" },
      "unspecified-low": { description: "Low-effort tasks that don't fit other categories" },
      "unspecified-high": { description: "High-effort tasks that don't fit other categories" },
      writing: { description: "Documentation, prose, technical writing" },
    },
  };
}

export function createPanelStatus(agents, models) {
  const state = agents.map((entry) => ({
    name: entry.name,
    type: entry.type,
    results: [],
    done: false,
    consensus: null,
  }));
  const totalTasks = agents.length * models.length;
  const modelSuccessCounts = new Map(models.map((model) => [model, 0]));
  const countWidth = String(totalTasks).length;
  const formatCount = (value, total) => `${String(value).padStart(countWidth, " ")}/${total}`;
  const maxLabelWidth = Math.max("tasks".length, "started".length, "agents".length, ...models.map((model) => model.length));
  const formatLinePrefix = (label) => `   \u2022 ${(label + ":").padEnd(maxLabelWidth + 1)} `;
  return {
    agentsDone: 0,
    currentAgent: "",
    formatCount,
    formatLinePrefix,
    modelSuccessCounts,
    state,
    tasksDone: 0,
    tasksStarted: 0,
    totalTasks,
  };
}

export function printInitialStatus(agents, models, panelStatus) {
  console.log();
  console.log(`== AI Panel: ${agents.length} agents, ${models.length} panel models ==`);
  console.log("   Models:");
  for (const model of models) {
    console.log(`${panelStatus.formatLinePrefix(model)}${panelStatus.formatCount(0, agents.length)} successful responses`);
  }
  console.log("evaluating -");
  console.log(`${panelStatus.formatLinePrefix("started")}${panelStatus.formatCount(0, panelStatus.totalTasks)}`);
  console.log(`${panelStatus.formatLinePrefix("tasks")}${panelStatus.formatCount(0, panelStatus.totalTasks)}`);
  console.log(`${panelStatus.formatLinePrefix("agents")}${panelStatus.formatCount(0, agents.length)}`);
}

export function updateStatus(panelStatus, agents, models) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b[${models.length + 4}F`);
  for (const model of models) {
    const count = panelStatus.modelSuccessCounts.get(model) || 0;
    process.stdout.write(`\x1b[2K${panelStatus.formatLinePrefix(model)}${panelStatus.formatCount(count, agents.length)} successful responses\n`);
  }
  process.stdout.write(`\x1b[2Kevaluating ${panelStatus.currentAgent || "-"}\n`);
  process.stdout.write(`\x1b[2K${panelStatus.formatLinePrefix("started")}${panelStatus.formatCount(panelStatus.tasksStarted, panelStatus.totalTasks)}\n`);
  process.stdout.write(`\x1b[2K${panelStatus.formatLinePrefix("tasks")}${panelStatus.formatCount(panelStatus.tasksDone, panelStatus.totalTasks)}\n`);
  process.stdout.write(`\x1b[2K${panelStatus.formatLinePrefix("agents")}${panelStatus.formatCount(panelStatus.agentsDone, agents.length)}\n`);
  if (typeof process.stdout._handle?.flush === "function") {
    process.stdout._handle.flush();
  }
}

export function printFinalStatus(panelStatus, agents, models) {
  if (process.stdout.isTTY) return;
  console.log("   Final successful responses:");
  for (const model of models) {
    const count = panelStatus.modelSuccessCounts.get(model) || 0;
    console.log(`${panelStatus.formatLinePrefix(model)}${panelStatus.formatCount(count, agents.length)} successful responses`);
  }
}

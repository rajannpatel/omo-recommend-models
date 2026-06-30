function splitTopLevelCommaList(value) {
  const items = [];
  let start = 0;
  let depth = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === "," && depth === 0) {
      const item = text.slice(start, index).trim();
      if (item) items.push(item);
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) items.push(tail);
  return items;
}

export function formatAiAnalysis(analysis) {
  if (!analysis) return "";
  const match = analysis.match(/([\s\S]*No available rule-chain model for:\s*)([\s\S]*)/i);
  if (!match) return analysis;

  let prefix = match[1].trim();
  let listPart = match[2].trim();
  if (listPart.endsWith(".")) {
    listPart = listPart.slice(0, -1);
  }

  if (!listPart) return prefix;

  const sentenceBoundary = prefix.indexOf(". ");
  if (sentenceBoundary !== -1) {
    const firstSentence = prefix.slice(0, sentenceBoundary + 1);
    const secondSentence = prefix.slice(sentenceBoundary + 2);
    prefix = `${firstSentence}\n${secondSentence}`;
  }

  const rawItems = splitTopLevelCommaList(listPart);
  const formattedItems = rawItems.map((item) => `  • ${item.trim()}`).join("\n");

  return `${prefix}\n${formattedItems}`;
}

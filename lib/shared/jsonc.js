function stripJsoncComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let quote = "";

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index++;
      if (index < text.length) out += text[index];
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length) {
        if (text[index] === "\n" || text[index] === "\r") out += text[index];
        if (text[index] === "*" && text[index + 1] === "/") {
          index++;
          break;
        }
        index++;
      }
      continue;
    }
    out += char;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let quote = "";

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === ",") {
      let cursor = index + 1;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
      if (text[cursor] === "}" || text[cursor] === "]") continue;
    }
    out += char;
  }
  return out;
}

export function jsoncParse(text) {
  return JSON.parse(stripTrailingCommas(stripJsoncComments(text)));
}

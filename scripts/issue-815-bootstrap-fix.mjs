import fs from "node:fs";

const path = "scripts/issue-815-transform.mjs";
let content = fs.readFileSync(path, "utf8");

const oldTestPattern = String.raw`/\n\s*it\("redirects the retired legacy entry to the current professional reports",[\s\S]*?\n\s*\}\);/g`;
const newTestPattern = String.raw`/\n\s*it\("redirects the retired legacy entry to the current professional reports",[^\n]*?\}\);/g`;
if (content.split(oldTestPattern).length - 1 !== 1) {
  throw new Error("Could not locate the legacy navigation test pattern.");
}
content = content.replace(oldTestPattern, newTestPattern);

const startMarker = `  content = replaceRegex(\n    path,\n    content,\n    /\\nexport type ProfessionalPatientQuestionInput`;
const endMarker = `    "legacy question types"\n  );`;
const start = content.indexOf(startMarker);
const endStart = content.indexOf(endMarker, start);
if (start < 0 || endStart < 0) {
  throw new Error("Could not locate the legacy question type transform block.");
}
const end = endStart + endMarker.length;
const replacement = `  content = content.replace(\n    /\\nexport type ProfessionalPatientQuestionInput = z\\.infer<[\\s\\S]*?\\n>;\\nexport type ProfessionalPatientAnswer = z\\.infer<[\\s\\S]*?\\n>;/,\n    ""\n  );`;
content = `${content.slice(0, start)}${replacement}${content.slice(end)}`;

fs.writeFileSync(path, content);
console.log("Issue #815 transform bootstrap fixes applied.");

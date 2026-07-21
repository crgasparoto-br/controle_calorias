import fs from "node:fs";

const path = "scripts/issue-815-transform.mjs";
let content = fs.readFileSync(path, "utf8");

function replacePattern(before, after, label) {
  if (content.split(before).length - 1 !== 1) {
    throw new Error(`Could not locate ${label}.`);
  }
  content = content.replace(before, after);
}

replacePattern(
  String.raw`/\n\s*it\("redirects the retired legacy entry to the current professional reports",[\s\S]*?\n\s*\}\);/g`,
  String.raw`/\n\s*it\("redirects the retired legacy entry to the current professional reports",[^\n]*?\}\);/g`,
  "the legacy navigation test pattern"
);

replacePattern(
  String.raw`/\n\s*it\("exibe vínculo na aba Perfil quando cópia do lado do paciente está ausente \(backfill assimétrico\)",[\s\S]*?\n\s*\}\);/g`,
  String.raw`/\n\s*it\("exibe vínculo na aba Perfil quando cópia do lado do paciente está ausente \(backfill assimétrico\)",[\s\S]*?(?=\n\s*it\("reconcilia cópia)/g`,
  "the asymmetric fallback test pattern"
);

const startMarker = `  content = replaceRegex(\n    path,\n    content,\n    /\\nExport type ProfessionalPatientQuestionInput`.replace("Export", "export");
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

import fs from "node:fs";

function replaceOnce(path, content, pattern, replacement, label) {
  const matches = content.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(`${path}: expected one ${label}, found ${matches.length}`);
  }
  return content.replace(pattern, replacement);
}

{
  const path = "server/repositories/professionalRepository.ts";
  let content = fs.readFileSync(path, "utf8");
  content = replaceOnce(
    path,
    content,
    /\n\s*async function migrateRelatedAuthorizations\([\s\S]*?\n\s*async function getProfile/g,
    "\n  async function getProfile",
    "unused related legacy migration helper"
  );
  fs.writeFileSync(path, content);
}

{
  const path = "server/modules/professionals/service.ts";
  let content = fs.readFileSync(path, "utf8");
  content = replaceOnce(
    path,
    content,
    /\nasync function loadProfessionalAccessesForPatient\([\s\S]*?\n\}\n\nasync function persistProfessionalProfile/g,
    "\nasync function persistProfessionalProfile",
    "unused patient compatibility loader"
  );
  fs.writeFileSync(path, content);
}

console.log("Issue #815 safeguards applied.");

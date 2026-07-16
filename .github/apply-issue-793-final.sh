#!/usr/bin/env bash
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
cat .github/issue-793-final.part00 \
    .github/issue-793-final.part01 \
    .github/issue-793-final.part03 \
    .github/issue-793-final.part04 \
  | base64 -d > /tmp/issue793.patch.xz
sha256sum /tmp/issue793.patch.xz > /tmp/issue793.sha256
xz -dc /tmp/issue793.patch.xz > /tmp/issue793.patch
sha256sum -c <(printf '%s  %s\n' '89df90c9d9ee586b7c242da0fafd78765ffc59b3cc645246b48253dc66be6c05' '/tmp/issue793.patch.xz')
git apply --check /tmp/issue793.patch
git apply /tmp/issue793.patch
rm -f .github/issue-793-final.part*
rm -f .github/apply-796.sh
rm -f .github/issue-796-patch.part*
rm -f .github/trigger-796-2.txt
rm -f .github/apply-issue-793-final.sh
git add -A
git diff --cached --check
git commit -m 'feat(timezone): complete owner timezone migration and guardrails (#793)'
git push origin HEAD:feat/796-timezone-whatsapp

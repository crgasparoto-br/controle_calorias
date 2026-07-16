#!/usr/bin/env bash
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/.github/issue-793-final.part02?ref=feat%2F796-timezone-whatsapp" \
  | jq -r '.content' | base64 -d > /tmp/canonical-part02
printf '%s  %s\n' '068107a7e28bf5e3a0d333559d7607c9de05e50896a12c43adcba98467b4b6df' '/tmp/canonical-part02' | sha256sum -c -

cat .github/issue-793-final.part00 \
    .github/issue-793-final.part01 \
    /tmp/canonical-part02 > /tmp/issue793.b64
tail -c +10001 .github/issue-793-final.part03 >> /tmp/issue793.b64
cat .github/issue-793-final.part04 >> /tmp/issue793.b64
base64 -d /tmp/issue793.b64 > /tmp/issue793.patch.xz
sha256sum /tmp/issue793.patch.xz > /tmp/issue793.sha256
printf '%s  %s\n' '89df90c9d9ee586b7c242da0fafd78765ffc59b3cc645246b48253dc66be6c05' '/tmp/issue793.patch.xz' | sha256sum -c -
xz -dc /tmp/issue793.patch.xz > /tmp/issue793.patch
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

#!/usr/bin/env bash
set -euxo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
cat .github/issue-796-patch.part* | base64 -d | gzip -dc > /tmp/issue796.patch
git am /tmp/issue796.patch > /tmp/issue796-am.log 2>&1
rm -f .github/issue-796-patch.part*
rm -f .github/trigger-796-2.txt
git add -A
git diff --cached --check
git commit -m 'chore: remove issue 796 transfer artifacts'
git push origin HEAD:feat/796-timezone-whatsapp

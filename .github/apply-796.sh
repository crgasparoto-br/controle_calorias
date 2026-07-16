#!/usr/bin/env bash
set -uxo pipefail

mkdir -p /tmp/issue796-diagnostics
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
cat .github/issue-796-patch.part* > /tmp/issue796-diagnostics/combined.b64
wc -c /tmp/issue796-diagnostics/combined.b64 > /tmp/issue796-diagnostics/sizes.txt

set +e
base64 -d /tmp/issue796-diagnostics/combined.b64 > /tmp/issue796-diagnostics/patch.gz 2> /tmp/issue796-diagnostics/base64.log
base64_status=$?
gzip -t /tmp/issue796-diagnostics/patch.gz 2> /tmp/issue796-diagnostics/gzip-test.log
gzip_test_status=$?
gzip -dc /tmp/issue796-diagnostics/patch.gz > /tmp/issue796.patch 2> /tmp/issue796-diagnostics/gzip-decode.log
gzip_decode_status=$?
git am /tmp/issue796.patch > /tmp/issue796-diagnostics/git-am.log 2>&1
git_am_status=$?
set -e

printf 'base64=%s\ngzip_test=%s\ngzip_decode=%s\ngit_am=%s\n' \
  "$base64_status" "$gzip_test_status" "$gzip_decode_status" "$git_am_status" \
  > /tmp/issue796-diagnostics/status.txt

if [ "$base64_status" -ne 0 ] || [ "$gzip_test_status" -ne 0 ] || [ "$gzip_decode_status" -ne 0 ] || [ "$git_am_status" -ne 0 ]; then
  git am --abort || true
  exit 1
fi

rm -f .github/issue-796-patch.part*
rm -f .github/trigger-796-2.txt
git add -A
git diff --cached --check
git commit -m 'chore: remove issue 796 transfer artifacts'
git push origin HEAD:feat/796-timezone-whatsapp

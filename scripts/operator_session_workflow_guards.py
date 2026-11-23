#!/usr/bin/env python3
"""Constrain exact trusted workflow boundaries before M2 activation (#1345).

Read-only static M1 preflight. Never certifies a review or activates policy.
"""
from __future__ import annotations

import hashlib
import re


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)

# Only these event, permission and job boundaries may reach the privileged
# trusted-base session verifier or the read-only neutral packet generator.
# Textual inclusion alone is unsafe: an unused guard could coexist with an
# unconditional `if: true`, or a second job could omit the guard entirely.
TRUSTED_SESSION_EVENTS = """  issue_comment:
    types: [created, edited, deleted]
  pull_request_target:
    branches: [develop, main]
    types: [opened, synchronize, reopened, ready_for_review, edited]
  issues:
    types: [edited]
  workflow_run:
    workflows: ["Validate skills", "Validate GitHub Audit MCP", "Collect and certify exact-SHA handoff"]
    types: [completed]
  push:
    branches: [develop, main]
"""
TRUSTED_PACKET_EVENTS = """  workflow_run:
    workflows: ["Collect and certify exact-SHA handoff"]
    types: [completed]
  issue_comment:
    types: [created]
"""
TRUSTED_SESSION_JOB_GUARD = """vars.SOLVERIT_SESSION_REVIEW_ENABLED == 'true' &&
(github.ref == 'refs/heads/develop' || github.ref == 'refs/heads/main') &&
(github.event_name != 'issue_comment' || github.event.issue.pull_request) &&
(github.event_name != 'workflow_run' ||
 (github.event.workflow_run.event == 'pull_request' &&
  github.event.workflow_run.head_repository.full_name == github.repository))"""
TRUSTED_PACKET_JOB_GUARD = """github.ref == format('refs/heads/{0}', github.event.repository.default_branch) &&
((github.event_name == 'workflow_run' &&
  github.event.workflow_run.event == 'pull_request' &&
  github.event.workflow_run.conclusion == 'success' &&
  github.event.workflow_run.head_repository.full_name == github.repository) ||
 (github.event_name == 'issue_comment' &&
  github.event.issue.pull_request &&
  github.event.comment.body == '/solverit-audit-packet'))"""


# Fail-closed content locks for the privileged/default-branch wrappers. The
# complete reviewed YAML (including steps and `with`/`run` bodies) is pinned,
# not just a few matching tokens. Changing these bytes requires an explicit
# security review and a deliberate lock update; the PR cannot silently expand
# the trusted execution surface. See A-007 in PR #1348.
TRUSTED_WORKFLOW_SHA256 = {
    "verify": "7fb1defd2446710c69b3aaec6af69ef669d41dbbc192b6341089d7e0e4ccdfaf",
    "packet": "1f3ba32259f56dc89658646c0aa6debae79d59754e6fbe7ab456405f12fbe41d",
}


def _fold_guard(text: str) -> str:
    return ' '.join(text.split())


def verify_trusted_wrapper_boundaries(source: str, *, job: str,
                                      events: str, permissions: str,
                                      guard: str) -> None:
    # Reject unexpected events, duplicate top-level mappings and job-scoped
    # privilege elevation. The exact effective job condition must be present,
    # not a comment, unconsumed string or guard on a different job.
    require(len(re.findall(r'(?m)^on:$', source)) == 1
            and len(re.findall(r'(?m)^permissions:$', source)) == 1
            and len(re.findall(r'(?m)^jobs:$', source)) == 1,
            'missing or duplicate trusted workflow root sections')
    event_section = re.search(r'(?ms)^on:\n(.*?)^permissions:\n', source)
    require(event_section is not None
            and event_section.group(1).strip() == events.strip(),
            'untrusted event trigger or missing revocation event')
    permission_section = re.search(r'(?m)^permissions:\n((?:  [^\n]*\n)+)', source)
    require(permission_section is not None
            and permission_section.group(1).strip() == permissions.strip(),
            'workflow permissions do not match trusted privilege boundary')
    jobs_section = source.split('\njobs:\n', 1)[-1]
    require(re.findall(r'(?m)^  ([A-Za-z0-9_-]+):\s*$', jobs_section) == [job]
            and not re.search(r'(?m)^    permissions:', jobs_section),
            'unexpected or individually privileged job')
    require(len(re.findall(r'(?m)^    if\s*:', jobs_section)) == 1,
            'duplicate or alternative trusted job if condition')
    matches = re.findall(r'(?m)^    if: >-\n((?:      [^\n]*\n)+)', jobs_section)
    require(len(matches) == 1
            and _fold_guard(matches[0]) == _fold_guard(guard),
            'effective trusted job guard differs from audited exact expression')
    require('github.event.pull_request.head.sha' not in jobs_section,
            'trusted wrapper must not check out the untrusted PR head')
    require(job in TRUSTED_WORKFLOW_SHA256, 'unknown privileged wrapper')
    actual_sha256 = hashlib.sha256(source.encode('utf-8')).hexdigest()
    require(actual_sha256 == TRUSTED_WORKFLOW_SHA256[job],
            'trusted wrapper content changed without explicit security review: '
            'steps, commands, checkout refs, and nested YAML are pinned')


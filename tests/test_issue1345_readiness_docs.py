"""Discriminating documentation coverage for issue #1345 M1/M2 plans.

The three documented obligations are not an operator session certification.
Remote ruleset read-back remains a separate authenticated audit activity.
"""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOSSIER = ROOT / 'docs/audit/issue-1345-semantic-dossier.md'
PROTOCOL = ROOT / 'docs/audit/operator-session-rollout.md'


def require_protocol(text: str) -> None:
    # Documentation contract only: no inferred real session or approving receipt.
    markers = (
        'SOLVERIT_SESSION_REVIEW_V1',
        'realmente separada',
        'nao inventar URL de conversa',
        'nao prova pessoa diferente',
        'single-operator-separate-context',
        'Ed25519',
        'A M1 nao modifica rulesets',
    )
    for marker in markers:
        if marker not in text:
            raise ValueError(f'missing session-review document contract: {marker}')


def require_ruleset_inventory(text: str) -> None:
    # Identities and limitations are checked against prose independently of
    # GitHub read-back. CI-only proof does not assert live rule applicability.
    markers = (
        'Ruleset develop #18391133',
        'Ruleset main #18391304',
        'enforcement=active',
        'deletion',
        'non_fast_forward',
        'strict_required_status_checks_policy=true',
        'Agent-first gate',
        'bypass_actors_visibility=UNKNOWN_NO_WRITE_ACCESS',
        'Nenhum check de revisao por sessao consta como obrigatorio.',
    )
    import unicodedata
    plain = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    for marker in markers:
        if marker not in plain:
            raise ValueError(f'missing ruleset document inventory: {marker}')


def require_retrospective_plan(text: str) -> None:
    # Mark the registered plan as documented without inventing an approval
    # of historical issue #1298 or a completed operational migration.
    markers = (
        'Plano especifico e auditavel de certificacao retrospectiva',
        'Issue #1298',
        'epica #1297',
        'PR #1328',
        '68d7186aeca4e442d79fad77e5e2cebd5c6abba0',
        '02d9dbffcf51fa3ac05c1fc138abd76b5b166b8b',
        'Nao fabricar evento de',
        'Manter #1298 aberta',
        'Nao usar este documento como',
    )
    import unicodedata
    plain = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    for marker in markers:
        if marker not in plain:
            raise ValueError(f'missing retrospective plan contract: {marker}')


class RulesetReadbackDocumentTests(unittest.TestCase):
    def test_positive_ruleset_inventory_and_limitations(self):
        require_ruleset_inventory(DOSSIER.read_text(encoding='utf-8'))

    def test_negative_wrong_main_ruleset_id(self):
        source = DOSSIER.read_text(encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Ruleset main'):
            require_ruleset_inventory(source.replace('Ruleset main #18391304', 'Ruleset main #99999999', 1))

    def test_regression_missing_bypass_visibility_limitation(self):
        source = DOSSIER.read_text(encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'bypass_actors_visibility'):
            require_ruleset_inventory(source.replace('bypass_actors_visibility=UNKNOWN_NO_WRITE_ACCESS',
                                                   'no bypass actors', 1))


class ReviewProcedureDocumentTests(unittest.TestCase):
    def test_positive_review_procedure_is_documented(self):
        require_protocol(PROTOCOL.read_text(encoding='utf-8'))

    def test_negative_omitting_review_marker(self):
        source = PROTOCOL.read_text(encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'SOLVERIT_SESSION_REVIEW_V1'):
            require_protocol(source.replace('SOLVERIT_SESSION_REVIEW_V1', 'UNVERIFIED', 1))

    def test_regression_invented_conversation_url_is_not_allowed(self):
        source = PROTOCOL.read_text(encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'nao inventar URL'):
            require_protocol(source.replace('nao inventar URL de conversa', 'inventar URL de conversa', 1))


class RetrospectivePlanDocumentTests(unittest.TestCase):
    def test_positive_retrospective_plan_registration_only(self):
        require_retrospective_plan(DOSSIER.read_text(encoding='utf-8'))

    def test_negative_missing_historical_material_identity(self):
        source = DOSSIER.read_text(encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '02d9dbff'):
            require_retrospective_plan(source.replace('02d9dbffcf51fa3ac05c1fc138abd76b5b166b8b',
                                                    'UNKNOWN', 1))

    def test_regression_no_retroactive_certificate_fabrication(self):
        source = DOSSIER.read_text(encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Nao fabricar'):
            require_retrospective_plan(source.replace('Não fabricar evento de',
                                                    'Fabricar evento de', 1))


if __name__ == '__main__':
    unittest.main()

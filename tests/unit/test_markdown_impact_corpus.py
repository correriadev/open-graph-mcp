import os
import sys
import json
import unittest
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

class CorpusValidationError(Exception):
    pass

class MarkdownImpactAcceptanceManifest:
    def __init__(self, data: Dict[str, Any]):
        self.raw_data = data
        self.contract_version: int = 0
        self.graph_cases: List[Dict[str, Any]] = []
        self.horizon_cases: List[Dict[str, Any]] = []
        self.exclusions: List[Dict[str, Any]] = []
        self.validate_schema()

    def validate_schema(self):
        # Disallow secrets / generated graph state
        disallowed_keys = {"token", "secret", "graphId", "nodes", "relationships", "tenantId"}
        for k in self.raw_data:
            if k in disallowed_keys:
                raise CorpusValidationError(f"Disallowed environment/generated key '{k}' in manifest")

        contract_version = self.raw_data.get("contractVersion")
        if not isinstance(contract_version, int) or contract_version <= 0:
            raise CorpusValidationError("CorpusContractVersion must be a positive integer")
        self.contract_version = contract_version

        # Validate graphCases
        graph_cases = self.raw_data.get("graphCases")
        if not isinstance(graph_cases, list):
            raise CorpusValidationError("graphCases must be a list")
        for case in graph_cases:
            self._validate_artifact_id(case.get("source"))
            self._validate_artifact_id(case.get("target"))
            if not case.get("id") or not case.get("kind") or not case.get("direction") or not case.get("minimumGrade") or not case.get("marker"):
                raise CorpusValidationError("ExpectedEvidenceCase missing required fields")
        self.graph_cases = graph_cases

        # Validate horizonCases
        horizon_cases = self.raw_data.get("horizonCases")
        if not isinstance(horizon_cases, list):
            raise CorpusValidationError("horizonCases must be a list")
        for case in horizon_cases:
            if not case.get("id") or not case.get("sourceHorizon") or not case.get("targetHorizon") or not case.get("payloadKind") or not case.get("marker"):
                raise CorpusValidationError("ExpectedHorizonCase missing required fields (payloadKind required)")
        self.horizon_cases = horizon_cases

        # Validate exclusions
        exclusions = self.raw_data.get("exclusions")
        if not isinstance(exclusions, list):
            raise CorpusValidationError("exclusions must be a list")
        for case in exclusions:
            self._validate_artifact_id(case.get("source"))
            if not case.get("id") or not case.get("marker") or not case.get("rejectionReason"):
                raise CorpusValidationError("ExpectedNonRelationshipCase missing required fields (rejectionReason required)")
        self.exclusions = exclusions

    @staticmethod
    def _validate_artifact_id(path_str: Optional[str]):
        if not path_str or not isinstance(path_str, str):
            raise CorpusValidationError("CorpusArtifactId must be a non-empty string")
        p = Path(path_str)
        if p.is_absolute() or (len(path_str) > 1 and path_str[1] == ":") or path_str.startswith("/") or path_str.startswith("\\"):
            raise CorpusValidationError(f"CorpusArtifactId cannot be absolute: {path_str}")
        parts = Path(path_str).parts
        if ".." in parts:
            raise CorpusValidationError(f"CorpusArtifactId cannot traverse parent: {path_str}")

    @classmethod
    def load(cls, file_path: str) -> "MarkdownImpactAcceptanceManifest":
        norm_path = os.path.normpath(file_path).replace("\\", "/")
        if not norm_path.endswith("tests/fixtures/open-graph/markdown-impact.expected.json"):
            raise CorpusValidationError(f"Only configured manifest is accepted, got: {file_path}")
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(data)


class HarnessKitRepositoryReader:
    def __init__(self, root_dir: str):
        self.root_path = Path(root_dir).resolve()

    def _resolve_safe(self, rel_path: str) -> Path:
        MarkdownImpactAcceptanceManifest._validate_artifact_id(rel_path)
        target = (self.root_path / rel_path).resolve()
        try:
            target.relative_to(self.root_path)
        except ValueError:
            raise CorpusValidationError(f"Path escapes repository root: {rel_path}")
        return target

    def exists(self, rel_path: str) -> bool:
        try:
            target = self._resolve_safe(rel_path)
            return target.is_file()
        except CorpusValidationError:
            return False

    def find_unique_marker(self, rel_path: str, marker: str) -> Tuple[int, int]:
        target = self._resolve_safe(rel_path)
        if not target.is_file():
            raise FileNotFoundError(f"Artifact not found: {rel_path}")
        content = target.read_text(encoding="utf-8")
        occurrences = content.count(marker)
        if occurrences == 0:
            raise ValueError(f"Marker not found in {rel_path}: {marker}")
        if occurrences > 1:
            raise ValueError(f"Marker is ambiguous ({occurrences} times) in {rel_path}: {marker}")
        idx = content.find(marker)
        line = content[:idx].count("\n") + 1
        col = idx - content.rfind("\n", 0, idx)
        return line, col


def VerifyMarkdownImpactCorpus(manifest: MarkdownImpactAcceptanceManifest, root_dir: str) -> Dict[str, Any]:
    reader = HarnessKitRepositoryReader(root_dir)
    
    # Check all graph cases
    for case in manifest.graph_cases:
        src = case["source"]
        tgt = case["target"]
        if not reader.exists(src):
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": "MISSING_ARTIFACT",
                "relativeArtifactId": src
            }
        if not reader.exists(tgt):
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": "MISSING_ARTIFACT",
                "relativeArtifactId": tgt
            }
        try:
            reader.find_unique_marker(src, case["marker"])
        except ValueError as e:
            reason = "AMBIGUOUS_MARKER" if "ambiguous" in str(e) else "MISSING_MARKER"
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": reason,
                "relativeArtifactId": src
            }
        except CorpusValidationError:
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": "UNSAFE_ARTIFACT",
                "relativeArtifactId": src
            }

    # Check horizon cases (source is default skills/autonomous-orchestrator/SKILL.md if not specified)
    default_src = "skills/autonomous-orchestrator/SKILL.md"
    for case in manifest.horizon_cases:
        src = case.get("source", default_src)
        if not reader.exists(src):
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": "MISSING_ARTIFACT",
                "relativeArtifactId": src
            }
        try:
            reader.find_unique_marker(src, case["marker"])
        except ValueError as e:
            reason = "AMBIGUOUS_MARKER" if "ambiguous" in str(e) else "MISSING_MARKER"
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": reason,
                "relativeArtifactId": src
            }

    # Check exclusions
    for case in manifest.exclusions:
        src = case["source"]
        if not reader.exists(src):
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": "MISSING_ARTIFACT",
                "relativeArtifactId": src
            }
        try:
            reader.find_unique_marker(src, case["marker"])
        except ValueError as e:
            reason = "AMBIGUOUS_MARKER" if "ambiguous" in str(e) else "MISSING_MARKER"
            return {
                "event": "CorpusContractDrifted",
                "caseId": case["id"],
                "reasonCode": reason,
                "relativeArtifactId": src
            }

    return {
        "event": "CorpusContractVerified",
        "contractVersion": manifest.contract_version,
        "evidenceCount": len(manifest.graph_cases),
        "horizonCaseCount": len(manifest.horizon_cases),
        "exclusionCount": len(manifest.exclusions)
    }


class TestMarkdownImpactCorpus(unittest.TestCase):
    def setUp(self):
        self.project_root = Path(__file__).resolve().parent.parent.parent
        self.manifest_path = self.project_root / "tests" / "fixtures" / "open-graph" / "markdown-impact.expected.json"
        self.corpus_dir = self.project_root / "tests" / "fixtures" / "corpus"

    def test_load_valid_manifest(self):
        manifest = MarkdownImpactAcceptanceManifest.load(str(self.manifest_path))
        self.assertEqual(manifest.contract_version, 1)
        self.assertGreaterEqual(len(manifest.graph_cases), 1)
        self.assertGreaterEqual(len(manifest.horizon_cases), 1)
        self.assertGreaterEqual(len(manifest.exclusions), 1)

    def test_reject_invalid_contract_version(self):
        invalid_data = {
            "contractVersion": 0,
            "graphCases": [],
            "horizonCases": [],
            "exclusions": []
        }
        with self.assertRaises(CorpusValidationError):
            MarkdownImpactAcceptanceManifest(invalid_data)

    def test_reject_absolute_or_traversing_artifact_id(self):
        cases = ["/etc/passwd", "C:\\Windows\\System32", "../outside.md", "a/../../b.md"]
        for c in cases:
            with self.assertRaises(CorpusValidationError):
                MarkdownImpactAcceptanceManifest._validate_artifact_id(c)

    def test_distinguish_case_types(self):
        manifest = MarkdownImpactAcceptanceManifest.load(str(self.manifest_path))
        self.assertIn("minimumGrade", manifest.graph_cases[0])
        self.assertIn("payloadKind", manifest.horizon_cases[0])
        self.assertIn("rejectionReason", manifest.exclusions[0])

    def test_reject_horizon_case_without_payload_kind(self):
        data = {
            "contractVersion": 1,
            "graphCases": [],
            "horizonCases": [{"id": "h-1", "sourceHorizon": "negotiation", "targetHorizon": "transformation", "marker": "m"}],
            "exclusions": []
        }
        with self.assertRaises(CorpusValidationError):
            MarkdownImpactAcceptanceManifest(data)

    def test_reject_exclusion_case_without_rejection_reason(self):
        data = {
            "contractVersion": 1,
            "graphCases": [],
            "horizonCases": [],
            "exclusions": [{"id": "e-1", "source": "skills/autonomous-orchestrator/SKILL.md", "marker": "m"}]
        }
        with self.assertRaises(CorpusValidationError):
            MarkdownImpactAcceptanceManifest(data)

    def test_verify_corpus_integrity(self):
        manifest = MarkdownImpactAcceptanceManifest.load(str(self.manifest_path))
        result = VerifyMarkdownImpactCorpus(manifest, str(self.corpus_dir))
        self.assertEqual(result["event"], "CorpusContractVerified")
        self.assertEqual(result["contractVersion"], 1)
        self.assertEqual(result["evidenceCount"], len(manifest.graph_cases))
        self.assertEqual(result["horizonCaseCount"], len(manifest.horizon_cases))
        self.assertEqual(result["exclusionCount"], len(manifest.exclusions))

    def test_missing_marker_produces_drift(self):
        manifest = MarkdownImpactAcceptanceManifest.load(str(self.manifest_path))
        # copy and inject bad marker
        data = json.loads(json.dumps(manifest.raw_data))
        data["graphCases"][0]["marker"] = "THIS_MARKER_DOES_NOT_EXIST_ANYWHERE"
        bad_manifest = MarkdownImpactAcceptanceManifest(data)
        result = VerifyMarkdownImpactCorpus(bad_manifest, str(self.corpus_dir))
        self.assertEqual(result["event"], "CorpusContractDrifted")
        self.assertEqual(result["reasonCode"], "MISSING_MARKER")
        self.assertEqual(result["caseId"], "graph-case-01")
        # Ensure no absolute paths leaked in result
        self.assertNotIn(":", result["relativeArtifactId"])
        self.assertNotIn("\\", result["relativeArtifactId"])

    def test_no_opengraph_imports_in_harness_kit_verification(self):
        import sys
        loaded_modules = set(sys.modules.keys())
        for mod in loaded_modules:
            self.assertFalse(mod.startswith("open_graph") or mod.startswith("opengraph"), f"Leaked module: {mod}")

    def test_stateless_between_verifications(self):
        manifest = MarkdownImpactAcceptanceManifest.load(str(self.manifest_path))
        res1 = VerifyMarkdownImpactCorpus(manifest, str(self.corpus_dir))
        res2 = VerifyMarkdownImpactCorpus(manifest, str(self.corpus_dir))
        self.assertEqual(res1, res2)


if __name__ == "__main__":
    unittest.main()

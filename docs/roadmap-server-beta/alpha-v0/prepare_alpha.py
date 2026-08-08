#!/usr/bin/env python3
"""
prepare_alpha.py — prepara o ambiente do Alpha v0 (SB-alfa).

Escopo: docs/roadmap-server-beta/02-scope-alpha-v0-reproducao-controlada.md

O que faz, em ordem:
  1. valida pre-requisitos (git, node, npm)
  2. cria uma COPIA FISICA do harness-kit (clone local) num diretorio de trabalho
  3. instala dependencias do sdk (npm ci)
  4. mede o baseline PRISTINO dos testes unitarios
  5. guarda o GABARITO (implementacao original) FORA do worktree
  6. reverte a IMPLEMENTACAO e restaura o TESTE
  7. mede o baseline REVERTIDO e valida que ele bate com o esperado
  8. grava um manifesto JSON com tudo que foi medido

A decisao de desenho que este script materializa: `git revert` do commit da
feature apaga a implementacao E o teste. Sem o teste nao ha gabarito, e
qualquer coisa que o agente escrever "funciona". Entao o passo 6 reverte e
depois RESTAURA o arquivo de teste — o teste vira o oraculo objetivo.

Guarda dura (passo 7): se depois do revert a suite continuar verde, o revert
nao removeu a feature e o experimento seria nulo. O script aborta.

Verificado a mao em 2026-08-08 contra o harness-kit em
C:/Users/User/Documents/harness-kit (HEAD 2a61195). Numeros medidos:
  pristino : 54 arquivos ok, 426 testes
  revertido: 53 ok + 1 falha, 419 testes  (o arquivo de teste vale 7 testes)

Uso:
    python prepare_alpha.py                 # prepara do zero (idempotente)
    python prepare_alpha.py --verify        # so mede e confere, nao altera
    python prepare_alpha.py --reset         # volta a copia ao estado pristino
    python prepare_alpha.py --help
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

# ── Configuracao ────────────────────────────────────────────────────────────

SOURCE_REPO = Path(r"C:/Users/User/Documents/harness-kit")
WORK_ROOT = Path(r"C:/Users/User/Documents/alpha-v0")
WORK_REPO = WORK_ROOT / "harness-kit"
GOLD_DIR = WORK_ROOT / "gabarito"          # fora do worktree, de proposito
MANIFEST = WORK_ROOT / "alpha-manifest.json"

# A feature sob teste.
FEATURE_COMMIT = "2c965b3"
FEATURE_NAME = "CodexCLIRunner"

# O arquivo de TESTE e restaurado depois do revert: e o oraculo.
TEST_FILES = ["sdk/src/agent-runner/__tests__/CodexCLIRunner.test.ts"]

# O sdk e onde os testes vivem.
SDK = "sdk"
# So os unitarios. Os e2e (tests/e2e/) sobem CLIs reais e falham por motivos
# alheios ao experimento — medidos a parte, nunca como criterio.
UNIT_SCOPE = "src/"

# Esperado depois do revert (medido a mao — a guarda do passo 7 compara).
EXPECTED_AFTER_REVERT = {"failed_files": 1, "passed_tests": 419}


# ── Infra ───────────────────────────────────────────────────────────────────

class Fail(Exception):
    """Erro esperado, com mensagem para humano — nao stacktrace."""


def say(msg: str) -> None:
    print(msg, flush=True)


def step(n: int, msg: str) -> None:
    print(f"\n[{n}] {msg}", flush=True)


def run(cmd: list[str], cwd: Path | None = None, check: bool = True,
        capture: bool = True) -> subprocess.CompletedProcess:
    """Executa e devolve o resultado. shell=False sempre (paths com espaco)."""
    proc = subprocess.run(
        cmd, cwd=str(cwd) if cwd else None,
        capture_output=capture, text=True, encoding="utf-8", errors="replace",
    )
    if check and proc.returncode != 0:
        out = ((proc.stdout or "") + (proc.stderr or "")).strip()
        raise Fail(f"comando falhou ({' '.join(cmd)}):\n{out[-2000:]}")
    return proc


def tool_version(name: str, args: list[str]) -> str:
    if shutil.which(name) is None:
        raise Fail(f"'{name}' nao esta no PATH — instale antes de rodar.")
    return run([name, *args]).stdout.strip().splitlines()[0]


# ── Medicao ─────────────────────────────────────────────────────────────────

@dataclass
class TestResult:
    passed_files: int
    failed_files: int
    passed_tests: int
    failed_tests: int
    failing_files: list[str]
    raw_tail: str

    @property
    def green(self) -> bool:
        return self.failed_files == 0 and self.failed_tests == 0


# Linhas de sumario do vitest, ancoradas em inicio de linha (MULTILINE) para nao
# casarem com um NOME de teste que por acaso contenha "Tests". Formatos reais:
#   " Test Files  54 passed (54)"
#   " Test Files  1 failed | 53 passed (54)"
#   "      Tests  426 passed (426)"
#   "      Tests  9 failed | 821 passed (830)"
# E o caso em que NADA passa, onde o "passed" some por completo:
#   "      Tests  7 failed (7)"
_FILES_RE = re.compile(r"^\s*Test Files\s+(.+?)\s*\(\d+\)\s*$", re.MULTILINE)
_TESTS_RE = re.compile(r"^\s*Tests\s+(.+?)\s*\(\d+\)\s*$", re.MULTILINE)
_FAIL_RE = re.compile(r"^\s*FAIL\s+(\S+)", re.MULTILINE)


def _counts(summary: str) -> tuple[int, int]:
    """Extrai (passed, failed) de um sumario tipo '1 failed | 53 passed'.
    Ausencia de um dos lados vale zero — vitest omite o que for zero."""
    passed = re.search(r"(\d+)\s+passed", summary)
    failed = re.search(r"(\d+)\s+failed", summary)
    return (int(passed.group(1)) if passed else 0,
            int(failed.group(1)) if failed else 0)


def run_tests(scope: str) -> TestResult:
    """Roda vitest no escopo dado e extrai os numeros. check=False: falha de
    teste e um RESULTADO a medir, nao um erro do script."""
    proc = run(["npx", "vitest", "run", scope], cwd=WORK_REPO / SDK, check=False)
    out = (proc.stdout or "") + (proc.stderr or "")

    # findall + [-1]: o sumario final e a ULTIMA ocorrencia. Um rerun/watch ou
    # um rodape repetido nao pode fazer o script ler o numero errado.
    files = _FILES_RE.findall(out)
    tests = _TESTS_RE.findall(out)
    if not files or not tests:
        raise Fail(
            "nao consegui interpretar a saida do vitest — o formato mudou?\n"
            f"ultimas linhas:\n{out[-1500:]}"
        )

    passed_files, failed_files = _counts(files[-1])
    passed_tests, failed_tests = _counts(tests[-1])
    failing = sorted({m.group(1) for m in _FAIL_RE.finditer(out)})
    return TestResult(
        passed_files=passed_files,
        failed_files=failed_files,
        passed_tests=passed_tests,
        failed_tests=failed_tests,
        failing_files=failing,
        raw_tail=out[-800:],
    )


def show(label: str, r: TestResult) -> None:
    say(f"    {label}: {r.passed_files} arquivos ok, {r.failed_files} falhando "
        f"| {r.passed_tests} testes ok, {r.failed_tests} falhando")
    for f in r.failing_files:
        say(f"      FAIL {f}")


# ── Passos ──────────────────────────────────────────────────────────────────

def check_prereqs() -> dict[str, str]:
    step(1, "Pre-requisitos")
    versions = {
        "git": tool_version("git", ["--version"]),
        "node": tool_version("node", ["--version"]),
        "npm": tool_version("npm", ["--version"]),
    }
    for k, v in versions.items():
        say(f"    {k}: {v}")

    if not SOURCE_REPO.exists():
        raise Fail(f"repo de origem nao existe: {SOURCE_REPO}")

    dirty = run(["git", "status", "--porcelain"], cwd=SOURCE_REPO).stdout.strip()
    if dirty:
        raise Fail(
            f"o repo de origem tem alteracoes nao commitadas:\n{dirty}\n"
            "O clone copiaria um estado ambiguo. Limpe antes."
        )
    say(f"    origem limpa: {SOURCE_REPO}")
    return versions


def make_copy() -> str:
    step(2, "Copia fisica do repositorio")
    if WORK_REPO.exists():
        say(f"    removendo copia anterior: {WORK_REPO}")
        shutil.rmtree(WORK_REPO, onerror=_force_rm)
    WORK_ROOT.mkdir(parents=True, exist_ok=True)

    # clone local: copia de verdade, com historico proprio. O agente do
    # experimento trabalha aqui e nunca toca no repo original.
    run(["git", "clone", "--quiet", str(SOURCE_REPO), str(WORK_REPO)])
    head = run(["git", "log", "--oneline", "-1"], cwd=WORK_REPO).stdout.strip()
    say(f"    criada: {WORK_REPO}")
    say(f"    HEAD: {head}")
    return head


def _force_rm(func, path, _exc):
    """rmtree em Windows tropeca em read-only (objetos do .git)."""
    import os
    import stat
    os.chmod(path, stat.S_IWRITE)
    func(path)


def install_deps() -> None:
    step(3, "Dependencias do sdk (npm ci)")
    say("    isto demora alguns minutos na primeira vez...")
    run(["npm", "ci", "--silent"], cwd=WORK_REPO / SDK)
    say("    node_modules OK")


def save_gold() -> list[str]:
    """Guarda a implementacao original FORA do worktree. Se ficasse dentro, o
    agente do experimento acharia o gabarito com um `ls`."""
    step(5, "Gabarito (implementacao original), fora do worktree")
    if GOLD_DIR.exists():
        shutil.rmtree(GOLD_DIR, onerror=_force_rm)
    GOLD_DIR.mkdir(parents=True)

    changed = run(
        ["git", "show", "--pretty=", "--name-only", FEATURE_COMMIT], cwd=WORK_REPO
    ).stdout.split()

    saved = []
    for rel in changed:
        blob = run(["git", "show", f"{FEATURE_COMMIT}:{rel}"], cwd=WORK_REPO, check=False)
        if blob.returncode != 0:
            continue
        dest = GOLD_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(blob.stdout, encoding="utf-8")
        saved.append(rel)

    diff = run(["git", "show", FEATURE_COMMIT], cwd=WORK_REPO).stdout
    (GOLD_DIR / "FEATURE.diff").write_text(diff, encoding="utf-8")

    say(f"    {len(saved)} arquivos + FEATURE.diff em {GOLD_DIR}")
    for s in saved:
        say(f"      {s}")
    return saved


def apply_revert() -> None:
    step(6, f"Reverter a implementacao de {FEATURE_NAME} ({FEATURE_COMMIT})")
    run(["git", "revert", "--no-commit", "--no-edit", FEATURE_COMMIT], cwd=WORK_REPO)
    say("    revert aplicado (implementacao E teste removidos)")

    # ...e devolve o teste. E ele o oraculo: sem teste nao ha gabarito.
    for t in TEST_FILES:
        run(["git", "checkout", FEATURE_COMMIT, "--", t], cwd=WORK_REPO)
        say(f"    teste restaurado: {t}")

    state = run(["git", "status", "--porcelain"], cwd=WORK_REPO).stdout.strip()
    say("    estado do worktree:")
    for line in state.splitlines():
        say(f"      {line}")


def reset_copy() -> None:
    step(0, "Reset da copia para o estado pristino")
    run(["git", "checkout", "--", "."], cwd=WORK_REPO, check=False)
    run(["git", "clean", "-fd"], cwd=WORK_REPO, check=False)
    run(["git", "revert", "--quit"], cwd=WORK_REPO, check=False)
    dirty = run(["git", "status", "--porcelain"], cwd=WORK_REPO).stdout.strip()
    say("    pristino" if not dirty else f"    ainda sujo:\n{dirty}")


# ── Orquestracao ────────────────────────────────────────────────────────────

def prepare() -> int:
    versions = check_prereqs()
    head = make_copy()
    install_deps()

    step(4, f"Baseline PRISTINO (vitest run {UNIT_SCOPE})")
    pristine = run_tests(UNIT_SCOPE)
    show("pristino", pristine)
    if not pristine.green:
        raise Fail(
            "a suite unitaria JA falha antes do revert. O experimento precisa de "
            "um ponto de partida verde, senao nao da para atribuir nada ao agente."
        )

    save_gold()
    apply_revert()

    step(7, f"Baseline REVERTIDO (vitest run {UNIT_SCOPE})")
    reverted = run_tests(UNIT_SCOPE)
    show("revertido", reverted)

    # Guarda dura: se continuar verde, o revert nao removeu a feature.
    if reverted.green:
        raise Fail(
            "depois do revert a suite continua VERDE — a feature nao foi removida.\n"
            "O experimento seria nulo (qualquer coisa 'passaria'). Investigue o "
            f"commit {FEATURE_COMMIT} antes de seguir."
        )
    if (reverted.failed_files != EXPECTED_AFTER_REVERT["failed_files"]
            or reverted.passed_tests != EXPECTED_AFTER_REVERT["passed_tests"]):
        say("    AVISO: os numeros nao batem com o esperado "
            f"{EXPECTED_AFTER_REVERT} — o repo mudou desde a medicao manual. "
            "Confira antes de rodar o experimento.")

    step(8, "Manifesto")
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_repo": str(SOURCE_REPO),
        "work_repo": str(WORK_REPO),
        "gold_dir": str(GOLD_DIR),
        "head": head,
        "feature": {"commit": FEATURE_COMMIT, "name": FEATURE_NAME},
        "test_oracle": {"scope": f"{SDK}: vitest run {UNIT_SCOPE}", "files": TEST_FILES},
        "baseline_pristine": asdict(pristine),
        "baseline_reverted": asdict(reverted),
        "delta_tests": pristine.passed_tests - reverted.passed_tests,
        "tools": versions,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    say(f"    {MANIFEST}")

    say("\n" + "=" * 72)
    say("AMBIENTE PRONTO")
    say("=" * 72)
    say(f"  worktree do experimento : {WORK_REPO}")
    say(f"  gabarito (NAO abrir)    : {GOLD_DIR}")
    say(f"  criterio de sucesso     : cd {SDK} && npx vitest run {UNIT_SCOPE}")
    say(f"                            -> {pristine.passed_files} arquivos, "
        f"{pristine.passed_tests} testes, 0 falhas")
    say(f"  agora falta             : {manifest['delta_tests']} testes "
        f"({', '.join(reverted.failing_files) or 'n/d'})")
    say("")
    say("  Proximo passo: rode o braco de CONTROLE (sem MCP) ANTES do de")
    say("  tratamento. E proiba o agente de consultar o historico do git da")
    say("  feature revertida — o gabarito esta a um `git show` de distancia.")
    return 0


def verify() -> int:
    if not WORK_REPO.exists():
        raise Fail(f"copia nao existe: {WORK_REPO} — rode sem --verify primeiro.")
    step(1, f"Medindo (vitest run {UNIT_SCOPE})")
    r = run_tests(UNIT_SCOPE)
    show("atual", r)

    if MANIFEST.exists():
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        goal = m["baseline_pristine"]
        say(f"\n    alvo: {goal['passed_files']} arquivos, {goal['passed_tests']} testes, 0 falhas")
        if r.green and r.passed_tests >= goal["passed_tests"]:
            say("    >>> RECONSTRUIDA: a suite bateu o baseline pristino.")
        else:
            falta = goal["passed_tests"] - r.passed_tests
            say(f"    >>> ainda faltam {falta} testes.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description="Prepara o ambiente do Alpha v0 (reproducao controlada).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    g = p.add_mutually_exclusive_group()
    g.add_argument("--verify", action="store_true",
                   help="so mede a suite e compara com o baseline; nao altera nada")
    g.add_argument("--reset", action="store_true",
                   help="devolve a copia ao estado pristino (desfaz o revert)")
    args = p.parse_args()

    try:
        if args.verify:
            return verify()
        if args.reset:
            reset_copy()
            return 0
        return prepare()
    except Fail as e:
        print(f"\nERRO: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrompido", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

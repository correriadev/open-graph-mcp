# BT-4 — Escopo fechado (conteúdo e dinâmica da sessão)

> Status: **proposto** — paraleliza com BT-0..3. Índice-pai: `README.md`.
>
> **Objetivo:** sem desenho de dinâmica, a sessão vira demo técnica com
> espectadores. Este escopo transforma o grafo em mesa de game design:
> um seed que dá estrutura sem prescrever o jogo, missões que forçam
> colaboração (e contenção saudável — risco 4 do README), e um roteiro
> de facilitação com plano B ensaiável.

---

## 1. O que sai pronto no final

1. **Graph seed do jogo** (`scripts/seed-beta-graph.ts`): bootstrap
   pure-knowledge no tenant da sessão (BD3) com domínios desenhados pra
   paralelizar SEM eliminar disputa — proposta inicial: `historia`,
   `personagens`, `mecanicas`, `gameloop`, `mundo`, `regras` (5-6
   domínios × níveis = cells suficientes pra 8-12 criadores; ajustar no
   dry-run). Cada domínio nasce com 1 claim-âncora explicando o que
   vive ali.
2. **Roteiro do facilitador** (`bt-4-roteiro.md`): timeline da janela
   (~2h) — boas-vindas + consentimento de coleta (BD2/risco 2 do BT-2)
   → warm-up individual (query + 1º turno guiado, ativa a métrica
   tempo-até-1º-commit) → rodadas de missão → retro a quente (15 min,
   perguntas fixas, incluindo a do gate pós-beta do `README.md`: "se
   isso sumisse amanhã, sentiria falta de quê?").
3. **Missões de co-criação** (3-4, no roteiro): desenhadas contra as
   métricas do BT-2 — ex.: "definam a premissa em `historia`" (converge
   todos → contenção medida), "cada dupla fecha uma mecânica que
   referencia a premissa" (paraleliza → refs entre cells), "montem o
   gameloop citando 2 mecânicas de OUTRA dupla" (força leitura do que
   os outros criaram — query, não só escrita).
4. **Guia do participante** (1 página, junta com o INSTALL.md do BT-1):
   o modelo mental mínimo — cell, turno, lock, "o que fazer quando
   negado" — em linguagem de mesa de RPG, não de protocolo.

**Definição de pronto (DoD):**

- [ ] **Seed roda idempotente**: `bun run scripts/seed-beta-graph.ts
      --tenant beta-teste` duas vezes seguidas = mesmo grafo, sem
      duplicata; âncoras visíveis na web UI.
- [ ] **Roteiro completo versionado**, com timeline em minutos, fala de
      abertura escrita (incluindo consentimento) e plano B de queda de
      túnel como bloco do roteiro (não improviso — risco 2 do README).
- [ ] **Cada missão anota quais métricas do BT-2 ela ativa** — missão
      que não ativa nenhuma é cortada ou reescrita.
- [ ] **Guia do participante testado em cobaia**: uma pessoa de fora lê
      o guia e explica de volta o que é um turno e o que fazer num
      `lock.denied`, sem ajuda — falhou, reescreve.
- [ ] **Validação real**: mini-rodada da dinâmica (dono + 1 cobaia + 1
      agente, 30 min, pode ser na LAN) percorrendo warm-up + 1 missão;
      ajustes registrados no roteiro. (O ensaio completo é BT-5.)

---

## 2. O que NÃO está nesta fase

- ❌ Ferramenta nova de produto pra sessão (templates de claim, UI de
  votação) — a sessão usa o produto como está; falta sentida vira
  backlog pós-beta, não feature de véspera (BD6).
- ❌ O jogo em si ser bom — o jogo é pretexto (tese); qualidade do
  game design resultante não é métrica.
- ❌ Gravação de vídeo/streaming da sessão — decisão do grupo no dia,
  fora do escopo técnico.
- ❌ Materializar o jogo criado (build jogável, engine) — pós-beta, se
  o grupo quiser; o entregável da sessão é o GRAFO do jogo.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Seed + âncoras | 0.5-1 dia |
| Roteiro + missões mapeadas a métricas | 1 dia |
| Guia do participante + teste cobaia + mini-rodada | 0.5-1 dia |
| **Total** | **2-3 dias** (+ facilitação na sessão real) |

---

## 4. Riscos

1. **Dinâmica boa demais esconde o produto** (facilitador carrega a
   sessão, ferramenta vira detalhe). Mitigação: missões obrigam uso das
   tools (refs entre cells exigem query; convergência exige turno);
   retro pergunta pela ferramenta, não pelo jogo.
2. **Domínios do seed enviesam o jogo** (estrutura prescreve o
   resultado criativo). Aceito: viés estrutural < página em branco com
   12 pessoas e 2 horas; âncoras dizem "o que vive aqui", nunca "o que
   criar".
3. **Warm-up estoura o tempo** (12 pessoas × instalação/1º turno).
   Mitigação: instalação acontece ANTES do dia (artefato BT-1 enviado
   na véspera com o guia); warm-up do dia é só registrar + 1º turno; o
   dry-run (BT-5) cronometra e corta o que não couber.

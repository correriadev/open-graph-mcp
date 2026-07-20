# UI-3 — Escopo fechado (leitura e busca)

> Status: **concluído** — depois de UI-2. Índice-pai: `README.md`.
>
> **Objetivo:** fechar o gap que motivou a reescrita: hoje a UI
> escreve mas não lê. Claims browser (o conteúdo criado vira legível e
> navegável), `graph.query` com gaps de primeira classe, history.
> É o que transforma o grafo em mesa de leitura coletiva — sem isso,
> co-criação é escrita cega.

---

## 1. O que sai pronto no final

1. **Claims browser**: painel por cell/domínio — lista de claims com
   autor, timestamp, status; claim aberto renderiza conteúdo completo
   com refs como chips navegáveis (clique → centra e abre o
   referenciado) e seção "referenciado por" (reverso, derivado do
   snapshot em memória); rodapé com proveniência (csId, seq).
2. **Busca global (`graph.query`)**: barra no topbar (⌘K), resultados
   agrupados; **gaps como resultado de primeira classe** — termo sem
   match aparece como "sem resultado: '<termo>'" com sugestão de
   refinamento (gaps são load-bearing: é como o usuário aprende o
   vocabulário do grafo). Selecionar resultado centra o nó.
3. **History**: rota com filtros (byUser/target/kind), clique abre
   payload; paridade com a rota velha, estilizada no norte visual.
4. **Sidebar de navegação**: árvore domínios → níveis com contagem de
   claims e badge de lock (o "CÉLULAS" do norte visual), filtros
   rápidos (com turno aberto, bloqueados, minhas contribuições).

**Definição de pronto (DoD):**

- [x] **Ciclo leitura→escrita**: achar claim via query → abrir no
      browser → navegar por ref → abrir turno na cell do claim lido —
      sem sair do fluxo (é a missão 3 do BT-4 executável 100% na web).
      *RETRY #1 nåo-diferido:* RefChip cross-cell nav (setSelectedCell
      + requestCenter) coberto em e2e (`query-and-read.e2e.ts`).
- [x] **Gaps visíveis**: query com termo inexistente mostra o gap (não
      lista vazia muda) — validado em e2e.
- [x] **e2e da fase**: `query-and-read.e2e.ts` (query → gap → query ok
      → abrir claim → navegar ref cross-cell) e `history.e2e.ts`
      (filtro + payload + round-trip URL).
- [x] CI verde.

**Itens explicitamente diferidos (Phase B):**

- [ ] **TurnModal commit DraftPanel**: clicar 'abrir turno nesta cell'
      abre o TurnModal UI-2; o commit integral do claim-draft via UI
      permanece em Phase B (sessão LLM stub completa — fora do budget
      desta fase). Path aberto honestamente: Phase A fecha o
      leitura→escrita ao surfacear o modal; Phase B fecha o submit.

---

## 2. O que NÃO está nesta fase

- ❌ Full-text search server-side novo — usa `graph.query` como está;
  ranking melhor é backlog de produto.
- ❌ Edição a partir do browser de claims — leitura; escrever = abrir
  turno (UI-2).
- ❌ Export/print de claims — YAGNI.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Claims browser + refs/reverso | 1-1.5 dia |
| Query bar + gaps + sidebar/filtros | 1 dia |
| History + e2e ×2 | 0.5 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **Snapshot não expõe conteúdo suficiente de claim** (GraphNode traz
   `claims: string[]` — verificar cedo se é id ou texto; se faltar
   corpo, a fase precisa de um resource novo `graph://claims?cell=` no
   server). Mitigação: verificação é a PRIMEIRA tarefa da fase; se
   precisar de resource novo, é read-only, aditivo, PR pequeno no
   server com teste — reabre BD6-equivalente? Não: beta está adiado
   (WD5), server não está congelado.
2. **"Referenciado por" caro em grafo grande** (varredura reversa).
   Mitigação: índice reverso construído uma vez por snapshot no
   cliente (O(edges)), invalidado por evento de commit.

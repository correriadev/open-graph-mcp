# BT-5 — Escopo fechado (dry-run + go/no-go)

> Status: **proposto** — último; exige BT-0..4 verdes. **Gate da sessão
> real.** Índice-pai: `README.md`.
>
> **Objetivo:** uma máquina, uma janela, uma chance (risco 2 do
> README). O dry-run é a única execução completa do sistema —
> túnel + artefato + telemetria + dinâmica — antes de haver plateia. O
> go/no-go transforma "acho que está pronto" em checklist assinado.

---

## 1. O que sai pronto no final

1. **Dry-run executado**: sessão-ensaio de ~45 min com 2-3 pessoas de
   fora da LAN (cobaias reais, não o dono) + ≥1 agente Claude Code via
   plugin, percorrendo o caminho INTEIRO do participante: baixar
   artefato do Release (BT-1) → instalar pelo INSTALL.md → entrar pelo
   URL ngrok (BT-0) → warm-up + 1 missão do roteiro (BT-4) → telemetria
   ligada (BT-2) → relatório gerado no fim.
2. **Ensaio do plano B dentro do dry-run**: dono mata o túnel no meio,
   executa o bloco de queda do roteiro, reabre; medido quanto tempo até
   todos de volta (proxy re-registra sozinho; web UI re-registra
   manual).
3. **Checklist go/no-go** (`bt-5-go-no-go.md`): itens objetivos,
   cada um verificável na véspera — versão taggeada do Release,
   server congelado (BD6), snapshot do STATE_DIR arquivado, matriz
   ngrok vigente, seed aplicado no tenant da sessão, METRICS_LOG
   ligado, roteiro impresso, canal do grupo com URL + guia enviados.
4. **Runbook do dia** (`bt-5-runbook-dia.md`): do abrir-janela (BT-0)
   ao fechar-janela + gerar relatório + arquivar tudo em
   `relatorios/`.

**Definição de pronto (DoD):**

- [ ] **Dry-run completo** com ata: o que travou, tempo de instalação
      real das cobaias, tempo de warm-up, fricções do roteiro —
      registrado em `docs/roadmap-beta-test/relatorios/dry-run-<data>.md`.
- [ ] **Relatório BT-2 do dry-run gerado** sem métrica "N/A" — prova
      final da telemetria com humanos reais.
- [ ] **Plano B cronometrado**: queda + retorno < 10 min com todos de
      volta; se estourar, ajustar roteiro/ferramenta e repetir só este
      bloco.
- [ ] **Checklist go/no-go versionado** e preenchível em < 30 min na
      véspera (testado no próprio dry-run).
- [ ] **Correções do dry-run aplicadas e re-verificadas** — item que
      exigir mudança de server reabre BD6 (congela de novo, novo
      smoke); mudança só de doc/roteiro não.
- [ ] **Validação real**: decisão go/no-go da 1ª sessão real registrada
      no checklist, com data e assinatura do dono.

---

## 2. O que NÃO está nesta fase

- ❌ A sessão real em si — é o EVENTO que este roadmap prepara; a
  análise dela (relatório BT-2 + retro + leitura do gate de adoção do
  `beta-plan.md`) é pós-roadmap.
- ❌ Segunda rodada de dry-run completa por default — só o bloco que
  falhou repete; ensaio infinito é procrastinação com checklist.
- ❌ Automatizar o go/no-go — checklist humano de véspera; automação
  disso é custo sem beta recorrente que o justifique.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Checklist + runbook do dia | 0.5 dia |
| Dry-run (agendar + executar + ata) | 0.5 dia |
| Correções + re-verificação | 0-1 dia (depende do achado) |
| **Total** | **1-2 dias** |

---

## 4. Riscos

1. **Dry-run acha problema estrutural a dias da sessão** (túnel
   inviável, instalação > 30 min). Mitigação: é o propósito do gate —
   sessão real ADIA, não degrada; a data com os amigos se remarca, a
   primeira impressão do produto não.
2. **Cobaias do dry-run são as mesmas pessoas da sessão** (queima a
   surpresa/dado de ativação). Mitigação: recrutar cobaias fora da
   lista de participantes; se impossível, marcar os dados de ativação
   delas como enviesados no relatório da sessão real.
3. **Tudo verde no ensaio, e o dia real falha diferente** (rede da
   casa, plano ngrok atingindo limite com N reais). Aceito o residual:
   risco 2 do README; o plano B ensaiado é a resposta, não prevenção
   total.

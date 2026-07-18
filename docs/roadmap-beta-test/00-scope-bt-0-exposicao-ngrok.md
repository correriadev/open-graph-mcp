# BT-0 — Escopo fechado (exposição MCP + ngrok)

> Status: **proposto** — primeiro do roadmap; BT-2/BT-3 dependem da
> topologia validada aqui. Índice-pai: `README.md`.
>
> **Objetivo:** o server é D2 (rede confiável) por design; a sessão
> exige internet pública por uma janela. Este escopo transforma "abrir
> um túnel" em procedimento com análise de ameaça, mitigações em camada
> e runbook — pra que a exceção ao D2 seja operada, não improvisada
> (BD1).

---

## 1. O que sai pronto no final

1. Topologia documentada: `participante → ngrok edge → túnel → server
   local (:8787) → SQLite/JSONL local`, cobrindo os DOIS canais (`POST
   /mcp` request/response e `GET /events` SSE de longa duração).
2. Matriz de capacidades ngrok testada no plano real da conta (com
   data): interstitial/header, SSE, basic-auth, limites.
3. Análise de ameaça da janela (quem pode chegar no túnel, o que
   consegue fazer, o que confina o dano) com cada mitigação mapeada.
4. Runbook `abrir-janela.md` / `fechar-janela.md`: passos exatos,
   comandos, checklist de saída (túnel morto, snapshot arquivado).

**Definição de pronto (DoD):**

- [ ] **Doc de topologia** em `docs/roadmap-beta-test/bt-0-topologia.md`
      com diagrama ASCII dos dois canais e a matriz ngrok preenchida
      (cada linha: capacidade, testado como, resultado, data).
- [ ] **SSE atravessa o túnel real**: web UI aberta via URL ngrok numa
      rede EXTERNA (celular 4G/5G, não a LAN do server) recebe
      presença/toast ao vivo por ≥10 min sem queda; registrado na matriz.
- [ ] **Proxy stdio atravessa o túnel**: `--server https://<ngrok-url>
      --name teste` completa register + query + um turno completo
      (open→claim→commit) de fora da LAN.
- [ ] **Interstitial resolvido**: web UI e proxy funcionam SEM clique
      manual em página do ngrok (header, domínio reservado ou plano —
      registrar qual caminho ficou).
- [ ] **Análise de ameaça** escrita no doc de topologia: pelo menos os
      vetores "URL vazado → registro anônimo", "flood de tool calls",
      "mutação maliciosa no tenant do beta", "descoberta de outros
      tenants" — cada um com mitigação ou aceite explícito (formato dos
      riscos do README).
- [ ] **Runbook executado uma vez de verdade** (não só escrito): abrir
      janela → smoke de 5 min → fechar janela → conferir que o URL
      morreu (curl de fora retorna erro) e que o snapshot do
      `STATE_DIR` foi arquivado.
- [ ] **Validação real**: tudo acima registrado com data + versão do
      ngrok + plano da conta no doc de topologia.

---

## 2. O que NÃO está nesta fase

- ❌ Auth de transporte no server (Authorization header, allowlist no
  próprio server) — é D10/Fase 4 (roadmap-mcp); a janela usa mitigação
  operacional, não feature.
- ❌ Hosted/VPS permanente — roadmap-mcp `05'`; BD1 diz que beta
  contínuo reabre a decisão, não este escopo.
- ❌ TLS/certificado próprio — ngrok já termina TLS na edge.
- ❌ Multi-região/segundo túnel de contingência — risco 2 do README é
  aceito; plano B é reabrir, não redundância.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Pesquisa ngrok + matriz testada | 0.5-1 dia |
| Testes reais através do túnel (SSE, proxy, interstitial) | 0.5-1 dia |
| Análise de ameaça + runbook + execução do runbook | 1 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **Plano free do ngrok não sustenta a sessão** (interstitial sem
   contorno, limite de conexões < participantes×2). Mitigação: matriz
   primeiro; se falhar, decidir upgrade de plano ANTES de BT-3 — é a
   decisão mais barata de antecipar do roadmap inteiro.
2. **SSE de longa duração cai no túnel em rede real** (timeouts de edge,
   NAT). Mitigação: o teste de 10 min do DoD é em rede externa real; a
   lib INT-2 já re-conecta e re-attacha — medir a frequência de
   reconexão e registrar como baseline pro BT-2.
3. **A análise de ameaça conclui que o residual é inaceitável.**
   Mitigação honesta: se acontecer, a resposta é tailnet (plano
   anterior, `beta-plan.md`) e a sessão perde "qualquer um entra com um
   link" — decisão do dono, documentada, não contornada.

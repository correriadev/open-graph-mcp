# SB-α — Alpha v0: reprodução controlada de uma feature revertida

> **Antes do beta v0.** O dono testa sozinho, no `harness-kit`, revertendo uma
> feature que já existe no histórico e reconstruindo-a com o open-graph-mcp
> conectado. Data de escrita: 2026-08-08. Estado do servidor: 556 testes
> verdes, achados F1–F8 e MP-1–MP-3 fechados.

## 1. Por que um alpha, e o que ele responde que o beta não responde

O beta v0 (`00`/`01` desta pasta) responde *"um estranho consegue usar isto por
dias sem o dono por perto?"*. É uma pergunta de **experiência**: instalação,
legibilidade, resiliência, e um log para diagnosticar o que der errado.

O alpha responde outra, anterior e mais dura: **"isto ajuda a construir?"**

E ele consegue responder porque tem uma propriedade que o beta nunca terá:
**verdade de referência**. A feature já foi escrita, está no histórico do git,
e veio com testes. Existe um gabarito objetivo — não a impressão de quem usou.

Ordem correta: se o alpha disser que não ajuda, o beta testa a experiência de
uma coisa que não serve. Alpha primeiro.

## 2. O desenho

```
1. escolher uma feature do histórico do harness-kit
2. reverter a IMPLEMENTAÇÃO dela, manter os TESTES
3. reconstruir a feature com um agente
4. comparar contra o original
```

O passo 2 é o que torna isto um experimento e não uma demonstração.

### Reverter a implementação, manter os testes

Se você reverter a feature inteira (implementação + testes), não sobra
gabarito: qualquer coisa que o agente escrever "funciona", porque nada afirma o
contrário. Mantendo os testes, o critério vira binário e objetivo: **a suíte
original passa?**

O `harness-kit` favorece isso — commits como
`2c965b3 feat: Add Codex CLI execution adapter and corresponding tests` trazem
implementação e teste juntos, e há uma suíte real em
`sdk/src/agent-runner/__tests__/`.

Candidato recomendado: **`CodexCLIRunner`**. Motivos:

- É um **adaptador com irmãos** (`ClaudeCLIRunner`, `CopilotCLIRunner`,
  `AntigravityCLIRunner`). Existe um padrão a inferir — exatamente o tipo de
  conhecimento que um grafo deveria carregar.
- Vem com teste próprio (`CodexCLIRunner.test.ts`).
- É pequeno o bastante para uma sessão e grande o bastante para ter estrutura.

Se o revert dele for inviável na prática, o critério para escolher outro é o
mesmo: implementação separável dos testes, e irmãos que estabeleçam padrão.

## 3. A decisão central: qual grafo o agente vê

Esta é a decisão que define o que o alpha mede, e ela precisa ser tomada
**antes** de rodar, não depois.

### Experimento A — grafo do estado PRÉ-feature *(recomendado como principal)*

Reverte primeiro, faz `graph.bootstrap` depois. O grafo não sabe que a feature
existiu. O que ele oferece é **estrutura**: quais arquivos existem, o que
depende do quê (`graph.impact`), como os irmãos se organizam em células.

Responde: *"o grafo ajuda a construir algo novo?"* — que é o uso normal.

### Experimento B — grafo do estado PÓS-feature

`graph.bootstrap` antes de reverter. Aí o grafo **lembra** algo que o código
perdeu: que `CodexCLIRunner.ts` existia, o que importava, qual era sua primeira
linha. O `watch` inclusive detecta o revert como drift e demove a célula.

Responde: *"o conhecimento sobrevive ao código?"* — que é a tese do produto.

**Sobre vazamento**, e vale ser honesto: um grafo recém-indexado tem
`claims: 0`. O que ele guarda por nó é uma âncora, definida como a **primeira
linha não-vazia** do arquivo. Então o experimento B entrega ao agente a lista de
arquivos, uma linha de cada e o grafo de imports — memória estrutural, não a
implementação. Não é gabarito, mas **é uma pista real**, e um resultado bom em B
tem que ser lido com esse desconto.

Se houver claims commitadas antes do revert (por você, na fase 3 do protocolo),
aí sim o vazamento é grande: uma claim carrega `subject` e `anchor` verbatim.
Nesse caso B deixa de medir "reconstrução" e passa a medir "restauração a
partir de notas" — o que é legítimo, mas é outra pergunta.

**Recomendação:** rodar **A** como experimento principal. B é uma segunda
rodada, opcional, e o resultado dele nunca deve ser reportado sem a ressalva
acima.

## 4. O braço de controle — sem ele não há conclusão

"Reconstruí a feature com o open-graph e funcionou" não diz nada sozinho: um
agente competente reconstrói `CodexCLIRunner` sem ferramenta nenhuma, olhando
os irmãos. Sem controle, o alpha vira demonstração.

**Dois braços, e a ordem importa:**

| Braço | Setup | Roda |
|---|---|---|
| **Controle** | Agente sem o MCP conectado | **PRIMEIRO** |
| **Tratamento** | Agente com o MCP conectado | depois |

O controle vai primeiro porque o inverso contamina: se você rodar o tratamento
antes, o braço de controle acontece numa cabeça (sua) que já viu o resultado.

Cada braço numa **sessão limpa**, sem histórico da outra.

## 5. Protocolo

**Fase 0 — preparação (antes de qualquer agente)**

1. Escolher a feature e anotar o commit (`git log --oneline`).
2. `git diff` do commit → separar arquivos de implementação de arquivos de teste.
3. Guardar a implementação original **fora do repo** (é o gabarito; não pode
   ficar no worktree onde o agente trabalha).
4. Reverter só a implementação. Confirmar que os testes agora **falham** — se
   passarem, o revert não removeu a feature e o experimento é nulo.
5. Anotar o número de testes falhando. É o placar inicial.

**Fase 1 — braço de controle**

Sessão limpa, sem MCP. Prompt igual ao do outro braço. Registrar tudo do §6.

**Fase 2 — braço de tratamento**

1. Subir o servidor: `STATE_DIR` novo, `PORT` livre, log ligado.
2. `claude mcp add --transport http open-graph http://localhost:8787/mcp`
3. Sessão limpa. **Mesmo prompt do controle.** Sem dica sobre usar as tools —
   se o agente não as usar, isso é o achado.
4. Ao fim: `claude mcp remove open-graph -s local`.

**Regra dura nos dois braços:** o agente **não pode consultar o histórico do
git** da feature revertida (`git log`, `git show`, `git diff` do commit,
`reflog`, stash). O gabarito está lá, a um comando de distância. Declare isso no
prompt e verifique depois no log da sessão. Sem essa regra, o experimento mede
se o agente sabe usar git.

## 6. O que medir — definido ANTES de rodar

Registre por braço:

| Medida | Como | Por que |
|---|---|---|
| **Testes originais passam?** | rodar a suíte | Critério primário. Binário. |
| **Quantos turnos / quanto tempo** | contagem | Custo. |
| **Diff vs. o original** | arquivos tocados, estrutura, assinaturas públicas | Chegou perto ou inventou outra coisa? |
| **Quantas chamadas MCP, e quais** | `<STATE_DIR>/server.log` | Ele *usou* a ferramenta? |
| **Alguma tool foi recusada?** | `verdict:"refused"` + `reasons` no log | O gate ajudou ou atrapalhou? |
| **O agente descobriu as tools sozinho?** | log + transcrição | É a pergunta do Caminho B. |

O `server.log` é o instrumento, e existe justamente para isto: uma linha JSONL
por chamada, com tool, duração, veredito e — desde `403240c` — a distinção entre
"a chamada funcionou" e "o gate recusou". Ele não registra token nem conteúdo de
claim, então pode ser anexado a qualquer relato.

## 7. Critérios de sucesso — pré-registrados

Escritos agora para não serem racionalizados depois.

**Sucesso forte:** os dois braços passam nos testes, **e** o braço com MCP
mostra vantagem mensurável (menos turnos, menos arquivos errados tocados, ou
uma decisão estrutural correta rastreável a uma consulta ao grafo).

**Sucesso fraco (ainda é sinal bom):** os dois passam, sem vantagem clara, mas o
agente **usou** as tools espontaneamente e o log mostra consultas coerentes com
o que ele escreveu depois. Significa: a ferramenta é usável, o valor ainda não
está provado.

**Fracasso informativo:** o agente **não usou** as tools, ou usou e ignorou o
resultado. Isso é um achado sobre o Caminho B (descrições de tool + `graph://guide`
não bastam), não sobre o grafo.

**Fracasso duro:** o braço com MCP vai **pior** — o agente se perde, o gate
bloqueia trabalho legítimo, ou ele gasta turnos lutando com a ferramenta. Aí o
beta não abre até entender por quê.

Observe que três desses quatro resultados são úteis. Só um é ruim, e mesmo ele
é acionável.

## 8. Ameaças à validade — para não descobrir depois

1. **`claims: 0`.** Um grafo recém-indexado não tem conhecimento nenhum, só
   estrutura. O alpha está testando o esqueleto, não o produto completo. Se o
   resultado for morno, esta é a primeira hipótese — não "a ideia não presta".
2. **N = 1.** Uma feature, uma sessão por braço. Não generaliza. Serve para
   detectar um problema grande, não para medir ganho pequeno.
3. **Você não é cego.** Você sabe qual braço é qual e conhece o gabarito. Isso
   inclina a avaliação sem má-fé. Mitigação parcial: o critério primário (a
   suíte passa) é objetivo e imune a isso — é por isso que ele é o primário.
4. **O agente pode ter o `harness-kit` no treino.** Se reproduzir bem demais e
   rápido demais nos dois braços, suspeite disso antes de comemorar.
5. **Um único usuário.** Trava, presença, contenção e notificação não são
   exercitados. O alpha é single-player por construção; a camada concorrente
   fica para o exercício multiplayer (`01`, §resíduos).

## 9. O que o alpha NÃO testa

Instalação por terceiro, empacotamento, uso prolongado, multi-usuário,
recuperação de restart no fluxo real. Tudo isso é beta v0.

## 10. Saída → o que destrava o beta v0

- [ ] Um braço de controle e um de tratamento executados, nessa ordem
- [ ] Suíte original passando registrada nos dois
- [ ] `server.log` do braço de tratamento arquivado
- [ ] As seis medidas do §6 anotadas
- [ ] Veredito declarado entre os quatro do §7
- [ ] Se "fracasso duro": causa entendida antes de qualquer coisa
- [ ] Se o agente não usou as tools: decisão sobre o Caminho B antes do beta

Fechado isso, o beta v0 passa a testar experiência sabendo que a substância foi
verificada — ou sabendo exatamente onde ela não foi.

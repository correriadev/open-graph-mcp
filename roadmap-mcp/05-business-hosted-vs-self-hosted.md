# Fase 5' — Hosted vs self-hosted (decisões comerciais)

> Status: **documento de produto**, não de engenharia. Não gera código.
> Gera escolhas que param para baixo em toda a linha.
> ADR-pai: `docs/roadmap-mcp/ADR.md`.
>
> **Objetivo:** articular as duas rotas de implantação da Fase 4+ open-graph
> MCP — (a) **self-hosted** single-tenant pago/licenciado, (b) **hosted**
> multi-tenant SaaS — e as implicações comerciais/tecnicas que cada uma
> carrega. **Isto é um documento de discussão; não é uma decisão.**

Quando isto foi escrito, Fase 4 ainda é spec; nenhuma implantação existe
ainda. Mas a decisão hosted vs self-hosted **não pode ficar adiada até o
final de Fase 4** — muitas escolhas de engenharia entre Fase 2 e Fase 4
dependem dela (auth, multi-tenancy, isolamento, pricing, growth path).

---

## 1. As duas rotas

### 1.1 Self-hosted single-tenant

**O que é:** o cliente (time/empresa) executa seu próprio servidor
open-graph MCP em uma VM / container / on-prem. Cada instância serve um
único "tenant" = um conjunto de usuários com acesso ao mesmo grafo.

- **Implantação:** `docker compose up`. Container binário Bun + SQLite
  volume persistente + HTTP/SSE porta 8787. Pronto p/ intranet.
- **Licenciamento:** open-source (AGPL ou MIT) ou comercial paga (licença
  perpetual por instância). Decisão a alinhar com estratégia da empresa.
- **Auth:** tokens emitidos pelo admin local (CLI). SSO/SAML só com
  integração custom (não é v1 self-hosted).
- **Multi-tenancy:** não há. Cada instância isolada; se empresa quer 5
  times distintos, 5 instâncias distintas (federation entre eles —
  Fase 5 — é o que une).
- **Custo p/ o cliente:** infra básica (VM 2GB RAM, disco 10GB SQLite).
  open-graph MCP aguenta dezenas de usuários simultâneos sem suar.

### 1.2 Hosted multi-tenant SaaS

**O que é:** você opera uma instância central, servindo múltiplos
tenants (times/empresas). Cada tenant tem seu grafo isolado, mas a
infra é compartilhada.

- **Implantação:** instância central em cloud (AWS/GCP); Postgres no
  SQLite lugar (decisão D13 abaixo); auth SSO; isolamento por
  `tenant_id` em todas tabelas.
- **Cliente paga** assinatura mensal/usuário ou por instância. Pricing a
  definir (recurso separado, depois de sinal de adoção).
- **Auth:** SSO (Google/Okta) obrigatório desde v1 hosted; onboarding
  self-service opcional.
- **Multi-tenancy:** TODO crítico — todas tabelas SQLite até Fase 4
  ganham coluna `tenant_id`; affinity router filtra por tenant; estado
  de presença é por tenant.
- **Isolamento:** DB-level (todos queries levam WHERE tenant_id=...) é
  o suficiente p/ v1; row-level security em Postgres é Fase 5+
  hosted.

---

## 2. Vantagens/desvantagens matemática direta

|              | Self-hosted                        | Hosted                            |
|---|---|---|
| Setup friction p/ cliente   | Médio (docker tem experiência)   | Baixo (signup)       |
| Operar infra (você)         | Zero (cliente faz)                 | Tudo (SLA, backup, uptime)        |
| Custo unitário/ usuário     | Low (uma VM)                       | Higher (você paga)                 |
| Receita escala linear       | Não sem visitar novas vendas       | Sim (assinatura)                   |
| Multi-tenancy code          | Não precisa                       | **Obrigatório** (D13)             |
| SSO/SAML desde v1           | Adiável                            | Obrigatório                       |
| Auditoria cross-org         | Cliente interno; não sua obrigacao | Você é guardião (LGPD/GDPR)       |
| Federação (Fase 5) natural  | Já funciona cross-org por design  | Mais valor (rede de tenants)      |
| Manutenção versões          | Cliente gerencia                   | Você roll-out p/ todos            |
| Lock-in percebido           | Zero (open-source req)             | Baixo se export importado garantido |
| Sales pitch                 | "Sua KB em sua rede"                | "Sua KB em 5 minutos"              |
| Mercado-alvo                | Ent/times >1-2 devs, security-aware| Startups / PMEs / pequenos times  |

**Observação analista:** não há rota errada — há rota que serve mercado
alvo. Pergunta que importa é "quem é seu first customer?":
- Se é uma empresa de segurança-ciosa (banco, gov, fintech), self-hosted.
- Se é equipe ágil product-led (startup, agência, consultoria), hosted.
- Se é open-source projeto comunitário (linux foundation, OSS), self-hosted
  puro.

---

## 3. D13 — Decisão técnica que trava ambas as rotas

**A pergunta: hosted exige MULTITENANCY desde v1?**

- **(a) Não, v1 hosted = uma instância por tenant.** Você roda N dockers
  na cloud, um por tenant. Mais simples; escala ruim; zero code de
  multi-tenancy. Mas você paga por servidor sempre.
- **(b) Não, v1 hosted elimina SQLite.** Vai direto p/ Postgres só em
  hosted; self-hosted fica SQLite. Dois codepaths.
- **(c) Sim, v1 hosted = Postgres com tenant_id.** Único código, SQLite
  p/ self-hosted, Postgres p/ hosted; abstração de DB swap em runtime.
  Mais caro; mais consistente.

**DECIDIDO (2026-07-12, usuário):** variante de (c) sem Postgres —
**SQLite + `tenant_id` em todas as tabelas desde a Fase 2**. Toda query
escopada; isolamento DB-level; espelho JSONL por tenant. Postgres segue
fora do v1. A recomendação (a) abaixo fica como registro histórico.

**Minha proposta D13 era: (a)** — uma instância por tenant, mesmo SQLite.
Ponytail argument: multi-tenancy real é refactor profundo, traze-o só
quando N tenants justifiquem o custo. Com 1-5 tenants, docker por
tenant é trivial. A partir de ~20 tenants, migrar p/ (b)/(c).

**Implicação D13(a):** código de Fases 2-4 **não precisa ser multi-tenant
aware**. Isto coloca Fase 4 ~30% mais fácil de entregar.

---

## 4. Open-source vs source-available vs closed

**D14 — Decisão comercialmente sensível.** Opções:

- **(a) Open-source total (AGPL ou MIT).** Repo público; qualquer um
  pode rodar. Hosted offered como conveniência (estilo GitLab/Plausible).
  Melhor p/ adoção; pior p/ monopolizar oferta.
- **(b) Source-available (BSL/FSL-like).** Código aberto p/ ler, mas usage
  comercial hosted concorrente é proibido por N anos. Depois converte p/
  open-source. Equilíbrio; modelo usado por MariaDB/HashiCorp/Sentry.
- **(c) Closed source, hosted only.** Sem self-hosted; SaaS puro. Mais
  foco; menos comunidade; sem nada do valor "open knowledge graph" que
  vem do open-source pitch do ADR open-graph.

**Minha proposta D14: (a) open-source (AGPL)**, alinhado à herança do
open-graph fork (que é OSS), e hosted oferecido como camada comercial
("conveniência e operação gerenciada"). Mas **isto é decisão comercial
sua, não técnica** — não devo puxar pra default.

---

## 5. Quando decidir

Ainda não. Momento certo de decidir:

- **Antes de começar Fase 2:** D13 (não precisa multi-tenancy em v1
  hosted?) — sabendo disto, código de Fases 2-4 fica significativamente
  mais simples. **Trava real adiante.**
- **Antes de terminar Fase 3:** D14 (licenciamento) — porque clientes
  early-adopter vão perguntar; você precisa ter resposta. Sem
  licenciamento definido, early access emperra.
- **Antes de Fase 4 verde:** D hosted vs self-hosted formalmente —
  depois de Fase 4, chega momento de "ESTOU vendendo isto?"; sim
  precisa de rota.
- **Fase 5 pode falar/decidir auth cross-org + federação multi-tenant**
  — mas só após adoção; pode ser adiada.

---

## 6. Pricing (não decido nada — coloquei p/ você pensar)

Estas são hipóteses, não proposta:

- Self-hosted OSS: grátis; consultoria/implantação paga separadamente
  (estilo "open-core business").
- Hosted single-tenant: USD 200-500/mês por instância (SQLite; ~50
  usuários ativos OK). Baixo custo unitário, margem pequena.
- Hosted multi-tenant (pós Fase 5): USD 15-30 usuário/mês. P/ times
  menores (3-10 pessoas) USD 99/333 por mês. Tiers por # cells/usuarios.
- Upsell features: hosted federação cross-tenant (apartir Fase 5),
  audit export avançado, SSO. Estilo "Plausible Cloud" — simples tiers,
  extras p/ admins.

**Importante:** se hospedar é camada comercial, OSS tem que ser
**realmente OK** (feature-paridade com hosted em tudo essencial).
Hosted-only features geram fricção comunidade OSS (estilo "open-core"
com community edition capada) — badwill histórico; evite se possível.
Plausible é citado repetidamente como bom exemplo: community edition é
full-featured; cloud é hosting + ops, não features exclusivas.

---

## 7. Questões operacionais que vao bater

### 7.1 Backup/restore

- Self-hosted: cliente decide; default é arquivo SQLite + JSONL.
- Hosted: você precisa fazer backup; restore p/ tenant só.

### 7.2 Atualizacoes/upgrades

- Self-hosted: cliente rola. Compatibilidade de schema vai exigir
  migrations; tests de `migrate-from-phase-N.ts` precisam ser ùteis.
- Hosted: você roda migrations no central; zero downtime p/ tenants.

### 7.3 SLA

- Self-hosted: cliente gerencia; sem SLA seu.
- Hosted: você promete uptime (99.5+?). Custos de suporte on-call.

### 7.4 LGPD/GDPR/data residency

- Self-hosted: dados nunca saem do cliente.
- Hosted: você é processador; precisa:dataProcessingAgreement;
  data residency choice (região); right-to-erase workflow.

---

## 8. A decisão que eu recomendo (analista p/ yourself)

**Self-hosted OSS primeiro, com plano-hosted p/ depois de Fase 4.**

Razões:

1. **Open-graph herança é OSS.** Continuar OSS tem consistência narrativa;
   não força reviravolta comercial.
2. **Self-hosted é onde produto se prova primeiramente.** Primeiros clientes
   são times dev como você (sua rede, repos públicos wanting MCP server) —
   times dev tem infra; preferem self-host; confiança total sobre seus dados.
3. **Hosted requer escala que não existe até Fase 4+adocao real.** Tomar
   deciCões de Postgres + multi-tenant + SSO agora desperdiça 5-8 sem de
   trabalho especulativo.
4. **D14(a) licenciamento alinhado:** AGPL mantêm concorrentes hosted
   competindo no ops não no code, beneficiando você (você tem o ops
   "oficial"); comunidade OSS ainda ganha muito.
5. **Após Fase 5 (federação) faz breakout hosted sentido.** Tens wanting
   cross-org hosted começam a pedir; nessa altura você tem 3-5 early
   adopters hosted trabalhando contigo.

**Isto é analysis, não projeto.** Você é quem decide qual rota seguir.

---

## 9. Perguntas p/ você responder (amesmo se NÃO hoje)

Adiável mas pendente:

- **D13:** multi-tenancy em Fases 2-4 (R = NÃO; adiável)?
- **D14:** licenciamento OSS / source-available / closed (R = OSS AGPL)?
- **D15:** monetização hosted? (item 6 — ou não monetizar "ainda")
- **D16:** "Primeiro paying customer" — quem é? (esta é VARIÁVEL mais
  importante — toda rota pendura daqui)

Se responder D16 em specifics ("Conheço Y time fintech", "Startup Z
pedindo"), decisão técnica path muda.

---

## 10. Por que escrevi este doc agora se é adiativo?

Porque evitar decisões D13/D14 até tarde demais é o que sufoca projeto em
refactor surpresa meio da Fase 3. Documentar explicitamente "esta
decisão existe, aqui está minha recomendacão R, decida depois de Y"
protege sua execução de flippers. Ponytail em trabalho especulativo é
preguiça certa — mas ponytail em **explicit marca de pendencias** é
disciplina.

Isto é tudo documento. Nao há código em Fase 5' — só um mapa de
decisões futuras.
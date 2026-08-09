/**
 * cell.ts — a forma canônica de uma chave de célula, e NADA mais.
 *
 * Módulo FOLHA de propósito: zero imports. `canonicalCell` nasceu em `gates.ts` (política), mas
 * `db.ts` (baixo nível) passou a precisar dela para migrar linhas legadas de `locks`/`authority` no
 * boot. `db.ts -> gates.ts` seria import "para cima" e reabriria a porta do ciclo que já custou caro
 * nesta base: `state.ts -> tools/session.ts -> state.ts` com import de VALOR não deu erro legível, deu
 * SEGFAULT do Bun (ver tokens.ts). A chave de célula é vocabulário compartilhado entre a camada de
 * política e a de persistência; vocabulário compartilhado mora numa folha.
 *
 * `gates.ts` reexporta este símbolo — todo import existente de `canonicalCell` a partir de `./gates`
 * continua válido, e continua havendo UMA implementação.
 */

/**
 * Forma canônica de uma chave de célula: `domain:<nível numérico>`. `auth:P4` e `auth:4` são a MESMA
 * célula e têm que virar a mesma string antes de qualquer comparação, lookup ou escrita.
 *
 * Causa raiz de F1/F7 (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md): a ausência de uma
 * canonicalização única aplicada nas BORDAS produziu o gate de autoridade aprovando sem cobertura (F1)
 * e a trava pessimista adquirível duas vezes para a mesma célula sob grafias diferentes (F7). Havia
 * três implementações paralelas da mesma comparação, cada uma com uma convenção. Quem receber chave de
 * célula de fora — tool, URI de recurso ou linha do banco — passa por aqui primeiro. Não escreva uma
 * quarta cópia.
 */
export const canonicalCell = (cell: string): string => {
  const cut = cell.lastIndexOf(":")
  return cut < 0 ? cell : `${cell.slice(0, cut)}:${cell.slice(cut + 1).replace(/^P/, "")}`
}

/**
 * typing.ts — Fase 3 §5: agregação de "digitando" por JANELA, não por keystroke.
 *
 *  - `changeset.claim` chama `touchDelta` a cada lance, atualizando `Presence.lastDeltaAt` de TODAS as
 *    presenças do user no tenant (claim só conhece userId via token, não a sessionId SSE — spec §5.1;
 *    na prática cada user tem uma Presence, mas nada impede múltiplas em teoria).
 *  - `sweepTyping` — scan periódico (default 500ms, ver sweeper.ts) que classifica cada Presence VISÍVEL
 *    (invisible não conta, spec §5): `now - lastDeltaAt < typingMs` → typing; `< idleMs` → idle; senão
 *    quiet. Broadcast `user.typing_state` (efêmero) SÓ na transição — nunca a cada tick (§5.1).
 *  - `forceQuiet` — chamado por presence.focus na transição visível→invisível: como sweepTyping pula
 *    invisíveis, um user que some ENQUANTO typing/idle congelaria o indicador nos observadores pra
 *    sempre. Emite UMA transição final → quiet antes de sumir.
 */
import { broadcastEphemeral, type Presence, type ServerState } from "../state"

const now = () => Date.now()

type TypingState = Presence["typingState"]

export function touchDelta(state: ServerState, tenant: string, userId: string): void {
  const t = now()
  for (const p of state.presence.values()) if (p.tenant === tenant && p.userId === userId) p.lastDeltaAt = t
}

function classify(state: ServerState, sinceMs: number): TypingState {
  if (sinceMs < state.typingMs) return "typing"
  if (sinceMs < state.idleMs) return "idle"
  return "quiet"
}

function transition(state: ServerState, p: Presence, next: TypingState): void {
  const prev = p.typingState
  p.typingState = next
  if (!p.focusCell) return // nada a rotear sem cell focada (§6.1: "observadores da cell que o user tem focus")
  broadcastEphemeral(state, p.tenant, {
    kind: "user.typing_state",
    targetKind: "cell",
    targetId: p.focusCell,
    byUser: p.userId,
    payload: { sessionId: p.sessionId, userId: p.userId, cell: p.focusCell, state: next, prev },
  })
}

export function sweepTyping(state: ServerState): void {
  const t = now()
  for (const p of state.presence.values()) {
    if (p.invisible) continue // spec §5: usuário invisível não emite typing_state
    const next = classify(state, t - p.lastDeltaAt)
    if (next !== p.typingState) transition(state, p, next) // só em TRANSIÇÃO — nunca a cada tick
  }
}

/** Transição final → quiet ao virar invisível (ver doc do módulo). No-op se já estava quiet. */
export function forceQuiet(state: ServerState, p: Presence): void {
  if (p.typingState !== "quiet") transition(state, p, "quiet")
}

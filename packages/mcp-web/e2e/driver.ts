// Helpers de spec UI-1: turnos dirigidos pela API autenticada (token nos args,
// transport.ts) em vez do modal de turno — que só nasce em UI-2. O token de um
// user WEB vem do localStorage da própria página (token-store.ts), então locks/
// claims/commits saem em nome do MESMO user que os avatares/roster mostram.
import type { Page } from "@playwright/test"
import type { Harness } from "./fixture"

export function webToken(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem("og.token")!) as Promise<string>
}

export function webUserId(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem("og.userId")!) as Promise<string>
}

/** Operações de changeset em nome do dono do token. */
export function turns(h: Harness, token: string) {
  return {
    open: (cells: string[], intent: string): Promise<any> => h.callTool("changeset.open", { token, cells, intent }),
    claim: (csId: string, delta: unknown): Promise<any> => h.callTool("changeset.claim", { token, csId, delta }),
    commit: (csId: string, intent: string): Promise<any> => h.callTool("changeset.commit", { token, csId, intent }),
    abort: (csId: string): Promise<any> => h.callTool("changeset.abort", { token, csId }),
  }
}

/**
 * F1 — gatilho de UI da transição LEITURA → EDIÇÃO: clica o `.og-card` do nó (abre #panel via
 * NodePanel) e depois `#edit-node` (dispara `node.edit`, abre/reusa o turno da célula do nó). Não
 * espera `#draft` aparecer — chamadores que testam contenção precisam observar o estado ANTES disso.
 */
export async function enterEdit(page: Page, nodeId: string): Promise<void> {
  await page.locator(`.og-card[data-id="${nodeId}"]`).click()
  await page.locator("#panel").waitFor({ state: "visible" })
  await page.locator("#edit-node").click()
}

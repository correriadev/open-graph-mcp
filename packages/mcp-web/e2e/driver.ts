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
    commit: (csId: string): Promise<any> => h.callTool("changeset.commit", { token, csId }),
    abort: (csId: string): Promise<any> => h.callTool("changeset.abort", { token, csId }),
  }
}

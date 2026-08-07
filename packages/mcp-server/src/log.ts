/**
 * log.ts — log estruturado JSONL em arquivo, para um beta local: o testador roda o servidor na
 * própria máquina e devolve o arquivo junto do feedback ("travou" sem isto é uma alegação sem
 * evidência). JSONL porque é o idioma da casa (db.ts `mirror` já espelha o estado durável assim) e
 * porque é grepável/parseável sem ferramenta.
 *
 * PRIVACIDADE — requisito duro, não detalhe. Este arquivo sai de uma máquina de terceiro. NUNCA
 * escreva aqui: `token` (nem truncado), conteúdo de claim (`subject`/`anchor`), conteúdo de arquivo,
 * caminho absoluto do repo do usuário, ou os `arguments` crus de uma tool call. Os call sites em
 * index.ts passam só nome de tool/URI (URI sem query string) + tenant (`tenantId`, já opaco) +
 * duração + ok/erro + mensagem de erro — nunca o payload inteiro. Ver o comentário em `toolCall`
 * abaixo para o que "mensagem de erro" cobre e não cobre.
 *
 * Rotação: sem lib externa. Antes de cada escrita, se o arquivo já passou de `maxBytes`, ele vira
 * `.1` (sobrescrevendo o `.1` anterior) e a escrita segue num arquivo novo — um beta roda por dias,
 * um `server.log` sem teto cresceria sem parar.
 *
 * Nunca derruba uma requisição: toda escrita está em try/catch — falha de disco (cheio, permissão)
 * vira log perdido, não erro 500.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import path from "node:path"

export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024 // 10MB por arquivo antes de rotacionar p/ .1

export type ErrorInfo = { message: string; stack?: string }

export type BootInfo = {
  port: number
  host: string
  stateDir: string
  version: string
  tenantsHydrated: number
}

export type CallInfo = {
  /** Nome da tool (`tools/call`) ou URI SEM query string (`resources/read`) — nunca os `arguments`/
   *  `params` crus, que podem carregar token, subject, anchor etc. */
  target: string
  /** `tenantId` (já opaco, não é PII) — `null` quando o token não resolve a nenhum tenant conhecido. */
  tenant: string | null
  durationMs: number
  ok: boolean
  /** Só a MENSAGEM do erro (e stack quando a origem for um throw não-capturado antes de chegar em
   *  transport.ts — ver o comentário grande em index.ts sobre por que tools/call normalmente só tem
   *  mensagem). A mensagem de erro de uma tool pode, em teoria, ecoar um argumento inválido que o
   *  chamador mandou (ex. "invalid or expired token" nunca inclui o token em si — as mensagens deste
   *  código-base são todas fixas/estruturais, não interpolam payload do usuário). */
  error?: ErrorInfo
}

export type Logger = {
  boot(info: BootInfo): void
  toolCall(info: CallInfo): void
  resourceRead(info: CallInfo): void
  fetchError(info: { path: string; error: ErrorInfo }): void
  shutdown(): void
}

/** Logger no-op — usado quando logging está desligado (default em teste, ver StartOptions.log). */
export const noopLogger: Logger = {
  boot() {},
  toolCall() {},
  resourceRead() {},
  fetchError() {},
  shutdown() {},
}

export function createLogger(file: string, maxBytes = DEFAULT_LOG_MAX_BYTES): Logger {
  function rotateIfNeeded(): void {
    if (!existsSync(file)) return
    const size = statSync(file).size
    if (size < maxBytes) return
    const rotated = `${file}.1`
    renameSync(file, rotated) // sobrescreve o .1 anterior (rename substitui destino existente)
  }

  function write(line: Record<string, unknown>): void {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      rotateIfNeeded()
      appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...line }) + "\n")
    } catch {
      /* uma falha de escrita de log nunca derruba a requisição que a gerou */
    }
  }

  return {
    boot(info) {
      write({ event: "boot", ...info })
    },
    toolCall(info) {
      write({ event: "tools/call", tool: info.target, tenant: info.tenant, durationMs: info.durationMs, ok: info.ok, error: info.error })
    },
    resourceRead(info) {
      write({ event: "resources/read", uri: info.target, tenant: info.tenant, durationMs: info.durationMs, ok: info.ok, error: info.error })
    },
    fetchError(info) {
      write({ event: "fetch_error", ...info })
    },
    shutdown() {
      write({ event: "shutdown" })
    },
  }
}

/** URI sem query string — `resources/read` URIs podem carregar `?id=`/`?cell=` que são identificadores
 *  de grafo (não PII), mas descartar a query inteira é a escolha conservadora: mais simples que manter
 *  uma allowlist de quais query params são "seguros" e ela nunca fica desatualizada. */
export function stripUriQuery(uri: string): string {
  const i = uri.indexOf("?")
  return i === -1 ? uri : uri.slice(0, i)
}

/** Extrai `{ message, stack }` de um valor de erro desconhecido (o `catch` de `fetch` não sabe o tipo). */
export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof Error) return { message: err.message, stack: err.stack }
  return { message: String(err) }
}

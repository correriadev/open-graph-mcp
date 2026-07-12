/**
 * layout.ts — posicionamento espacial determinístico do grafo, para o explorer renderizar
 * milhares de nós em latência interativa (custo O(visível), nunca O(grafo)).
 *
 * Três responsabilidades puras, todas SEM LLM:
 *  1. seedLayout: posição (x, y) por nó, função pura do grafo — mesmo grafo → mesmas posições.
 *     y é uma função fixa de `level` (P1..P5 → banda horizontal). x é um hash estável do id
 *     do nó, mapeado numa banda vertical do domínio (domínios ordenados alfabeticamente, cada
 *     um uma banda; dentro da banda o nó se espalha pelo hash do próprio id). Nada de Math.random,
 *     nada de índice de inserção — só (id, domain, level), então reordenar `graph.nodes` ou
 *     adicionar um nó novo NÃO desloca os nós existentes (memória espacial preservada).
 *  2. load/saveLayout: persistência em `.graph/layout.json`, um arquivo TOTALMENTE separado de
 *     `.graph/graph.json` (INV-H3-1 — layout/visual state e semantic state em stores disjuntos;
 *     esta função NUNCA toca graph.json).
 *  3. lodForZoom: thresholds fixos de câmera → nível de detalhe semântico (tower/floor/node).
 *     Determinístico, sem re-resolver nada ao dar zoom.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import type { Graph } from "./build"
import type { Level } from "./classify"

export type Point = { x: number; y: number }
export type LayoutPositions = Map<string, Point>

/** Ordem fixa das bandas horizontais (torre): P1 no topo, P5 embaixo. */
const LEVEL_ORDER: readonly Level[] = ["P1", "P2", "P3", "P4", "P5"]
const LEVEL_BAND_HEIGHT = 200 // px por banda de nível

/** Largura de cada banda de domínio (torre vertical) e padding interno do slab do nó. */
const DOMAIN_BAND_WIDTH = 400
const NODE_SLAB_PADDING = 4 // px — tolerância de estabilidade entre runs

/** Hash estável (FNV-1a de 32 bits) — determinístico entre processos/plataformas, sem libs. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Fração determinística em [0, 1) derivada do hash estável de uma string. */
function unitFraction(s: string): number {
  return stableHash(s) / 0x100000000
}

/**
 * y fixo por nível — banda horizontal. Level desconhecido cai numa banda extra ao final,
 * mantendo determinismo (nunca lança).
 */
function bandForLevel(level: Level | string): number {
  const idx = LEVEL_ORDER.indexOf(level as Level)
  return idx >= 0 ? idx : LEVEL_ORDER.length
}

export function yForLevel(level: Level | string): number {
  return bandForLevel(level) * LEVEL_BAND_HEIGHT + LEVEL_BAND_HEIGHT / 2
}

/**
 * x = banda do domínio (domínios em ordem alfabética, cada um um slab de largura fixa) +
 * posição do nó dentro do slab, pelo hash do próprio id. Domínio null/(unassigned) vai na
 * última banda.
 */
export function xForNode(id: string, domain: string | null, sortedDomains: readonly string[]): number {
  const domainIdx = domain === null ? sortedDomains.length : sortedDomains.indexOf(domain)
  const bandIdx = domainIdx >= 0 ? domainIdx : sortedDomains.length
  const bandStart = bandIdx * DOMAIN_BAND_WIDTH
  const withinBand = unitFraction(id) * (DOMAIN_BAND_WIDTH - 2 * NODE_SLAB_PADDING)
  return bandStart + NODE_SLAB_PADDING + withinBand
}

/**
 * seedLayout — posição determinística por nó. Pura função de (id, domain, level) de cada nó;
 * NÃO depende da ordem de `graph.nodes` nem de qualquer estado externo. Domínios são coletados
 * e ordenados alfabeticamente para formar as bandas verticais, então adicionar/remover nós de
 * OUTROS domínios não desloca as bandas dos domínios já existentes (a ordenação alfabética é
 * estável em relação a inserções que não mudem a posição relativa dos nomes já presentes).
 */
export function seedLayout(graph: Pick<Graph, "nodes">): LayoutPositions {
  const domainSet = new Set<string>()
  for (const n of graph.nodes) {
    if (n.domain !== null) domainSet.add(n.domain)
  }
  const sortedDomains = [...domainSet].sort()

  const positions: LayoutPositions = new Map()
  for (const n of graph.nodes) {
    positions.set(n.id, {
      x: xForNode(n.id, n.domain, sortedDomains),
      y: yForLevel(n.level),
    })
  }
  return positions
}

// ---------------------------------------------------------------------------------------------
// Persistência — `.graph/layout.json`, disjunto de `.graph/graph.json` (INV-H3-1).
// ---------------------------------------------------------------------------------------------

export type LayoutFile = {
  schemaVersion: 1
  positions: Record<string, Point>
}

function layoutFilePath(root: string): string {
  return path.join(root, ".graph", "layout.json")
}

/** Lê `.graph/layout.json`. Ausente ou inválido → Map vazio (caller decide se re-semeia). */
export function loadLayout(root: string): LayoutPositions {
  const file = layoutFilePath(root)
  if (!existsSync(file)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as LayoutFile
    const positions: LayoutPositions = new Map()
    if (parsed && typeof parsed === "object" && parsed.positions) {
      for (const [id, p] of Object.entries(parsed.positions)) {
        if (p && typeof p.x === "number" && typeof p.y === "number") positions.set(id, { x: p.x, y: p.y })
      }
    }
    return positions
  } catch {
    return new Map()
  }
}

/**
 * Escreve SOMENTE `.graph/layout.json`. Nunca cria, lê ou escreve `.graph/graph.json` — o
 * store semântico (graph.json) permanece puro (INV-H3-1).
 */
export function saveLayout(root: string, positions: LayoutPositions): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = layoutFilePath(root)
  const record: Record<string, Point> = {}
  for (const [id, p] of positions) record[id] = p
  const payload: LayoutFile = { schemaVersion: 1, positions: record }
  writeFileSync(file, JSON.stringify(payload, null, 2))
  return file
}

// ---------------------------------------------------------------------------------------------
// LOD — thresholds fixos de câmera. Documentados aqui para que zoom nunca dispare re-solve.
// ---------------------------------------------------------------------------------------------

export type Lod = "tower" | "floor" | "node"

/** zoom < TOWER_MAX → visão de torre (agregado por domínio). Zoom é "unidades de mundo por px". */
export const LOD_TOWER_MAX_ZOOM = 0.35
/** TOWER_MAX <= zoom < FLOOR_MAX → visão de andar (agregado por nível dentro do domínio). */
export const LOD_FLOOR_MAX_ZOOM = 1.2
/** zoom >= FLOOR_MAX → visão de nó individual (símbolo). */

export function lodForZoom(zoom: number): Lod {
  if (zoom < LOD_TOWER_MAX_ZOOM) return "tower"
  if (zoom < LOD_FLOOR_MAX_ZOOM) return "floor"
  return "node"
}

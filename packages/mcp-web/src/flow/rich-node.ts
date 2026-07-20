export type SemanticLod = "node" | "floor" | "tower"
export type NodeVisualState = "published" | "review" | "draft" | "drift" | "suspended"

export function effectiveLod(globalLod: SemanticLod, selected: boolean): SemanticLod {
  return selected ? "node" : globalLod
}

export function resolveVisualState(input: { authority?: string; drift?: string; locked?: boolean; ghost?: boolean; draft?: boolean }) {
  const markers: NodeVisualState[] = []
  if (input.authority === "suspended") markers.push("suspended")
  if (input.drift) markers.push("drift")
  if (input.locked || input.ghost) markers.push("review")
  if (input.draft) markers.push("draft")
  const state = markers[0] ?? "published"
  return { state, markers: markers.length ? markers : ["published" as const] }
}

export function domainColor(domain: string | null | undefined): string {
  if (!domain) return "hsl(220 8% 55%)"
  let hash = 0
  for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 62% 55%)`
}

export function markdownSource(node: { responsibility?: string; anchor?: string }): string {
  return node.responsibility?.trim() || node.anchor?.trim() || "Sem descrição."
}

export function resolveHolderName(holder: string, roster: readonly { userId: string; name: string }[]): string {
  return roster.find((user) => user.userId === holder)?.name || "participante"
}

export function aggregateCell(input: { claims: readonly string[]; users: readonly { userId: string; name: string }[] }) {
  return {
    claimCount: new Set(input.claims).size,
    users: [...new Map(input.users.map((user) => [user.userId, user])).values()],
  }
}

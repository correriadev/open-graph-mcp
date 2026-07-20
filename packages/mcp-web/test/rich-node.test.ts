import { expect, test } from "bun:test"
import { aggregateCell, domainColor, effectiveLod, markdownSource, resolveHolderName, resolveVisualState } from "../src/flow/rich-node"

test("visual state preserves suspended and drift precedence", () => {
  const resolved = resolveVisualState({ authority: "suspended", drift: "high", locked: true })
  expect(resolved.state).toBe("suspended")
  expect(resolved.markers).toEqual(["suspended", "drift", "review"])
})

test("cell aggregation deduplicates claims and roster while unknown holders stay neutral", () => {
  const user = { userId: "secret-id", name: "Alice" }
  const aggregated = aggregateCell({ claims: ["c1", "c1", "c2"], users: [user, user] })
  expect(aggregated.claimCount).toBe(2)
  expect(aggregated.users).toEqual([user])
  expect(resolveHolderName("secret-id", [user])).toBe("Alice")
  expect(resolveHolderName("unknown-raw-id", [])).toBe("participante")
})

test("domain palette is stable with explicit fallback", () => {
  expect(domainColor("auth")).toBe(domainColor("auth"))
  expect(domainColor(null)).toBe("hsl(220 8% 55%)")
})

test("selected nodes pin to full card and markdown has a neutral fallback", () => {
  expect(effectiveLod("tower", true)).toBe("node")
  expect(effectiveLod("tower", false)).toBe("tower")
  expect(markdownSource({})).toBe("Sem descrição.")
})

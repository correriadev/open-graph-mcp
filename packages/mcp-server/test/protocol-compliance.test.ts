import { expect, test } from "bun:test"
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"
import { createState } from "../src/state"
import { handleRpc } from "../src/transport"

function freshState() {
  return createState({ stateDir: ":memory:" })
}

test("initialize echoes back a client protocolVersion the server supports", () => {
  const state = freshState()
  try {
    const wanted = SUPPORTED_PROTOCOL_VERSIONS[1] ?? LATEST_PROTOCOL_VERSION
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: wanted } })
    expect(res?.result).toMatchObject({ protocolVersion: wanted })
  } finally {
    state.db.close()
  }
})

test("initialize falls back to LATEST_PROTOCOL_VERSION for an unsupported protocolVersion", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })
    expect(res?.result).toMatchObject({ protocolVersion: LATEST_PROTOCOL_VERSION })
  } finally {
    state.db.close()
  }
})

test("initialize falls back to LATEST_PROTOCOL_VERSION when protocolVersion is omitted", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    expect(res?.result).toMatchObject({ protocolVersion: LATEST_PROTOCOL_VERSION })
  } finally {
    state.db.close()
  }
})

test("notifications/initialized round-trips as a no-op notification (no id, no response, no throw)", () => {
  const state = freshState()
  try {
    const res = handleRpc(state, { jsonrpc: "2.0", method: "notifications/initialized" })
    expect(res).toBeNull()
  } finally {
    state.db.close()
  }
})

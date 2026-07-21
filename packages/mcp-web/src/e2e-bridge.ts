export type BridgeViewport = { x: number; y: number; zoom: number }

export type E2EBridgeDependencies = {
  setFocus: (cell: string | null) => void
  pushToast: (key: string, text: string) => void
  pollWho: () => void | Promise<void>
  getViewport: () => BridgeViewport
  setViewport: (viewport: BridgeViewport) => void | Promise<unknown>
  focusNode: (id: string, zoom: number) => void
  setNodeResponsibility: (id: string, responsibility: string) => void
  setNodeDrift: (id: string, grade: string) => void
  setCellAuthority: (cell: string, authority: "source" | "graph" | "suspended") => void
}

export type E2EBridge = E2EBridgeDependencies & { zoomTo: (zoom: number) => void }
export type E2EBridgeTarget = { __og_e2e?: E2EBridge }

export function installE2EBridge(target: E2EBridgeTarget, dependencies: E2EBridgeDependencies): () => void {
  const bridge: E2EBridge = {
    ...dependencies,
    zoomTo: (zoom) => dependencies.setViewport({ ...dependencies.getViewport(), zoom }),
  }
  target.__og_e2e = bridge
  return () => {
    if (target.__og_e2e === bridge) delete target.__og_e2e
  }
}

export function createLatestRequest() {
  let sequence = 0
  return {
    next: () => ++sequence,
    isLatest: (candidate: number) => candidate === sequence,
  }
}

export class ConnectionOwner {
  private generation = 0
  replace(): number { return ++this.generation }
  isCurrent(owner: number): boolean { return owner === this.generation }
  ifCurrent(owner: number, action: () => void): boolean {
    if (!this.isCurrent(owner)) return false
    action()
    return true
  }
}

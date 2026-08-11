/**
 * packages/graph-core/src/eap/budget.ts
 * Budget Ledger aggregate for Horizon governance.
 */

export class BudgetLedger {
  public readonly limit: number
  private consumed: number

  constructor(limit: number, consumed: number = 0) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error("Budget limit must be a non-negative integer")
    }
    if (!Number.isInteger(consumed) || consumed < 0) {
      throw new Error("Budget consumed must be a non-negative integer")
    }
    this.limit = limit
    this.consumed = consumed
  }

  public getConsumed(): number {
    return this.consumed
  }

  public isExhausted(): boolean {
    return this.consumed >= this.limit
  }

  public consume(amount: number): boolean {
    if (amount <= 0) return true
    if (this.consumed + amount > this.limit) {
      return false
    }
    this.consumed += amount
    return true
  }

  public snapshot() {
    return {
      limit: this.limit,
      consumed: this.consumed,
      isExhausted: this.isExhausted(),
    }
  }
}

export class SingleFlight<T> {
  private readonly requests = new Map<string, Promise<T>>()

  run(key: string, start: () => Promise<T>): Promise<T> {
    const current = this.requests.get(key)
    if (current) return current
    const request = start()
    this.requests.set(key, request)
    request.finally(() => {
      if (this.requests.get(key) === request) this.requests.delete(key)
    }).catch(() => {})
    return request
  }
}

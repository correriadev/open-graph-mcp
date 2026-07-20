import { expect, test } from "bun:test"
import { createLatestRequest } from "../src/latest-request"

test("out-of-order query responses only accept the latest request", async () => {
  const requests = createLatestRequest()
  const first = requests.next()
  const second = requests.next()
  const accepted: string[] = []
  await Promise.all([
    new Promise((resolve) => setTimeout(resolve, 10)).then(() => { if (requests.isLatest(first)) accepted.push("old") }),
    Promise.resolve().then(() => { if (requests.isLatest(second)) accepted.push("new") }),
  ])
  expect(accepted).toEqual(["new"])
})

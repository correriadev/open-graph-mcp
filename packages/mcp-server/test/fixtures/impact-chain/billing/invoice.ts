import { verify } from "../auth/verify"

export function invoice(user: string) {
  return verify(user, "***")
}

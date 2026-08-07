import { login } from "./login"

export function verify(user: string, password: string) {
  return login(user, password)
}

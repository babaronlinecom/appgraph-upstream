import { db } from "@acme/db";

export function start() {
  return db.ready;
}

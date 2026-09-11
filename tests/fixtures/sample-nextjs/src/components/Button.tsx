import type { ReactNode } from "react";

export default function Button({ children }: { children: ReactNode }) {
  return <button type="button">{children}</button>;
}

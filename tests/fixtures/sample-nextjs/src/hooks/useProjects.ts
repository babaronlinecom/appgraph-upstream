"use client";

import { useState } from "react";

export function useProjects() {
  const [selected, setSelected] = useState<string | null>(null);
  return { selected, select: setSelected };
}

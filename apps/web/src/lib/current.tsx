import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useRecalls } from "./hooks";

interface Ctx { id: string | null; setId: (id: string) => void }
const C = createContext<Ctx>({ id: null, setId: () => undefined });
const KEY = "bsrx.recall";

/** The recall being worked on: ?r= in the URL wins, then localStorage, then the first death notice. */
export function CurrentRecallProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const { data: recalls } = useRecalls();
  const [stored, setStored] = useState<string | null>(() => localStorage.getItem(KEY));
  const fromUrl = params.get("r");
  const valid = (id: string | null) => !!id && !!recalls?.some((r) => r.id === id);
  const id = valid(fromUrl) ? fromUrl : valid(stored) ? stored : recalls?.[0]?.id ?? null;

  const setId = useCallback((next: string) => {
    localStorage.setItem(KEY, next);
    setStored(next);
    const p = new URLSearchParams(params);
    p.set("r", next);
    setParams(p, { replace: true });
  }, [params, setParams]);

  useEffect(() => { if (id) localStorage.setItem(KEY, id); }, [id]);
  const value = useMemo(() => ({ id, setId }), [id, setId]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export const useCurrentRecall = () => useContext(C);

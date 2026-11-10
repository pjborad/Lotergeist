import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { get, type User } from "./lib/api";
import { Shell } from "./components/Shell";
import { SignIn } from "./screens/SignIn";
import { Today } from "./screens/Today";
import { Receiving } from "./screens/Receiving";
import { Inventory } from "./screens/Inventory";
import { Fill } from "./screens/Fill";
import { Recalls } from "./screens/Recalls";
import { Labels } from "./screens/Labels";
import { Outbox } from "./screens/Outbox";
import { Patients } from "./screens/Patients";
import { Integrations } from "./screens/Integrations";

export function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<{ user: User; today: string }>("/api/me"), retry: false });
  useEffect(() => {
    const h = () => void qc.invalidateQueries({ queryKey: ["me"] });
    window.addEventListener("lg:unauthenticated", h);
    return () => window.removeEventListener("lg:unauthenticated", h);
  }, [qc]);

  if (me.isLoading) return <div style={{ padding: 40 }} className="dim">Loading…</div>;
  if (me.isError || !me.data) return <SignIn />;
  const user = me.data.user;
  return (
    <Shell user={user}>
      <Routes>
        <Route path="/" element={user.role === "admin" ? <Navigate to="/integrations" replace /> : <Today user={user} />} />
        <Route path="/patients" element={<Patients user={user} />} />
        <Route path="/integrations" element={<Integrations user={user} />} />
        <Route path="/receiving" element={<Receiving user={user} />} />
        <Route path="/inventory" element={<Inventory user={user} />} />
        <Route path="/fill" element={<Fill user={user} />} />
        <Route path="/recalls" element={<Recalls user={user} />} />
        <Route path="/labels" element={<Labels />} />
        <Route path="/outbox" element={<Outbox />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

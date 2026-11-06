import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { AfterlifeView, DemoPackage, FillItem, FillScanResult, HearseView, PipelineEvent, RecallDetail, RecallSummary, TraceView } from "./types";

const BUSY = new Set(["confirmed", "tracing", "exhuming"]);

export const useRecalls = () => useQuery({ queryKey: ["recalls"], queryFn: () => api<RecallSummary[]>("/api/recalls"), refetchInterval: 4000 });

export const useRecall = (id: string | null) =>
  useQuery({
    queryKey: ["recall", id],
    enabled: !!id,
    queryFn: () => api<RecallDetail>(`/api/recalls/${encodeURIComponent(id!)}`),
    refetchInterval: (q) => (q.state.data && BUSY.has(q.state.data.status) ? 1200 : false)
  });

export const useTrace = (id: string | null, busy: boolean) =>
  useQuery({
    queryKey: ["trace", id],
    enabled: !!id,
    queryFn: () => api<TraceView>(`/api/recalls/${encodeURIComponent(id!)}/trace`),
    refetchInterval: busy ? 1500 : false
  });

export const useAfterlife = () => useQuery({ queryKey: ["afterlife"], queryFn: () => api<AfterlifeView>("/api/afterlife") });
export const useHearse = (avoid: boolean) => useQuery({ queryKey: ["hearse", avoid], queryFn: () => api<HearseView>(`/api/hearse?avoid=${avoid ? 1 : 0}`) });
export const useDemoPackages = () => useQuery({ queryKey: ["demo-packages"], queryFn: () => api<DemoPackage[]>("/api/demo/packages"), staleTime: 60_000 });

/** Subscribe to the recall's SSE stream (GET /api/recalls/:id/stream). */
export function useRecallStream(id: string | null, onEvent: (e: PipelineEvent) => void) {
  const qc = useQueryClient();
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`/api/recalls/${encodeURIComponent(id)}/stream`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (m) => {
      try { cb.current(JSON.parse(m.data) as PipelineEvent); } catch { /* ignore malformed */ }
      clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["recall", id] });
        void qc.invalidateQueries({ queryKey: ["trace", id] });
        void qc.invalidateQueries({ queryKey: ["recalls"] });
      }, 250);
    };
    return () => { clearTimeout(timer); es.close(); };
  }, [id, qc]);
}

export const useFills = () => useQuery({ queryKey: ["fills"], queryFn: () => api<FillItem[]>("/api/fills") });
export const useFillScans = () => useQuery({ queryKey: ["fill-scans"], queryFn: () => api<FillScanResult[]>("/api/fills/scans") });

/** Live events for the Soul Catcher: scans, write-back bot steps and write-back results. */
export function useFillStream(onEvent: (e: PipelineEvent) => void) {
  const qc = useQueryClient();
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const es = new EventSource("/api/fills/stream");
    es.onmessage = (m) => {
      try { cb.current(JSON.parse(m.data) as PipelineEvent); } catch { /* ignore */ }
      void qc.invalidateQueries({ queryKey: ["fills"] });
      void qc.invalidateQueries({ queryKey: ["fill-scans"] });
    };
    return () => es.close();
  }, [qc]);
}

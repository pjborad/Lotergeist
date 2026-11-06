import { EventEmitter } from "node:events";
import type { PipelineEvent, PipelineEventType } from "./types";

/** Typed in-process event bus. Keeps a per-recall history so late SSE subscribers can catch up. */
export class Bus {
  private ee = new EventEmitter();
  private history = new Map<string, PipelineEvent[]>();
  private seq = 0;
  constructor() { this.ee.setMaxListeners(200); }

  publish<T>(type: PipelineEventType, recallId: string, data: T): PipelineEvent<T> {
    const ev: PipelineEvent<T> = { id: ++this.seq, type, recallId, ts: Date.now(), data };
    const h = this.history.get(recallId) ?? [];
    h.push(ev);
    if (h.length > 2000) h.splice(0, h.length - 2000);
    this.history.set(recallId, h);
    this.ee.emit(`r:${recallId}`, ev);
    this.ee.emit("*", ev);
    return ev;
  }

  since(recallId: string, lastId = 0): PipelineEvent[] {
    return (this.history.get(recallId) ?? []).filter((e) => e.id > lastId);
  }

  subscribe(recallId: string, fn: (e: PipelineEvent) => void): () => void {
    this.ee.on(`r:${recallId}`, fn);
    return () => this.ee.off(`r:${recallId}`, fn);
  }

  onAny(fn: (e: PipelineEvent) => void): () => void {
    this.ee.on("*", fn);
    return () => this.ee.off("*", fn);
  }

  reset() {
    this.history.clear();
  }
}

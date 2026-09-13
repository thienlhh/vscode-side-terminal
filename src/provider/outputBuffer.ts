export interface OutputMessage {
  type: 'data';
  tabId: string;
  data: string;
  seq: number;
}

export interface OutputBufferOptions {
  /** Maximum number of UTF-16 code units queued for one tab. */
  maxQueuedBytes?: number;
  /** Maximum payload sent in one webview message. */
  maxBatchBytes?: number;
  /** Delay before starting a new batch, allowing nearby chunks to coalesce. */
  flushDelayMs?: number;
  /** High-water threshold that asks the PTY owner to pause. */
  highWaterBytes?: number;
  /** Low-water threshold that allows the PTY owner to resume. */
  lowWaterBytes?: number;
  /** Called when a tab crosses the high or low water mark. */
  onBackpressureChange?: (tabId: string, backpressured: boolean) => void;
}

interface PendingBatch {
  seq: number;
  data: string;
  bytes: number;
}

interface TabBuffer {
  queue: Array<{ data: string; marker: boolean }>;
  queuedBytes: number;
  inFlight?: PendingBatch;
  droppedBytes: number;
  backpressured: boolean;
  transportFailed: boolean;
  markerQueued: boolean;
  pendingTruncation: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

type SendOutput = (message: OutputMessage) => void | boolean | Thenable<boolean>;

/**
 * Batches terminal output and allows only one unacknowledged batch per tab.
 * The caller should pause its producer while `onBackpressureChange` is true.
 * If the producer cannot pause, excess output is dropped at the bounded limit.
 */
export class OutputBuffer {
  private readonly buffers = new Map<string, TabBuffer>();
  private readonly maxQueuedBytes: number;
  private readonly maxBatchBytes: number;
  private readonly flushDelayMs: number;
  private readonly highWaterBytes: number;
  private readonly lowWaterBytes: number;
  private nextSeq = 1;
  private detached = false;
  private static readonly truncationMarker = '\r\n[output truncated while terminal was busy]\r\n';

  constructor(
    private readonly send: SendOutput,
    options: OutputBufferOptions = {}
  ) {
    this.maxQueuedBytes = Math.max(1, options.maxQueuedBytes ?? 256 * 1024);
    this.maxBatchBytes = Math.max(1, Math.min(options.maxBatchBytes ?? 32 * 1024, this.maxQueuedBytes));
    this.flushDelayMs = Math.max(0, options.flushDelayMs ?? 16);
    this.highWaterBytes = Math.max(1, Math.min(options.highWaterBytes ?? Math.floor(this.maxQueuedBytes / 2), this.maxQueuedBytes));
    this.lowWaterBytes = Math.max(0, Math.min(options.lowWaterBytes ?? Math.floor(this.highWaterBytes / 2), this.highWaterBytes));
    this.onBackpressureChange = options.onBackpressureChange;
  }

  private readonly onBackpressureChange?: OutputBufferOptions['onBackpressureChange'];

  append(tabId: string, data: string): void {
    if (!data) return;

    const buffer = this.buffers.get(tabId) ?? this.createBuffer(tabId);
    const capacity = Math.max(0, this.maxQueuedBytes - buffer.queuedBytes);
    const markerBytes = buffer.markerQueued || buffer.pendingTruncation ? 0 : OutputBuffer.truncationMarker.length;
    let available = data.length <= capacity
      ? capacity
      : Math.max(0, capacity - markerBytes);
    if (available > 0 && available < data.length && /[\uD800-\uDBFF]/.test(data[available - 1]) && /[\uDC00-\uDFFF]/.test(data[available])) {
      available--;
    }
    if (available > 0) {
      const accepted = data.slice(0, available);
      buffer.queue.push({ data: accepted, marker: false });
      buffer.queuedBytes += accepted.length;
    }
    if (data.length > available) {
      buffer.droppedBytes += data.length - Math.max(0, available);
      buffer.pendingTruncation = true;
    }

    this.queueTruncationMarker(buffer);
    this.updateBackpressure(tabId, buffer);
    this.schedule(tabId, buffer);
  }

  /** Sends a queued batch immediately; useful when the caller already has a frame boundary. */
  flush(tabId?: string): void {
    if (tabId) {
      const buffer = this.buffers.get(tabId);
      if (buffer) this.pump(tabId, buffer);
      return;
    }

    for (const [id, buffer] of this.buffers) {
      this.pump(id, buffer);
    }
  }

  ack(tabId: string, seq: number): string | undefined {
    const buffer = this.buffers.get(tabId);
    if (!buffer || buffer.inFlight?.seq !== seq) return;

    const parsed = buffer.inFlight.data;
    buffer.inFlight = undefined;
    this.pump(tabId, buffer);
    this.updateBackpressure(tabId, buffer);
    return parsed;
  }

  /** Retains unacknowledged data while the webview document is unavailable. */
  detach(): void {
    this.detached = true;
    for (const buffer of this.buffers.values()) {
      if (buffer.timer) clearTimeout(buffer.timer);
      buffer.timer = undefined;
      if (buffer.inFlight) {
        buffer.queue.unshift({ data: buffer.inFlight.data, marker: false });
        buffer.queuedBytes += buffer.inFlight.bytes;
        buffer.inFlight = undefined;
      }
    }
  }

  /** Call after the receiving document has restored its tabs. */
  attach(): void {
    this.detached = false;
    for (const tabId of this.buffers.keys()) this.resume(tabId);
  }

  /** Clears a failed webview transport and retries the retained batch once. */
  resume(tabId: string): void {
    const buffer = this.buffers.get(tabId);
    if (!buffer) return;
    buffer.transportFailed = false;
    this.pump(tabId, buffer);
  }

  isBackpressured(tabId: string): boolean {
    return this.buffers.get(tabId)?.backpressured ?? false;
  }

  getPendingBytes(tabId: string): number {
    const buffer = this.buffers.get(tabId);
    return (buffer?.queuedBytes ?? 0) + (buffer?.inFlight?.bytes ?? 0);
  }

  getDroppedBytes(tabId: string): number {
    return this.buffers.get(tabId)?.droppedBytes ?? 0;
  }

  remove(tabId: string): void {
    const buffer = this.buffers.get(tabId);
    if (buffer?.timer) clearTimeout(buffer.timer);
    this.buffers.delete(tabId);
  }

  dispose(): void {
    for (const buffer of this.buffers.values()) {
      if (buffer.timer) clearTimeout(buffer.timer);
    }
    this.buffers.clear();
  }

  private createBuffer(tabId: string): TabBuffer {
    const buffer: TabBuffer = {
      queue: [],
      queuedBytes: 0,
      droppedBytes: 0,
      backpressured: false,
      transportFailed: false,
      markerQueued: false,
      pendingTruncation: false
    };
    this.buffers.set(tabId, buffer);
    return buffer;
  }

  private schedule(tabId: string, buffer: TabBuffer): void {
    if (buffer.timer || buffer.inFlight || buffer.queue.length === 0) return;
    buffer.timer = setTimeout(() => {
      buffer.timer = undefined;
      this.pump(tabId, buffer);
    }, this.flushDelayMs);
  }

  private pump(tabId: string, buffer: TabBuffer): void {
    if (this.detached || buffer.inFlight || buffer.transportFailed) return;

    this.queueTruncationMarker(buffer);
    if (buffer.queue.length === 0) return;

    let data = '';
    while (buffer.queue.length > 0 && data.length < this.maxBatchBytes) {
      const { data: chunk, marker } = buffer.queue[0];
      const room = this.maxBatchBytes - data.length;
      if (chunk.length <= room) {
        data += chunk;
        buffer.queue.shift();
        buffer.queuedBytes -= chunk.length;
        if (marker) buffer.markerQueued = false;
      } else {
        let sliceLen = room;
        if (sliceLen > 0 && sliceLen < chunk.length && /[\uD800-\uDBFF]/.test(chunk[sliceLen - 1]) && /[\uDC00-\uDFFF]/.test(chunk[sliceLen])) {
          sliceLen--;
        }
        if (sliceLen === 0) break;
        data += chunk.slice(0, sliceLen);
        buffer.queue[0].data = chunk.slice(sliceLen);
        buffer.queuedBytes -= sliceLen;
      }
    }

    const inFlight: PendingBatch = {
      seq: this.nextSeq++,
      data,
      bytes: data.length
    };
    buffer.inFlight = inFlight;
    this.updateBackpressure(tabId, buffer);

    const message: OutputMessage = {
      type: 'data',
      tabId,
      data: inFlight.data,
      seq: inFlight.seq
    };
    try {
      const result = this.send(message);
      if (result === false) {
        this.failSend(tabId, buffer, inFlight);
      } else if (result && typeof (result as PromiseLike<boolean>).then === 'function') {
        void Promise.resolve(result).then((sent) => {
          if (sent === false) this.failSend(tabId, buffer, inFlight);
        }, () => this.failSend(tabId, buffer, inFlight));
      }
    } catch {
      this.failSend(tabId, buffer, inFlight);
    }
  }

  private updateBackpressure(tabId: string, buffer: TabBuffer): void {
    const pending = buffer.queuedBytes + (buffer.inFlight?.bytes ?? 0);
    const next = buffer.backpressured
      ? pending > this.lowWaterBytes
      : pending >= this.highWaterBytes;
    if (next === buffer.backpressured) return;
    buffer.backpressured = next;
    this.onBackpressureChange?.(tabId, next);
  }

  private failSend(tabId: string, buffer: TabBuffer, batch: PendingBatch): void {
    if (this.buffers.get(tabId) !== buffer || buffer.inFlight?.seq !== batch.seq) return;
    buffer.inFlight = undefined;
    buffer.queue.unshift({ data: batch.data, marker: false });
    buffer.queuedBytes += batch.bytes;
    buffer.transportFailed = true;
    this.updateBackpressure(tabId, buffer);
  }

  private queueTruncationMarker(buffer: TabBuffer): void {
    if (!buffer.pendingTruncation || buffer.markerQueued) return;
    if (buffer.queuedBytes + OutputBuffer.truncationMarker.length > this.maxQueuedBytes) return;
    buffer.queue.push({ data: OutputBuffer.truncationMarker, marker: true });
    buffer.queuedBytes += OutputBuffer.truncationMarker.length;
    buffer.markerQueued = true;
    buffer.pendingTruncation = false;
  }
}

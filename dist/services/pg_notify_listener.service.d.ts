/**
 * PgNotifyListener — Production-grade PostgreSQL LISTEN/NOTIFY listener.
 *
 * Replaces setInterval polling with instant push-based event delivery.
 * Maintains a dedicated persistent pg connection per channel with:
 *   - Automatic reconnection with exponential backoff on connection loss
 *   - Structured JSON payload parsing from trigger notifications
 *   - Graceful shutdown support via SIGTERM/SIGINT
 *
 * Each worker creates one listener per channel it subscribes to.
 */
export interface NotifyPayload {
    id: string;
    user_id: string;
    event_type: string;
}
type NotifyHandler = (payload: NotifyPayload) => Promise<void>;
export declare class PgNotifyListener {
    private client;
    private channel;
    private handler;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private isShuttingDown;
    private reconnectTimer;
    constructor(channel: string, handler: NotifyHandler);
    start(): Promise<void>;
    private connect;
    private scheduleReconnect;
    stop(): Promise<void>;
    private registerShutdownHooks;
}
export {};
//# sourceMappingURL=pg_notify_listener.service.d.ts.map
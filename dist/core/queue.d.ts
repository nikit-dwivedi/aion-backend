export interface QueueMessage {
    id: string;
    userId: string;
    eventType: string;
}
export type QueueHandler = (msg: QueueMessage) => Promise<void>;
export interface QueueProvider {
    subscribe(channel: string, handler: QueueHandler): Promise<void>;
    publish(channel: string, message: QueueMessage): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    stop(): Promise<void>;
}
export declare class PostgresQueueProvider implements QueueProvider {
    private clients;
    private handlers;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private isShuttingDown;
    subscribe(channel: string, handler: QueueHandler): Promise<void>;
    private connectAndListen;
    private scheduleReconnect;
    publish(channel: string, message: QueueMessage): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    stop(): Promise<void>;
}
export declare const queueProvider: QueueProvider;
//# sourceMappingURL=queue.d.ts.map
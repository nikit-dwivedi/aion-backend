import { Client } from 'pg';
import { env } from '../config/env.js';
export class PgNotifyListener {
    client = null;
    channel;
    handler;
    reconnectAttempts = 0;
    maxReconnectAttempts = 20;
    isShuttingDown = false;
    reconnectTimer = null;
    constructor(channel, handler) {
        this.channel = channel;
        this.handler = handler;
    }
    async start() {
        await this.connect();
        this.registerShutdownHooks();
        console.log(`[PgNotify] Listening on channel: ${this.channel}`);
    }
    async connect() {
        try {
            this.client = new Client({
                connectionString: env.DATABASE_URL,
                // Keep-alive to detect dead connections through firewalls/load balancers
                keepAlive: true,
                keepAliveInitialDelayMillis: 10000,
            });
            this.client.on('error', (err) => {
                console.error(`[PgNotify][${this.channel}] Connection error:`, err.message);
                this.scheduleReconnect();
            });
            this.client.on('end', () => {
                if (!this.isShuttingDown) {
                    console.warn(`[PgNotify][${this.channel}] Connection ended unexpectedly. Reconnecting...`);
                    this.scheduleReconnect();
                }
            });
            this.client.on('notification', async (msg) => {
                if (msg.channel === this.channel && msg.payload) {
                    try {
                        const payload = JSON.parse(msg.payload);
                        console.log(`[PgNotify][${this.channel}] Received event: ${payload.id}`);
                        await this.handler(payload);
                    }
                    catch (err) {
                        console.error(`[PgNotify][${this.channel}] Handler error for payload:`, err.message);
                    }
                }
            });
            await this.client.connect();
            await this.client.query(`LISTEN ${this.channel}`);
            // Reset reconnect counter on successful connection
            this.reconnectAttempts = 0;
            console.log(`[PgNotify][${this.channel}] Connected and listening.`);
        }
        catch (err) {
            console.error(`[PgNotify][${this.channel}] Failed to connect:`, err.message);
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        if (this.isShuttingDown)
            return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`[PgNotify][${this.channel}] Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            return;
        }
        // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
        const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        console.log(`[PgNotify][${this.channel}] Reconnecting in ${delayMs / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(async () => {
            // Destroy old client safely
            try {
                await this.client?.end();
            }
            catch { /* ignore */ }
            this.client = null;
            await this.connect();
        }, delayMs);
    }
    async stop() {
        this.isShuttingDown = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        try {
            if (this.client) {
                await this.client.query(`UNLISTEN ${this.channel}`);
                await this.client.end();
            }
        }
        catch { /* ignore cleanup errors */ }
        console.log(`[PgNotify][${this.channel}] Stopped.`);
    }
    registerShutdownHooks() {
        const shutdown = () => {
            this.stop().catch(() => { });
        };
        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
    }
}
//# sourceMappingURL=pg_notify_listener.service.js.map
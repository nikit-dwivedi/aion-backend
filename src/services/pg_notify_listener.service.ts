import { Client } from 'pg';
import { env } from '../config/env.js';

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

export class PgNotifyListener {
  private client: Client | null = null;
  private channel: string;
  private handler: NotifyHandler;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private isShuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(channel: string, handler: NotifyHandler) {
    this.channel = channel;
    this.handler = handler;
  }

  async start(): Promise<void> {
    await this.connect();
    this.registerShutdownHooks();
    console.log(`[PgNotify] Listening on channel: ${this.channel}`);
  }

  private async connect(): Promise<void> {
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
            const payload: NotifyPayload = JSON.parse(msg.payload);
            console.log(`[PgNotify][${this.channel}] Received event: ${payload.id}`);
            await this.handler(payload);
          } catch (err: any) {
            console.error(`[PgNotify][${this.channel}] Handler error for payload:`, err.message);
          }
        }
      });

      await this.client.connect();
      await this.client.query(`LISTEN ${this.channel}`);
      
      // Reset reconnect counter on successful connection
      this.reconnectAttempts = 0;
      console.log(`[PgNotify][${this.channel}] Connected and listening.`);
    } catch (err: any) {
      console.error(`[PgNotify][${this.channel}] Failed to connect:`, err.message);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[PgNotify][${this.channel}] Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[PgNotify][${this.channel}] Reconnecting in ${delayMs / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      // Destroy old client safely
      try { await this.client?.end(); } catch { /* ignore */ }
      this.client = null;
      await this.connect();
    }, delayMs);
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      if (this.client) {
        await this.client.query(`UNLISTEN ${this.channel}`);
        await this.client.end();
      }
    } catch { /* ignore cleanup errors */ }
    console.log(`[PgNotify][${this.channel}] Stopped.`);
  }

  private registerShutdownHooks(): void {
    const shutdown = () => {
      this.stop().catch(() => {});
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
}

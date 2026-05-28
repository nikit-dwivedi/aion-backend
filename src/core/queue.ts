import { Client } from 'pg';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

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

export class PostgresQueueProvider implements QueueProvider {
  private clients = new Map<string, Client>();
  private handlers = new Map<string, QueueHandler>();
  private reconnectAttempts = new Map<string, number>();
  private maxReconnectAttempts = 20;
  private isShuttingDown = false;

  async subscribe(channel: string, handler: QueueHandler): Promise<void> {
    if (this.clients.has(channel)) {
      console.warn(`[QueueProvider] Already subscribed to channel: ${channel}`);
      return;
    }

    this.handlers.set(channel, handler);
    this.reconnectAttempts.set(channel, 0);
    await this.connectAndListen(channel);
  }

  private async connectAndListen(channel: string): Promise<void> {
    const handler = this.handlers.get(channel);
    if (!handler) return;

    try {
      const client = new Client({
        connectionString: env.DATABASE_URL,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      client.on('error', (err) => {
        console.error(`[QueueProvider][${channel}] Connection error:`, err.message);
        this.scheduleReconnect(channel);
      });

      client.on('end', () => {
        if (!this.isShuttingDown) {
          console.warn(`[QueueProvider][${channel}] Connection ended unexpectedly. Reconnecting...`);
          this.scheduleReconnect(channel);
        }
      });

      client.on('notification', async (msg) => {
        if (msg.channel === channel && msg.payload) {
          try {
            const payload: QueueMessage = JSON.parse(msg.payload);
            console.log(`[QueueProvider][${channel}] Push notification received for event: ${payload.id}`);
            await handler(payload);
          } catch (err: any) {
            console.error(`[QueueProvider][${channel}] Error handling payload:`, err.message);
          }
        }
      });

      await client.connect();
      await client.query(`LISTEN ${channel}`);
      
      this.clients.set(channel, client);
      this.reconnectAttempts.set(channel, 0); // Reset on success
      console.log(`[QueueProvider][${channel}] Listening successfully.`);
    } catch (err: any) {
      console.error(`[QueueProvider][${channel}] Failed to connect:`, err.message);
      this.scheduleReconnect(channel);
    }
  }

  private scheduleReconnect(channel: string): void {
    if (this.isShuttingDown) return;
    const attempts = this.reconnectAttempts.get(channel) || 0;
    if (attempts >= this.maxReconnectAttempts) {
      console.error(`[QueueProvider][${channel}] Max reconnection attempts reached. Giving up.`);
      return;
    }

    const delayMs = Math.min(1000 * Math.pow(2, attempts), 30000);
    this.reconnectAttempts.set(channel, attempts + 1);

    console.log(`[QueueProvider][${channel}] Reconnecting in ${delayMs / 1000}s (attempt ${attempts + 1}/${this.maxReconnectAttempts})...`);

    setTimeout(async () => {
      const oldClient = this.clients.get(channel);
      if (oldClient) {
        try { await oldClient.end(); } catch { /* ignore */ }
        this.clients.delete(channel);
      }
      await this.connectAndListen(channel);
    }, delayMs);
  }

  async publish(channel: string, message: QueueMessage): Promise<void> {
    try {
      await db.execute(sql`SELECT pg_notify(${channel}, ${JSON.stringify(message)})`);
      console.log(`[QueueProvider] Published message to channel ${channel}`);
    } catch (err: any) {
      console.error(`[QueueProvider] Failed to publish message:`, err.message);
      throw err;
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    const client = this.clients.get(channel);
    if (client) {
      try {
        await client.query(`UNLISTEN ${channel}`);
        await client.end();
      } catch { /* ignore cleanup errors */ }
      this.clients.delete(channel);
    }
    this.handlers.delete(channel);
    this.reconnectAttempts.delete(channel);
    console.log(`[QueueProvider][${channel}] Unsubscribed.`);
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    const channels = Array.from(this.clients.keys());
    for (const channel of channels) {
      await this.unsubscribe(channel);
    }
  }
}

export const queueProvider: QueueProvider = new PostgresQueueProvider();

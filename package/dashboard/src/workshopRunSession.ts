import { DurableObject } from 'cloudflare:workers';
import type { Env } from './models/applicationSharedmodel';
import { runDetail } from './service/workshopRunInferenceService';

/** One live view per run. Progress notices are coalesced, then pushed to every open socket. */
export class WorkshopRunSession extends DurableObject<Env> {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/notify')) {
      await this.ctx.storage.put('dirty', 1);
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 120);
      return new Response(null, { status: 202 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.ctx.waitUntil(this.push());
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async alarm() {
    await this.ctx.storage.delete('dirty');
    await this.push();
    if (await this.ctx.storage.get('dirty')) await this.ctx.storage.setAlarm(Date.now() + 120);
  }

  async webSocketClose(socket: WebSocket) {
    socket.close();
  }

  private async push() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length || !this.ctx.id.name) return;
    let message: string;
    try {
      message = JSON.stringify(await runDetail(this.env, this.ctx.id.name));
    } catch (error) {
      message = JSON.stringify({ error: error instanceof Error ? error.message : 'Run update failed.' });
    }
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        /* A closing browser is ignored. */
      }
    }
  }
}

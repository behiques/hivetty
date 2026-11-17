import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { incomingFrame, RELAY_CLOSE, RELAY_PATH, RELAY_PING_MS, type RelayHost } from '@shared/relay-contract';

/** One message the relay passed between a joined pair. */
export interface RelayFrame {
  from: 'client' | 'server';
  binary: boolean;
  data: Buffer;
}

export interface StubRelay {
  /** Every message passed between a joined pair, in order. */
  frames: RelayFrame[];
  /** What `GET /relay/hosts` answers. */
  hosts(): RelayHost[];
  /** Ends every relay socket with no close frame, as a relay that died would. Answers how many. */
  cut(): number;
  close(): void;
}

interface RelayAuth {
  /** Whether the stub cloud issued this bearer and has not revoked its device. */
  authorised(token: string): boolean;
  /** The id a serving app is listed under. */
  serverId(): string;
}

interface Waiting {
  client: WebSocket;
  held: { data: Buffer; binary: boolean }[];
  /** The accept socket, once the serving app has dialled it. */
  peer: WebSocket | null;
}

const bytes = (raw: RawData): Buffer =>
  Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);

/** A code a peer app sent itself reaches the other side; anything else reads "the other side went away". */
const passed = (code: number): number =>
  code === 1000 ||
  (code >= 3000 && code <= 4999 && code !== RELAY_CLOSE.unauthorized && code !== RELAY_CLOSE.notEntitled)
    ? code
    : RELAY_CLOSE.goingAway;

/**
 * The cloud relay as the app dials it (HIVE-286), on the stub cloud's own server: the paths, control
 * frame, close codes and ping of `electron/shared/relay-contract.ts`.
 *
 * shortcut: no rate limit, accept timeout, entitlement check or size cap, and one device per stub;
 * upgrade when a spec needs a relay refusal the cloud e2e suite (HIVE-285) does not already prove.
 */
export function attachStubRelay(server: Server, auth: RelayAuth): StubRelay {
  const wss = new WebSocketServer({ noServer: true });
  const frames: RelayFrame[] = [];
  const waiting = new Map<string, Waiting>();
  let serve: { socket: WebSocket; since: string } | null = null;

  const pass = (from: RelayFrame['from'], to: WebSocket, data: Buffer, binary: boolean): void => {
    frames.push({ from, binary, data });
    // One message in, one message out: a Noise message is a WebSocket message.
    to.send(data, { binary });
  };

  const onServe = (socket: WebSocket): void => {
    serve?.socket.close(RELAY_CLOSE.replaced);
    const mine = { socket, since: new Date().toISOString() };
    serve = mine;
    socket.once('close', () => {
      if (serve !== mine) return;
      serve = null;
      for (const { client } of waiting.values()) client.close(RELAY_CLOSE.notFound);
      waiting.clear();
    });
  };

  const onAttach = (client: WebSocket, serverId: string): void => {
    if (serve === null || serverId !== auth.serverId()) {
      client.close(RELAY_CLOSE.notFound);
      return;
    }
    const conn = randomUUID();
    const entry: Waiting = { client, held: [], peer: null };
    waiting.set(conn, entry);
    // The app sends its hello as soon as the socket opens: held until the accept, then delivered in order.
    client.on('message', (raw, binary) => {
      if (entry.peer === null) entry.held.push({ data: bytes(raw), binary });
      else pass('client', entry.peer, bytes(raw), binary);
    });
    client.once('close', (code) => {
      waiting.delete(conn);
      entry.peer?.close(passed(code));
    });
    serve.socket.send(incomingFrame(conn));
  };

  const onAccept = (accepted: WebSocket, conn: string): void => {
    const entry = waiting.get(conn);
    if (entry === undefined) {
      accepted.close(RELAY_CLOSE.notFound);
      return;
    }
    waiting.delete(conn);
    entry.peer = accepted;
    for (const message of entry.held.splice(0)) pass('client', accepted, message.data, message.binary);
    accepted.on('message', (raw, binary) => pass('server', entry.client, bytes(raw), binary));
    accepted.once('close', (code) => entry.client.close(passed(code)));
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://stub').pathname;
    if (!path.startsWith('/relay/')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const [, , verb, id = ''] = path.split('/');
      if (!auth.authorised(token)) ws.close(RELAY_CLOSE.unauthorized);
      else if (path === RELAY_PATH.serve) onServe(ws);
      else if (verb === 'attach') onAttach(ws, id);
      else if (verb === 'accept') onAccept(ws, id);
      else ws.close(RELAY_CLOSE.notFound);
    });
  });

  // The app drops a serve socket that hears no ping for 60 seconds.
  const ping = setInterval(() => {
    for (const socket of wss.clients) if (socket.readyState === socket.OPEN) socket.ping();
  }, RELAY_PING_MS);
  ping.unref();

  const cut = (): number => {
    const count = wss.clients.size;
    for (const socket of wss.clients) socket.terminate();
    return count;
  };

  return {
    frames,
    hosts: () => (serve === null ? [] : [{ serverId: auth.serverId(), name: 'Test Mac', since: serve.since }]),
    cut,
    close: () => {
      clearInterval(ping);
      cut();
    },
  };
}

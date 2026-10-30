import { type IncomingMessage, request } from 'node:http';

export interface SseMessage {
  type: string;
  data: Record<string, unknown>;
}

export interface SseStream {
  status: number;
  messages: SseMessage[];
  /** Attend un message correspondant (déjà reçu ou à venir). */
  waitFor(predicate: (m: SseMessage) => boolean, timeoutMs?: number): Promise<SseMessage>;
  /** Vrai quand le serveur a fermé le flux. */
  closed(): boolean;
  waitClosed(timeoutMs?: number): Promise<void>;
  close(): void;
}

/**
 * Client SSE minimal pour les tests d'intégration : connexion HTTP réelle (comme EventSource),
 * avec le cookie de session. Rejette si le serveur ne répond pas 200 (le corps est joint au message).
 */
export function openSse(port: number, path: string, cookie: string): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { cookie, accept: 'text/event-stream' },
      },
      (res: IncomingMessage) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (c: Buffer) => (body += c.toString()));
          res.on('end', () => {
            const error = new Error(`SSE ${res.statusCode}: ${body}`) as Error & {
              status?: number;
              body?: unknown;
            };
            error.status = res.statusCode;
            try {
              error.body = JSON.parse(body);
            } catch {
              error.body = body;
            }
            reject(error);
          });
          return;
        }
        const messages: SseMessage[] = [];
        const waiters: {
          predicate: (m: SseMessage) => boolean;
          resolve: (m: SseMessage) => void;
        }[] = [];
        let ended = false;
        const endWaiters: (() => void)[] = [];
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let index: number;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let type = 'message';
            const data: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trim());
            }
            if (data.length === 0) continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data.join('\n'));
            } catch {
              parsed = { raw: data.join('\n') };
            }
            const message = { type, data: parsed };
            messages.push(message);
            for (const w of [...waiters]) {
              if (w.predicate(message)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(message);
              }
            }
          }
        });
        const markEnded = () => {
          ended = true;
          endWaiters.splice(0).forEach((fn) => fn());
        };
        res.on('end', markEnded);
        res.on('close', markEnded);
        resolve({
          status: res.statusCode,
          messages,
          waitFor(predicate, timeoutMs = 10_000) {
            const found = messages.find(predicate);
            if (found) return Promise.resolve(found);
            return new Promise((ok, ko) => {
              const timer = setTimeout(
                () => ko(new Error(`Message SSE attendu non reçu en ${timeoutMs} ms`)),
                timeoutMs,
              );
              waiters.push({
                predicate,
                resolve: (m) => {
                  clearTimeout(timer);
                  ok(m);
                },
              });
            });
          },
          closed: () => ended,
          waitClosed(timeoutMs = 10_000) {
            if (ended) return Promise.resolve();
            return new Promise((ok, ko) => {
              const timer = setTimeout(
                () => ko(new Error(`Flux SSE toujours ouvert après ${timeoutMs} ms`)),
                timeoutMs,
              );
              endWaiters.push(() => {
                clearTimeout(timer);
                ok();
              });
            });
          },
          close: () => {
            req.destroy();
          },
        });
      },
    );
    req.on('error', (error) => {
      // Une fermeture volontaire (close()) n'est pas une erreur de test.
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });
}

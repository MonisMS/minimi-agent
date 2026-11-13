import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { parseConfig } from '../server/config.js';
import { openInMemoryDatabase } from '../server/db/connection.js';
import { createConversation } from '../server/db/conversations.js';
import { createOwner } from '../server/db/owners.js';
import { createApp } from '../server/http/app.js';
import { RunEventWriter } from '../server/runs/events.js';
import { RunAbortRegistry } from '../server/runs/registry.js';

describe('isolated demo namespace', () => {
  it('keeps fictional demo conversations out of the default live API', async () => {
    const database = openInMemoryDatabase();
    const clock = new ManualClock();
    const owner = createOwner(database, clock);
    const demo = createConversation(database, clock, {
      ownerId: owner.id, namespace: 'demo', title: 'Fictional CRM walkthrough',
    });
    const live = createConversation(database, clock, {
      ownerId: owner.id, namespace: 'live', title: 'Live history',
    });
    const demoEvents = new RunEventWriter({ database, clock });
    const liveEvents = new RunEventWriter({ database, clock });
    const demoServer = createApp({
      config: parseConfig({ NODE_ENV: 'test' }), database, clock,
      registry: new RunAbortRegistry(), events: demoEvents, executor: null, namespace: 'demo',
    }).listen(0, '127.0.0.1');
    const liveServer = createApp({
      config: parseConfig({ NODE_ENV: 'test' }), database, clock,
      registry: new RunAbortRegistry(), events: liveEvents, executor: null,
    }).listen(0, '127.0.0.1');

    const listen = (server: Server) => new Promise<void>((resolve) => server.once('listening', resolve));
    await Promise.all([listen(demoServer), listen(liveServer)]);
    const address = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookie = `minimi_owner=${owner.id}`;
    try {
      const [demoResponse, liveResponse] = await Promise.all([
        fetch(`${address(demoServer)}/api/conversations`, { headers: { cookie } }),
        fetch(`${address(liveServer)}/api/conversations`, { headers: { cookie } }),
      ]);
      const demoPayload = await demoResponse.json() as { conversations: Array<{ id: string }> };
      const livePayload = await liveResponse.json() as { conversations: Array<{ id: string }> };
      expect(demoPayload.conversations.map((item) => item.id)).toEqual([demo.id]);
      expect(livePayload.conversations.map((item) => item.id)).toEqual([live.id]);
    } finally {
      for (const server of [demoServer, liveServer]) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }
      demoEvents.close();
      liveEvents.close();
      database.close();
    }
  });
});

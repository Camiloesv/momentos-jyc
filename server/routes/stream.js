import { feedBus } from '../lib/events.js';

export default async function streamRoute(fastify) {
  fastify.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`: connected ${Date.now()}\n\n`);

    const onNew = (item) => {
      reply.raw.write(`event: new\ndata: ${JSON.stringify(item)}\n\n`);
    };
    const onHide = (payload) => {
      reply.raw.write(`event: hide\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping ${Date.now()}\n\n`);
    }, 25000);

    feedBus.on('new', onNew);
    feedBus.on('hide', onHide);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      feedBus.off('new', onNew);
      feedBus.off('hide', onHide);
    });
  });
}

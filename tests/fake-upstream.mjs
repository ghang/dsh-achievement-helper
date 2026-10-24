import { createServer } from 'node:http';
import { once } from 'node:events';

// Synthetic local Messages API; contains no real credentials or private inputs.
export async function fakeUpstream(script) {
  const queue = [...script], requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const reply = queue.shift();
    if (!reply) { res.writeHead(500); res.end('Synthetic script exhausted'); return; }
    const usage = reply.usage ?? { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 };
    const events = [{ type: 'message_start', message: { id: 'synthetic-message', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage } }];
    let index = 0;
    if (reply.text) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: reply.text } }, { type: 'content_block_stop', index }); index++;
    }
    for (const call of reply.calls ?? []) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id ?? `fixture-${index}`, name: call.name, input: call.input ?? {} } },
        { type: 'content_block_stop', index }); index++;
    }
    events.push({ type: 'message_delta', delta: { stop_reason: reply.calls?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, requests,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

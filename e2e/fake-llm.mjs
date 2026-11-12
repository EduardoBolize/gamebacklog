// A stand-in for a local model server (Ollama / LM Studio), speaking the OpenAI-compatible
// protocol. The end-to-end tests point the app at it, so the whole AI path runs for real —
// HTTP request, JSON extraction, validation, cache — without any model or network.
//
// Usage: node e2e/fake-llm.mjs [port]
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3878);
let chatRequests = 0;

/** Picks a canned answer from what the system prompt asks for. */
function answerFor(system, user) {
  if (system.includes('spoiler-safe hints')) {
    const level = /Level (\d)/.exec(system)?.[1] ?? '?';
    return { hint: `Dica de nível ${level} para o teste.`, sources: [] };
  }
  if (system.includes('list for a progress tracker')) {
    return {
      checkpoints: [
        { name: 'Kokiri Forest', aliases: [], isPointOfNoReturn: false, bossName: null },
        {
          name: 'Inside the Deku Tree',
          aliases: ['Deku Tree'],
          isPointOfNoReturn: false,
          bossName: 'Queen Gohma',
        },
      ],
    };
  }
  if (system.includes('Match what they wrote to the numbered checkpoints')) {
    return /deku/i.test(user)
      ? { checkpoint: 2, completed: [], alias: null }
      : { checkpoint: null, completed: [], alias: null };
  }
  if (system.includes('choose where to go next')) {
    return {
      beforeLeaving: [{ kind: 'item', name: 'Escudo de teste', detail: 'Pegue antes de sair.' }],
      paths: [
        {
          option: 1,
          howToGetThere: 'Caminho de teste.',
          warnings: [{ kind: 'point_of_no_return', name: 'Templo', detail: 'Aviso de teste.' }],
        },
      ],
    };
  }
  if (system.includes('completionist checklist')) {
    return {
      collectibles: [
        {
          name: 'Gold Skulltula (teste)',
          description: 'Na sala principal.',
          category: 'Gold Skulltula',
          isMissable: true,
        },
      ],
      missableAchievements: [],
    };
  }
  if (system.includes('estimate what share')) {
    return { percentFinished: 42, rationale: 'Estimativa de teste.' };
  }
  if (system.includes('one short line per game')) {
    // One line for each numbered game in the prompt.
    const numbers = [...user.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
    return { lines: numbers.map((game) => ({ game, line: `Linha de teste ${game}.` })) };
  }
  return 'OK';
}

const server = createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (request.method === 'GET' && request.url === '/v1/models') {
    return send(200, { object: 'list', data: [{ id: 'fake-model', object: 'model' }] });
  }
  if (request.method === 'GET' && request.url === '/requests') {
    return send(200, { chatRequests });
  }
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      chatRequests++;
      const body = JSON.parse(raw || '{}');
      const text = (role) =>
        (body.messages ?? [])
          .filter((message) => message.role === role)
          .map((message) =>
            typeof message.content === 'string'
              ? message.content
              : (message.content ?? []).map((part) => part.text ?? '').join(''),
          )
          .join('\n');
      const answer = answerFor(text('system'), text('user'));
      const content = typeof answer === 'string' ? answer : JSON.stringify(answer);
      send(200, {
        id: `chatcmpl-${chatRequests}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      });
    });
    return undefined;
  }
  return send(404, { error: 'not_found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fake LLM listening on http://127.0.0.1:${port}`);
});

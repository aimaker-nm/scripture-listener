// Scripture Listener story detection. POST /identify {"text": "...transcript..."}
// with "Authorization: Bearer <APP_TOKEN>" returns {"matches":[{reference, confidence, story}]}.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM = `You help a church media team. You receive a few sentences of a live sermon transcript
(from speech recognition, so expect misheard words). Decide whether the preacher is retelling,
summarising or alluding to a SPECIFIC Bible story or passage without saying the reference.

Rules:
- Only answer when the speech clearly describes a particular story or event (people, actions, outcome),
  e.g. "the prophet told the king he would die, he prayed, and God gave him fifteen more years"
  -> 2 Kings 20:1-6.
- General preaching, prayer, encouragement, announcements, or themes found in many places
  ("God is faithful", "Jesus loves you", "we must pray") -> return no matches.
- Give the few verses (at most 6) that capture the moment the preacher describes, as
  "Book Chapter:Verse-Verse" with full book names like "2 Kings", "Psalms", "Song of Solomon" -
  e.g. David killing Goliath -> 1 Samuel 17:48-50, not the whole chapter. They go on a screen.
  Add a parallel account only if it is equally central.
- confidence is 0 to 1: how sure you are this exact story is being told. Do not guess.
- story is a short name for the story, e.g. "Hezekiah's illness and recovery".`;

const SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          confidence: { type: 'number' },
          story: { type: 'string' },
        },
        required: ['reference', 'confidence', 'story'],
      },
    },
  },
  required: ['matches'],
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/identify') return json({ error: 'not found' }, 404);
    if (!env.APP_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.APP_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    let text;
    try {
      ({ text } = await request.json());
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    if (typeof text !== 'string' || !text.trim()) return json({ error: 'text is required' }, 400);
    text = text.slice(-2000); // the last few sentences are what matter; keeps cost bounded

    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Transcript:\n"""${text}"""` },
        ],
        response_format: { type: 'json_schema', json_schema: SCHEMA },
        max_tokens: 300,
        temperature: 0,
      });
      const parsed = typeof result.response === 'string' ? JSON.parse(result.response) : result.response;
      const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
      return json({ matches });
    } catch (err) {
      console.error('identify failed', err);
      return json({ error: 'model call failed' }, 502);
    }
  },
};

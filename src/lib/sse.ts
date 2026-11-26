/**
 * Server-Sent Events (SSE) 解析，适配 OpenAI / Anthropic / Gemini 等流式 AI 接口
 */
export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  parsed?: unknown;
}

export interface ParsedSse {
  events: SseEvent[];
  /** 拼接后的正文（AI 模型流式输出） */
  assembledText: string;
  /** 拼接后的思考过程（如 DeepSeek R1 / reasoning_content） */
  assembledReasoning: string;
  done: boolean;
  error?: string;
}

export function isSseContent(contentType: string, body: string): boolean {
  if (/text\/event-stream/i.test(contentType)) return true;
  if (!body) return false;
  const head = body.slice(0, 600);
  return /(^|\n)data:\s*(\{|\[DONE\])/.test(head);
}

function parseEvent(block: string): SseEvent | null {
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let val = colon >= 0 ? line.slice(colon + 1) : '';
    if (val.startsWith(' ')) val = val.slice(1);
    if (field === 'data') dataLines.push(val);
    else if (field === 'event') event = val;
    else if (field === 'id') id = val;
  }
  if (!dataLines.length && !event) return null;
  const data = dataLines.join('\n');
  try {
    return { id, event, data, parsed: JSON.parse(data) };
  } catch {
    return { id, event, data };
  }
}

export function parseSse(body: string): ParsedSse {
  const events: SseEvent[] = [];
  let assembledText = '';
  let assembledReasoning = '';
  let done = false;
  let error: string | undefined;

  for (const block of body.replace(/\r\n?/g, '\n').split(/\n\n+/)) {
    const entry = parseEvent(block);
    if (!entry) continue;
    events.push(entry);
    const { event, data, parsed } = entry;
    if (event === 'error') error = typeof parsed === 'string' ? parsed : data;
    if (data.trim() === '[DONE]') done = true;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, any>;
      if (event === 'error' || obj.type === 'error' || obj.error) {
        error = [obj.error?.message, obj.message, obj.error].find(value => typeof value === 'string' && value) ?? data;
      }
      // OpenAI / DeepSeek / 兼容格式
      const choice = obj.choices?.[0];
      if (choice?.delta) {
        if (typeof choice.delta.content === 'string') assembledText += choice.delta.content;
        if (typeof choice.delta.reasoning_content === 'string') assembledReasoning += choice.delta.reasoning_content;
        if (typeof choice.delta.reasoning === 'string') assembledReasoning += choice.delta.reasoning;
      } else if (typeof choice?.text === 'string') {
        assembledText += choice.text;
      }
      // OpenAI Responses API
      if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
        assembledText += obj.delta;
      }
      if ((obj.type === 'response.reasoning_summary_text.delta' || obj.type === 'response.reasoning_text.delta') && typeof obj.delta === 'string') {
        assembledReasoning += obj.delta;
      }
      if (obj.type === 'response.completed' || obj.type === 'message_stop') done = true;
      // Anthropic Messages SSE
      if (obj.type === 'content_block_delta' && obj.delta) {
        if (obj.delta.type === 'text_delta' && typeof obj.delta.text === 'string') assembledText += obj.delta.text;
        if (obj.delta.type === 'thinking_delta' && typeof obj.delta.thinking === 'string') assembledReasoning += obj.delta.thinking;
      }
      // Gemini SSE
      const parts = obj.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p?.text === 'string') {
            if (p.thought) assembledReasoning += p.text;
            else assembledText += p.text;
          }
        }
      }
    }
  }

  return { events, assembledText, assembledReasoning, done, error };
}

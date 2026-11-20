import { describe, expect, it } from 'vitest';
import { parseCurl, parseCurlCommands, looksLikeCurl } from '../src/lib/curlParser';
import { applyImport, importAll, planImport } from '../src/lib/curlImport';
import { seedData } from '../src/lib/factory';
import { renderTemplate, resolveVariables } from '../src/lib/template';
import { runFilter, formatFilterOutput } from '../src/lib/jq';

const USER_EXAMPLE = `curl -sS 'https://api.example-llm.dev/v1/chat/completions' \\
  -H "Authorization: Bearer sk-demo0000111122223333444455556666777788889999" \\
  -H 'Content-Type: application/json' \\
  --data-raw '{
    "model": "model-j",
    "messages": [
      {
        "role": "user",
        "content": "你是什么模型"
      }
    ],
    "stream": false
  }' | jq -r '.choices[0].message.content // .error.message // .'`;

const OPTS = { extractSecrets: true, extractBaseUrl: true, groupByHost: true };

describe('curl 解析', () => {
  it('解析用户给出的示例', () => {
    expect(looksLikeCurl(USER_EXAMPLE)).toBe(true);
    const p = parseCurl(USER_EXAMPLE)!;
    expect(p.method).toBe('POST');
    expect(p.url).toBe('https://api.example-llm.dev/v1/chat/completions');
    expect(p.headers).toEqual([
      { key: 'Authorization', value: 'Bearer sk-demo0000111122223333444455556666777788889999' },
      { key: 'Content-Type', value: 'application/json' },
    ]);
    expect(p.body.type).toBe('json');
    expect(JSON.parse(p.body.text)).toEqual({
      model: 'model-j',
      messages: [{ role: 'user', content: '你是什么模型' }],
      stream: false,
    });
    expect(p.jqFilter).toBe('.choices[0].message.content // .error.message // .');
  });

  it('组合短选项与附着参数', () => {
    const p = parseCurl(`curl -sSLkXPOST -H'X-A: 1' -d 'a=1&b=%E4%BD%A0' example.com/api`)!;
    expect(p.method).toBe('POST');
    expect(p.url).toBe('http://example.com/api');
    expect(p.insecure).toBe(true);
    expect(p.followRedirects).toBe(true);
    expect(p.headers[0]).toEqual({ key: 'X-A', value: '1' });
    expect(p.body.type).toBe('form');
    expect(p.body.form).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '你' },
    ]);
  });

  it('环境变量引用与 export', () => {
    const list = parseCurlCommands(`export OPENAI_API_KEY="sk-abc123456789"
curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`);
    expect(list).toHaveLength(1);
    expect(list[0].headers[0].value).toBe('Bearer {{OPENAI_API_KEY}}');
    expect(list[0].envRefs).toEqual(['OPENAI_API_KEY']);
    expect(list[0].envValues.OPENAI_API_KEY).toBe('sk-abc123456789');
    expect(list[0].method).toBe('GET');
  });

  it('Windows cmd 风格', () => {
    const p = parseCurl(`curl ^"https://example.com/a?x=1^" ^
  -H ^"accept: */*^" ^
  --data-raw ^"^{^\\^"k^\\^":1^}^"`)!;
    expect(p.url).toBe('https://example.com/a?x=1');
    expect(p.headers[0]).toEqual({ key: 'accept', value: '*/*' });
    expect(JSON.parse(p.body.text)).toEqual({ k: 1 });
  });

  it('多条命令批量', () => {
    const list = parseCurlCommands(`curl https://a.com/x
curl -X DELETE https://b.com/y/1`);
    expect(list.map((x) => x.method)).toEqual(['GET', 'DELETE']);
    expect(list[1].url).toBe('https://b.com/y/1');
  });

  it('-u 与 -F 表单、--json、-G', () => {
    const p1 = parseCurl(`curl -u admin:pw https://x.com -F name=张三 -F file=@/tmp/a.png`)!;
    expect(p1.auth).toEqual({ type: 'basic', username: 'admin', password: 'pw' });
    expect(p1.body.type).toBe('multipart');
    expect(p1.body.multipart[0]).toEqual({ key: 'name', value: '张三' });
    expect(p1.body.multipart[1].isFile).toBe(true);
    const p2 = parseCurl(`curl --json '{"a":1}' https://x.com`)!;
    expect(p2.method).toBe('POST');
    expect(p2.body.type).toBe('json');
    expect(p2.headers.find((h) => h.key === 'Content-Type')?.value).toBe('application/json');
    const p3 = parseCurl(`curl -G https://x.com/s -d q=hi -d n=2`)!;
    expect(p3.method).toBe('GET');
    expect(p3.url).toBe('https://x.com/s?q=hi&n=2');
  });

  it('ANSI-C 字符串与无续行符的多行', () => {
    const p = parseCurl(`curl $'https://x.com/a' -d $'line1\\nline2' -H 'Content-Type: text/plain'`)!;
    expect(p.body.text).toBe('line1\nline2');
    const p2 = parseCurl(`curl https://x.com/a
  -H 'X-Token: 1'
  -X PUT`)!;
    expect(p2.method).toBe('PUT');
    expect(p2.headers[0].key).toBe('X-Token');
  });
});

describe('智能归档', () => {
  it('用户示例：按域名归档、提取 base_url 与密钥、jq 筛选', () => {
    const data = seedData();
    const ws = data.workspaces[0].id;
    const parsed = parseCurl(USER_EXAMPLE)!;
    const plan = planImport(parsed, data, ws, OPTS);
    expect(plan.folder.kind).toBe('new');
    expect(plan.folder.name).toBe('api.example-llm.dev');
    expect(plan.request.url).toBe('{{base_url}}/chat/completions');
    expect(plan.request.auth).toEqual({ type: 'bearer', prefix: 'Bearer', token: '{{api_key}}' });
    expect(plan.request.headers.map((h) => h.key)).toEqual(['Content-Type']);
    expect(plan.request.responseFilter).toBe('.choices[0].message.content // .error.message // .');
    expect(plan.request.name).toBe('对话补全 · model-j · 你是什么模型');
    expect(plan.request.description).toContain('sk-dem••••9999');
    expect(plan.request.description).not.toContain('sk-demo0000111122223333444455556666777788889999');
    const vars = plan.vars.map((v) => [v.key, v.value, v.status, v.scope]);
    expect(vars).toEqual([
      ['base_url', 'https://api.example-llm.dev/v1', 'new', 'folder'],
      ['api_key', 'sk-demo0000111122223333444455556666777788889999', 'new', 'folder'],
    ]);

    const r = applyImport(data, plan);
    const folder = r.data.folders.find((f) => f.id === r.folderId)!;
    expect(folder.host).toBe('api.example-llm.dev');
    expect(folder.variables.map((v) => v.key)).toEqual(['base_url', 'api_key']);
    expect(folder.variables[1].secret).toBe(true);

    // 变量解析
    const vm = resolveVariables(r.data, ws, folder.id);
    const req = r.data.requests.find((x) => x.id === r.requestId)!;
    expect(renderTemplate(req.url, vm).text).toBe('https://api.example-llm.dev/v1/chat/completions');

    // 第二次导入同站点、同密钥、不同内容 → 复用文件夹与变量
    const second = parseCurl(USER_EXAMPLE.replace('你是什么模型', '讲个笑话'))!;
    const plan2 = planImport(second, r.data, ws, OPTS);
    expect(plan2.folder.kind).toBe('existing');
    expect(plan2.vars.every((v) => v.status === 'reuse')).toBe(true);
    const r2 = applyImport(r.data, plan2);
    expect(r2.data.folders.filter((f) => f.host === 'api.example-llm.dev')).toHaveLength(1);
    expect(r2.data.folders.find((f) => f.id === r.folderId)!.variables).toHaveLength(2);

    // 完全相同 → 查重
    const plan3 = planImport(parseCurl(USER_EXAMPLE)!, r2.data, ws, OPTS);
    expect(plan3.duplicateOf?.id).toBe(r.requestId);

    // 不同密钥 → api_key_2
    const plan4 = planImport(parseCurl(USER_EXAMPLE.replace('sk-demo', 'sk-ZZZZ'))!, r2.data, ws, OPTS);
    expect(plan4.vars.find((v) => v.slot === 'auth:bearer')?.key).toBe('api_key_2');
  });

  it('Gemini 查询参数密钥 / Anthropic x-api-key / 环境变量', () => {
    const data = seedData();
    const ws = data.workspaces[0].id;
    const { data: d2, plans } = importAll(
      data,
      parseCurlCommands(`curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test_gemini_demo_key_123456" -H 'Content-Type: application/json' -d '{"contents":[{"parts":[{"text":"你好"}]}]}'
curl https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d '{"model":"claude-sonnet-4","max_tokens":100,"messages":[{"role":"user","content":"Hi"}]}'`),
      ws,
      OPTS,
    );
    expect(plans[0].request.url).toBe('{{base_url}}/models/gemini-2.0-flash:generateContent?key={{api_key}}');
    expect(plans[0].request.name).toBe('生成内容 · gemini-2.0-flash · 你好');
    expect(plans[0].folder.name).toBe('Google Gemini · generativelanguage.googleapis.com');
    expect(plans[1].request.headers.find((h) => h.key === 'x-api-key')?.value).toBe('{{ANTHROPIC_API_KEY}}');
    const base = d2.environments.find((e) => e.isBase && e.workspaceId === ws)!;
    expect(base.variables.find((v) => v.key === 'ANTHROPIC_API_KEY')?.secret).toBe(true);
  });
});

describe('jq 筛选', () => {
  const resp = { choices: [{ message: { content: '我是模型' } }], data: [{ id: 'a' }, { id: 'b' }] };
  it('基础路径与 //', () => {
    expect(runFilter('.choices[0].message.content // .error.message // .', resp)).toEqual(['我是模型']);
    expect(runFilter('.error.message // .', { error: { message: '错误' } })).toEqual(['错误']);
    expect(runFilter('.choices[0].message.content // .error.message // .', { x: 1 })).toEqual([{ x: 1 }]);
  });
  it('迭代、map、select、length', () => {
    expect(runFilter('.data[].id', resp)).toEqual(['a', 'b']);
    expect(runFilter('.data | map(.id) | join(",")', resp)).toEqual(['a,b']);
    expect(runFilter('.data[] | select(.id == "b")', resp)).toEqual([{ id: 'b' }]);
    expect(runFilter('.data | length', resp)).toEqual([2]);
    expect(runFilter('{first: .data[0].id, n: (.data|length)}', resp)).toEqual([{ first: 'a', n: 2 }]);
    expect(runFilter('$.data[*].id', resp)).toEqual(['a', 'b']);
    expect(formatFilterOutput(runFilter('.data[].id', resp))).toBe('a\nb');
  });
});

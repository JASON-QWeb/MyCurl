import { describe, expect, it } from 'vitest';
import { isSseContent, parseSse } from '../src/lib/sse';
import { exportAsCurl, exportAsFetch, exportAsPython, generateFolderDoc, generateWorkspaceDoc } from '../src/lib/curlExport';
import { exportMyCurlJson, importPostmanCollection, isPostmanCollection } from '../src/lib/collectionIO';
import { prepareRequest } from '../src/lib/requestRunner';
import { parseCurl } from '../src/lib/curlParser';
import { applyImport, planImport } from '../src/lib/curlImport';
import { defaultSettings, newFolder, normalizeData, seedData } from '../src/lib/factory';
import { syncParamsFromUrl, syncUrlFromParams } from '../src/lib/urlParams';
import { useAppStore } from '../src/store/useAppStore';

const USER_CURL = `curl -sS 'https://api.example-llm.dev/v1/chat/completions' \\
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

describe('SSE 解析', () => {
  it('解析 OpenAI / DeepSeek 流式对话与思考过程', () => {
    const sseBody = [
      `data: {"choices":[{"delta":{"reasoning_content":"先思考一下"}}]}`,
      ``,
      `data: {"choices":[{"delta":{"content":"你好，"}}]}`,
      ``,
      `data: {"choices":[{"delta":{"content":"我是模型 J。"}}]}`,
      ``,
      `data: [DONE]`,
      ``,
    ].join('\n');
    expect(isSseContent('text/event-stream; charset=utf-8', sseBody)).toBe(true);
    const parsed = parseSse(sseBody);
    expect(parsed.done).toBe(true);
    expect(parsed.assembledReasoning).toBe('先思考一下');
    expect(parsed.assembledText).toBe('你好，我是模型 J。');
    expect(parsed.events).toHaveLength(4);
  });

  it('解析 Anthropic 与 Gemini SSE', () => {
    const claude = `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello Claude"}}\n\n`;
    expect(parseSse(claude).assembledText).toBe('Hello Claude');
    const gemini = `data: {"candidates":[{"content":{"parts":[{"text":"Hi Gemini"}]}}]}\n\n`;
    expect(parseSse(gemini).assembledText).toBe('Hi Gemini');
  });
});

describe('请求构建、代码与文档导出', () => {
  const init = seedData();
  const wsId = init.workspaces[0].id;
  const plan = planImport(parseCurl(USER_CURL)!, init, wsId, {
    extractSecrets: true,
    extractBaseUrl: true,
    groupByHost: true,
  });
  const { data, requestId, folderId } = applyImport(init, plan);
  const req = data.requests.find((r) => r.id === requestId)!;
  const folder = data.folders.find((f) => f.id === folderId)!;

  it('prepareRequest 正确还原文件夹变量与 Bearer 认证头', () => {
    const prep = prepareRequest(data, req);
    expect(prep.method).toBe('POST');
    expect(prep.url).toBe('https://api.example-llm.dev/v1/chat/completions');
    expect(prep.headers).toContainEqual(['Authorization', 'Bearer sk-demo0000111122223333444455556666777788889999']);
    expect(prep.headers).toContainEqual(['Content-Type', 'application/json']);
    expect(prep.body.kind).toBe('text');
    expect(prep.missingVars).toEqual([]);
  });

  it('导出 cURL 支持脱敏 / 模板 / 明文三种模式并保留 jq 管道', () => {
    const masked = exportAsCurl(data, req, { secretMode: 'mask', includeJq: true });
    expect(masked).toMatch(/^curl 'https:\/\/api\.example-llm\.dev\/v1\/chat\/completions'/);
    expect(masked).not.toContain('-sS');
    expect(masked).not.toContain(' -L ');
    expect(masked).toContain('sk-dem••••9999');
    expect(masked).not.toContain('sk-demo0000111122223333444455556666777788889999');
    expect(masked).toContain(`| jq -r '.choices[0].message.content // .error.message // .'`);

    const tpl = exportAsCurl(data, req, { secretMode: 'template', includeJq: false });
    expect(tpl).toContain('{{base_url}}/chat/completions');
    expect(tpl).toContain('Bearer {{api_key}}');
    expect(tpl).not.toContain('| jq');

    const real = exportAsCurl(data, req, { secretMode: 'resolve', includeJq: true });
    expect(real).toContain('sk-demo0000111122223333444455556666777788889999');

    // 显式设置 followRedirects / verifySSL 时才输出 -L / -k
    const withFlags = exportAsCurl(
      data,
      { ...req, settings: { ...req.settings, followRedirects: true, verifySSL: false } },
      { secretMode: 'mask', includeJq: false },
    );
    expect(withFlags).toMatch(/^curl -k -L 'https:\/\/api\.example-llm\.dev\/v1\/chat\/completions'/);
  });

  it('导出 Fetch、Python 以及脱敏 Markdown 文档', () => {
    const js = exportAsFetch(data, req, { secretMode: 'mask' });
    expect(js).toContain('await fetch("https://api.example-llm.dev/v1/chat/completions"');
    expect(js).not.toContain('sk-demo0000111122223333444455556666777788889999');

    const py = exportAsPython(data, req, { secretMode: 'mask' });
    expect(py).toContain('import requests');
    expect(py).toContain('json=payload');

    const folderDoc = generateFolderDoc(data, folder);
    expect(folderDoc).toContain('# api.example-llm.dev');
    expect(folderDoc).toContain('`{{base_url}}`');
    expect(folderDoc).toContain('`{{api_key}}`');
    expect(folderDoc).toContain('sk-dem••••9999');
    expect(folderDoc).not.toContain('sk-demo0000111122223333444455556666777788889999');

    const wsDoc = generateWorkspaceDoc(data, wsId);
    expect(wsDoc).toContain('对话补全 · model-j · 你是什么模型');
  });
});

describe('集合导入导出与 URL 参数同步', () => {
  it('导出脱敏 JSON 备份不会泄漏密钥', () => {
    const init = seedData();
    const wsId = init.workspaces[0].id;
    const plan = planImport(parseCurl(USER_CURL)!, init, wsId, {
      extractSecrets: true,
      extractBaseUrl: true,
      groupByHost: true,
    });
    const { data } = applyImport(init, plan);
    const maskedJson = exportMyCurlJson(data, true);
    expect(maskedJson).not.toContain('sk-demo0000111122223333444455556666777788889999');
    expect(maskedJson).toContain('sk-dem••••9999');
  });

  it('导入 Postman v2.1 集合', () => {
    const pm = {
      info: { name: '测试集合', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: '对话接口',
          request: {
            method: 'POST',
            url: { raw: 'https://api.example.com/v1/chat' },
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: { mode: 'raw', raw: '{"hi":1}', options: { raw: { language: 'json' } } },
          },
        },
      ],
    };
    expect(isPostmanCollection(pm)).toBe(true);
    const init = seedData();
    const res = importPostmanCollection(init, init.workspaces[0].id, pm);
    expect(res.folderCount).toBe(1);
    expect(res.requestCount).toBe(1);
    expect(res.data.requests.some((r) => r.name === '对话接口' && r.body.type === 'json')).toBe(true);
  });

  it('URL 与查询参数双向同步', () => {
    const params = syncParamsFromUrl('https://a.com/x?a=1&b=2#top', []);
    expect(params.map((p) => [p.key, p.value])).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    params[1].enabled = false;
    expect(syncUrlFromParams('https://a.com/x?a=1&b=2#top', params)).toBe('https://a.com/x?a=1#top');
  });

  it('curlCopySecretMode 默认脱敏且支持明文与占位符配置持久化', () => {
    expect(defaultSettings().curlCopySecretMode).toBe('mask');
    const raw = seedData();
    // 兼容旧数据缺少该字段的情况
    const legacy = JSON.parse(JSON.stringify(raw));
    delete legacy.settings.curlCopySecretMode;
    expect(normalizeData(legacy).settings.curlCopySecretMode).toBe('mask');

    raw.settings.curlCopySecretMode = 'resolve';
    expect(normalizeData(raw).settings.curlCopySecretMode).toBe('resolve');
  });

  it('支持文件夹拖拽嵌套进路由目录，并阻止循环嵌套', () => {
    const init = seedData();
    const wsId = init.workspaces[0].id;
    const routeFolder = init.folders[0];
    const subA = newFolder(wsId, null, { name: '子目录 A' });
    const subB = newFolder(wsId, subA.id, { name: '子目录 B' });
    useAppStore.setState({ data: { ...init, folders: [...init.folders, subA, subB] } });

    // 将 subA 移入路由目录
    expect(useAppStore.getState().moveFolder(subA.id, routeFolder.id)).toBe(true);
    expect(useAppStore.getState().data.folders.find((f) => f.id === subA.id)?.parentId).toBe(routeFolder.id);

    // 阻止把父目录移入自身或子孙目录
    expect(useAppStore.getState().moveFolder(routeFolder.id, routeFolder.id)).toBe(false);
    expect(useAppStore.getState().moveFolder(routeFolder.id, subA.id)).toBe(false);
    expect(useAppStore.getState().moveFolder(routeFolder.id, subB.id)).toBe(false);

    // 支持移回根目录
    expect(useAppStore.getState().moveFolder(subA.id, null)).toBe(true);
    expect(useAppStore.getState().data.folders.find((f) => f.id === subA.id)?.parentId).toBe(null);
  });
});

// ========== 数据模型 ==========

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | string;

export interface KV {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface Variable extends KV {
  /** 是否为敏感信息（密钥/令牌），界面中默认遮罩 */
  secret?: boolean;
  /** 备注，例如“从 cURL 导入” */
  note?: string;
}

export type BodyType =
  | 'none'
  | 'json'
  | 'text'
  | 'xml'
  | 'form'
  | 'multipart'
  | 'graphql';

export interface MultipartField extends KV {
  isFile?: boolean;
  fileName?: string;
  /** 浏览器选择的文件，以 base64 存储 */
  fileData?: string;
  /** 文件的 MIME 类型 */
  contentType?: string;
}

export interface RequestBody {
  type: BodyType;
  text: string;
  form: KV[];
  multipart: MultipartField[];
  graphql?: { query: string; variables: string };
}

export type AuthType = 'inherit' | 'none' | 'bearer' | 'basic' | 'apikey';

export interface Auth {
  type: AuthType;
  token?: string;
  /** Bearer 前缀，默认 Bearer */
  prefix?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  in?: 'header' | 'query';
}

export interface RequestSettings {
  /** 为 undefined 时使用全局设置 */
  followRedirects?: boolean;
  verifySSL?: boolean;
  timeoutMs?: number;
}

export interface HttpRequest {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  params: KV[];
  headers: KV[];
  body: RequestBody;
  auth: Auth;
  settings: RequestSettings;
  /** 响应筛选表达式（jq 子集 / JSONPath），例如 .choices[0].message.content */
  responseFilter?: string;
  /** Markdown 文档 */
  description?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  /** 导入来源 */
  source?: { kind: 'curl'; raw: string; importedAt: number };
}

export interface Folder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  /** 若该文件夹是按域名自动归档生成的，记录域名 */
  host?: string;
  variables: Variable[];
  auth: Auth;
  headers: KV[];
  description?: string;
  sortOrder: number;
  createdAt: number;
}

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  /** 全局（基础）环境：总是生效 */
  isBase: boolean;
  color?: string;
  variables: Variable[];
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  activeWorkspaceId: string | null;
  /** workspaceId -> 当前子环境 id */
  activeEnvironment: Record<string, string | null>;
  timeoutMs: number;
  verifySSL: boolean;
  followRedirects: boolean;
  proxy: string;
  import: {
    extractSecrets: boolean;
    extractBaseUrl: boolean;
    groupByHost: boolean;
    /** 粘贴 cURL 后跳过预览直接导入 */
    skipPreview: boolean;
    /** 导入后自动发送 */
    autoSend: boolean;
  };
  editorFontSize: number;
  sidebarWidth: number;
  responsePaneRatio: number;
  layout: 'horizontal' | 'vertical';
}

export interface AppData {
  version: number;
  workspaces: Workspace[];
  folders: Folder[];
  requests: HttpRequest[];
  environments: Environment[];
  settings: Settings;
}

export interface ResponseRecord {
  id: string;
  requestId: string;
  createdAt: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  /** 文本内容（二进制时为空） */
  body: string;
  /** base64，仅用于图片等二进制且较小时 */
  bodyBase64?: string;
  bodyTruncated?: boolean;
  contentType: string;
  size: number;
  timeMs: number;
  ttfbMs?: number;
  error?: string;
  requestHeaders?: [string, string][];
  requestBodyPreview?: string;
  redirects?: string[];
}

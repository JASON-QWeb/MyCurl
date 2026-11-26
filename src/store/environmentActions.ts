import { readDotEnvEnvironment } from '../lib/dotenvImport';
import { readPostmanEnvironment } from '../lib/postmanEnvironment';
import { tr } from '../lib/translate';
import type { Environment } from '../lib/types';
import { uid } from '../lib/util';
import type { AppStore } from './useAppStore';

type EnvironmentActions = Pick<AppStore, 'importEnvironmentFile' | 'importDotEnvEnvironment' | 'importPostmanEnvironment' | 'duplicateEnvironment'>;

export function createEnvironmentActions(get: () => AppStore): EnvironmentActions {
  function saveImport(env: Environment | null, error?: string) {
    const { data, mutate, toast } = get();
    const lang = data.settings.language;
    if (!env) {
      toast(error ?? tr(lang, '未识别的环境文件（支持 Postman 环境 JSON 或 .env 文件）',
        'Unrecognized environment file (supports Postman Environment JSON or .env)'), 'error');
      return null;
    }
    mutate(current => ({ ...current, environments: [...current.environments, env] }), true);
    toast(tr(lang, `已导入环境「${env.name}」`, `Imported environment "${env.name}"`), 'success');
    return env;
  }

  return {
    importEnvironmentFile: (text, workspaceId, fileName) => {
      let doc: unknown;
      try { doc = JSON.parse(text.trimStart()); } catch { /* Try dotenv assignments below. */ }
      const postman = readPostmanEnvironment(doc, workspaceId);
      return postman ? saveImport(postman) : get().importDotEnvEnvironment(text, workspaceId, fileName);
    },

    importDotEnvEnvironment: (text, workspaceId, fileName) =>
      saveImport(readDotEnvEnvironment(text, workspaceId, fileName)),

    importPostmanEnvironment: (doc, workspaceId) => saveImport(readPostmanEnvironment(doc, workspaceId),
      tr(get().data.settings.language, 'Postman 环境文件格式无效，请检查环境名称与变量列表', 'Invalid Postman environment name or variable list')),

    duplicateEnvironment: id => {
      const { data, mutate } = get();
      const source = data.environments.find(env => env.id === id);
      if (!source || source.isBase) return null;
      const copy = {
        ...source,
        id: uid('env_'),
        name: source.name + tr(data.settings.language, '（副本）', ' (Copy)'),
        variables: source.variables.map(variable => ({ ...variable, id: uid('kv_') })),
      };
      mutate(current => ({ ...current, environments: [...current.environments, copy] }), true);
      return copy;
    },
  };
}

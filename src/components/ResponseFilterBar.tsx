import { useMemo } from 'react';
import { useI18n } from '../lib/i18n';
import { rankJqPresets } from '../lib/jqPresets';
import { inferVarNameFromFilter, resolveSaveTargetScope, VARIABLE_NAME } from '../lib/responseExtract';
import type { HttpRequest } from '../lib/types';
import { isCredentialKey } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { IconChevronDown, IconFilter, IconKey, IconX } from './Icons';
import { ResponseDropdown } from './ResponseDropdown';

function Presets({ body, onPick }: { body?: string; onPick: (expr: string) => void }) {
  const { t, lang } = useI18n();
  const { quick, all } = useMemo(() => rankJqPresets(body, lang), [body, lang]);
  return (
    <div className="jq-presets">
      {quick.map(p => <button key={p.expr} className="btn btn-ghost btn-sm jq-quick" title={p.expr}
        onClick={() => onPick(p.expr)}>{p.label}</button>)}
      <ResponseDropdown label={t('更多预设', 'More presets')} iconOnly trigger={<IconChevronDown size={12} />} menuClass="jq-preset-menu">
        {close => all.map(p => (
          <button key={p.expr} className="menu-item" title={p.expr} onClick={() => { onPick(p.expr); close(); }}>
            {p.label}<span className="mono">{p.expr}</span>
          </button>
        ))}
      </ResponseDropdown>
    </div>
  );
}

function SaveVariable({ req, value }: { req: HttpRequest; value: string }) {
  const { t } = useI18n();
  const save = async () => {
    const { data, prompt, toast, upsertVariable } = useAppStore.getState();
    const scope = resolveSaveTargetScope(data, req);
    const missing = t('变量保存位置已不存在', 'The variable destination no longer exists');
    if (!scope) { toast(missing, 'error'); return; }
    const target = scope.kind === 'folder' ? t(`文件夹「${scope.name}」`, `folder "${scope.name}"`)
      : scope.kind === 'env' ? t(`环境「${scope.name}」`, `environment "${scope.name}"`)
      : t('全局变量', 'Global Variables');
    const preview = value.length > 64 ? value.slice(0, 64) + '…' : value;
    const name = (await prompt({
      title: t('存为变量', 'Save Var'),
      message: t(`保存到${target}。值预览：${preview}`, `Save to ${target}. Value preview: ${preview}`),
      defaultValue: inferVarNameFromFilter(req.responseFilter ?? ''),
      confirmLabel: t('保存', 'Save'),
    }))?.trim();
    if (!name) return;
    if (!VARIABLE_NAME.test(name)) {
      toast(t('变量名可包含字母、数字、汉字、下划线、点和连字符', 'Use letters, numbers, Chinese characters, underscores, dots or hyphens in the variable name'), 'error');
      return;
    }
    if (upsertVariable(scope, name, value, isCredentialKey(name))) {
      toast(t(`已将 {{${name}}} 保存到${target}`, `Saved {{${name}}} to ${target}`), 'success');
    } else toast(missing, 'error');
  };
  return <button className="btn btn-ghost btn-sm" onClick={save}><IconKey size={12} />{t('存为变量', 'Save Var')}</button>;
}

interface FilterBarProps {
  req: HttpRequest;
  presetBody?: string;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  filteredValue?: string;
}

export function ResponseFilterBar({ req, presetBody, enabled, setEnabled, filteredValue }: FilterBarProps) {
  const { t } = useI18n();
  const updateRequest = useAppStore(s => s.updateRequest);
  const expr = req.responseFilter ?? '';
  const apply = (value: string) => {
    updateRequest(req.id, { responseFilter: value });
    setEnabled(true);
  };
  return (
    <div className="jq-bar">
      <IconFilter size={13} className="jq-icon" />
      <input className="jq-input" placeholder={t(
        'jq / JSONPath 筛选（如 .choices[0].message.content // .error.message // .）',
        'jq / JSONPath filter (e.g. .choices[0].message.content // .error.message // .)',
      )} value={expr} onChange={e => apply(e.target.value)} />
      {expr.trim() ? <>
        <div className="segmented">
          <button className={enabled ? 'active' : ''} onClick={() => setEnabled(true)}>{t('筛选', 'Filtered')}</button>
          <button className={!enabled ? 'active' : ''} onClick={() => setEnabled(false)}>{t('原始', 'Raw')}</button>
        </div>
        {enabled && filteredValue !== undefined && filteredValue !== '' && <SaveVariable req={req} value={filteredValue} />}
        <button className="btn btn-ghost btn-icon btn-sm" title={t('清除筛选表达式', 'Clear filter')}
          onClick={() => updateRequest(req.id, { responseFilter: '' })}><IconX size={13} /></button>
      </> : <Presets body={presetBody} onPick={apply} />}
    </div>
  );
}

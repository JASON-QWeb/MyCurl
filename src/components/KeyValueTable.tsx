import React from 'react';
import type { KV } from '../lib/types';
import type { VarMap } from '../lib/template';
import { kv } from '../lib/util';
import { useI18n } from '../lib/i18n';
import { TemplateInput } from './TemplateInput';
import { IconPlus, IconTrash } from './Icons';

interface KeyValueTableProps {
  items: KV[];
  onChange: (next: KV[]) => void;
  vars: VarMap;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  keySuggestions?: string[];
}

export const KeyValueTable: React.FC<KeyValueTableProps> = ({
  items,
  onChange,
  vars,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  keySuggestions,
}) => {
  const { t } = useI18n();
  const finalKeyPlaceholder = keyPlaceholder ?? t('键名', 'Key');
  const finalValuePlaceholder = valuePlaceholder ?? t('值（支持 {{变量}}）', 'Value (supports {{var}})');
  const finalAddLabel = addLabel ?? t('添加一行', 'Add Row');
  const listId = keySuggestions ? 'kv-suggestions-' + finalKeyPlaceholder : undefined;

  const update = (id: string, patch: Partial<KV>) => {
    onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const remove = (id: string) => {
    onChange(items.filter((x) => x.id !== id));
  };

  const add = () => {
    onChange([...items, kv('', '', true)]);
  };

  return (
    <div>
      {keySuggestions && (
        <datalist id={listId}>
          {keySuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <table className="kv-table">
        <thead>
          <tr>
            <th className="kv-check" />
            <th style={{ width: '36%' }}>{t('名称', 'Name')}</th>
            <th>{t('值', 'Value')}</th>
            <th className="kv-del" />
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className={`kv-row ${row.enabled ? '' : 'disabled'}`}>
              <td className="kv-check">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => update(row.id, { enabled: e.target.checked })}
                  title={t('启用/禁用', 'Enable/Disable')}
                />
              </td>
              <td>
                <input
                  className="input input-sm mono"
                  style={{ width: '100%' }}
                  list={listId}
                  value={row.key}
                  placeholder={finalKeyPlaceholder}
                  onChange={(e) => update(row.id, { key: e.target.value })}
                />
              </td>
              <td>
                <TemplateInput
                  value={row.value}
                  onChange={(v) => update(row.id, { value: v })}
                  vars={vars}
                  placeholder={finalValuePlaceholder}
                  bordered
                  compact
                />
              </td>
              <td className="kv-del">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(row.id)} title={t('删除', 'Delete')}>
                  <IconTrash size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <button className="btn btn-sm" onClick={add}>
          <IconPlus size={13} />
          {finalAddLabel}
        </button>
      </div>
    </div>
  );
};

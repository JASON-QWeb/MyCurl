import React from 'react';
import type { KV } from '../lib/types';
import type { VarMap } from '../lib/template';
import { kv } from '../lib/util';
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
  keyPlaceholder = '键名',
  valuePlaceholder = '值（支持 {{变量}}）',
  addLabel = '添加一行',
  keySuggestions,
}) => {
  const listId = keySuggestions ? 'kv-suggestions-' + keyPlaceholder : undefined;

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
            <th style={{ width: '36%' }}>名称</th>
            <th>值</th>
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
                  title="启用/禁用"
                />
              </td>
              <td>
                <input
                  className="input input-sm mono"
                  style={{ width: '100%' }}
                  list={listId}
                  value={row.key}
                  placeholder={keyPlaceholder}
                  onChange={(e) => update(row.id, { key: e.target.value })}
                />
              </td>
              <td>
                <TemplateInput
                  value={row.value}
                  onChange={(v) => update(row.id, { value: v })}
                  vars={vars}
                  placeholder={valuePlaceholder}
                  bordered
                  compact
                />
              </td>
              <td className="kv-del">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(row.id)} title="删除">
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
          {addLabel}
        </button>
      </div>
    </div>
  );
};

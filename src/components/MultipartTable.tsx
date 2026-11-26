import React from 'react';
import { useI18n } from '../lib/i18n';
import type { VarMap } from '../lib/template';
import type { HttpRequest, MultipartField } from '../lib/types';
import { kv } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { IconPlus, IconTrash } from './Icons';
import { TemplateInput } from './TemplateInput';

type UpdateRow = (patch: Partial<MultipartField>) => void;

function FileCell({ row, update }: { row: MultipartField; update: UpdateRow }) {
  const { t } = useI18n();
  const toast = useAppStore(s => s.toast);
  const missing = row.fileData == null;
  const pickFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast(t('单个上传文件请勿超过 15 MB', 'File size must not exceed 15 MB'), 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (input.files?.[0] !== file) return;
      const dataUrl = String(reader.result);
      update({
        fileName: file.name,
        fileData: dataUrl.slice(dataUrl.indexOf(',') + 1),
        contentType: file.type || 'application/octet-stream',
      });
    };
    reader.onerror = () => toast(t('无法读取所选文件', 'Could not read the selected file'), 'error');
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <input type="file" style={{ fontSize: 11.5, maxWidth: 210 }} onChange={e => pickFile(e.currentTarget)} />
      {row.fileName && <span className={missing ? undefined : 'pill'}>{row.fileName}</span>}
      {missing && <span className="pill pill-warning">{t('待选文件', 'Select file')}</span>}
    </div>
  );
}

interface MultipartRowProps {
  row: MultipartField;
  vars: VarMap;
  update: UpdateRow;
  remove: () => void;
}

function MultipartRow({ row, vars, update, remove }: MultipartRowProps) {
  const { t } = useI18n();
  return (
    <tr className={`kv-row ${row.enabled ? '' : 'disabled'}`}>
      <td className="kv-check">
        <input type="checkbox" checked={row.enabled} onChange={e => update({ enabled: e.target.checked })} />
      </td>
      <td>
        <input
          className="input input-sm mono"
          style={{ width: '100%' }}
          value={row.key}
          placeholder={t('字段名', 'Field')}
          onChange={e => update({ key: e.target.value })}
        />
      </td>
      <td>
        <select
          className="select select-sm"
          style={{ width: '100%' }}
          value={row.isFile ? 'file' : 'text'}
          onChange={e => update({ isFile: e.target.value === 'file' })}
        >
          <option value="text">{t('文本', 'Text')}</option>
          <option value="file">{t('文件', 'File')}</option>
        </select>
      </td>
      <td>
        {row.isFile
          ? <FileCell row={row} update={update} />
          : <TemplateInput value={row.value} onChange={value => update({ value })} vars={vars} bordered compact />}
      </td>
      <td className="kv-del">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={remove} title={t('删除字段', 'Delete field')}>
          <IconTrash size={13} />
        </button>
      </td>
    </tr>
  );
}

export function MultipartTable({ req, vars }: { req: HttpRequest; vars: VarMap }) {
  const { t } = useI18n();
  const changeRows = (edit: (rows: MultipartField[]) => MultipartField[]) => {
    // A file read may finish after another row was edited.
    const { data, updateRequest } = useAppStore.getState();
    const current = data.requests.find(r => r.id === req.id);
    if (current?.body.type === 'multipart') {
      updateRequest(req.id, { body: { ...current.body, multipart: edit(current.body.multipart) } });
    }
  };
  return (
    <div className="tab-scroll">
      <table className="kv-table">
        <thead>
          <tr>
            <th className="kv-check" />
            <th style={{ width: '28%' }}>{t('字段名', 'Field')}</th>
            <th style={{ width: 82 }}>{t('类型', 'Type')}</th>
            <th>{t('值 / 文件', 'Value / File')}</th>
            <th className="kv-del" />
          </tr>
        </thead>
        <tbody>
          {req.body.multipart.map(row => (
            <MultipartRow
              key={row.id}
              row={row}
              vars={vars}
              update={patch => changeRows(rows => rows.map(field => field.id === row.id ? { ...field, ...patch } : field))}
              remove={() => changeRows(rows => rows.filter(field => field.id !== row.id))}
            />
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => changeRows(rows => [...rows, { ...kv(), isFile: false }])}>
          <IconPlus size={13} />
          {t('添加字段', 'Add Field')}
        </button>
      </div>
    </div>
  );
}

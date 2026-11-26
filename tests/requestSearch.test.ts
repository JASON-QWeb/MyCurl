import { describe, expect, it } from 'vitest';
import { newFolder, newRequest, seedData } from '../src/lib/factory';
import { filterSidebarTree, filterWorkspaceRequests, parseRequestSearch } from '../src/lib/requestSearch';

describe('command palette request search', () => {
  const data = seedData();
  const ws = data.workspaces[0].id;
  const root = newFolder(ws, null, { name: 'Billing Ops' });
  const child = newFolder(ws, root.id, { name: 'Payments' });
  data.folders = [root, child];
  const make = (method: string, folder: string | null, workspace = ws) =>
    newRequest(workspace, folder, { name: 'Invoice status', url: 'https://localhost/v1/invoices', method });
  const nested = make('PoSt', child.id);
  const direct = make('GET', root.id);
  const unfiled = make('POST', null);
  data.requests = [nested, direct, unfiled, make('POST', child.id, 'another-workspace')];
  const search = (query: string) => filterWorkspaceRequests(data, ws, parseRequestSearch(query));

  it('combines case-insensitive methods, ancestor paths, and text in names or URLs', () => {
    expect(search('METHOD:post folder:"BILLING ops" /V1/')).toEqual([nested]);
    expect(search('Invoice folder:"Billing Ops/Payments" status')).toEqual([nested]);
    expect(search('folder:payments method:GET')).toEqual([]);
    expect(search('method:pos')).toEqual([]);
  });

  it('keeps unfiled requests in method searches and out of folder searches', () => {
    expect(search('method:post')).toEqual([nested, unfiled]);
    expect(search('folder:"Billing Ops"')).toEqual([nested, direct]);
  });

  it('keeps ordinary and incomplete terms as literal palette searches', () => {
    for (const term of ['Invoice status', 'https://localhost', 'folder:', 'methodology:abc', 'foo:bar']) {
      expect(parseRequestSearch(term)).toMatchObject({ filtered: false, text: term.toLowerCase() });
    }
    expect(search('Invoice status')).toEqual([nested, direct, unfiled]);
    expect(search('missing')).toEqual([]);
  });

  it('keeps only ancestor paths for combined filters, and includes empty folders for folder-only searches', () => {
    const empty = newFolder(ws, root.id, { name: 'Archive' });
    const unrelated = newFolder(ws, null, { name: 'Unrelated' });
    const extended = { ...data, folders: [...data.folders, empty, unrelated] };
    const tree = (query: string) => filterSidebarTree(extended, ws, parseRequestSearch(query));
    expect(tree('method:POST folder:"Billing Ops" /V1/')).toEqual({
      folderIds: new Set([root.id, child.id]), requestIds: new Set([nested.id]),
    });
    expect(tree('method:POST').requestIds).toEqual(new Set([nested.id, unfiled.id]));
    expect(tree('folder:"billing ops"').folderIds).toEqual(new Set([root.id, child.id, empty.id]));
    expect(tree('method:GET folder:archive')).toEqual({ folderIds: new Set(), requestIds: new Set() });
  });

  it('preserves ordinary sidebar method, folder name and host searches', () => {
    const extended = { ...data, folders: [{ ...root, host: 'billing.local' }, child] };
    const tree = (query: string) => filterSidebarTree(extended, ws, parseRequestSearch(query));
    expect(tree('post').requestIds).toEqual(new Set([nested.id, unfiled.id]));
    expect(tree('billing ops')).toEqual({ folderIds: new Set([root.id]), requestIds: new Set([direct.id]) });
    expect(tree('billing.local')).toEqual({ folderIds: new Set([root.id]), requestIds: new Set() });
  });
});

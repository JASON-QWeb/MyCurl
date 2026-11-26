import { describe, expect, it } from 'vitest';
import { newFolder, newRequest, seedData } from '../src/lib/factory';
import { filterWorkspaceRequests, parseRequestSearch } from '../src/lib/requestSearch';

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
});

export const ontologyFixture = {
  declaration: {
    schemaVersion: 1,
    entities: { path: 'ontology/entities.csv', note: 'note', parent: 'parentId', group: 'group' },
    relations: { path: 'ontology/relations.csv' },
  },
  entities:
    '\uFEFFid,label,note,parentId,group,unknown\r\nroot,ナレッジ,notes/概念.md,,基礎,"keep, this"\r\nresearch,調査,notes/調査.md,root,調査,"two\r\nlines"\r\nsource,資料,,research,調査,untouched\r\noutput,成果物,,root,活用,extra\r\n',
  relations:
    'sourceId,relation,targetId,extra\nresearch,参照する,source,kept\nsource,支える,output,untouched\n',
};

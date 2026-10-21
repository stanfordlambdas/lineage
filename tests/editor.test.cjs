const {test} = require('node:test');
const assert = require('node:assert/strict');
const Editor = require('../public/editor.js');

const BIG = '7a71d737-cfb8-4225-bdf9-b9a98e790ef1';
const LITTLE = '77319fa7-16cc-4a8d-b97c-1fe58f0434e5';
const OTHER = 'ecedce32-43a9-451d-a629-4c6c7cf719be';
function source() {
  return {schema_version:2, classes:['Founding','Alpha','Beta'], members:[
    {id:BIG,name:'Big Brother',class:'Founding',roles:['president'],layout_x:1},
    {id:LITTLE,name:'Little Brother',class:'Alpha',roles:[],layout_x:2},
  ], edges:[{source:BIG,target:LITTLE}]};
}

test('editor generates stable opaque UUIDs for new members and preserves sanitized schema', () => {
  const result = Editor.addMember(source(), {name:' New Member ',class:'Beta',roles:['sensei']}, () => OTHER);
  assert.deepEqual(result.member, {id:OTHER,name:'New Member',class:'Beta',roles:['sensei'],layout_x:1});
  assert.deepEqual(Object.keys(result.source), ['schema_version','classes','members','edges']);
  assert.deepEqual(Object.keys(result.member), ['id','name','class','roles','layout_x']);
});

test('editor allows multiple Big Brothers and adds/removes relationships by stable IDs', () => {
  const data = source();
  data.members.push({id:OTHER,name:'Second Big Brother',class:'Founding',roles:[],layout_x:3});
  const multi = Editor.addEdge(data, OTHER, LITTLE);
  assert.equal(multi.edges.length, 2);
  const updated = Editor.removeEdge(multi, OTHER, LITTLE);
  assert.deepEqual(updated.edges, data.edges);
});

test('editor rejects duplicate, self, unknown, and backwards relationships', () => {
  assert.throws(() => Editor.addEdge(source(), BIG, LITTLE), /already exists/);
  assert.throws(() => Editor.addEdge(source(), BIG, BIG), /own Big Brother/);
  assert.throws(() => Editor.addEdge(source(), OTHER, LITTLE), /does not exist/);
  assert.throws(() => Editor.addEdge(source(), LITTLE, BIG), /earlier class/);
});

test('editor accepts the Evan Chen Award role', () => {
  const result = Editor.addMember(source(), {name:'Honoree',class:'Beta',roles:['president','evan_chen_award']}, () => OTHER);
  assert.deepEqual(result.member.roles, ['president','evan_chen_award']);
});

test('editor never persists unrecognized member fields and rejects unsupported roles', () => {
  const result = Editor.addMember(source(), {name:'Safe Name',class:'Beta',email:'secret@example.test'}, () => OTHER);
  assert.equal('email' in result.member, false);
  assert.throws(() => Editor.addMember(source(), {name:'Unsafe',class:'Beta',roles:['admin']}, () => OTHER), /President, Sensei, and\/or Evan Chen Award/);
  assert.throws(() => Editor.addMember(source(), {name:'Unsafe',class:'missing'}, () => OTHER), /valid class/);
});

test('search returns name/class matches without changing source', () => {
  const data = source();
  assert.deepEqual(Editor.searchMembers(data, 'little'), [data.members[1]]);
  assert.deepEqual(Editor.searchMembers(data, 'founding'), [data.members[0]]);
  assert.deepEqual(Editor.searchMembers(data, ''), []);
});

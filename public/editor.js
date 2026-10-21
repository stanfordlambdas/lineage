/* Local-only editor for the sanitized, contributor-facing lineage source. */
(function (root) {
  'use strict';

  const ALLOWED_ROLES = new Set(['president', 'sensei', 'evan_chen_award']);
  const ROLE_LABELS = {president: 'President', sensei: 'Sensei', evan_chen_award: 'Evan Chen Award'};
  const ROOT_KEYS = ['schema_version', 'classes', 'members', 'edges'];
  const MEMBER_KEYS = ['id', 'name', 'class', 'roles', 'layout_x'];
  const EDGE_KEYS = ['source', 'target'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function assertCanonical(source) {
    const fail = (message) => { throw new Error(message); };
    const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
    if (!exactKeys(source, ROOT_KEYS) || source.schema_version !== 2) fail('Source must use schema version 2 and contain only classes, members, and edges.');
    if (!Array.isArray(source.classes) || !source.classes.length || source.classes.some(c => typeof c !== 'string' || !c.trim())) fail('Add at least one named class.');
    if (new Set(source.classes).size !== source.classes.length) fail('Class names must be unique.');
    if (!Array.isArray(source.members) || !Array.isArray(source.edges)) fail('Members and relationships must be arrays.');
    const ranks = new Map(source.classes.map((className, rank) => [className, rank]));
    const ids = new Set();
    for (const member of source.members) {
      if (!exactKeys(member, MEMBER_KEYS)) fail('Members may contain only id, name, class, roles, and layout_x.');
      if (typeof member.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(member.id)) fail('Member IDs must be canonical lowercase UUIDv4 values.');
      if (ids.has(member.id)) fail('Member IDs must be unique.');
      ids.add(member.id);
      if (typeof member.name !== 'string' || !member.name.trim()) fail('Every member needs a name.');
      if (typeof member.class !== 'string' || !ranks.has(member.class)) fail(`Choose a valid class for ${member.name || 'the member'}.`);
      if (!Array.isArray(member.roles) || member.roles.some(role => !ALLOWED_ROLES.has(role)) || new Set(member.roles).size !== member.roles.length) fail(`Roles for ${member.name} must be unique President/Sensei/Evan Chen Award values.`);
      if (typeof member.layout_x !== 'number' || !Number.isFinite(member.layout_x)) fail(`Layout position for ${member.name} must be a finite number.`);
    }
    const pairs = new Set();
    for (const edge of source.edges) {
      if (!exactKeys(edge, EDGE_KEYS) || typeof edge.source !== 'string' || typeof edge.target !== 'string') fail('Relationships must contain Big and Little member IDs only.');
      const big = source.members.find(member => member.id === edge.source);
      const little = source.members.find(member => member.id === edge.target);
      if (!big || !little) fail('Relationship references a member that does not exist.');
      if (edge.source === edge.target) fail('A member cannot be their own Big Brother.');
      if (ranks.get(big.class) >= ranks.get(little.class)) fail('Big Brothers must be from an earlier class than their Little.');
      const pair = `${edge.source}:${edge.target}`;
      if (pairs.has(pair)) fail('That Big/Little relationship already exists.');
      pairs.add(pair);
    }
    return source;
  }

  function makeUuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    if (!root.crypto || typeof root.crypto.getRandomValues !== 'function') throw new Error('A secure browser context is required to generate member IDs.');
    const bytes = root.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function addMember(source, input, idFactory = makeUuid) {
    assertCanonical(source);
    const name = String(input.name || '').trim();
    const className = input.class;
    if (!name) throw new Error('Enter a member name.');
    if (!source.classes.includes(className)) throw new Error('Choose a valid class.');
    const roles = [...new Set(Array.isArray(input.roles) ? input.roles : [])];
    if (roles.some(role => !ALLOWED_ROLES.has(role))) throw new Error('Roles can only be President, Sensei, and/or Evan Chen Award.');
    const row = source.members.filter(member => member.class === className);
    const layout_x = input.layout_x === undefined || input.layout_x === ''
      ? (row.length ? Math.max(...row.map(member => member.layout_x)) + 2 : 1)
      : Number(input.layout_x);
    const member = {id: idFactory(), name, class: className, roles, layout_x};
    const next = clone(source);
    next.members.push(member);
    assertCanonical(next);
    return {source: next, member};
  }

  function addEdge(source, bigId, littleId) {
    assertCanonical(source);
    const next = clone(source);
    next.edges.push({source: bigId, target: littleId});
    assertCanonical(next);
    return next;
  }

  function removeEdge(source, bigId, littleId) {
    assertCanonical(source);
    const next = clone(source);
    const before = next.edges.length;
    next.edges = next.edges.filter(edge => !(edge.source === bigId && edge.target === littleId));
    if (next.edges.length === before) throw new Error('That relationship was not found.');
    return next;
  }

  function searchMembers(source, query) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return [];
    return source.members.filter(member => `${member.name} ${member.class} ${member.roles.join(' ')}`.toLocaleLowerCase().includes(needle));
  }

  function mount(container, initialSource, options = {}) {
    if (!container || !root.document) throw new Error('Mount the editor into a browser element.');
    let source = clone(initialSource);
    assertCanonical(source);
    let selectedBig = null, selectedLittle = null;
    const doc = container.ownerDocument || root.document;
    const el = (tag, attrs = {}, text = '') => {
      const node = doc.createElement(tag);
      Object.entries(attrs).forEach(([key, value]) => key === 'className' ? node.className = value : node.setAttribute(key, value));
      if (text) node.textContent = text;
      return node;
    };
    const rootEl = el('section', {className: 'lineage-editor', 'aria-label': 'Lineage editor'});
    const title = el('h2', {}, 'Edit Lineage');
    const intro = el('p', {className: 'lineage-editor__notice'}, 'Changes stay in this browser until you download the sanitized JSON and submit it in a pull request.');
    const status = el('p', {className: 'lineage-editor__status', role: 'status', 'aria-live': 'polite'});
    const form = el('form', {className: 'lineage-editor__member-form'});
    const nameInput = el('input', {name: 'name', required: 'required', maxlength: '120', placeholder: 'Full Name', 'aria-label': 'Member name'});
    const classSelect = el('select', {name: 'class', required: 'required', 'aria-label': 'Class'});
    source.classes.forEach(className => classSelect.append(el('option', {value: className}, className)));
    const rolesLabel = el('span', {className: 'lineage-editor__label'}, 'Roles and Honors');
    const roleControls = el('div', {className: 'lineage-editor__roles'});
    ALLOWED_ROLES.forEach(role => {
      const label = el('label');
      const checkbox = el('input', {type: 'checkbox', value: role});
      label.append(checkbox, doc.createTextNode(` ${ROLE_LABELS[role]}`));
      roleControls.append(label);
    });
    const addMemberButton = el('button', {type: 'submit'}, 'Add Member');
    form.append(nameInput, classSelect, rolesLabel, roleControls, addMemberButton);

    const relationships = el('section', {className: 'lineage-editor__relationships'});
    relationships.append(el('h3', {}, 'Big → Little Relationship'));
    const bigInput = el('input', {type: 'search', placeholder: 'Search Big Brother by name', 'aria-label': 'Search Big Brother'});
    const bigResults = el('div', {className: 'lineage-editor__results', role: 'listbox', 'aria-label': 'Big Brother search results'});
    const littleInput = el('input', {type: 'search', placeholder: 'Search Little Brother by name', 'aria-label': 'Search Little Brother'});
    const littleResults = el('div', {className: 'lineage-editor__results', role: 'listbox', 'aria-label': 'Little Brother search results'});
    const chosen = el('p', {className: 'lineage-editor__chosen'});
    const addRelationship = el('button', {type: 'button', disabled: 'disabled'}, 'Add Relationship');
    relationships.append(bigInput, bigResults, littleInput, littleResults, chosen, addRelationship);

    const edgeSection = el('section', {className: 'lineage-editor__edge-list'});
    edgeSection.append(el('h3', {}, 'Recorded Relationships'));
    const edgesList = el('ul');
    edgeSection.append(edgesList);
    const exportButton = el('button', {type: 'button', className: 'lineage-editor__export'}, 'Download lineage.json for PR');
    rootEl.append(title, intro, form, relationships, edgeSection, exportButton, status);
    container.replaceChildren(rootEl);

    function memberLabel(id) {
      const member = source.members.find(item => item.id === id);
      if (!member) return 'Unknown member';
      const duplicates = source.members.filter(item => item.name.toLocaleLowerCase() === member.name.toLocaleLowerCase()).length;
      const qualifier = duplicates > 1 ? ` · ${member.class} · ${source.members.filter(item => item.class === member.class && item.name.toLocaleLowerCase() === member.name.toLocaleLowerCase()).indexOf(member) + 1}` : ` · ${member.class}`;
      return `${member.name}${qualifier}`;
    }
    function setStatus(message, error = false) {
      status.textContent = message;
      status.dataset.state = error ? 'error' : 'success';
    }
    function publishChange() {
      if (typeof options.onChange === 'function') options.onChange(clone(source));
    }
    function renderResults(input, target, current, onChoose) {
      target.replaceChildren();
      const matches = searchMembers(source, input.value).slice(0, 12);
      matches.forEach(member => {
        const button = el('button', {type: 'button', role: 'option', 'aria-selected': String(current === member.id)}, memberLabel(member.id));
        button.addEventListener('click', () => { onChoose(member.id); render(); });
        target.append(button);
      });
      if (input.value.trim() && !matches.length) target.append(el('p', {className: 'lineage-editor__empty'}, 'No matching members.'));
    }
    function render() {
      renderResults(bigInput, bigResults, selectedBig, id => { selectedBig = id; });
      renderResults(littleInput, littleResults, selectedLittle, id => { selectedLittle = id; });
      chosen.textContent = `Big: ${selectedBig ? memberLabel(selectedBig) : 'not selected'}  ·  Little: ${selectedLittle ? memberLabel(selectedLittle) : 'not selected'}`;
      addRelationship.disabled = !(selectedBig && selectedLittle);
      edgesList.replaceChildren();
      source.edges.forEach(edge => {
        const row = el('li');
        row.append(doc.createTextNode(`${memberLabel(edge.source)} → ${memberLabel(edge.target)} `));
        const remove = el('button', {type: 'button', 'aria-label': `Remove relationship ${memberLabel(edge.source)} to ${memberLabel(edge.target)}`}, 'Remove');
        remove.addEventListener('click', () => {
          try { source = removeEdge(source, edge.source, edge.target); setStatus('Relationship removed. Download JSON to include the change in a PR.'); publishChange(); render(); }
          catch (error) { setStatus(error.message, true); }
        });
        row.append(remove); edgesList.append(row);
      });
    }
    bigInput.addEventListener('input', () => renderResults(bigInput, bigResults, selectedBig, id => { selectedBig = id; render(); }));
    littleInput.addEventListener('input', () => renderResults(littleInput, littleResults, selectedLittle, id => { selectedLittle = id; render(); }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const roles = [...roleControls.querySelectorAll('input:checked')].map(input => input.value);
        const result = addMember(source, {name: nameInput.value, class: classSelect.value, roles});
        source = result.source;
        nameInput.value = '';
        roleControls.querySelectorAll('input').forEach(input => { input.checked = false; });
        setStatus(`Added ${result.member.name} to ${result.member.class} class. Member ID generated; download JSON to submit a PR.`);
        publishChange();
        render();
      } catch (error) { setStatus(error.message, true); }
    });
    addRelationship.addEventListener('click', () => {
      try {
        source = addEdge(source, selectedBig, selectedLittle);
        selectedBig = selectedLittle = null;
        setStatus('Relationship added. Download JSON to submit a PR.'); publishChange(); render();
      } catch (error) { setStatus(error.message, true); }
    });
    function exportJSON() {
      assertCanonical(source);
      const json = `${JSON.stringify(source, null, 2)}\n`;
      if (typeof options.onExport === 'function') options.onExport(json);
      else {
        const blob = new Blob([json], {type: 'application/json'});
        const url = root.URL.createObjectURL(blob);
        const link = el('a', {href: url, download: 'lineage.json'});
        doc.body.append(link); link.click(); link.remove(); root.URL.revokeObjectURL(url);
      }
      setStatus('Sanitized lineage.json exported. Open a PR with the updated source/lineage.json.');
      return json;
    }
    exportButton.addEventListener('click', exportJSON);
    render();
    return {
      getData: () => clone(source),
      validate: () => assertCanonical(source),
      exportJSON,
      destroy: () => rootEl.remove(),
    };
  }

  const api = {assertCanonical, addMember, addEdge, removeEdge, searchMembers, mount};
  if (typeof module !== 'undefined') module.exports = api;
  root.LineageEditor = api;
})(globalThis);

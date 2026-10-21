/* All imported data lives in memory. No requests, storage, analytics, or uploads. */
'use strict';
const $ = id => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
}
function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(ns, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
}
const canvas = $('canvas'), graphSvg = $('graph'), world = $('world');
let graph, index, points = new Map(), selected = null, isolated = false, activeClass = null;
let family = null, visibleIds = new Set(), nodeElements = new Map(), edgeElements = [];
let camera = {x: 0, y: 0, scale: 0.85}, miniBounds, miniWindow;
let editorMounted = false, editorSource = globalThis.LINEAGE_SOURCE || null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function closeIcon() {
  const icon = svgEl('svg', {class:'icon', viewBox:'0 0 16 16', 'aria-hidden':'true'});
  icon.append(svgEl('path', {d:'m4 4 8 8M12 4l-8 8'}));
  return icon;
}

function graphFromSource(source) {
  const idBySource = new Map(source.members.map((member, i) => [member.id, i + 1]));
  return {
    nodes: source.members.map((member, i) => ({
      id: i + 1, display_name: member.name, class_name: member.class,
      rank: source.classes.indexOf(member.class), x: member.layout_x, roles: member.roles,
    })),
    edges: source.edges.map(edge => ({source: idBySource.get(edge.source), target: idBySource.get(edge.target)})),
  };
}

function mountEditor() {
  const root = $('editor-root');
  if (editorMounted) return;
  if (!editorSource) {
    root.replaceChildren(el('p', {class:'editor-unavailable'}, 'The local editor source is not preloaded. Run `python scripts/prepare_viewer.py` to create the sanitized local source, then reload this page.'));
    return;
  }
  if (!globalThis.LineageEditor) {
    root.replaceChildren(el('p', {class:'editor-unavailable'}, 'The local editor module is not available on this page.'));
    return;
  }
  try {
    globalThis.LineageEditor.mount(root, editorSource, {
      onChange(updatedSource) {
        editorSource = updatedSource;
        globalThis.LINEAGE_SOURCE = updatedSource;
        load(graphFromSource(updatedSource));
      },
    });
    editorMounted = true;
  } catch (error) {
    root.replaceChildren(el('p', {class:'editor-unavailable'}, `Editor could not be opened: ${error.message}`));
  }
}

function load(raw) {
  const parsed = Lineage.normalize(raw); // Validate before replacing a working graph.
  graph = parsed; index = Lineage.model(graph);
  ['overview','recent','clear','zoom-out','zoom-level','zoom-in','fit'].forEach(id => { $(id).disabled = false; });
  selected = null; isolated = false; family = null; activeClass = null;
  $('member-search').value = '';
  closeSearch();
  showEmptyDetails();
  $('empty').hidden = true;
  $('summary').textContent = `${new Set(graph.nodes.map(n => n.rank)).size} Pledge Classes`;
  $('classes').replaceChildren();
  const classes = [...new Map(graph.nodes.map(n => [n.rank, n.class_name])).entries()].sort((a,b) => a[0]-b[0]);
  for (const [rank, label] of classes) {
    const button = el('button', {'data-rank': rank});
    button.append(el('span', {class:'class-number'}, String(rank + 1).padStart(2, '0')), el('span', {}, label));
    button.addEventListener('click', () => jumpClass(rank)); $('classes').append(button);
  }
  render();
  // Start with readable recent cards; the minimap provides context for the full map.
  recent();
}

function render() {
  visibleIds = isolated && family ? family.all : new Set(graph.nodes.map(n => n.id));
  const visible = graph.nodes.filter(n => visibleIds.has(n.id));
  points = Lineage.layout(visible);
  world.replaceChildren(); nodeElements = new Map(); edgeElements = [];
  const defs = svgEl('defs'), grad = svgEl('linearGradient', {id:'both'});
  grad.append(svgEl('stop', {offset:'50%', class:'both-president'}), svgEl('stop', {offset:'50%', class:'both-sensei'})); defs.append(grad); world.append(defs);
  const bounds = Lineage.bounds(visibleIds, points);
  // Size the SVG to the map; the camera moves it with a CSS transform (see applyCamera).
  graphSvg.setAttribute('width', Math.ceil(bounds.x + bounds.w + 60));
  graphSvg.setAttribute('height', Math.ceil(bounds.y + bounds.h + Lineage.ROW));
  const rows = [...new Map(visible.map(n => [n.rank,n.class_name])).entries()].sort((a,b)=>a[0]-b[0]);
  for (const [rank, name] of rows) {
    const y = 90 + rank * Lineage.ROW;
    if (rank % 2 === 0) world.append(svgEl('rect', {x:0,y:y-Lineage.ROW/2,width:bounds.x+bounds.w+60,height:Lineage.ROW,class:'band'}));
    // Repeat class labels across wide rows so a class remains identifiable while panning.
    for (let x = 30; x < bounds.x + bounds.w; x += 1100) world.append(svgEl('text', {x,y:y-49,class:'class-label'}, name));
  }
  const edgeLayer=svgEl('g'), nodeLayer=svgEl('g'); world.append(edgeLayer,nodeLayer);
  for (const edge of graph.edges) {
    const a=points.get(edge.source), b=points.get(edge.target);
    if(!a || !b) continue;
    const path=svgEl('path', {d:routeEdge(edge,a,b),class:'edge'});
    edgeLayer.append(path); edgeElements.push({edge,path});
  }
  for (const n of visible) {
    const p=points.get(n.id);
    const president=n.roles.includes('president'), sensei=n.roles.includes('sensei'), award=n.roles.includes('evan_chen_award');
    const roleClass=president&&sensei?'both':president?'president':sensei?'sensei':'';
    const roleLabel=roleClass==='both'?'President and Sensei':roleClass==='president'?'President':roleClass==='sensei'?'Sensei':'';
    const g=svgEl('g',{class:`node ${roleClass}${award?' award':''}`,transform:`translate(${p.x},${p.y})`,tabindex:'0',role:'button','aria-label':`${n.display_name}, ${n.class_name} class${roleLabel?`, ${roleLabel}`:''}${award?', Evan Chen Award recipient':''}`});
    g.append(svgEl('title',{},`${n.display_name} · ${n.class_name}`),svgEl('rect',{x:-Lineage.CARD_W/2,y:-Lineage.CARD_H/2,width:Lineage.CARD_W,height:Lineage.CARD_H,class:'card'}));
    const name=svgEl('text',{x:0,'text-anchor':'middle',class:'name'});
    const lines=[];
    for(const word of n.display_name.split(/\s+/)) {
      const current=lines.length-1;
      if(current<0 || `${lines[current]} ${word}`.trim().length>23) lines.push(word);
      else lines[current]+=` ${word}`;
    }
    const rowCount=lines.length+(roleClass?1:0);
    const startY=-(rowCount-1)*8+5;
    lines.forEach((line,i)=>name.append(svgEl('tspan',{x:0,dy:i===0?startY:16},line)));
    g.append(name);
    if(roleClass) g.append(svgEl('text',{x:0,y:startY+lines.length*16,'text-anchor':'middle',class:'role','aria-hidden':'true'},roleClass==='both'?'President & Sensei':roleLabel));
    if(award) g.append(svgEl('text',{x:Lineage.CARD_W/2-14,y:-Lineage.CARD_H/2+18,'text-anchor':'middle',class:'award-mark','aria-hidden':'true'},'★'));
    g.addEventListener('click',()=>{ if(!suppressClick) select(n.id); });
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();select(n.id);}});
    nodeLayer.append(g); nodeElements.set(n.id,g);
  }
  buildMini(); updateStyles(); transform();
}

function routeEdge(edge, a, b) {
  const source=index.byId.get(edge.source), target=index.byId.get(edge.target);
  const outgoing=index.children.get(edge.source), incoming=index.parents.get(edge.target);
  const port=(neighbors,id)=>neighbors.length>1?(neighbors.indexOf(id)-(neighbors.length-1)/2)*3:0;
  const x1=a.x+port(outgoing,edge.target), x2=b.x+port(incoming,edge.source);
  const y1=a.y+Lineage.CARD_H/2, y2=b.y-Lineage.CARD_H/2, middle=(y1+y2)/2;
  const obstacles=source.rank+1<target.rank?graph.nodes.filter(n=>n.rank>source.rank&&n.rank<target.rank&&points.has(n.id)).map(n=>points.get(n.id)):[];
  const pathFor=bow=>`M${x1},${y1} C${x1+bow},${middle} ${x2+bow},${middle} ${x2},${y2}`;
  if(!obstacles.length) return pathFor(0);
  const collisionCount=bow=>{
    let hits=0;
    for(let step=1;step<48;step++) {
      const t=step/48, mt=1-t;
      const x=mt**3*x1+3*mt**2*t*(x1+bow)+3*mt*t**2*(x2+bow)+t**3*x2;
      const y=mt**3*y1+3*mt**2*t*middle+3*mt*t**2*middle+t**3*y2;
      if(obstacles.some(p=>Math.abs(x-p.x)<Lineage.CARD_W/2+8&&Math.abs(y-p.y)<Lineage.CARD_H/2+5)) hits++;
    }
    return hits;
  };
  if(!collisionCount(0)) return pathFor(0);
  // Search both sides of the corridor, preferring the smallest clear detour.
  let bestBow=0,bestHits=Infinity;
  for(let offset=90;offset<=900;offset+=45) {
    for(const bow of [offset,-offset]) {
      const hits=collisionCount(bow);
      if(hits<bestHits){bestHits=hits;bestBow=bow;}
      if(!hits) return pathFor(bow);
    }
  }
  // Dense intermediate rows can leave no clear single-cubic corridor. Route
  // through the row gaps and use an outside gutter so the edge cannot cross a card.
  if(bestHits>0) {
    const left=Math.min(...obstacles.map(p=>p.x))-Lineage.CARD_W/2-24;
    const right=Math.max(...obstacles.map(p=>p.x))+Lineage.CARD_W/2+24;
    const gutter=Math.abs(x1-left)+Math.abs(x2-left)<Math.abs(x1-right)+Math.abs(x2-right)?left:right;
    const gapTop=y1+Lineage.ROW/2-Lineage.CARD_H/2-12, gapBottom=y2-Lineage.ROW/2+Lineage.CARD_H/2+12;
    return `M${x1},${y1} C${x1},${gapTop} ${gutter},${gapTop} ${gutter},${gapTop} L${gutter},${gapBottom} C${gutter},${gapBottom} ${x2},${gapBottom} ${x2},${y2}`;
  }
  return pathFor(bestBow);
}

function updateStyles() {
  for (const [id,g] of nodeElements) {
    const n=index.byId.get(id), filtered=activeClass===null||n.rank===activeClass;
    g.classList.toggle('selected',id===selected);
    g.classList.toggle('related',!!family?.all.has(id));
    g.classList.toggle('dim',family?!family.all.has(id):!filtered);
  }
  for (const {edge,path} of edgeElements) {
    const chain=family?.all.has(edge.source)&&family?.all.has(edge.target);
    path.classList.toggle('active',!!chain);
    path.classList.toggle('dim',family?!chain:activeClass!==null&&!(index.byId.get(edge.source).rank===activeClass||index.byId.get(edge.target).rank===activeClass));
  }
  $('isolate').disabled=selected===null; $('fit-selection').disabled=selected===null;
  $('isolate').setAttribute('aria-pressed',String(isolated));
  $('isolate').textContent=isolated?'Show Full Map':'Isolate Lineage';
  document.querySelectorAll('#classes button').forEach(b=>{b.classList.toggle('active',Number(b.dataset.rank)===activeClass);b.setAttribute('aria-pressed',String(Number(b.dataset.rank)===activeClass));});
}

function select(id) {
  selected=id; family=index.family(id); activeClass=null;
  if(isolated) render(); else updateStyles();
  const n=index.byId.get(id);
  $('view-title').textContent=`${n.class_name} Class · Lineage Highlighted`;
  $('status').textContent='Connected relationships highlighted.';
  renderDetails(n);
  center(id,Math.max(camera.scale,.9));
}

function reset() {
  if(!graph)return;
  selected=null;family=null;isolated=false;activeClass=null;
  $('view-title').textContent='Explore the Connections';
  $('status').textContent='';
  showEmptyDetails();
  render();
}

function closeSearch() {
  const results = $('search-results');
  results.hidden = true;
  results.replaceChildren();
  $('member-search').setAttribute('aria-expanded', 'false');
}

function searchMembers() {
  if (!graph) return closeSearch();
  const query = $('member-search').value.trim().toLocaleLowerCase();
  const results = $('search-results');
  results.replaceChildren();
  if (!query) return closeSearch();

  const matches = graph.nodes.filter(n => `${n.display_name} ${n.class_name}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.display_name.localeCompare(b.display_name) || a.rank - b.rank);
  if (!matches.length) {
    results.append(el('p', {}, 'No members or classes found.'));
  } else {
    for (const n of matches.slice(0, 30)) {
      const result = el('button', {class:'result', type:'button', role:'option'});
      result.append(el('strong', {}, n.display_name), el('span', {}, `${n.class_name} Class`));
      result.addEventListener('click', () => {
        closeSearch();
        select(n.id);
        $('member-search').value = `${n.display_name} · ${n.class_name}`;
      });
      results.append(result);
    }
    if (matches.length > 30) results.append(el('p', {}, `Showing 30 of ${matches.length} matches. Refine your search.`));
  }
  results.hidden = false;
  $('member-search').setAttribute('aria-expanded', 'true');
}

function showEmptyDetails() {
  const aside = $('details');
  aside.classList.remove('open');
  aside.replaceChildren();
  aside.append(el('div', {class:'details-empty'}, ''));
  const content = aside.firstElementChild;
  content.append(el('span', {class:'eyebrow'}, 'Lineage Details'), el('h2', {}, 'Explore a Lineage'),
    el('p', {}, graph ? 'Search for a member or select a node to see their class, leadership roles and honors, Bigs, Littles, and connected lineage.' : 'Load the graph to explore member relationships.'));
}

function renderDetails(member) {
  const aside = $('details');
  aside.classList.add('open');
  aside.replaceChildren();
  const heading = el('div', {class:'details-heading'});
  const title = el('div');
  title.append(el('span', {class:'eyebrow'}, `${member.class_name} Class`), el('h2', {}, member.display_name));
  const close = el('button', {class:'details-close icon-button', type:'button', 'aria-label':'Close member details'});
  close.append(closeIcon());
  close.addEventListener('click', () => aside.classList.remove('open'));
  heading.append(title, close);
  const badges = el('div', {class:'badges'});
  // Both roles share one badge, matching the legend, so it fits beside long class names.
  const president = member.roles.includes('president'), sensei = member.roles.includes('sensei');
  if (president && sensei) badges.append(el('span', {class:'badge both-badge'}, 'President & Sensei'));
  else if (president) badges.append(el('span', {class:'badge president-badge'}, 'President'));
  else if (sensei) badges.append(el('span', {class:'badge sensei-badge'}, 'Sensei'));
  if (member.roles.includes('evan_chen_award')) badges.append(el('span', {class:'badge award-badge'}, 'Evan Chen Award'));
  if (!member.roles.length) badges.append(el('span', {class:'badge'}, 'Member'));
  heading.append(badges);
  aside.append(heading);

  const addSection = (title, ids, emptyText) => {
    const section = el('section', {class:'lineage-section'});
    const heading = el('h3', {}, title);
    heading.append(el('span', {class:'count'}, ` (${ids.length})`));
    section.append(heading);
    if (!ids.length) section.append(el('p', {class:'lineage-empty'}, emptyText));
    for (const id of ids) {
      const related = index.byId.get(id);
      if (!related) continue;
      const button = el('button', {class:'member-link', type:'button'});
      button.append(el('span', {}, related.display_name), el('small', {}, `${related.class_name} Class`));
      button.addEventListener('click', () => select(id));
      section.append(button);
    }
    aside.append(section);
  };
  const sortByClass = ids => [...ids].sort((a,b) => index.byId.get(a).rank - index.byId.get(b).rank || index.byId.get(a).display_name.localeCompare(index.byId.get(b).display_name));
  addSection('Bigs', sortByClass(index.parents.get(member.id)), 'No Big relationship recorded.');
  addSection('Littles', sortByClass(index.children.get(member.id)), 'No Little relationship recorded.');
  addSection('Ancestors', sortByClass(family.ancestors), 'No ancestors recorded.');
  addSection('Descendants', sortByClass(family.descendants), 'No descendants recorded.');
}
function jumpClass(rank) {
  reset();activeClass=rank;updateStyles();
  const group=graph.nodes.filter(n=>n.rank===rank).sort((a,b)=>a.x-b.x);
  $('view-title').textContent=group[0].class_name+' Class';
  $('status').textContent='Class highlighted · select a member to trace their connections';
  center(group[Math.floor(group.length/2)].id,.85);
}
function recent() {
  if(!graph)return; reset();
  const maxRank=Math.max(...graph.nodes.map(n=>n.rank));
  const nodes=graph.nodes.filter(n=>n.rank>=maxRank-3).sort((a,b)=>a.x-b.x);
  const mid=nodes[Math.floor(nodes.length/2)];
  camera.scale=.85;camera.x=canvas.clientWidth/2-points.get(mid.id).x*camera.scale;
  // Put the newest class just above the bottom edge, so taller screens show more recent classes.
  camera.y=canvas.clientHeight-96-(90+maxRank*Lineage.ROW+Lineage.CARD_H/2)*camera.scale;
  $('view-title').textContent='Recent Generations'; transform();
  // Show the newest classes in the list. Only the list scrolls, so short screens keep the sidebar title in view.
  $('classes').scrollTop=$('classes').scrollHeight;
}
function center(id,scale=camera.scale) {
  const p=points.get(id);if(!p)return;
  camera={scale:clamp(scale,.06,2.5),x:canvas.clientWidth/2-p.x*scale,y:canvas.clientHeight/2-p.y*scale};transform();
}
function fit(ids=visibleIds) {
  const b=Lineage.bounds(ids,points);if(!b)return;
  const scale=clamp(Math.min((canvas.clientWidth-60)/b.w,(canvas.clientHeight-100)/b.h),.06,1.1);
  camera={scale,x:canvas.clientWidth/2-(b.x+b.w/2)*scale,y:(canvas.clientHeight-45)/2-(b.y+b.h/2)*scale};transform();
}
function zoom(scale,x=canvas.clientWidth/2,y=canvas.clientHeight/2) {
  scale=clamp(scale,.06,2.5);camera.x=x-(x-camera.x)*scale/camera.scale;camera.y=y-(y-camera.y)*scale/camera.scale;camera.scale=scale;transform();
}
// Wheel and pointer events can arrive several times per frame, so apply the camera
// once per frame and never read layout here. The camera is a CSS transform on the
// <svg> element: changing an SVG transform attribute re-lays out every text label
// whenever the scale changes, while a CSS transform only repaints.
let cameraFrame=0, viewport={width:0,height:0}, zoomText='';
function transform() {
  if(!cameraFrame) cameraFrame=requestAnimationFrame(applyCamera);
}
function applyCamera() {
  cameraFrame=0;
  graphSvg.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
  world.classList.toggle('zoom-far',camera.scale<.45);
  const text=Math.round(camera.scale*100)+'%';
  if(text!==zoomText){zoomText=text;$('zoom-level').textContent=text;}
  if(miniWindow) {
    const width=viewport.width||canvas.clientWidth, height=viewport.height||canvas.clientHeight;
    miniWindow.setAttribute('x',-camera.x/camera.scale);miniWindow.setAttribute('y',-camera.y/camera.scale);
    miniWindow.setAttribute('width',width/camera.scale);miniWindow.setAttribute('height',height/camera.scale);
  }
}
function buildMini() {
  const mini=$('mini');mini.replaceChildren();miniBounds=Lineage.bounds(visibleIds,points);
  if(!miniBounds)return;
  const b=miniBounds;mini.setAttribute('viewBox',`${b.x} ${b.y} ${b.w} ${b.h}`);
  for(const p of points.values()) mini.append(svgEl('rect',{x:p.x-90,y:p.y-20,width:180,height:40,class:'mini-node'}));
  miniWindow=svgEl('rect',{class:'mini-window','vector-effect':'non-scaling-stroke'});mini.append(miniWindow);
}
$('mini').addEventListener('click',e=>{if(!graph)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform($('mini').getScreenCTM().inverse());camera.x=canvas.clientWidth/2-p.x*camera.scale;camera.y=canvas.clientHeight/2-p.y*camera.scale;transform();});
$('mini').addEventListener('keydown',e=>{if(e.key==='Enter')fit();});

let suppressClick=false, pointers=new Map(), drag=null, pinch=null;
canvas.addEventListener('pointerdown',e=>{
  if(e.target.closest('.map-tools,.minimap')||e.button>0)return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  // Capture on the hit node so a simple pointer release retains its click target.
  e.target.setPointerCapture(e.pointerId);
  suppressClick=false;drag={x:e.clientX,y:e.clientY,panX:camera.x,panY:camera.y};
  if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale:camera.scale};}
});
canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()],r=canvas.getBoundingClientRect();zoom(pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,(a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top);suppressClick=true;return;}
  if(!drag)return;
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4){suppressClick=true;canvas.classList.add('dragging');}
  camera.x=drag.panX+e.clientX-drag.x;camera.y=drag.panY+e.clientY-drag.y;transform();
});
function endPointer(e){pointers.delete(e.pointerId);pinch=null;drag=null;canvas.classList.remove('dragging');}
canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
canvas.addEventListener('wheel',e=>{
  if(!graph)return;e.preventDefault();
  // Firefox reports mouse wheels in lines or pages; convert them to pixels.
  const unit=e.deltaMode===1?16:e.deltaMode===2?viewport.height||canvas.clientHeight:1;
  const dx=e.deltaX*unit, dy=e.deltaY*unit;
  if(e.ctrlKey||e.metaKey){const r=canvas.getBoundingClientRect();zoom(camera.scale*Math.exp(-dy*.008),e.clientX-r.left,e.clientY-r.top);}
  else{camera.x-=dx+(e.shiftKey?dy:0);camera.y-=e.shiftKey?0:dy;transform();}
},{passive:false});
canvas.addEventListener('keydown',e=>{
  if(e.target.closest('button'))return;
  if(e.key==='+'||e.key==='=')zoom(camera.scale*1.2);
  else if(e.key==='-')zoom(camera.scale/1.2);
  else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();camera.x+=e.key==='ArrowLeft'?80:e.key==='ArrowRight'?-80:0;camera.y+=e.key==='ArrowUp'?80:e.key==='ArrowDown'?-80:0;transform();}
});
new ResizeObserver(([entry])=>{viewport={width:entry.contentRect.width,height:entry.contentRect.height};transform();}).observe(canvas);
// Focus or find-in-page can still scroll a clipped box in some browsers; the camera assumes it never scrolls.
canvas.addEventListener('scroll',()=>{canvas.scrollLeft=0;canvas.scrollTop=0;});
// Overlays sit below the header and map header, whose heights vary when they wrap on narrow screens.
const barHeights=new ResizeObserver(entries=>{
  for(const entry of entries) document.documentElement.style.setProperty(entry.target.matches('header')?'--header-h':'--map-header-h',`${entry.borderBoxSize[0].blockSize}px`);
});
barHeights.observe(document.querySelector('header'));barHeights.observe(document.querySelector('.map-header'));

$('isolate').addEventListener('click',()=>{if(selected===null)return;isolated=!isolated;render();center(selected,.95);});
$('fit-selection').addEventListener('click',()=>{if(family)fit(family.all);});
$('clear').addEventListener('click',reset);
$('recent').addEventListener('click',recent);
$('overview').addEventListener('click',()=>{reset();fit();$('view-title').textContent='The Full Lineage';});
$('zoom-in').addEventListener('click',()=>zoom(camera.scale*1.25));
$('zoom-out').addEventListener('click',()=>zoom(camera.scale/1.25));
$('zoom-level').addEventListener('click',()=>zoom(1));
$('fit').addEventListener('click',()=>fit());
$('import').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{load(JSON.parse(await file.text()));}catch(error){$('status').textContent=error.message;}finally{e.target.value='';}});
$('member-search').addEventListener('input',searchMembers);
$('member-search').addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeSearch();return;}
  if(e.key==='Enter'){
    const first=$('search-results').querySelector('.result');
    if(first){e.preventDefault();first.click();}
  }
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search-wrap'))closeSearch();});
// On phones the class list is a drawer over the map. Picking anything in it, tapping the map or pressing Escape closes it.
function setBrowse(open){$('browse').classList.toggle('open',open);$('browse-toggle').setAttribute('aria-expanded',String(open));if(open)$('overview').focus({preventScroll:true});}
$('browse-toggle').addEventListener('click',()=>setBrowse(!$('browse').classList.contains('open')));
$('browse').addEventListener('click',e=>{if(e.target.closest('button'))setBrowse(false);});
canvas.addEventListener('pointerdown',()=>setBrowse(false));
document.addEventListener('keydown',e=>{if(e.key==='Escape')setBrowse(false);});
$('editor-toggle').addEventListener('click',()=>{
  const panel=$('editor-panel'), open=panel.hidden;
  if(open) mountEditor();
  panel.hidden=!open;
  $('editor-toggle').setAttribute('aria-expanded',String(open));
  if(open) $('editor-close').focus();
});
$('editor-close').addEventListener('click',()=>{
  $('editor-panel').hidden=true;
  $('editor-toggle').setAttribute('aria-expanded','false');
  $('editor-toggle').focus();
});
 $('empty-import').addEventListener('click',()=>$('import').click());
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === 'light';
  $('theme-toggle').setAttribute('aria-pressed', String(light));
  $('theme-toggle').title = `Switch to ${light ? 'dark' : 'light'} mode`;
  $('theme-toggle').querySelector('span').textContent = light ? 'Dark Mode' : 'Light Mode';
}
$('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
try {if(globalThis.LINEAGE_DATA)load(globalThis.LINEAGE_DATA);else{$('empty').hidden=false;$('status').textContent='No graph loaded · your data stays on this device.';}}
catch(error){$('empty').hidden=false;$('status').textContent=error.message;}

// entity-learn canvas — vanilla JS spec renderer
// ~200 lines, zero frameworks, renders JSONL specs from entity-learn render

const API = '/api/ui';
const root = document.getElementById('root');
const dot = document.getElementById('dot');
const status = document.getElementById('status');

async function send(prompt) {
  dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
  status.textContent = 'resolving...';
  root.innerHTML = '<div class="flex items-center justify-center py-20 text-zinc-300"><div class="w-6 h-6 rounded border-2 border-zinc-200 animate-pulse"></div></div>';

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const text = await res.text();
    const spec = parseJSONL(text);
    if (spec.root) renderSpec(spec);
  } catch (e) {
    root.innerHTML = `<p class="text-red-500 text-sm">${e.message}</p>`;
  }

  dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
  status.textContent = '';
}

function parseJSONL(text) {
  const spec = { root: '', elements: {} };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      if (p.op === 'add') {
        const parts = p.path.split('/').filter(Boolean);
        if (parts[0] === 'root') spec.root = p.value;
        else if (parts[0] === 'elements' && parts[1]) spec.elements[parts[1]] = p.value;
      }
    } catch {}
  }
  return spec;
}

function renderSpec(spec) {
  root.innerHTML = '';
  const node = renderElement(spec.root, spec.elements);
  if (node) root.appendChild(node);
}

function renderElement(id, elements) {
  const el = elements[id];
  if (!el) return null;
  const fn = R[el.type];
  if (!fn) { console.warn('Unknown:', el.type); return null; }
  const node = fn(el.props);
  if (el.children) {
    for (const cid of el.children) {
      const child = renderElement(cid, elements);
      if (child) node.appendChild(child);
    }
  }
  return node;
}

// --- Helpers ---
function h(tag, cls, ...children) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  }
  return el;
}

function statusBadge(s) {
  if (!s) return null;
  const colors = {
    open:'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200', closed:'bg-zinc-50 text-zinc-400 ring-1 ring-zinc-200',
    warm:'bg-amber-50 text-amber-600 ring-1 ring-amber-200', cold:'bg-sky-50 text-sky-600 ring-1 ring-sky-200',
    dead:'bg-red-50 text-red-500 ring-1 ring-red-200', sent:'bg-violet-50 text-violet-600 ring-1 ring-violet-200',
    merged:'bg-purple-50 text-purple-600 ring-1 ring-purple-200', active:'bg-blue-50 text-blue-600 ring-1 ring-blue-200',
  };
  const badge = h('span', `text-[10px] px-2 py-0.5 rounded-md font-medium ${colors[s.toLowerCase()] ?? 'bg-zinc-50 text-zinc-400 ring-1 ring-zinc-200'}`, s.replace(/_/g,' '));
  return badge;
}

// --- Component Renderers ---
const R = {
  Stack(p) { return h('div', `flex flex-col ${{sm:'gap-1.5',md:'gap-3',lg:'gap-5'}[p.gap]??'gap-3'}`); },
  Row(p) { return h('div', `flex items-start ${{sm:'gap-1.5',md:'gap-3',lg:'gap-5'}[p.gap]??'gap-3'}`); },
  Grid(p) { const el = h('div','grid gap-3'); el.style.gridTemplateColumns=`repeat(${p.cols},1fr)`; return el; },

  ListView(p) {
    const wrap = h('div','');
    const hdr = h('div','mb-4', h('h2','text-[22px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100',p.title));
    if (p.subtitle) hdr.appendChild(h('p','text-[13px] text-zinc-400 mt-1',p.subtitle));
    wrap.appendChild(hdr);
    wrap.appendChild(h('div','space-y-1.5')); // children go in last child
    return wrap;
  },

  ListItem(p) {
    const btn = h('button','w-full text-left px-4 py-3.5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 hover:border-zinc-200 dark:hover:border-zinc-700 transition-all group active:scale-[0.99]');
    const row = h('div','flex items-center justify-between gap-3');
    const left = h('div','flex items-center gap-3 min-w-0');

    if (p.image) { const img = h('img','w-8 h-8 rounded-full ring-1 ring-zinc-200 shrink-0 object-cover'); img.src=p.image; img.onerror=()=>img.style.display='none'; left.appendChild(img); }
    else if (p.icon) left.appendChild(h('span','text-lg shrink-0',p.icon));

    const text = h('div','min-w-0');
    text.appendChild(h('p','text-[14px] font-medium text-zinc-800 dark:text-zinc-200 truncate group-hover:text-zinc-900 dark:group-hover:text-white transition-colors',p.title));
    if (p.subtitle) text.appendChild(h('p','text-[12px] text-zinc-400 truncate mt-0.5',p.subtitle));
    left.appendChild(text);
    row.appendChild(left);

    const right = h('div','flex items-center gap-2.5 shrink-0');
    const badge = statusBadge(p.status);
    if (badge) right.appendChild(badge);
    right.innerHTML += '<svg class="w-4 h-4 text-zinc-300 group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7"/></svg>';
    row.appendChild(right);
    btn.appendChild(row);
    btn.onclick = () => send(`navigate:${p.type??p.id}:${p.id}`);
    return btn;
  },

  DetailView(p) {
    const wrap = h('div','space-y-5');
    const hdr = h('div','flex items-start gap-3');
    if (p.image) { const img = h('img','w-10 h-10 rounded-full ring-2 ring-white dark:ring-zinc-900 mt-0.5 shrink-0'); img.src=p.image; hdr.appendChild(img); }
    else if (p.icon) hdr.appendChild(h('span','text-2xl mt-0.5',p.icon));
    const meta = h('div','flex-1 min-w-0');
    meta.appendChild(h('h1','text-[20px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 leading-snug',p.title));
    const sub = h('div','flex items-center gap-2 mt-1.5');
    if (p.subtitle) sub.appendChild(h('span','text-[12px] text-zinc-400',p.subtitle));
    const badge = statusBadge(p.status);
    if (badge) sub.appendChild(badge);
    meta.appendChild(sub);
    hdr.appendChild(meta);
    wrap.appendChild(hdr);
    wrap.appendChild(h('div','space-y-1 bg-white dark:bg-zinc-900/80 rounded-xl border border-zinc-100 dark:border-zinc-800 px-4 py-3'));
    return wrap;
  },

  NavBar(p) {
    const wrap = h('div','flex items-center gap-2 mb-2 -mx-1');
    const back = h('button','p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors active:scale-95');
    back.innerHTML = '<svg class="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>';
    back.onclick = () => send('back');
    wrap.appendChild(back);
    const crumbs = h('div','flex items-center gap-1.5 text-[12px] text-zinc-400');
    (p.breadcrumbs||[]).forEach((c,i,arr) => {
      if (i > 0) crumbs.appendChild(h('span','text-zinc-300 dark:text-zinc-700','/'));
      if (i < arr.length-1) {
        const btn = h('button','hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors',c);
        btn.onclick = () => i===0 ? send('init') : send(`navigate:${c}:${c}`);
        crumbs.appendChild(btn);
      } else crumbs.appendChild(h('span','text-zinc-600 dark:text-zinc-300 font-medium',c));
    });
    wrap.appendChild(crumbs);
    return wrap;
  },

  DataRow(p) {
    const row = h('div','flex items-baseline gap-3 py-2 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0');
    row.appendChild(h('span','text-[11px] text-zinc-400 w-28 shrink-0',p.label));
    const val = h('span','text-[13px] text-zinc-700 dark:text-zinc-300 break-all leading-relaxed');
    if (typeof p.value === 'string' && p.value.startsWith('http')) {
      const a = h('a','text-blue-500 hover:text-blue-600 underline underline-offset-2',p.value);
      a.href = p.value; a.target = '_blank'; val.appendChild(a);
    } else val.textContent = p.value;
    row.appendChild(val);
    return row;
  },

  Section(p) {
    const wrap = h('div','pt-3');
    const hdr = h('div','mb-2');
    hdr.appendChild(h('h3','text-[13px] font-semibold text-zinc-500 dark:text-zinc-400',p.title));
    if (p.subtitle) hdr.appendChild(h('p','text-[11px] text-zinc-400 mt-0.5',p.subtitle));
    wrap.appendChild(hdr);
    wrap.appendChild(h('div','space-y-1.5'));
    return wrap;
  },

  Card(p) {
    const wrap = h('div','rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-4 space-y-2');
    const hdr = h('div','flex items-center gap-2');
    if (p.icon) hdr.appendChild(h('span','',p.icon));
    hdr.appendChild(h('h3','font-medium text-[14px] text-zinc-800 dark:text-zinc-200 truncate',p.title));
    const badge = statusBadge(p.status);
    if (badge) { badge.classList.add('ml-auto'); hdr.appendChild(badge); }
    wrap.appendChild(hdr);
    if (p.subtitle) wrap.appendChild(h('p','text-[12px] text-zinc-400',p.subtitle));
    return wrap;
  },

  Metric(p) {
    const wrap = h('div','rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-4');
    wrap.appendChild(h('p','text-[11px] text-zinc-400',p.label));
    wrap.appendChild(h('p','text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mt-1 tracking-tight',p.value));
    if (p.delta) wrap.appendChild(h('p',`text-[12px] mt-1 font-medium ${p.trend==='up'?'text-emerald-500':p.trend==='down'?'text-red-500':'text-zinc-400'}`,p.delta));
    return wrap;
  },

  Badge(p) { return statusBadge(p.text) || h('span','',p.text); },

  Markdown(p) {
    const wrap = h('div','prose prose-sm prose-zinc dark:prose-invert max-w-none text-[13px]');
    // Simple markdown → HTML (handles headers, code blocks, bold, links, lists)
    let html = (p.content||'')
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    wrap.innerHTML = `<p>${html}</p>`;
    return wrap;
  },

  Avatar(p) {
    const wrap = h('div','inline-flex items-center gap-2');
    const img = h('img',`rounded-full ring-1 ring-zinc-200 object-cover ${p.size==='lg'?'w-12 h-12':p.size==='sm'?'w-6 h-6':'w-8 h-8'}`);
    img.src = p.src; img.onerror=()=>img.style.display='none';
    wrap.appendChild(img);
    if (p.name) wrap.appendChild(h('span','text-[13px] text-zinc-700 dark:text-zinc-300',p.name));
    return wrap;
  },

  LinkChip(p) {
    const btn = h('button','inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-[12px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 hover:border-zinc-300 transition-all active:scale-95');
    if (p.icon) btn.appendChild(h('span','text-sm',p.icon));
    const label = h('span','truncate max-w-[200px]',p.label);
    btn.appendChild(label);
    btn.innerHTML += '<svg class="w-3 h-3 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
    btn.onclick = () => send(`navigate:${p.entityType}:${p.entityId}`);
    return btn;
  },

  Text(p) {
    const styles = {
      body:'text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed',
      caption:'text-[11px] text-zinc-400 mt-3 mb-1',
      code:'text-[12px] font-mono bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5 rounded-lg break-all text-zinc-500 dark:text-zinc-400 leading-relaxed',
      heading:'text-lg font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight',
    };
    return h('p', styles[p.variant]||styles.body, p.content);
  },

  Divider() { return h('hr','border-zinc-100 dark:border-zinc-800/50 my-1'); },
  Empty(p) { return h('div','text-center py-12 text-zinc-400 text-[13px]',p.message); },
  ImageRow(p) { return h('div','flex items-center -space-x-2'); },
};

// Auto-init
send('init');

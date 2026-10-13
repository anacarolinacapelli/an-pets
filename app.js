'use strict';

const STORAGE_KEY = 'an-app:v1';
const KCAL_TOLERANCE = 0.10; // alerta quando a dieta fica mais de 10% fora da N.E.M
const VEG_TARGET = 6;        // g/kg de vegetais, conforme a orientação da planilha
const CATEGORIES = {
  proteina: 'Carne', viscera: 'Víscera muscular', orgao: 'Órgão', vegetal: 'Vegetal',
  carboidrato: 'Carboidrato', suplemento: 'Suplemento', outro: 'Outro',
};
const UNITS = ['g', 'ml', 'gotas'];

// ---------- utilidades ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
  let s = String(v ?? '').trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const inVal = (n) => (n == null ? '' : String(n).replace('.', ','));
const fmt = (n, max = 2) => (n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('pt-BR', { maximumFractionDigits: max }));
const money = (n) => (n == null ? '–' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pct = (x) => (x > 0 ? '+' : '') + (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const addDays = (s, n) => { const d = new Date(parseISO(s) + n * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const fmtDate = (s) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '–');
const fmtDateFull = (s) => (s ? s.split('-').reverse().join('/') : '–');

function qty(value, unit) {
  if (value == null || !Number.isFinite(value)) return '–';
  if (unit === 'gotas') return `${fmt(Math.round(value), 0)} gotas`;
  if (value >= 1000) return `${fmt(value / 1000, 2)} ${unit === 'g' ? 'kg' : 'L'}`;
  return `${fmt(value, value < 10 ? 2 : 1)} ${unit}`;
}
const perUnitLabel = (unit) => (unit === 'g' ? 'R$/kg' : unit === 'ml' ? 'R$/L' : '');

// ---------- dados iniciais (planilha "AN Ana") ----------
function seed() {
  const ing = (id, name, category, unit, kcal, price, note = '') => ({ id, name, category, unit, kcal, price, note });
  const r = (id, ingredientId, mode, amount, everyDays = 1) => ({ id, ingredientId, mode, amount, everyDays });
  const pet = (id, name, weight, overrides, phases) => ({
    id, name, weight, activity: 1.2, portions: 2, overrides, excluded: [],
    adaptation: { start: null, phases: phases.map(([from, to, kibble, an]) => ({ from, to, kibble, an })) },
    weights: [], notes: '',
  });
  return {
    version: 1,
    settings: { cycleDays: 20, cycleStart: todayISO() },
    ingredients: [
      ing('carne', 'Carne', 'proteina', 'g', 1.4, 19, 'Pernil suíno, sobrecoxa de frango, carne bovina (evitar peito bovino e cupim), peito de frango etc.'),
      ing('viscera', 'Víscera muscular', 'viscera', 'g', 1.7, 19, 'Moela de frango, coração de boi, coração suíno.'),
      ing('repolho', 'Repolho verde', 'vegetal', 'g', 0.25, 3.99),
      ing('abobrinha', 'Abobrinha', 'vegetal', 'g', 0.17, 7.99),
      ing('beterraba', 'Beterraba', 'vegetal', 'g', 0.43, 4.99),
      ing('pepino', 'Pepino', 'vegetal', 'g', 0.16, 5.99),
      ing('batata-doce', 'Batata-doce cozida', 'carboidrato', 'g', 0.86, 3, 'Pode trocar por batata inglesa ou asterix, mas a doce é preferível (melhor índice glicêmico).'),
      ing('figado', 'Fígado bovino', 'orgao', 'g', 1.35, null, 'Fígado bovino cru ≈ 135 kcal/100 g (USDA).'),
      ing('casca-ovo', 'Casca de ovo moída', 'suplemento', 'g', 0, null),
      ing('oleo-coco', 'Óleo de coco', 'suplemento', 'ml', 7.9, null, '≈ 862 kcal/100 g (USDA) × 0,92 g/ml.'),
      ing('propolis', 'Própolis verde 15%', 'suplemento', 'gotas', 0, null),
    ],
    recipe: [
      r('r-carne', 'carne', 'perKg', 20),
      r('r-viscera', 'viscera', 'perKg', 10),
      r('r-repolho', 'repolho', 'perKg', 2),
      r('r-abobrinha', 'abobrinha', 'perKg', 2),
      r('r-beterraba', 'beterraba', 'perKg', 1),
      r('r-pepino', 'pepino', 'perKg', 1),
      r('r-batata', 'batata-doce', 'perKg', 3),
      r('r-figado', 'figado', 'fixed', 20, 5),
      r('r-casca', 'casca-ovo', 'perKg', 0.067),
      r('r-oleo', 'oleo-coco', 'perKg', 0.167),
      r('r-propolis', 'propolis', 'perKg', 1),
    ],
    pets: [
      pet('scooby', 'Scooby', 12, { 'r-viscera': 9 }, [[1, 3, 110, 100], [4, 7, 75, 200], [8, 10, 40, 300]]),
      pet('bolt', 'Bolt', 7, {}, [[1, 3, 75, 65], [4, 7, 50, 120], [8, 10, 25, 200]]),
      pet('duda', 'Duda', 8, {}, [[1, 3, 80, 70], [4, 7, 55, 130], [8, 10, 30, 210]]),
    ],
    notes: [
      'Manter a suplementação já usada, seguindo a recomendação do fabricante.',
      '',
      'Vegetais: os da receita são sugestões. Pode usar vagem, cenoura, brócolis, couve-flor, couve, espinafre. O ideal é fazer rodízio e manter 6 g/kg no total de vegetais (ex.: 1 g/kg de couve-flor + 2 g/kg de cenoura + 3 g/kg de abobrinha).',
      '',
      'Batata-doce pode ser trocada por batata inglesa ou asterix, mas a doce é preferível.',
    ].join('\n'),
  };
}

function normalize(s) {
  s.settings ??= { cycleDays: 20, cycleStart: todayISO() };
  s.ingredients ??= []; s.recipe ??= []; s.pets ??= []; s.notes ??= '';
  for (const p of s.pets) {
    p.overrides ??= {}; p.excluded ??= []; p.weights ??= []; p.notes ??= '';
    p.portions ??= 2; p.activity ??= 1.2;
    p.adaptation ??= { start: null, phases: [] };
    p.adaptation.phases ??= [];
  }
  return s;
}

// ---------- armazenamento ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* segue com os dados iniciais */ }
  return seed();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast('Não foi possível salvar neste navegador.'); }
}

let state = load();
const ui = { shopDays: null, shopPets: null };

const ingById = (id) => state.ingredients.find((i) => i.id === id);
const petById = (id) => state.pets.find((p) => p.id === id);
const recipeItem = (id) => state.recipe.find((i) => i.id === id);

// ---------- cálculos ----------
function calcPet(pet, days = state.settings.cycleDays) {
  const rows = [];
  for (const item of state.recipe) {
    const ing = ingById(item.ingredientId);
    if (!ing) continue;
    const used = !pet.excluded.includes(item.id);
    const override = pet.overrides[item.id];
    const amount = override ?? item.amount;
    const every = item.mode === 'fixed' ? Math.max(1, item.everyDays || 1) : 1;
    const perEvent = item.mode === 'perKg' ? amount * pet.weight : amount;
    const daily = used ? perEvent / every : 0;
    const total = daily * days;
    const priced = ing.unit !== 'gotas' && ing.price != null;
    rows.push({
      item, ing, used, amount, overridden: override != null, every, perEvent, daily, total,
      kcal: daily * (ing.kcal || 0),
      cost: used && priced ? (total / 1000) * ing.price : null,
      missingPrice: used && ing.unit !== 'gotas' && ing.price == null,
    });
  }
  const used = rows.filter((r) => r.used);
  const kcal = sum(used, (r) => r.kcal);
  const rer = 70 * Math.pow(pet.weight, 0.75);
  const nem = rer * pet.activity;
  const base = used.filter((r) => r.every === 1 && r.ing.unit === 'g' && r.ing.category !== 'suplemento');
  const dailyFood = sum(base, (r) => r.daily);
  return {
    rows, kcal, rer, nem, diff: nem ? kcal / nem - 1 : 0,
    dailyFood, portion: dailyFood / Math.max(1, pet.portions),
    vegPerKg: sum(used.filter((r) => r.ing.category === 'vegetal' && r.item.mode === 'perKg'), (r) => r.amount),
    cost: sum(used, (r) => r.cost),
    missingPrice: used.some((r) => r.missingPrice),
  };
}

function adaptationStatus(pet, date = todayISO()) {
  const a = pet.adaptation;
  if (!a.start || !a.phases.length) return null;
  const day = daysBetween(a.start, date) + 1;
  if (day < 1) return { pending: true, start: a.start };
  const phase = a.phases.find((p) => day >= p.from && day <= p.to);
  if (phase) return { day, phase };
  const last = Math.max(...a.phases.map((p) => p.to));
  return day > last ? { done: true, day } : { day, gap: true };
}

function nextOccurrence(every, date = todayISO()) {
  const start = state.settings.cycleStart;
  const d = daysBetween(start, date);
  if (d <= 0) return start;
  const rest = d % every;
  return rest === 0 ? date : addDays(date, every - rest);
}

function kcalBadge(c) {
  const cls = Math.abs(c.diff) <= KCAL_TOLERANCE ? 'ok' : 'warn';
  return `<span class="badge ${cls}" title="Calorias da dieta × N.E.M">${fmt(c.kcal, 0)} kcal · meta ${fmt(c.nem, 0)} (${pct(c.diff)})</span>`;
}

function amountUnit(item, ing) {
  if (item.mode === 'perKg') return `${ing.unit}/kg`;
  return item.everyDays > 1 ? `${ing.unit} a cada ${item.everyDays} dias` : `${ing.unit}/dia`;
}

// ---------- telas ----------
function viewHoje() {
  const s = state.settings;
  const t = todayISO();
  const day = daysBetween(s.cycleStart, t) + 1;
  const end = addDays(s.cycleStart, s.cycleDays - 1);
  const over = day > s.cycleDays;
  let html = `
    <section class="card ${over ? 'warn' : ''}">
      <div class="spread">
        <div>
          <div class="eyebrow">Leva atual</div>
          <div class="big">${day >= 1 ? `Dia ${Math.min(day, 999)} de ${s.cycleDays}` : `Começa em ${fmtDate(s.cycleStart)}`}</div>
          <div class="muted">${over ? `Terminou em ${fmtDate(end)}. Hora de preparar a próxima.` : `Termina em ${fmtDate(end)}`}</div>
        </div>
        <button class="btn ${over ? '' : 'ghost'}" data-action="new-cycle">Nova leva hoje</button>
      </div>
    </section>`;

  if (!state.pets.length) {
    html += `<section class="card"><p>Nenhum pet cadastrado.</p><a class="btn" href="#pets">Cadastrar pet</a></section>`;
  }

  for (const pet of state.pets) {
    const c = calcPet(pet);
    const ad = adaptationStatus(pet);
    let serve;
    if (ad?.phase) {
      serve = `<div class="serve"><span class="tag">Transição · dia ${ad.day}</span>
        <div class="big">Ração ${fmt(ad.phase.kibble, 0)} g + AN ${fmt(ad.phase.an, 0)} g</div>
        <div class="muted">por dia · AN em ${pet.portions}× de ${fmt(ad.phase.an / pet.portions, 0)} g</div></div>`;
    } else if (ad?.pending) {
      serve = `<div class="serve"><span class="tag">Transição começa em ${fmtDate(ad.start)}</span>
        <div class="muted">Até lá, segue com a alimentação atual.</div></div>`;
    } else {
      serve = `<div class="serve"><div class="big">${pet.portions}× ${fmt(c.portion, 0)} g de AN</div>
        <div class="muted">${fmt(c.dailyFood, 0)} g por dia</div></div>`;
    }
    const extras = c.rows.filter((r) => r.used && r.every === 1 && r.ing.category === 'suplemento')
      .map((r) => `<li><span>${esc(r.ing.name)}</span><span class="num">${qty(r.daily, r.ing.unit)}/dia</span></li>`);
    const periodic = c.rows.filter((r) => r.used && r.every > 1).map((r) => {
      const next = nextOccurrence(r.every, t);
      return next === t
        ? `<li class="hi"><span>Hoje: ${esc(r.ing.name)}</span><span class="num">${qty(r.perEvent, r.ing.unit)}</span></li>`
        : `<li><span>Próximo ${esc(r.ing.name.toLowerCase())}</span><span class="num">${fmtDate(next)} · ${qty(r.perEvent, r.ing.unit)}</span></li>`;
    });
    html += `
      <section class="card">
        <div class="pet-head"><h2><a href="#pet/${esc(pet.id)}" style="color:inherit;text-decoration:none">${esc(pet.name)}</a></h2><span class="muted">${fmt(pet.weight, 1)} kg</span></div>
        ${serve}
        <ul class="list">${periodic.join('')}${extras.join('')}</ul>
        <div style="margin-top:10px">${kcalBadge(c)}</div>
      </section>`;
  }
  return html;
}

function viewPets() {
  let html = `<div class="spread" style="margin-bottom:12px"><h2 style="margin:0">Pets</h2><button class="btn" data-action="add-pet">Adicionar pet</button></div>`;
  for (const pet of state.pets) {
    const c = calcPet(pet);
    html += `
      <a class="card" href="#pet/${esc(pet.id)}" style="display:block;text-decoration:none;color:inherit">
        <div class="pet-head"><h2>${esc(pet.name)}</h2><span class="muted">${fmt(pet.weight, 1)} kg</span></div>
        <div class="muted" style="margin-bottom:8px">${fmt(c.dailyFood, 0)} g/dia · ${pet.portions}× ${fmt(c.portion, 0)} g · ${money(c.cost)} por leva</div>
        ${kcalBadge(c)}
      </a>`;
  }
  return html;
}

function viewPet(pet) {
  if (!pet) return `<a class="back" href="#pets">‹ Pets</a><p>Pet não encontrado.</p>`;
  const c = calcPet(pet);
  const days = state.settings.cycleDays;
  const pid = esc(pet.id);

  const rows = c.rows.map((r) => {
    const id = `ov-${pet.id}-${r.item.id}`;
    return `<tr class="${r.used ? '' : 'off'}">
      <td>${esc(r.ing.name)}${r.overridden ? ' <span class="badge warn" title="Diferente da receita">ajustado</span>' : ''}</td>
      <td><div class="row" style="flex-wrap:nowrap;gap:6px"><input id="${esc(id)}" class="w-s" inputmode="decimal" value="${inVal(pet.overrides[r.item.id])}" placeholder="${inVal(r.item.amount)}" data-field="pet.override" data-pet="${pid}" data-item="${esc(r.item.id)}" aria-label="${esc(r.ing.name)}: quantidade"><span class="muted small" style="white-space:nowrap">${esc(amountUnit(r.item, r.ing))}</span></div></td>
      <td class="r num">${r.used ? qty(r.daily, r.ing.unit) : '–'}</td>
      <td class="r num">${r.used ? qty(r.total, r.ing.unit) : '–'}</td>
      <td class="r num">${r.used ? fmt(r.kcal, 1) : '–'}</td>
      <td class="r num">${r.missingPrice ? '<span class="muted">sem preço</span>' : money(r.cost)}</td>
      <td><input type="checkbox" id="use-${esc(pet.id)}-${esc(r.item.id)}" ${r.used ? 'checked' : ''} data-field="pet.use" data-pet="${pid}" data-item="${esc(r.item.id)}" aria-label="Usar ${esc(r.ing.name)}"></td>
    </tr>`;
  }).join('');

  const ad = pet.adaptation;
  const phases = ad.phases.map((p, i) => `<tr>
      <td><input id="ph-${i}-from" class="w-s" inputmode="numeric" value="${p.from}" data-field="phase.from" data-pet="${pid}" data-idx="${i}" aria-label="Fase ${i + 1}: do dia"></td>
      <td><input id="ph-${i}-to" class="w-s" inputmode="numeric" value="${p.to}" data-field="phase.to" data-pet="${pid}" data-idx="${i}" aria-label="Fase ${i + 1}: até o dia"></td>
      <td><input id="ph-${i}-kibble" class="w-s" inputmode="decimal" value="${inVal(p.kibble)}" data-field="phase.kibble" data-pet="${pid}" data-idx="${i}" aria-label="Fase ${i + 1}: ração em gramas"></td>
      <td><input id="ph-${i}-an" class="w-s" inputmode="decimal" value="${inVal(p.an)}" data-field="phase.an" data-pet="${pid}" data-idx="${i}" aria-label="Fase ${i + 1}: AN em gramas"></td>
      <td><button class="btn icon" data-action="delete-phase" data-pet="${pid}" data-idx="${i}" aria-label="Remover fase">✕</button></td>
    </tr>`).join('');
  const st = adaptationStatus(pet);
  const stText = !st ? 'Sem transição em andamento.'
    : st.pending ? `Começa em ${fmtDateFull(st.start)}.`
    : st.phase ? `Hoje é o dia ${st.day} da transição.`
    : st.done ? 'Transição concluída: dieta completa.' : `Dia ${st.day}: fora das fases cadastradas.`;

  const weights = [...pet.weights].sort((a, b) => b.date.localeCompare(a.date));
  const weightRows = weights.map((w, i) => {
    const prev = weights[i + 1];
    const delta = prev ? w.kg - prev.kg : null;
    const idx = pet.weights.indexOf(w);
    return `<tr><td>${fmtDateFull(w.date)}</td><td class="r num">${fmt(w.kg, 2)} kg</td>
      <td class="r num muted">${delta == null ? '' : (delta > 0 ? '+' : '') + fmt(delta, 2)}</td>
      <td><button class="btn icon" data-action="delete-weight" data-pet="${pid}" data-idx="${idx}" aria-label="Remover pesagem">✕</button></td></tr>`;
  }).join('');

  return `
    <a class="back" href="#pets">‹ Pets</a>
    <section class="card">
      <h2>Dados</h2>
      <div class="grid">
        <label class="field">Nome<input id="p-name" value="${esc(pet.name)}" data-field="pet.name" data-pet="${pid}"></label>
        <label class="field">Peso atual (kg)<input id="p-weight" inputmode="decimal" value="${inVal(pet.weight)}" data-field="pet.weight" data-pet="${pid}"></label>
        <label class="field">Fator de atividade<input id="p-activity" inputmode="decimal" value="${inVal(pet.activity)}" data-field="pet.activity" data-pet="${pid}"></label>
        <label class="field">Refeições por dia<input id="p-portions" inputmode="numeric" value="${pet.portions}" data-field="pet.portions" data-pet="${pid}"></label>
      </div>
      <p class="muted small" style="margin-top:8px">Fator de atividade: leve 1,2–1,4 · moderado 1,5–1,7 · alto 2+</p>
    </section>

    <section class="card">
      <h2>Energia</h2>
      <div class="stats">
        <div class="stat"><div class="muted small">RER (repouso)</div><div class="v num">${fmt(c.rer, 0)} kcal</div></div>
        <div class="stat"><div class="muted small">N.E.M (meta/dia)</div><div class="v num">${fmt(c.nem, 0)} kcal</div></div>
        <div class="stat"><div class="muted small">Dieta/dia</div><div class="v num">${fmt(c.kcal, 0)} kcal</div></div>
        <div class="stat"><div class="muted small">Diferença</div><div class="v num">${pct(c.diff)}</div></div>
      </div>
      ${Math.abs(c.diff) > KCAL_TOLERANCE ? `<p class="badge warn" style="margin-top:10px;white-space:normal">A dieta está mais de ${KCAL_TOLERANCE * 100}% ${c.diff > 0 ? 'acima' : 'abaixo'} da meta. Vale revisar com a veterinária.</p>` : ''}
      ${Math.abs(c.vegPerKg - VEG_TARGET) > 0.01 ? `<p class="badge warn" style="margin-top:10px;white-space:normal">Vegetais somam ${fmt(c.vegPerKg)} g/kg (orientação: ${VEG_TARGET} g/kg).</p>` : ''}
    </section>

    <section class="card">
      <div class="spread"><h2>Dieta</h2><span class="muted small">leva de ${days} dias</span></div>
      <p class="muted small">Campo vazio usa o valor da receita (cinza). Preencha só para ajustar este pet.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ingrediente</th><th>Quantidade</th><th class="r">Por dia</th><th class="r">Na leva</th><th class="r">kcal/dia</th><th class="r">Custo</th><th>Usar</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="r num">${fmt(c.dailyFood, 0)} g</td><td class="r num">${qty(c.dailyFood * days, 'g')}</td><td class="r num">${fmt(c.kcal, 0)}</td><td class="r num">${money(c.cost)}</td><td></td></tr></tfoot>
      </table></div>
      <p class="muted small" style="margin-top:8px">Porção: <b>${pet.portions}× ${fmt(c.portion, 0)} g</b> (sem suplementos e itens periódicos).${c.missingPrice ? ' Itens sem preço não entram no custo; cadastre em Ajustes.' : ''}</p>
    </section>

    <section class="card">
      <h2>Transição da ração</h2>
      <div class="grid"><label class="field">Início da transição<input type="date" id="p-adstart" value="${ad.start || ''}" data-field="pet.adStart" data-pet="${pid}"></label></div>
      <p class="muted small" style="margin-top:8px">${stText}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Do dia</th><th>Até</th><th>Ração (g)</th><th>AN (g)</th><th></th></tr></thead>
        <tbody>${phases}</tbody>
      </table></div>
      <div class="row" style="margin-top:10px"><button class="btn ghost" data-action="add-phase" data-pet="${pid}">Adicionar fase</button><span class="muted small">Depois da última fase: dieta completa.</span></div>
    </section>

    <section class="card">
      <h2>Pesagens</h2>
      <div class="grid">
        <label class="field">Data<input type="date" id="w-date" value="${todayISO()}"></label>
        <label class="field">Peso (kg)<input id="w-kg" inputmode="decimal" placeholder="${inVal(pet.weight)}"></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn" data-action="add-weight" data-pet="${pid}">Registrar pesagem</button><span class="muted small">A pesagem mais recente vira o peso atual.</span></div>
      ${weightRows ? `<div class="table-wrap" style="margin-top:10px"><table><tbody>${weightRows}</tbody></table></div>` : ''}
    </section>

    <section class="card">
      <h2>Observações</h2>
      <textarea id="p-notes" data-field="pet.notes" data-pet="${pid}" placeholder="Anotações sobre este pet">${esc(pet.notes)}</textarea>
    </section>

    <button class="btn danger" data-action="delete-pet" data-pet="${pid}">Excluir ${esc(pet.name)}</button>`;
}

function viewReceita() {
  const options = (sel) => state.ingredients.map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  const rows = state.recipe.map((item) => {
    const iid = esc(item.id);
    return `<tr>
      <td><select id="rc-ing-${iid}" data-field="recipe.ingredient" data-item="${iid}" aria-label="Ingrediente">${options(item.ingredientId)}</select></td>
      <td><select id="rc-mode-${iid}" data-field="recipe.mode" data-item="${iid}" aria-label="Tipo de quantidade">
        <option value="perKg" ${item.mode === 'perKg' ? 'selected' : ''}>por kg de peso</option>
        <option value="fixed" ${item.mode === 'fixed' ? 'selected' : ''}>quantidade fixa</option></select></td>
      <td><input id="rc-amt-${iid}" class="w-s" inputmode="decimal" value="${inVal(item.amount)}" data-field="recipe.amount" data-item="${iid}" aria-label="Quantidade"></td>
      <td>${item.mode === 'fixed' ? `<input id="rc-every-${iid}" class="w-s" inputmode="numeric" value="${item.everyDays}" data-field="recipe.every" data-item="${iid}" aria-label="A cada quantos dias">` : '<span class="muted small">todo dia</span>'}</td>
      <td><button class="btn icon" data-action="delete-recipe-item" data-item="${iid}" aria-label="Remover da receita">✕</button></td>
    </tr>`;
  }).join('');
  const veg = sum(state.recipe.filter((i) => i.mode === 'perKg' && ingById(i.ingredientId)?.category === 'vegetal'), (i) => i.amount);

  return `
    <section class="card">
      <h2>Receita</h2>
      <p class="muted small">Vale para todos os pets. Para mudar só um pet, ajuste na página dele. Unidades: g, ml ou gotas, conforme o ingrediente.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ingrediente</th><th>Tipo</th><th>Qtd</th><th>Frequência</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost" data-action="add-recipe-item">Adicionar à receita</button>
        <span class="badge ${Math.abs(veg - VEG_TARGET) <= 0.01 ? 'ok' : 'warn'}">Vegetais: ${fmt(veg)} g/kg (meta ${VEG_TARGET})</span>
      </div>
      <p class="muted small" style="margin-top:8px">Para fazer o rodízio de vegetais, troque o ingrediente na lista. Novos ingredientes são cadastrados em Ajustes.</p>
    </section>
    <section class="card">
      <h2>Orientações</h2>
      <textarea id="notes" data-field="notes" style="min-height:200px">${esc(state.notes)}</textarea>
    </section>`;
}

function shoppingList(days, petIds) {
  const agg = new Map();
  for (const pet of state.pets.filter((p) => petIds.includes(p.id))) {
    for (const r of calcPet(pet, days).rows) {
      if (!r.used || r.total <= 0) continue;
      const a = agg.get(r.ing.id) || { ing: r.ing, total: 0, cost: 0 };
      a.total += r.total;
      a.cost += r.cost || 0;
      agg.set(r.ing.id, a);
    }
  }
  return [...agg.values()];
}

function viewCompras() {
  ui.shopDays ??= state.settings.cycleDays;
  ui.shopPets ??= state.pets.map((p) => p.id);
  const items = shoppingList(ui.shopDays, ui.shopPets);
  const total = sum(items, (i) => i.cost);
  const missing = items.filter((i) => i.ing.unit !== 'gotas' && i.ing.price == null);
  const rows = items.map((i) => `<tr><td>${esc(i.ing.name)}</td><td class="r num">${qty(i.total, i.ing.unit)}</td>
    <td class="r num">${i.ing.unit === 'gotas' ? '–' : i.ing.price == null ? '<span class="muted">sem preço</span>' : money(i.cost)}</td></tr>`).join('');
  const pets = state.pets.map((p) => `<label class="row" style="gap:6px;font-weight:600"><input type="checkbox" id="sp-${esc(p.id)}" ${ui.shopPets.includes(p.id) ? 'checked' : ''} data-field="shop.pet" data-pet="${esc(p.id)}">${esc(p.name)}</label>`).join('');
  return `
    <section class="card">
      <h2>Lista de compras</h2>
      <div class="grid"><label class="field">Para quantos dias<input id="shop-days" inputmode="numeric" value="${ui.shopDays}" data-field="shop.days"></label></div>
      <div class="row" style="margin-top:10px">${pets}</div>
    </section>
    <section class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="r">Quantidade</th><th class="r">Custo</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">Nada para comprar.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="r num">${money(total)}</td></tr></tfoot>
      </table></div>
      ${missing.length ? `<p class="muted small" style="margin-top:8px">Sem preço cadastrado (fora do total): ${missing.map((i) => esc(i.ing.name)).join(', ')}.</p>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn" data-action="copy-shopping">Copiar lista</button></div>
    </section>`;
}

function viewAjustes() {
  const s = state.settings;
  const catOpts = (sel) => Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  const unitOpts = (sel) => UNITS.map((u) => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('');
  const rows = state.ingredients.map((i) => {
    const id = esc(i.id);
    return `<tr>
      <td><input id="in-name-${id}" value="${esc(i.name)}" data-field="ing.name" data-ing="${id}" style="min-width:150px" aria-label="Nome"></td>
      <td><select id="in-cat-${id}" data-field="ing.category" data-ing="${id}" aria-label="Categoria">${catOpts(i.category)}</select></td>
      <td><select id="in-unit-${id}" data-field="ing.unit" data-ing="${id}" aria-label="Unidade">${unitOpts(i.unit)}</select></td>
      <td><input id="in-kcal-${id}" class="w-s" inputmode="decimal" value="${inVal(i.kcal)}" data-field="ing.kcal" data-ing="${id}" aria-label="kcal por ${esc(i.unit)}"></td>
      <td>${i.unit === 'gotas' ? '<span class="muted small">–</span>' : `<input id="in-price-${id}" class="w-s" inputmode="decimal" value="${inVal(i.price)}" placeholder="${perUnitLabel(i.unit)}" data-field="ing.price" data-ing="${id}" aria-label="Preço ${perUnitLabel(i.unit)}">`}</td>
      <td><input id="in-note-${id}" value="${esc(i.note)}" data-field="ing.note" data-ing="${id}" style="min-width:180px" aria-label="Observação"></td>
      <td><button class="btn icon" data-action="delete-ingredient" data-ing="${id}" aria-label="Excluir ingrediente">✕</button></td>
    </tr>`;
  }).join('');
  return `
    <section class="card">
      <h2>Leva</h2>
      <div class="grid">
        <label class="field">Dias por leva<input id="s-days" inputmode="numeric" value="${s.cycleDays}" data-field="settings.cycleDays"></label>
        <label class="field">Início da leva atual<input type="date" id="s-start" value="${s.cycleStart}" data-field="settings.cycleStart"></label>
      </div>
      <p class="muted small" style="margin-top:8px">Os itens periódicos (ex.: fígado a cada 5 dias) contam a partir do início da leva.</p>
    </section>

    <section class="card">
      <h2>Ingredientes</h2>
      <p class="muted small">kcal por g ou por ml. Preço em R$/kg (g) ou R$/L (ml).</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Categoria</th><th>Unid.</th><th>kcal</th><th>Preço</th><th>Observação</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="row" style="margin-top:10px"><button class="btn ghost" data-action="add-ingredient">Novo ingrediente</button></div>
    </section>

    <section class="card">
      <h2>Lembretes na agenda</h2>
      <p class="muted small">Baixa um arquivo .ics com o fígado a cada ${esc(recipeEveryText())}, o fim de cada leva e as fases da transição. Abra no celular para importar no Google Agenda ou no Calendário. Se mudar datas, baixe de novo.</p>
      <button class="btn" data-action="export-ics">Baixar lembretes (.ics)</button>
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted small">Os dados ficam só neste aparelho. Exporte de vez em quando, e use o arquivo para passar os dados para outro aparelho.</p>
      <div class="row">
        <button class="btn" data-action="export-json">Exportar backup</button>
        <button class="btn ghost" data-action="import-json">Importar backup</button>
      </div>
    </section>

    <section class="card">
      <h2>Recomeçar</h2>
      <p class="muted small">Apaga tudo e volta aos dados da planilha original.</p>
      <button class="btn danger" data-action="reset">Restaurar dados da planilha</button>
    </section>`;
}

function recipeEveryText() {
  const it = state.recipe.find((i) => i.mode === 'fixed' && i.everyDays > 1);
  return it ? `${it.everyDays} dias` : 'X dias';
}

// ---------- calendário (.ics) ----------
function buildICS() {
  const s = state.settings;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const d = (iso) => iso.replace(/-/g, '');
  const icsEsc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const events = [];
  const ev = (key, date, summary, desc, rrule) => events.push([
    'BEGIN:VEVENT', `UID:${key}@an-pets`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d(date)}`, `DTEND;VALUE=DATE:${d(addDays(date, 1))}`,
    `SUMMARY:${icsEsc(summary)}`, desc && `DESCRIPTION:${icsEsc(desc)}`, rrule && `RRULE:${rrule}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(summary)}`, 'TRIGGER:PT9H', 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n'));

  for (const item of state.recipe.filter((i) => i.mode === 'fixed' && i.everyDays > 1)) {
    const ing = ingById(item.ingredientId);
    if (!ing) continue;
    const parts = state.pets.filter((p) => !p.excluded.includes(item.id))
      .map((p) => `${p.name} ${qty(p.overrides[item.id] ?? item.amount, ing.unit)}`);
    if (parts.length) ev(`${item.id}-${s.cycleStart}`, s.cycleStart, `${ing.name}: ${parts.join(', ')}`, `A cada ${item.everyDays} dias`, `FREQ=DAILY;INTERVAL=${item.everyDays}`);
  }
  ev(`leva-${s.cycleStart}`, addDays(s.cycleStart, s.cycleDays - 1), 'Último dia da leva de AN: preparar a próxima', '', `FREQ=DAILY;INTERVAL=${s.cycleDays}`);

  for (const p of state.pets) {
    const a = p.adaptation;
    if (!a.start || !a.phases.length) continue;
    a.phases.forEach((ph, i) => ev(`${p.id}-fase${i}-${a.start}`, addDays(a.start, ph.from - 1),
      `${p.name}: transição dias ${ph.from}–${ph.to} · ração ${ph.kibble} g + AN ${ph.an} g`, ''));
    const last = Math.max(...a.phases.map((ph) => ph.to));
    const c = calcPet(p);
    ev(`${p.id}-completa-${a.start}`, addDays(a.start, last), `${p.name}: dieta AN completa (${p.portions}× ${fmt(c.portion, 0)} g)`, '');
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AN Pets//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:AN Pets', ...events, 'END:VCALENDAR'].join('\r\n');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- ações ----------
const actions = {
  'new-cycle'() {
    if (!confirm('Iniciar uma nova leva hoje? O dia 1 passa a ser hoje e os itens periódicos contam a partir de hoje.')) return;
    state.settings.cycleStart = todayISO();
    commit('Nova leva iniciada.');
  },
  'add-pet'() {
    const pet = { id: uid(), name: 'Novo pet', weight: 10, activity: 1.2, portions: 2, overrides: {}, excluded: [], adaptation: { start: null, phases: [] }, weights: [], notes: '' };
    state.pets.push(pet);
    save();
    location.hash = `#pet/${pet.id}`;
  },
  'delete-pet'(el) {
    const pet = petById(el.dataset.pet);
    if (!pet || !confirm(`Excluir ${pet.name}? Isso não pode ser desfeito.`)) return;
    state.pets = state.pets.filter((p) => p !== pet);
    ui.shopPets = null;
    save();
    location.hash = '#pets';
  },
  'add-weight'(el) {
    const pet = petById(el.dataset.pet);
    const kg = num(document.getElementById('w-kg').value);
    const date = document.getElementById('w-date').value || todayISO();
    if (!pet || !kg || kg <= 0) return toast('Informe o peso em kg.');
    pet.weights.push({ date, kg });
    const latest = [...pet.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    pet.weight = latest.kg;
    commit(`Pesagem registrada. Peso atual: ${fmt(pet.weight, 2)} kg.`);
  },
  'delete-weight'(el) {
    const pet = petById(el.dataset.pet);
    if (!pet) return;
    pet.weights.splice(Number(el.dataset.idx), 1);
    commit();
  },
  'add-phase'(el) {
    const pet = petById(el.dataset.pet);
    const ph = pet.adaptation.phases;
    const from = ph.length ? Math.max(...ph.map((p) => p.to)) + 1 : 1;
    ph.push({ from, to: from + 2, kibble: 0, an: 0 });
    commit();
  },
  'delete-phase'(el) {
    petById(el.dataset.pet).adaptation.phases.splice(Number(el.dataset.idx), 1);
    commit();
  },
  'add-recipe-item'() {
    const unused = state.ingredients.find((i) => !state.recipe.some((r) => r.ingredientId === i.id)) || state.ingredients[0];
    if (!unused) return toast('Cadastre um ingrediente em Ajustes primeiro.');
    state.recipe.push({ id: uid(), ingredientId: unused.id, mode: 'perKg', amount: 1, everyDays: 1 });
    commit();
  },
  'delete-recipe-item'(el) {
    const id = el.dataset.item;
    state.recipe = state.recipe.filter((r) => r.id !== id);
    for (const p of state.pets) { delete p.overrides[id]; p.excluded = p.excluded.filter((x) => x !== id); }
    commit();
  },
  'add-ingredient'() {
    state.ingredients.push({ id: uid(), name: 'Novo ingrediente', category: 'vegetal', unit: 'g', kcal: 0, price: null, note: '' });
    commit();
  },
  'delete-ingredient'(el) {
    const id = el.dataset.ing;
    if (state.recipe.some((r) => r.ingredientId === id)) return toast('Esse ingrediente está na receita. Tire da receita antes.');
    state.ingredients = state.ingredients.filter((i) => i.id !== id);
    commit();
  },
  'copy-shopping'() {
    const items = shoppingList(ui.shopDays, ui.shopPets);
    const names = state.pets.filter((p) => ui.shopPets.includes(p.id)).map((p) => p.name).join(', ');
    const text = [`Compras AN – ${ui.shopDays} dias (${names})`, ...items.map((i) => `- ${i.ing.name}: ${qty(i.total, i.ing.unit)}`)].join('\n');
    (navigator.clipboard?.writeText(text) ?? Promise.reject())
      .then(() => toast('Lista copiada.'))
      .catch(() => prompt('Copie a lista:', text));
  },
  'export-ics'() {
    download('an-pets-lembretes.ics', buildICS(), 'text/calendar;charset=utf-8');
  },
  'export-json'() {
    download(`an-pets-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  },
  'import-json'() {
    document.getElementById('import-file').click();
  },
  'reset'() {
    if (!confirm('Apagar todos os dados e voltar à planilha original?')) return;
    state = seed();
    ui.shopPets = null; ui.shopDays = null;
    commit('Dados restaurados.');
  },
};

// ---------- campos editáveis ----------
function onField(el) {
  const f = el.dataset.field;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  const pet = el.dataset.pet ? petById(el.dataset.pet) : null;
  const ing = el.dataset.ing ? ingById(el.dataset.ing) : null;
  const item = el.dataset.item ? recipeItem(el.dataset.item) : null;
  const positive = (n, fallback) => (n != null && n > 0 ? n : fallback);

  switch (f) {
    case 'settings.cycleDays': state.settings.cycleDays = Math.round(positive(num(v), state.settings.cycleDays)); break;
    case 'settings.cycleStart': if (v) state.settings.cycleStart = v; break;
    case 'notes': state.notes = v; break;

    case 'pet.name': pet.name = v.trim() || pet.name; break;
    case 'pet.weight': pet.weight = positive(num(v), pet.weight); break;
    case 'pet.activity': pet.activity = positive(num(v), pet.activity); break;
    case 'pet.portions': pet.portions = Math.round(positive(num(v), pet.portions)); break;
    case 'pet.notes': pet.notes = v; break;
    case 'pet.adStart': pet.adaptation.start = v || null; break;
    case 'pet.override': {
      const n = num(v);
      if (n == null || n === recipeItem(el.dataset.item)?.amount) delete pet.overrides[el.dataset.item];
      else pet.overrides[el.dataset.item] = n;
      break;
    }
    case 'pet.use':
      pet.excluded = pet.excluded.filter((x) => x !== el.dataset.item);
      if (!v) pet.excluded.push(el.dataset.item);
      break;

    case 'phase.from': case 'phase.to': case 'phase.kibble': case 'phase.an': {
      const ph = pet.adaptation.phases[Number(el.dataset.idx)];
      const key = f.split('.')[1];
      const n = num(v);
      if (n != null && n >= 0) ph[key] = key === 'from' || key === 'to' ? Math.round(n) : n;
      pet.adaptation.phases.sort((a, b) => a.from - b.from);
      break;
    }

    case 'recipe.ingredient': item.ingredientId = v; break;
    case 'recipe.mode': item.mode = v; if (v === 'fixed' && !item.everyDays) item.everyDays = 1; break;
    case 'recipe.amount': { const n = num(v); if (n != null && n >= 0) item.amount = n; break; }
    case 'recipe.every': item.everyDays = Math.round(positive(num(v), item.everyDays)); break;

    case 'ing.name': ing.name = v.trim() || ing.name; break;
    case 'ing.category': ing.category = v; break;
    case 'ing.unit': ing.unit = v; break;
    case 'ing.kcal': { const n = num(v); ing.kcal = n != null && n >= 0 ? n : ing.kcal; break; }
    case 'ing.price': { const n = num(v); ing.price = n != null && n >= 0 ? n : null; break; }
    case 'ing.note': ing.note = v; break;

    case 'shop.days': ui.shopDays = Math.round(positive(num(v), ui.shopDays)); break;
    case 'shop.pet':
      ui.shopPets = ui.shopPets.filter((x) => x !== el.dataset.pet);
      if (v) ui.shopPets.push(el.dataset.pet);
      break;
    default: return;
  }
  commit();
}

function commit(message) {
  save();
  setTimeout(render, 0); // depois que o foco já foi para o próximo campo
  if (message) toast(message);
}

// ---------- render / rotas ----------
const app = document.getElementById('app');
const titles = { hoje: 'Hoje', pets: 'Pets', pet: 'Pet', receita: 'Receita', compras: 'Compras', ajustes: 'Ajustes' };

function render() {
  const focused = document.activeElement?.id;
  const [route = 'hoje', param] = location.hash.slice(1).split('/');
  let html;
  switch (route) {
    case 'pets': html = viewPets(); break;
    case 'pet': html = viewPet(petById(decodeURIComponent(param || ''))); break;
    case 'receita': html = viewReceita(); break;
    case 'compras': html = viewCompras(); break;
    case 'ajustes': html = viewAjustes(); break;
    default: html = viewHoje();
  }
  app.innerHTML = html;
  const tab = route === 'pet' ? 'pets' : (titles[route] ? route : 'hoje');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const pet = route === 'pet' ? petById(decodeURIComponent(param || '')) : null;
  document.getElementById('title').textContent = pet ? pet.name : (titles[route] || 'Hoje');
  if (focused) {
    const el = document.getElementById(focused);
    if (el && el !== document.body) el.focus({ preventScroll: true });
  }
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'import-file') return importBackup(e.target);
  if (e.target.dataset?.field) onField(e.target);
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function importBackup(input) {
  const file = input.files?.[0];
  if (!file) return;
  file.text().then((text) => {
    const data = JSON.parse(text);
    if (!Array.isArray(data.pets) || !Array.isArray(data.ingredients) || !Array.isArray(data.recipe)) throw new Error('formato');
    if (!confirm('Substituir os dados deste aparelho pelo backup?')) return;
    state = normalize(data);
    ui.shopPets = null; ui.shopDays = null;
    commit('Backup importado.');
  }).catch(() => toast('Arquivo de backup inválido.')).finally(() => { input.value = ''; });
}

render();
save();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});

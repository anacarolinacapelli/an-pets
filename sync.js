// Sincronização com a nuvem (Firebase): login com Google + Firestore.
// Os dados continuam no localStorage (app.js); aqui eles também ficam em users/{uid}/data/app.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';

// Configuração pública do app web (não é segredo): quem protege os dados são as regras do Firestore.
const firebaseConfig = {
  apiKey: 'AIzaSyDDw0yrjlk8Iv3Kx4H8RlC4zW47ILhHEMY',
  authDomain: 'an-pets.firebaseapp.com',
  projectId: 'an-pets',
  storageBucket: 'an-pets.firebasestorage.app',
  messagingSenderId: '500258403690',
  appId: '1:500258403690:web:e17f43270cf7100962e113',
};

const LINK_KEY = 'an-app:sync-uid'; // conta já vinculada a este aparelho
const PUSH_DELAY = 800;

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
auth.languageCode = 'pt-BR';
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const provider = new GoogleAuthProvider();

const an = window.anApp;
const sync = { user: null, statusText: '', busy: false, signIn, signOut: logout };
window.anSync = sync;

let ref = null;
let unsub = null;
let ready = false;        // true depois de decidir qual versão vale (nuvem ou aparelho)
let pushTimer = null;
let lastPushed = null;    // JSON enviado por último, para ignorar o eco do próprio envio
let pendingRemote = null; // versão da nuvem esperando o usuário sair do campo que está editando
let deciding = false;     // diálogo de escolha aberto

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (d) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const device = () => (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'celular' : 'computador');

// ---------- status (atualiza só o texto e o selo, sem redesenhar a tela) ----------
function status(text, kind = 'ok') {
  sync.statusText = text;
  const p = document.getElementById('sync-status');
  if (p) p.textContent = text;
  const badge = document.getElementById('sync-badge');
  if (badge) {
    badge.hidden = !sync.user;
    badge.dataset.kind = kind;
    badge.textContent = { ok: '☁ ok', pending: '☁ salvando', offline: '☁ offline', error: '☁ erro' }[kind];
    badge.title = text;
  }
}

// ---------- login ----------
async function signIn() {
  sync.busy = true; an.render();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      an.toast(`Não foi possível entrar (${e.code || e.message}).`);
    }
  } finally {
    sync.busy = false; an.render();
  }
}

async function logout() {
  stop();
  localStorage.removeItem(LINK_KEY);
  await signOut(auth);
  an.toast('Você saiu. Os dados continuam neste aparelho.');
}

function stop() {
  if (unsub) unsub();
  unsub = null; ready = false; ref = null; pendingRemote = null; deciding = false;
  clearTimeout(pushTimer); pushTimer = null;
}

getRedirectResult(auth).catch((e) => an.toast(`Não foi possível entrar (${e.code || e.message}).`));

onAuthStateChanged(auth, (user) => {
  stop();
  sync.user = user;
  if (!user) { status(''); an.render(); return; }
  ref = doc(db, 'users', user.uid, 'data', 'app');
  sync.statusText = 'Conectando…';
  an.render();
  status('Conectando…', 'pending');
  unsub = onSnapshot(ref, { includeMetadataChanges: true }, onRemote, (e) => {
    status(e.code === 'permission-denied'
      ? 'Sem permissão no banco. Confira se as regras do Firestore foram publicadas.'
      : `Erro na nuvem (${e.code || e.message}).`, 'error');
  });
});

// ---------- nuvem → aparelho ----------
async function onRemote(snap) {
  const local = JSON.stringify(an.getState());

  if (!ready) {
    if (deciding) return;
    // aparelho novo e sem internet: espera a resposta do servidor antes de decidir
    if (!snap.exists() && snap.metadata.fromCache) return status('Aguardando conexão com a nuvem…', 'offline');
    if (!snap.exists()) {
      ready = true;
      localStorage.setItem(LINK_KEY, sync.user.uid);
      await push();
      return an.toast('Dados deste aparelho enviados para a nuvem.');
    }
    const remote = snap.data().json;
    const linked = localStorage.getItem(LINK_KEY) === sync.user.uid;
    let choice = 'cloud';
    if (remote !== local && !linked) {
      deciding = true;
      choice = await choose(snap.data(), local);
      deciding = false;
    }
    if (choice === 'cancel') return logout();
    ready = true;
    localStorage.setItem(LINK_KEY, sync.user.uid);
    if (choice === 'local') return push();
    applyRemote(remote);
    return settled(snap);
  }

  if (snap.metadata.hasPendingWrites || !snap.exists()) return settled(snap);
  const remote = snap.data().json;
  if (remote !== local && remote !== lastPushed && !pushTimer) applyRemote(remote);
  settled(snap);
}

function settled(snap) {
  if (snap.metadata.hasPendingWrites) return status('Salvo neste aparelho; vai para a nuvem quando houver internet.', navigator.onLine ? 'pending' : 'offline');
  const at = snap.data()?.updatedAt?.toDate?.();
  status(at ? `Sincronizado. Última alteração: ${time(at)} (${snap.data().device || 'aparelho'}).` : 'Sincronizado.', 'ok');
}

function applyRemote(json) {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox') {
    pendingRemote = json; // não troca a tela no meio de uma digitação
    return;
  }
  pendingRemote = null;
  lastPushed = json;
  an.replaceState(JSON.parse(json));
}

document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!pendingRemote) return;
    const el = document.activeElement;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) applyRemote(pendingRemote);
  }, 300);
});

// ---------- aparelho → nuvem ----------
an.onSave = () => {
  if (!ready) return;
  clearTimeout(pushTimer);
  status('Salvando…', 'pending');
  pushTimer = setTimeout(() => { pushTimer = null; push(); }, PUSH_DELAY);
};

async function push() {
  if (!ref) return;
  const json = JSON.stringify(an.getState());
  lastPushed = json;
  const write = setDoc(ref, { json, updatedAt: serverTimestamp(), device: device() });
  if (!navigator.onLine) status('Salvo neste aparelho; vai para a nuvem quando houver internet.', 'offline');
  try {
    await write;
  } catch (e) {
    status(e.code === 'permission-denied'
      ? 'Sem permissão para salvar. Confira as regras do Firestore.'
      : `Erro ao salvar na nuvem (${e.code || e.message}).`, 'error');
  }
}

window.addEventListener('online', () => sync.user && status('Reconectando…', 'pending'));
window.addEventListener('offline', () => sync.user && status('Sem internet: as alterações ficam guardadas e sobem depois.', 'offline'));

// ---------- escolha no primeiro login de um aparelho ----------
function summary(state) {
  const pets = state.pets || [];
  const weighings = pets.reduce((n, p) => n + (p.weights?.length || 0), 0);
  return `${pets.map((p) => `${esc(p.name)} (${String(p.weight).replace('.', ',')} kg)`).join(', ') || 'nenhum pet'} · ${weighings} pesagem(ns)`;
}

function choose(remoteDoc, localJson) {
  return new Promise((resolve) => {
    const at = remoteDoc.updatedAt?.toDate?.();
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `
      <h2>Já existem dados na nuvem</h2>
      <p class="muted small">Os dados deste aparelho são diferentes dos que estão na sua conta. Qual versão você quer manter?</p>
      <div class="opt-box"><b>Nuvem</b>${at ? ` · atualizado em ${time(at)}` : ''}<br><span class="small">${summary(JSON.parse(remoteDoc.json))}</span></div>
      <div class="opt-box"><b>Este aparelho</b><br><span class="small">${summary(JSON.parse(localJson))}</span></div>
      <div class="modal-actions">
        <button class="btn" value="cloud">Usar os da nuvem</button>
        <button class="btn ghost" value="local">Enviar os deste aparelho</button>
        <button class="btn icon" value="cancel">Cancelar</button>
      </div>
      <p class="muted small">"Enviar os deste aparelho" substitui o que está na nuvem. Na dúvida, exporte um backup antes.</p>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button[value]');
      if (b) d.close(b.value);
    });
    d.addEventListener('close', () => { resolve(d.returnValue || 'cancel'); d.remove(); });
    document.body.append(d);
    d.showModal();
  });
}

an.render();

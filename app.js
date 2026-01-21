import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, onSnapshot, addDoc, serverTimestamp, runTransaction, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDy6Ewsq2egkBrELp6i9rGLRnvdIYqOxeg",
    authDomain: "catsblock-94c61.firebaseapp.com",
    projectId: "catsblock-94c61",
    storageBucket: "catsblock-94c61.firebasestorage.app",
    messagingSenderId: "462618239829",
    appId: "1:462618239829:web:8c1445e69db9fc988585dc"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTADO GLOBAL ---
let currentUserData = null;
let currentChatId = null;
let pendingMedia = null;
let mediaType = null;
let mediaRecorder = null;
let audioChunks = [];
let msgRateLimit = { count: 0, start: 0 };

const Toast = {
    show: (text, type = 'info') => {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = text;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }
};

const Router = {
    go: (id) => {
        document.querySelectorAll('.frame').forEach(f => f.classList.add('hidden'));
        const target = document.getElementById(id);
        if(target) target.classList.remove('hidden');
        if(id === 'main-frame') loadConversations();
    }
};

// --- AUTH & SYNC (COM ACCOUNT ID E PRIVACIDADE) ---
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-screen');
    if (user) {
        await syncUser(user);
        applyTheme();
        Router.go('main-frame');
        startPresenceTracking();
    } else {
        Router.go('login-frame');
    }
    loader.classList.add('hidden');
});

async function syncUser(user) {
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
        await runTransaction(db, async (t) => {
            const cRef = doc(db, "counters", "users");
            const cSnap = await t.get(cRef);
            const newId = cSnap.exists() ? cSnap.data().count + 1 : 1;
            t.set(cRef, { count: newId });
            t.set(ref, {
                uid: user.uid, displayName: user.displayName, photoURL: user.photoURL,
                accountId: newId, darkMode: false, acceptNew: true, 
                lastSeenPrivacy: 'all', blockedUsers: [], description: ""
            });
        });
        snap = await getDoc(ref);
    }
    currentUserData = snap.data();
}

function startPresenceTracking() {
    setInterval(() => {
        if(auth.currentUser) {
            updateDoc(doc(db, "users", auth.currentUser.uid), { lastSeen: serverTimestamp() }).catch(()=>{});
        }
    }, 30000);
}

// --- TEMA E CONFIGURAÇÕES ---
function applyTheme() {
    if(currentUserData.darkMode) document.body.setAttribute('data-theme', 'dark');
    else document.body.removeAttribute('data-theme');
}

document.getElementById('btn-save-settings').onclick = async () => {
    const isDark = document.getElementById('setting-dark-mode').value === 'on';
    const accept = document.getElementById('setting-accept-new').value === 'yes';
    const privacy = document.getElementById('setting-last-seen').value;

    await updateDoc(doc(db, "users", auth.currentUser.uid), {
        darkMode: isDark, acceptNew: accept, lastSeenPrivacy: privacy
    });
    currentUserData.darkMode = isDark;
    applyTheme();
    Toast.show("Settings Saved", "success");
    Router.go('main-frame');
};

// --- LOGICA DE MÍDIA (FOTOS, VÍDEOS, ÁUDIO) ---
document.getElementById('btn-img-picker').onclick = () => document.getElementById('input-img-hidden').click();
document.getElementById('btn-vid-picker').onclick = () => document.getElementById('input-vid-hidden').click();
document.getElementById('input-img-hidden').onchange = (e) => handleFile(e.target.files[0], 'image', 600000);
document.getElementById('input-vid-hidden').onchange = (e) => handleFile(e.target.files[0], 'video', 1048576);

function handleFile(file, type, maxSize) {
    if(!file || file.size > maxSize) return Toast.show("File too large!", "error");
    mediaType = type;
    const reader = new FileReader();
    reader.onload = (ev) => {
        pendingMedia = ev.target.result;
        document.getElementById('media-preview-container').classList.remove('hidden');
        document.getElementById('media-preview-content').innerHTML = type === 'image' ? 
            `<img src="${pendingMedia}">` : `<video src="${pendingMedia}" muted autoplay></video>`;
    };
    reader.readAsDataURL(file);
}

document.getElementById('btn-aud-picker').onclick = async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = (e) => {
                pendingMedia = e.target.result;
                mediaType = 'audio';
                document.getElementById('audio-recording-ui').classList.remove('hidden');
                document.getElementById('btn-confirm-audio').classList.remove('hidden');
                document.getElementById('btn-trash-audio').classList.remove('hidden');
                document.getElementById('btn-send-msg').classList.add('hidden');
            };
            reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        Toast.show("Recording...", "info");
    } catch(e) { Toast.show("Mic permission denied", "error"); }
};

document.getElementById('btn-cancel-media').onclick = clearMedia;
document.getElementById('btn-trash-audio').onclick = clearMedia;

function clearMedia() {
    pendingMedia = null; mediaType = null;
    document.getElementById('media-preview-container').classList.add('hidden');
    document.getElementById('audio-recording-ui').classList.add('hidden');
    document.getElementById('btn-confirm-audio').classList.add('hidden');
    document.getElementById('btn-trash-audio').classList.add('hidden');
    document.getElementById('btn-send-msg').classList.remove('hidden');
}

// --- ENVIO ---
document.getElementById('btn-send-msg').onclick = sendMsg;
document.getElementById('btn-confirm-audio').onclick = sendMsg;

async function sendMsg() {
    const txt = document.getElementById('msg-input').value.trim();
    if(!txt && !pendingMedia) return;

    await addDoc(collection(db, "conversations", currentChatId, "messages"), {
        text: txt, senderId: auth.currentUser.uid,
        media: pendingMedia, mediaType: mediaType,
        createdAt: serverTimestamp()
    });
    document.getElementById('msg-input').value = '';
    clearMedia();
}

// --- LISTAGEM E CHAT ---
function loadConversations() {
    const q = query(collection(db, "conversations"), where("participants", "array-contains", auth.currentUser.uid));
    onSnapshot(q, async (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = '';
        for (const d of snap.docs) {
            const otherId = d.data().participants.find(id => id !== auth.currentUser.uid);
            const uSnap = await getDoc(doc(db, "users", otherId));
            const uData = uSnap.data();
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `<img src="${uData.photoURL}" class="avatar"><div>${uData.displayName}</div>`;
            div.onclick = () => enterChat(d.id, otherId, uData);
            list.appendChild(div);
        }
    });
}

async function enterChat(chatId, otherId, otherUser) {
    currentChatId = chatId;
    Router.go('conversation-frame');
    document.getElementById('chat-header-name').innerText = otherUser.displayName;
    document.getElementById('chat-header-img').src = otherUser.photoURL;

    // Visto por último
    onSnapshot(doc(db, "users", otherId), (snap) => {
        const data = snap.data();
        const statusEl = document.getElementById('peer-last-seen');
        if(data?.lastSeen && data.lastSeenPrivacy === 'all') {
            statusEl.innerText = `Online: ${data.lastSeen.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        } else { statusEl.innerText = ''; }
    });

    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("createdAt", "asc"), limit(30));
    onSnapshot(q, (snap) => {
        const box = document.getElementById('messages-list');
        box.innerHTML = '';
        snap.forEach(m => {
            const d = m.data();
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${d.senderId === auth.currentUser.uid ? 'msg-me' : 'msg-other'}`;
            let html = d.mediaType === 'image' ? `<img src="${d.media}" style="width:100%">` : 
                       d.mediaType === 'video' ? `<video src="${d.media}" controls style="width:100%"></video>` :
                       d.mediaType === 'audio' ? `<audio src="${d.media}" controls></audio>` : '';
            bubble.innerHTML = `${html}<div>${d.text || ''}</div>`;
            box.appendChild(bubble);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- MODAIS E PERFIL ---
document.getElementById('menu-trigger').onclick = () => document.getElementById('main-menu').classList.toggle('show');
document.getElementById('menu-settings').onclick = () => Router.go('settings-frame');
document.getElementById('menu-profile').onclick = () => {
    document.getElementById('profile-details-modal').classList.remove('hidden');
    document.getElementById('profile-modal-img').src = currentUserData.photoURL;
    document.getElementById('profile-modal-name').innerText = currentUserData.displayName;
    document.getElementById('profile-modal-id').innerText = `Your ID: ${currentUserData.accountId}`;
    document.getElementById('profile-desc-edit').value = currentUserData.description || "";
};

document.getElementById('btn-update-desc').onclick = async () => {
    const desc = document.getElementById('profile-desc-edit').value;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { description: desc });
    currentUserData.description = desc;
    Toast.show("Description updated", "success");
};

document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = () => document.getElementById(btn.dataset.close).classList.add('hidden');
});

// Novo Chat
document.getElementById('btn-new-chat').onclick = () => document.getElementById('new-chat-modal').classList.remove('hidden');
document.getElementById('btn-start-chat').onclick = async () => {
    const acId = parseInt(document.getElementById('new-chat-id').value);
    const uQ = query(collection(db, "users"), where("accountId", "==", acId));
    const uSnap = await getDocs(uQ);
    if(uSnap.empty) return Toast.show("User not found", "error");
    const target = uSnap.docs[0].data();
    await addDoc(collection(db, "conversations"), {
        participants: [auth.currentUser.uid, target.uid],
        createdAt: serverTimestamp()
    });
    document.getElementById('new-chat-modal').classList.add('hidden');
    loadConversations();
};

document.getElementById('btn-google-login').onclick = () => signInWithPopup(auth, new GoogleAuthProvider());
document.getElementById('menu-logout').onclick = () => signOut(auth).then(() => location.reload());
document.getElementById('btn-close-chat').onclick = () => Router.go('main-frame');
document.getElementById('btn-close-settings').onclick = () => Router.go('main-frame');

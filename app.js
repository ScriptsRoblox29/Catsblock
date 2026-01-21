import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot, addDoc, serverTimestamp, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

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

let currentUserData = null;
let currentChatId = null;
let currentReceiverId = null;
let activeUnsubscribes = [];
let pendingMedia = null;
let mediaType = null;
let mediaRecorder = null;
let audioChunks = [];

const Toast = {
    show: (text, type = 'info') => {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = text;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }
};

const Router = {
    go: (id) => {
        document.querySelectorAll('.frame').forEach(f => f.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
        if(id === 'main-frame') loadConversations();
    }
};

// --- AUTH & PRESENÇA ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await syncUser(user);
        Router.go('main-frame');
        startPresenceTracking();
    } else {
        Router.go('login-frame');
    }
    document.getElementById('loading-screen').classList.add('hidden');
});

function startPresenceTracking() {
    const update = () => {
        if(auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), { lastSeen: serverTimestamp() });
    };
    update();
    setInterval(update, 30000);
}

async function syncUser(user) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        await updateDoc(ref, { uid: user.uid, accountId: Date.now(), lastSeenPrivacy: 'all' });
    }
    currentUserData = (await getDoc(ref)).data();
}

// --- MÍDIA LOGIC ---
const msgInput = document.getElementById('msg-input');
msgInput.addEventListener('input', () => {
    if(msgInput.value.length > 150) msgInput.value = msgInput.value.slice(0, 150);
});

function toggleMediaButtons(disabled) {
    document.getElementById('btn-img-picker').disabled = disabled;
    document.getElementById('btn-vid-picker').disabled = disabled;
    document.getElementById('btn-aud-picker').classList.toggle('hidden', disabled);
}

// Imagem & Vídeo
document.getElementById('btn-img-picker').onclick = () => document.getElementById('input-img-hidden').click();
document.getElementById('btn-vid-picker').onclick = () => document.getElementById('input-vid-hidden').click();

document.getElementById('input-img-hidden').onchange = (e) => handleFile(e.target.files[0], 'image', 350000);
document.getElementById('input-vid-hidden').onchange = (e) => handleFile(e.target.files[0], 'video', 1048576);

function handleFile(file, type, maxSize) {
    if(!file) return;
    if(file.size > maxSize) return Toast.show("File too large!", "error");
    
    mediaType = type;
    const reader = new FileReader();
    reader.onload = (ev) => {
        pendingMedia = ev.target.result;
        document.getElementById('media-preview-container').classList.remove('hidden');
        document.getElementById('media-preview-content').innerHTML = type === 'image' ? 
            `<img src="${pendingMedia}">` : `<video src="${pendingMedia}" muted></video>`;
        toggleMediaButtons(true);
    };
    reader.readAsDataURL(file);
}

// Áudio
document.getElementById('btn-aud-picker').onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            if(blob.size > 819200) return Toast.show("Audio too large!", "error");
            pendingMedia = blob;
            mediaType = 'audio';
            document.getElementById('audio-recording-ui').classList.remove('hidden');
            document.getElementById('btn-confirm-audio').classList.remove('hidden');
            document.getElementById('btn-trash-audio').classList.remove('hidden');
            document.getElementById('btn-send-msg').classList.add('hidden');
        };
        mediaRecorder.start();
        Toast.show("Recording... Click icon again to stop", "info");
        document.getElementById('btn-aud-picker').onclick = () => mediaRecorder.stop();
    } catch(e) {
        alert("You denied microphone permission. You cannot make any more audio until you accept permission.");
    }
};

document.getElementById('btn-cancel-media').onclick = clearMedia;
document.getElementById('btn-trash-audio').onclick = clearMedia;

function clearMedia() {
    pendingMedia = null;
    mediaType = null;
    document.getElementById('media-preview-container').classList.add('hidden');
    document.getElementById('audio-recording-ui').classList.add('hidden');
    document.getElementById('btn-confirm-audio').classList.add('hidden');
    document.getElementById('btn-trash-audio').classList.add('hidden');
    document.getElementById('btn-send-msg').classList.remove('hidden');
    toggleMediaButtons(false);
}

// --- ENVIO ---
document.getElementById('btn-send-msg').onclick = () => sendFinal();
document.getElementById('btn-confirm-audio').onclick = () => sendFinal();

async function sendFinal() {
    const txt = msgInput.value.trim();
    if(!txt && !pendingMedia) return;
    
    await addDoc(collection(db, "conversations", currentChatId, "messages"), {
        text: txt,
        senderId: auth.currentUser.uid,
        media: pendingMedia ? "BASE64_OR_BLOB_HERE" : null, // Idealmente usar Firebase Storage
        mediaType: mediaType,
        createdAt: serverTimestamp()
    });
    
    msgInput.value = '';
    clearMedia();
}

// --- CHAT LIST & VISTO POR ÚLTIMO ---
function loadConversations() {
    const q = query(collection(db, "conversations"), where("participants", "array-contains", auth.currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = '';
        snap.forEach(async (d) => {
            const otherId = d.data().participants.find(id => id !== auth.currentUser.uid);
            const uSnap = await getDoc(doc(db, "users", otherId));
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `<img src="${uSnap.data().photoURL}" class="avatar"><div>${uSnap.data().displayName}</div>`;
            div.onclick = () => enterChat(d.id, otherId, uSnap.data());
            list.appendChild(div);
        });
    });
}

async function enterChat(chatId, otherId, otherUser) {
    currentChatId = chatId;
    currentReceiverId = otherId;
    Router.go('conversation-frame');
    
    // Visto por Último (Correção)
    onSnapshot(doc(db, "users", otherId), (snap) => {
        const data = snap.data();
        const statusEl = document.getElementById('peer-last-seen');
        if(data.lastSeen) {
            const time = data.lastSeen.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            statusEl.innerText = `Last seen at ${time}`;
        }
    });

    onSnapshot(query(collection(db, "conversations", chatId, "messages"), orderBy("createdAt", "asc")), (snap) => {
        const box = document.getElementById('messages-list');
        box.innerHTML = '';
        snap.forEach(m => {
            const data = m.data();
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${data.senderId === auth.currentUser.uid ? 'msg-me' : 'msg-other'}`;
            bubble.innerText = data.text;
            box.appendChild(bubble);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// Menu Triggers
document.getElementById('menu-trigger').onclick = () => document.getElementById('main-menu').classList.toggle('show');
document.getElementById('menu-profile').onclick = () => document.getElementById('profile-details-modal').classList.remove('hidden');


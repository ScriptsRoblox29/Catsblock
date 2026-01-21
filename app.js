import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot, addDoc, serverTimestamp, runTransaction, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyDy6Ewsq2egkBrELp6i9rGLRnvdIYqOxeg",
    authDomain: "catsblock-94c61.firebaseapp.com",
    projectId: "catsblock-94c61",
    storageBucket: "catsblock-94c61.firebasestorage.app",
    messagingSenderId: "462618239829",
    appId: "1:462618239829:web:8c1445e69db9fc988585dc",
    measurementId: "G-0S10J45W82"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTADO GLOBAL ---
let currentUserData = null;
let currentChatId = null;
let currentReceiverId = null; // 1. PEÇA NOVA: Guarda com quem você está falando
let activeUnsubscribes = [];
let msgRateLimit = { count: 0, start: 0 };
let lastChatOpenTime = 0;

// --- UTILITÁRIOS ---
const Toast = {
    show: (text, type = 'info') => {
        const c = document.getElementById('toast-container');
        if (c.children.length >= 3) c.removeChild(c.firstElementChild);
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

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-screen');
    if (user) {
        loader.classList.remove('hidden');
        await syncUser(user);
        if(Notification.permission === 'default') {
            Notification.requestPermission().then(p => {
                if(p === 'denied') alert("You denied permission.");
            });
        }
        loader.classList.add('hidden');
        Router.go('main-frame');
        listenForCalls();
    } else {
        loader.classList.add('hidden');
        Router.go('login-frame');
    }
});

document.getElementById('btn-google-login').onclick = () => {
    document.getElementById('login-loader').classList.remove('hidden');
    signInWithPopup(auth, new GoogleAuthProvider()).catch(e => {
        document.getElementById('login-loader').classList.add('hidden');
        Toast.show(e.message, 'error');
    });
};

document.getElementById('btn-save-settings').onclick = async () => {
    const isDark = document.getElementById('setting-dark-mode').value === 'on';
    const accept = document.getElementById('setting-accept-new').value === 'yes';
    const privacy = document.getElementById('setting-last-seen').value;

    await updateDoc(doc(db, "users", auth.currentUser.uid), {
        darkMode: isDark, acceptNew: accept, lastSeenPrivacy: privacy
    });
    currentUserData.darkMode = isDark;
    currentUserData.acceptNew = accept;
    currentUserData.lastSeenPrivacy = privacy;
    applyTheme();
    Toast.show("Saved", "success");
    Router.go('main-frame');
};

document.getElementById('menu-logout').onclick = () => signOut(auth).then(() => location.reload());

async function syncUser(user) {
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    
    if (!snap.exists()) {
        try {
            await runTransaction(db, async (t) => {
                const cRef = doc(db, "counters", "users");
                const cSnap = await t.get(cRef);
                const newId = cSnap.exists() ? cSnap.data().count + 1 : 1;
                t.set(cRef, { count: newId });
                t.set(ref, {
                    uid: user.uid,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    accountId: newId,
                    darkMode: false,
                    acceptNew: true,
                    lastSeenPrivacy: 'all',
                    blockedUsers: [],
                    description: ""
                });
            });
            snap = await getDoc(ref);
        } catch(e) { console.error(e); }
    }
    currentUserData = snap.data();
    applyTheme();
}

function applyTheme() {
    if(currentUserData.darkMode) document.body.setAttribute('data-theme', 'dark');
    else document.body.removeAttribute('data-theme');
    
    document.getElementById('setting-dark-mode').value = currentUserData.darkMode ? 'on' : 'off';
    document.getElementById('setting-accept-new').value = currentUserData.acceptNew ? 'yes' : 'no';
    document.getElementById('setting-last-seen').value = currentUserData.lastSeenPrivacy;
}

// --- CHATS E LISTAGEM ---
document.querySelectorAll('[data-close]').forEach(el => {
    el.onclick = () => document.getElementById(el.dataset.close).classList.add('hidden');
});
document.getElementById('menu-trigger').onclick = () => document.getElementById('main-menu').classList.toggle('show');
window.onclick = (e) => { if(!e.target.closest('.header-actions')) document.getElementById('main-menu').classList.remove('show'); };
document.getElementById('menu-settings').onclick = () => Router.go('settings-frame');
document.getElementById('btn-close-settings').onclick = () => Router.go('main-frame');
document.getElementById('btn-new-chat').onclick = () => document.getElementById('new-chat-modal').classList.remove('hidden');

function showSkeletons() {
    const list = document.getElementById('chat-list');
    list.innerHTML = '';
    for(let i=0;i<5;i++) list.innerHTML += `<div class="chat-item" style="opacity:0.5"><div class="avatar"></div><div class="chat-info"><div style="height:10px;background:#ccc;width:50%;margin-bottom:5px"></div></div></div>`;
}

function loadConversations() {
    showSkeletons();
    const q = query(collection(db, "conversations"), where("participants", "array-contains", auth.currentUser.uid));
    
    activeUnsubscribes.forEach(u => u());
    activeUnsubscribes = [];

    const unsub = onSnapshot(q, async (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = '';
        if(snap.empty) {
            list.innerHTML = '<div style="text-align:center;padding:40px;color:#888">You haven\'t talked to anyone yet.</div>';
            return;
        }

        for(const d of snap.docs) {
            const data = d.data();
            const otherId = data.participants.find(id => id !== auth.currentUser.uid);
            let otherUser = { displayName: 'Unknown', photoURL: '' };
            try {
                const uSnap = await getDoc(doc(db, "users", otherId));
                if(uSnap.exists()) otherUser = uSnap.data();
            } catch(e) {}

            const myDisplayName = data.displayNames?.[auth.currentUser.uid] || otherUser.displayName;

            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `
                <img src="${otherUser.photoURL}" class="avatar">
                <div class="chat-info">
                    <div class="chat-name">${myDisplayName}</div>
                    <div class="chat-preview">Open conversation</div>
                </div>
            `;
            div.onclick = () => enterChat(d.id, otherId, otherUser, myDisplayName);
            list.appendChild(div);
        }
    });
    activeUnsubscribes.push(unsub);
}

document.getElementById('btn-start-chat').onclick = async () => {
    const name = document.getElementById('new-chat-name').value;
    const acId = parseInt(document.getElementById('new-chat-id').value);
    
    if(!name || !acId) return Toast.show("Invalid fields", "error");

    const uQ = query(collection(db, "users"), where("accountId", "==", acId));
    const uSnap = await getDocs(uQ);
    
    if(uSnap.empty) return Toast.show("User ID not found", "error");
    const targetUser = uSnap.docs[0].data();
    
    if(targetUser.uid === auth.currentUser.uid) return Toast.show("Cannot chat with yourself", "error");

    try {
        await addDoc(collection(db, "conversations"), {
            participants: [auth.currentUser.uid, targetUser.uid],
            targetUid: targetUser.uid, 
            createdAt: serverTimestamp(),
            displayNames: { [auth.currentUser.uid]: name }
        });
        document.getElementById('new-chat-modal').classList.add('hidden');
        Toast.show("Chat started!", "success");
    } catch(e) {
        if(e.code === 'permission-denied') {
            Toast.show("Blocked or user doesn't accept new chats!", "error");
        } else {
            Toast.show("Error creating chat", "error");
        }
    }
};

// --- DENTRO DA CONVERSA ---
async function enterChat(chatId, otherId, otherUser, dispName) {
    if (Date.now() - lastChatOpenTime < 30000) {
        Toast.show("Wait 30s.", "error");
        return;
    }
    lastChatOpenTime = Date.now();
    currentChatId = chatId;
    currentReceiverId = otherId; // 2. PEÇA NOVA: Salva quem é o destinatário
    Router.go('conversation-frame');

    const hImg = document.getElementById('chat-header-img');
    const hName = document.getElementById('chat-header-name');
    hImg.src = otherUser.photoURL;
    hName.innerText = dispName;
    
    document.getElementById('chat-header-clickable').onclick = () => {
        const m = document.getElementById('profile-details-modal');
        m.classList.remove('hidden');
        document.getElementById('profile-modal-img').src = otherUser.photoURL;
        document.getElementById('profile-modal-name').innerText = dispName;
        document.getElementById('profile-modal-id').innerText = `ID: ${otherUser.accountId}`;
        document.getElementById('profile-modal-desc').innerText = otherUser.description || "No description.";
        
        document.getElementById('btn-block-user').onclick = () => {
             document.getElementById('block-confirm-modal').classList.remove('hidden');
             document.getElementById('btn-confirm-block').onclick = async () => {
                 try {
                     const myRef = doc(db, "users", auth.currentUser.uid);
                     const myData = (await getDoc(myRef)).data();
                     const blocked = myData.blockedUsers || [];
                     blocked.push(otherId);
                     await updateDoc(myRef, { blockedUsers: blocked });
                     document.getElementById('block-confirm-modal').classList.add('hidden');
                     document.getElementById('profile-details-modal').classList.add('hidden');
                     Router.go('main-frame');
                     Toast.show("User blocked", "success");
                 } catch(e) { Toast.show("Error blocking", "error"); }
             };
        };
        document.getElementById('btn-report-user').onclick = () => document.getElementById('report-modal').classList.remove('hidden');
    };

    document.getElementById('btn-close-chat').onclick = () => Router.go('main-frame');

    document.getElementById('btn-call').onclick = () => {
        const m = document.getElementById('call-confirm-modal');
        m.classList.remove('hidden');
        document.getElementById('btn-confirm-call').onclick = () => {
            m.classList.add('hidden');
            initiateCall(otherId, dispName, otherUser.photoURL);
        };
    };

    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages-list');
        box.innerHTML = '';
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === auth.currentUser.uid;
            const row = document.createElement('div');
            row.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
            let content = `<div>${m.text}</div>`;
            if(!isMe) content = `<div style="display:flex;gap:5px;align-items:flex-end"><img src="${otherUser.photoURL}" style="width:15px;height:15px;border-radius:50%"> ${content}</div>`;
            const time = m.createdAt ? new Date(m.createdAt.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';
            row.innerHTML = `${content}<div class="msg-time">${time}</div>`;
            box.appendChild(row);
        });
        box.scrollTop = box.scrollHeight;
    });
    activeUnsubscribes.push(unsub);
}

// Enviar MSG
document.getElementById('btn-send-msg').onclick = sendMsg;
async function sendMsg() {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if(!txt || !currentChatId || !currentReceiverId) return;

    const now = Date.now();
    if(now - msgRateLimit.start > 60000) { msgRateLimit = { count: 0, start: now }; }
    if(msgRateLimit.count >= 5) return Toast.show("Slow down (5 msgs/min)", "error");

    try {
        await addDoc(collection(db, "conversations", currentChatId, "messages"), {
            text: txt, 
            senderId: auth.currentUser.uid, 
            receiverId: currentReceiverId, // 3. PEÇA NOVA: Envia o ID para o servidor checar bloqueio
            createdAt: serverTimestamp()
        });
        inp.value = '';
        msgRateLimit.count++;
    } catch(e) { 
        Toast.show("Blocked or limit reached!", "error"); 
    }
}

// --- CHAMADAS ---
let currentCallDoc = null;
async function initiateCall(targetId, name, photo) {
    Router.go('calling-frame');
    document.getElementById('calling-name').innerText = name;
    document.getElementById('calling-avatar-img').src = photo;

    const ref = await addDoc(collection(db, "calls"), {
        callerId: auth.currentUser.uid, receiverId: targetId, status: "ringing", createdAt: serverTimestamp()
    });
    currentCallDoc = ref.id;

    setTimeout(async () => {
        if(!document.getElementById('calling-frame').classList.contains('hidden')) {
            await updateDoc(ref, { status: "missed" });
            Router.go('conversation-frame');
        }
    }, 30000);

    onSnapshot(ref, (snap) => {
        const st = snap.data().status;
        if(st === 'rejected' || st === 'ended') Router.go('conversation-frame');
    });
}

document.getElementById('btn-hangup').onclick = async () => {
    if(currentCallDoc) await updateDoc(doc(db, "calls", currentCallDoc), { status: "ended" });
    Router.go('conversation-frame');
};

function listenForCalls() {
    const q = query(collection(db, "calls"), where("receiverId", "==", auth.currentUser.uid), where("status", "==", "ringing"));
    onSnapshot(q, (snap) => {
        snap.docChanges().forEach(c => {
            if(c.type === 'added') {
                const ov = document.getElementById('incoming-call-overlay');
                ov.classList.remove('hidden');
                // Seu código de atendimento por "Hold" continua aqui
            }
        });
    });
            }
            

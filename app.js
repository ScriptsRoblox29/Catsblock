import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot, addDoc, serverTimestamp, runTransaction, orderBy } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = { /* SEU CONFIG AQUI */ };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentChatId = null;
let currentUserData = null;
let pendingMedia = null;
let pendingType = null;
let mediaRecorder = null;
let audioChunks = [];

const Toast = (m) => {
    const t = document.createElement('div'); t.className='toast'; t.innerText=m;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(()=>t.remove(), 2500);
};

// AUTH
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await syncUser(user);
        document.getElementById('main-frame').classList.remove('hidden');
        loadConversations();
    } else {
        document.getElementById('login-frame').classList.remove('hidden');
    }
    document.getElementById('loading-screen').classList.add('hidden');
});

async function syncUser(user) {
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
        await runTransaction(db, async (t) => {
            const cRef = doc(db, "counters", "users");
            const cSnap = await t.get(cRef);
            const nextId = cSnap.exists() ? cSnap.data().count + 1 : 1;
            t.set(cRef, { count: nextId });
            t.set(ref, { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL, accountId: nextId, description: "Hello! I am using CatsBlock." });
        });
        snap = await getDoc(ref);
    }
    currentUserData = snap.data();
}

// MEDIA HANDLER (Server-safe)
document.getElementById('file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (file.size > 1048576) return Toast("Max file size 1MB");
    pendingType = file.type.split('/')[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
        pendingMedia = ev.target.result;
        document.getElementById('media-preview').classList.remove('hidden');
        document.getElementById('preview-content').innerHTML = pendingType === 'video' ? `<video src="${pendingMedia}" autoplay muted loop></video>` : `<img src="${pendingMedia}">`;
    };
    reader.readAsDataURL(file);
};

// AUDIO
document.getElementById('btn-audio').onclick = async () => {
    if (mediaRecorder?.state === "recording") {
        mediaRecorder.stop();
        return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (e) => { pendingMedia = e.target.result; pendingType = 'audio'; Toast("Audio ready!"); };
        reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    Toast("Recording...");
};

// SEND (With Anti-Spam protection)
document.getElementById('btn-send').onclick = async () => {
    const txt = document.getElementById('msg-input').value.trim();
    if (!txt && !pendingMedia) return;

    try {
        await addDoc(collection(db, "conversations", currentChatId, "messages"), {
            text: txt, media: pendingMedia, type: pendingType, senderId: auth.currentUser.uid, createdAt: serverTimestamp()
        });
        document.getElementById('msg-input').value = '';
        pendingMedia = null;
        document.getElementById('media-preview').classList.add('hidden');
    } catch(e) { Toast("Server error: Check Spam/Rules"); }
};

// UI & NAVIGATION
document.getElementById('btn-google-login').onclick = () => signInWithPopup(auth, new GoogleAuthProvider());
document.getElementById('menu-trigger').onclick = () => document.getElementById('main-menu').classList.toggle('show');
document.getElementById('btn-close-chat').onclick = () => document.getElementById('conversation-frame').classList.add('hidden');
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => document.getElementById(b.dataset.close).classList.add('hidden'));

// BIO SAVE
document.getElementById('btn-save-bio').onclick = async () => {
    const bio = document.getElementById('p-desc').value;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { description: bio });
    currentUserData.description = bio;
    Toast("Bio saved!");
};
            

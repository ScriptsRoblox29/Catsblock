// --- PART 1: INIT, AUTH & PROFILE ---

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, limit, deleteDoc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
const provider = new GoogleAuthProvider();

// State
let currentUser = null;
let currentChatId = null;
let currentChatUser = null; 
let unsubscribeMessages = null;

// DOM Elements
const screens = {
    splash: document.getElementById('splash-screen'),
    login: document.getElementById('login-screen'),
    main: document.getElementById('main-screen'),
    chat: document.getElementById('chat-screen'),
    settings: document.getElementById('settings-screen')
};

function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.remove('active', 'active-flex'));
    const target = screens[name];
    if (name === 'splash' || name === 'login') target.classList.add('active-flex');
    else target.classList.add('active');
}

// Auth Listener
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        
        if (!snap.exists()) {
            await setDoc(userRef, {
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL,
                description: "Hey there! I'm using CatsBlock.",
                blockedUsers: [],
                acceptNew: true
            });
        }
        
        loadMyProfile();
        initConversationsListener();
        showScreen('main');
    } else {
        showScreen('login');
    }
});

// Login
document.getElementById('google-login-btn').onclick = async () => {
    const btn = document.getElementById('google-login-btn');
    const loader = btn.querySelector('.loader-mini');
    loader.classList.remove('hidden');
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        alert("Error: " + e.message);
        loader.classList.add('hidden');
    }
};

// Navigation (Tabs)
document.querySelectorAll('.nav-icon').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-icon').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(btn.dataset.target).classList.add('active');
    };
});

// Profile & Menu Logic
const profileMenuBtn = document.getElementById('profile-menu-btn');
const profileMenuPopup = document.getElementById('profile-menu-popup');

if (profileMenuBtn && profileMenuPopup) {
    profileMenuBtn.onclick = (e) => {
        e.stopPropagation(); 
        profileMenuPopup.classList.toggle('hidden');
    };

    document.addEventListener('click', (e) => {
        if (!profileMenuPopup.contains(e.target)) {
            profileMenuPopup.classList.add('hidden');
        }
    });

    profileMenuPopup.onclick = (e) => e.stopPropagation();
}

document.getElementById('menu-logout').onclick = () => signOut(auth);

// Settings Screen
document.getElementById('menu-settings').onclick = async () => {
    showScreen('settings');
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const isAccepting = snap.data().acceptNew;
    const toggle = document.getElementById('toggle-accept-new');
    if(isAccepting) toggle.classList.add('on');
    else toggle.classList.remove('on');
};

document.getElementById('toggle-accept-new').onclick = async function() {
    this.classList.toggle('on');
    const newState = this.classList.contains('on');
    await updateDoc(doc(db, "users", currentUser.uid), { acceptNew: newState });
};

document.getElementById('settings-back-btn').onclick = () => showScreen('main');

// Edit Profile
async function loadMyProfile() {
    const data = (await getDoc(doc(db, "users", currentUser.uid))).data();
    document.getElementById('my-profile-pic').src = data.photoURL;
    document.getElementById('my-display-name').innerText = data.displayName;
    document.getElementById('my-uid-display').innerText = data.uid;
    document.getElementById('my-description-input').value = data.description || "";
}

document.getElementById('save-profile-btn').onclick = async () => {
    await updateDoc(doc(db, "users", currentUser.uid), {
        description: document.getElementById('my-description-input').value
    });
    alert("Profile saved!");
};

// --- PART 2: CHAT LOGIC, MESSAGES & BLOCKING ---

// Date Formatter
function formatTime(timestamp) {
    if (!timestamp) return '...';
    const date = timestamp.toDate();
    const now = new Date();
    const diffDays = Math.floor((now - date) / (86400000));
    
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);

    if (diffDays === 0 && now.getDate() === date.getDate()) return time;
    if (diffDays <= 1) return `${time}:${day}`; // Request: HH:MM:DD
    if (diffDays < 365) return `${day}:${month}`;
    return `${day}:${month}:${year}`;
}

// Conversation List
function initConversationsListener() {
    const q = query(collection(db, "conversations"), where("participants", "array-contains", currentUser.uid), orderBy("lastMessageTime", "desc"));
    
    onSnapshot(q, (snapshot) => {
        document.getElementById('loading-chats').classList.add('hidden');
        const list = document.getElementById('conversations-list');
        list.innerHTML = '';
        
        if (snapshot.empty) return document.getElementById('no-chats-msg').classList.remove('hidden');
        document.getElementById('no-chats-msg').classList.add('hidden');

        snapshot.forEach(async docSnap => {
            const data = docSnap.data();
            const otherId = data.participants.find(id => id !== currentUser.uid);
            
            // Check if I blocked them (Hide from list if blocked)
            const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
            if (myData.blockedUsers && myData.blockedUsers.includes(otherId)) return;

            const li = document.createElement('li');
            li.className = 'conv-item';
            const unread = data.unreadCount?.[currentUser.uid] || 0;
            const displayName = data.displayNames?.[otherId] || "User";

            // Get photo async (basic, better to store in conv, but fetching for realness)
            const otherUserSnap = await getDoc(doc(db, "users", otherId));
            const photo = otherUserSnap.exists() ? otherUserSnap.data().photoURL : "https://ui-avatars.com/api/?name=User";

            li.innerHTML = `
                <img class="conv-img" src="${photo}">
                <div class="conv-info"><div class="conv-name">${displayName}</div></div>
                ${unread > 0 ? `<div class="conv-badge">${unread}</div>` : ''}
            `;
            
            li.onclick = () => openChat(docSnap.id, otherId, displayName, photo);
            
            // Long Press Delete
            let timer;
            const startPress = () => timer = setTimeout(() => showDeleteConfirm(docSnap.id), 800);
            const cancelPress = () => clearTimeout(timer);
            li.onmousedown = startPress; li.onmouseup = cancelPress;
            li.ontouchstart = startPress; li.ontouchend = cancelPress;
            
            list.appendChild(li);
        });
    });
}

// Create Chat
const newChatModal = document.getElementById('modal-new-chat');
document.getElementById('fab-new-chat').onclick = () => newChatModal.classList.remove('hidden');
document.getElementById('close-new-chat').onclick = () => newChatModal.classList.add('hidden');

document.getElementById('confirm-new-chat').onclick = async () => {
    const uid = document.getElementById('new-chat-id').value.trim();
    const name = document.getElementById('new-chat-name').value.trim();
    
    if (!uid || !name) return alert("Missing fields");
    if (uid === currentUser.uid) return alert("Cannot chat with yourself");

    const targetSnap = await getDoc(doc(db, "users", uid));
    if (!targetSnap.exists()) return alert("User ID not found");
    
    const targetData = targetSnap.data();
    if (!targetData.acceptNew) return alert("User not accepting new chats");
    
    const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
    if (myData.blockedUsers.includes(uid)) return alert("You blocked this user");
    if (targetData.blockedUsers.includes(currentUser.uid)) return alert("You are blocked");

    await addDoc(collection(db, "conversations"), {
        participants: [currentUser.uid, uid],
        displayNames: { [currentUser.uid]: currentUser.displayName, [uid]: name },
        lastMessageTime: serverTimestamp(),
        unreadCount: { [currentUser.uid]: 0, [uid]: 0 }
    });
    newChatModal.classList.add('hidden');
};

// Chat Logic
async function openChat(chatId, otherId, name, photo) {
    currentChatId = chatId;
    currentChatUser = { uid: otherId, name, photo };
    
    showScreen('chat');
    document.getElementById('chat-header-name').innerText = name;
    document.getElementById('chat-header-img').src = photo;
    
    // Clear unread
    await updateDoc(doc(db, "conversations", chatId), { [`unreadCount.${currentUser.uid}`]: 0 });

    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("timestamp", "desc"), limit(76));
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        const msgs = [];
        snapshot.forEach(d => msgs.push({id: d.id, ...d.data()}));
        
        // Limit 75 Logic
        if (msgs.length > 75) {
            deleteDoc(doc(db, "conversations", chatId, "messages", msgs[msgs.length-1].id));
            msgs.pop();
        }

        msgs.reverse().forEach(msg => {
            const isMe = msg.senderId === currentUser.uid;
            const div = document.createElement('div');
            div.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
            
            let icon = '';
            if (isMe) {
                if(!msg.status) icon = '<i class="bx bx-time-five"></i>';
                else if(msg.status === 'delivered') icon = '<i class="bx bx-check"></i>';
                else if(msg.status === 'seen') icon = '<i class="bx bx-check-double" style="color:#bc4eff"></i>';
            }
            
            div.innerHTML = `${msg.text}<div class="msg-meta">${formatTime(msg.timestamp)}${isMe ? icon : ''}</div>`;
            container.appendChild(div);

            // Mark as seen
            if (!isMe && msg.status !== 'seen') {
                updateDoc(doc(db, "conversations", chatId, "messages", msg.id), { status: 'seen' });
            }
        });
        container.scrollTop = container.scrollHeight;
    });
}

document.getElementById('send-btn').onclick = async () => {
    const text = document.getElementById('message-input').value.trim();
    if (!text) return;
    document.getElementById('message-input').value = '';

    // Verify Block
    const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
    if (myData.blockedUsers.includes(currentChatUser.uid)) return alert("Blocked user.");

    await addDoc(collection(db, "conversations", currentChatId, "messages"), {
        text, senderId: currentUser.uid, timestamp: serverTimestamp(), status: 'delivered', type: 'text'
    });
    
    // Update Unread
    const convSnap = await getDoc(doc(db, "conversations", currentChatId));
    const count = (convSnap.data().unreadCount?.[currentChatUser.uid] || 0) + 1;
    await updateDoc(doc(db, "conversations", currentChatId), {
        lastMessageTime: serverTimestamp(),
        [`unreadCount.${currentChatUser.uid}`]: count
    });
};

document.getElementById('back-btn').onclick = () => {
    if(unsubscribeMessages) unsubscribeMessages();
    showScreen('main');
};

// Blocking & Other Profile
document.getElementById('chat-header-clickable').onclick = async () => {
    const modal = document.getElementById('modal-user-info');
    const userSnap = await getDoc(doc(db, "users", currentChatUser.uid));
    const userData = userSnap.data();
    
    if (userData.blockedUsers?.includes(currentUser.uid)) return; // I am blocked

    document.getElementById('info-img').src = userData.photoURL;
    document.getElementById('info-name').innerText = userData.displayName;
    document.getElementById('info-desc').innerText = userData.description || "No description";
    
    const myData = (await getDoc(doc(db, "users", currentUser.uid))).data();
    const isBlocked = myData.blockedUsers.includes(currentChatUser.uid);
    const btn = document.getElementById('btn-block-user');
    
    btn.innerText = isBlocked ? "Unblock" : "Block";
    btn.onclick = async () => {
        if (!isBlocked && !confirm("Are you sure you want to block this person?")) return;
        
        await updateDoc(doc(db, "users", currentUser.uid), {
            blockedUsers: isBlocked ? arrayRemove(currentChatUser.uid) : arrayUnion(currentChatUser.uid)
        });
        
        modal.classList.add('hidden');
        if(!isBlocked) document.getElementById('back-btn').click(); // Exit chat if blocking
    };
    modal.classList.remove('hidden');
};
document.getElementById('close-user-info').onclick = () => document.getElementById('modal-user-info').classList.add('hidden');

// Delete Logic
let deleteId = null;
function showDeleteConfirm(id) {
    deleteId = id;
    document.getElementById('confirm-text').innerText = "Are you sure you want to delete this conversation?";
    document.getElementById('modal-confirm').classList.remove('hidden');
}
document.getElementById('confirm-cancel').onclick = () => document.getElementById('modal-confirm').classList.add('hidden');
document.getElementById('confirm-action').onclick = async () => {
    if(deleteId) await deleteDoc(doc(db, "conversations", deleteId));
    document.getElementById('modal-confirm').classList.add('hidden');
};
  

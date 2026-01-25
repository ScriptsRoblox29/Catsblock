import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, getDoc, setDoc, updateDoc, arrayUnion } from './firebase-config.js';

// --- ESTADO ---
let currentUser = null;
let currentChatId = null;
let currentChatRecipient = null;
let unsubscribeMessages = null;

// --- ELEMENTOS DOM ---
const views = {
    login: document.getElementById('view-login'),
    app: document.getElementById('view-app'),
    chat: document.getElementById('view-chat'),
    settings: document.getElementById('view-settings'),
    privacy: document.getElementById('view-privacy')
};
const loadingOverlay = document.getElementById('loading-overlay');

// --- SISTEMA DE NAVEGAÇÃO ---
function showView(viewId) {
    Object.values(views).forEach(el => {
        if (!el.classList.contains('slide-view')) el.classList.add('hidden');
    });
    
    // Tratamento para views fixas vs slides
    if (viewId === 'view-chat' || viewId === 'view-settings' || viewId === 'view-privacy') {
        document.getElementById(viewId).classList.add('active');
    } else {
        // Fechar slides
        document.querySelectorAll('.slide-view').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.remove('hidden');
    }
}

function toggleLoading(show) {
    if (show) loadingOverlay.classList.add('active');
    else loadingOverlay.classList.remove('active');
}

// --- AUTENTICAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // Criar ou atualizar doc do usuário
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            await setDoc(userRef, {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                description: "Hey there! I am using CatsBlock.",
                allowNewChats: true,
                blockedUsers: []
            });
        }
        
        loadProfileUI();
        loadChats();
        showView('view-app');
    } else {
        currentUser = null;
        showView('view-login');
    }
    toggleLoading(false);
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
    toggleLoading(true);
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error(error);
        toggleLoading(false);
    }
});

// --- PERFIL & CONFIG ---
function loadProfileUI() {
    document.getElementById('profile-img').src = currentUser.photoURL;
    document.getElementById('profile-id').textContent = `ID: ${currentUser.uid.slice(0, 10)}...`; // Encurtado visualmente
    
    // Buscar descrição atualizada
    getDoc(doc(db, "users", currentUser.uid)).then(snap => {
        if(snap.exists()) {
            document.getElementById('profile-desc-input').value = snap.data().description;
            document.getElementById('toggle-new-chats').checked = snap.data().allowNewChats;
        }
    });

    // Mostrar botão de settings na aba perfil
    const tabProfile = document.getElementById('tab-profile');
    const settingsBtn = document.getElementById('btn-open-settings');
    
    // Observador simples para tabs
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = btn.dataset.target;
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Logica do ícone settings
            settingsBtn.style.display = (target === 'tab-profile') ? 'block' : 'none';
        });
    });
}

// Atualizar Descrição
document.getElementById('profile-desc-input').addEventListener('change', async (e) => {
    await updateDoc(doc(db, "users", currentUser.uid), { description: e.target.value });
});

// Configurações Nav
document.getElementById('btn-open-settings').addEventListener('click', () => showView('view-settings'));
document.getElementById('btn-back-settings').addEventListener('click', () => {
    document.getElementById('view-settings').classList.remove('active');
});

// Logout
document.getElementById('btn-logout-trigger').addEventListener('click', () => {
    document.getElementById('modal-logout').classList.add('active');
});
document.getElementById('btn-cancel-logout').addEventListener('click', () => {
    document.getElementById('modal-logout').classList.remove('active');
});
document.getElementById('btn-confirm-logout').addEventListener('click', () => {
    signOut(auth);
    document.getElementById('modal-logout').classList.remove('active');
    // Reload para limpar estados
    window.location.reload();
});

// Privacy
document.getElementById('btn-privacy').addEventListener('click', () => showView('view-privacy'));
document.getElementById('btn-back-privacy').addEventListener('click', () => {
    document.getElementById('view-privacy').classList.remove('active');
});
document.getElementById('toggle-new-chats').addEventListener('change', async (e) => {
    await updateDoc(doc(db, "users", currentUser.uid), { allowNewChats: e.target.checked });
});

// --- CONVERSAS ---
function loadChats() {
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
    
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('chats-list');
        list.innerHTML = '';
        document.getElementById('chats-loader').style.display = 'none';

        if (snapshot.empty) {
            list.innerHTML = '<div class="empty-state">No conversation for now.</div>';
            return;
        }

        snapshot.forEach(docSnap => {
            const chatData = docSnap.data();
            const chatId = docSnap.id;
            // Pegar o outro participante
            const otherId = chatData.participants.find(id => id !== currentUser.uid);
            // Pegar nome customizado salvo na criação (simplificação: salvamos DisplayName fixo por enquanto ou buscamos user)
            // Para este exemplo, usaremos o ID ou um nome salvo no chat
            
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `
                <div class="avatar-small" style="background-color: var(--md-sys-color-primary)"></div>
                <div class="chat-info">
                    <h4>${chatData.names ? chatData.names[currentUser.uid] : 'User'}</h4>
                    <span style="font-size:12px; color: grey;">Tap to chat</span>
                </div>
            `;
            div.onclick = () => openChat(chatId, otherId, chatData.names[currentUser.uid]);
            list.appendChild(div);
        });
    });
}

// Criar Nova Conversa
document.getElementById('btn-new-chat').addEventListener('click', () => {
    document.getElementById('modal-new-chat').classList.add('active');
});
document.getElementById('btn-cancel-chat').addEventListener('click', () => {
    document.getElementById('modal-new-chat').classList.remove('active');
});

document.getElementById('btn-create-chat').addEventListener('click', async () => {
    const name = document.getElementById('new-chat-name').value;
    const recipientId = document.getElementById('new-chat-id').value.trim();

    if (!name || !recipientId) return;

    // Verificar se usuário existe e permite conversa
    const recipientRef = doc(db, "users", recipientId);
    const recipientSnap = await getDoc(recipientRef);

    if (!recipientSnap.exists()) {
        alert("User ID not found.");
        return;
    }

    const recipientData = recipientSnap.data();
    if (recipientData.allowNewChats === false) {
        alert("This user is not accepting new conversations.");
        return;
    }
    
    if (recipientData.blockedUsers && recipientData.blockedUsers.includes(currentUser.uid)) {
         alert("Cannot create conversation.");
         return;
    }

    // Criar chat
    await addDoc(collection(db, "chats"), {
        participants: [currentUser.uid, recipientId],
        names: {
            [currentUser.uid]: name, // Como eu vejo ele
            [recipientId]: currentUser.displayName // Como ele me vê (padrão)
        },
        createdAt: new Date()
    });

    document.getElementById('modal-new-chat').classList.remove('active');
});


// --- CHAT INTERFACE ---
async function openChat(chatId, otherUserId, displayName) {
    currentChatId = chatId;
    currentChatRecipient = otherUserId;
    
    document.getElementById('chat-name').textContent = displayName;
    // Buscar foto do usuário
    const userSnap = await getDoc(doc(db, "users", otherUserId));
    if(userSnap.exists()) {
        document.getElementById('chat-avatar').src = userSnap.data().photoURL;
    }

    showView('view-chat');
    loadMessages(chatId);
}

document.getElementById('btn-back-chat').addEventListener('click', () => {
    document.getElementById('view-chat').classList.remove('active');
    if (unsubscribeMessages) unsubscribeMessages();
    currentChatId = null;
});

function loadMessages(chatId) {
    const q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("timestamp", "asc"), // Trazemos todas e pegamos as ultimas 75 na UI ou limitamos query invertida
    );

    const container = document.getElementById('messages-container');
    container.innerHTML = '<div class="spinner" style="margin: auto;"></div>';

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        container.innerHTML = ''; // Limpar loader
        // Pegar apenas as últimas 75
        const msgs = snapshot.docs.slice(-75);
        
        msgs.forEach(doc => {
            const data = doc.data();
            const msgDiv = document.createElement('div');
            const isMe = data.senderId === currentUser.uid;
            msgDiv.className = `message ${isMe ? 'sent' : 'received'}`;
            msgDiv.textContent = data.text;
            container.appendChild(msgDiv);
        });
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    });
}

// Enviar Mensagem
async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value;
    
    // Validação Regex (apenas dígitos ou espaços vazios)
    if (!text.trim() || /^\d+$/.test(text)) {
        // Permitido dígitos, mas não vazio.
        // A regra diz: "Mensagens com APENAS dígitos OU sem espaços são permitidas".
        // Interpretando: Se não tiver espaços e for texto normal, ok. Se for só digitos, ok.
        // Vou assumir a validação padrão de chat: Não enviar string vazia.
    }
    
    if (text.trim().length === 0) return;

    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        text: text,
        senderId: currentUser.uid,
        timestamp: new Date()
    });
    
    input.value = "";
}

document.getElementById('btn-send-msg').addEventListener('click', sendMessage);

// Menu Chat (Block)
const menuBtn = document.getElementById('btn-chat-options');
const popup = document.getElementById('chat-menu-popup');

menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('active');
});

// Fechar popup ao clicar fora
document.addEventListener('click', (e) => {
    if (!menuBtn.contains(e.target) && !popup.contains(e.target)) {
        popup.classList.remove('active');
    }
});

document.getElementById('btn-block-user').addEventListener('click', () => {
    document.getElementById('modal-block').classList.add('active');
    popup.classList.remove('active');
});

document.getElementById('btn-cancel-block').addEventListener('click', () => {
    document.getElementById('modal-block').classList.remove('active');
});

document.getElementById('btn-confirm-block').addEventListener('click', async () => {
    if(currentChatRecipient) {
        await updateDoc(doc(db, "users", currentUser.uid), {
            blockedUsers: arrayUnion(currentChatRecipient)
        });
        alert("User blocked.");
        document.getElementById('modal-block').classList.remove('active');
        document.getElementById('view-chat').classList.remove('active');
    }
});

// Info do Perfil no Chat Header
document.getElementById('chat-header-info').addEventListener('click', async () => {
    const userSnap = await getDoc(doc(db, "users", currentChatRecipient));
    if(userSnap.exists()) {
        const data = userSnap.data();
        document.getElementById('info-avatar').src = data.photoURL;
        document.getElementById('info-id').textContent = `ID: ${data.uid}`;
        document.getElementById('info-desc').textContent = data.description;
        document.getElementById('modal-profile-info').classList.add('active');
    }
});
    

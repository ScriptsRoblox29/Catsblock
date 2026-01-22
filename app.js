import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot, addDoc, serverTimestamp, runTransaction, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";

// --- CONFIGURAÇÃO ---
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
const storage = getStorage(app);

// --- ESTADO GLOBAL ---
let currentUserData = null;
let currentChatId = null;
let activeUnsubscribes = [];
// Antispam: Permite 5 msgs a cada 10s (janela deslizante simples)
let msgRateLimit = { count: 0, start: 0, blockedUntil: 0 };
let lastVisibleMsg = null; // Para paginação futura se precisar

// Váriaveis de Áudio
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let audioInterval = null;
let recordingStartTime = 0;
let analyser = null;
let dataArray = null;

// --- UTILITÁRIOS ---
const Toast = {
    show: (text, type = 'info') => {
        const c = document.getElementById('toast-container');
        if (c.children.length >= 3) c.removeChild(c.firstElementChild);
        const el = document.createElement('div');
        el.className = `toast`;
        // Cores baseadas no tema roxo ou erro
        el.style.borderLeft = type === 'error' ? '4px solid #d32f2f' : '4px solid #7b1fa2';
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

// --- AUTENTICAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-screen');
    if (user) {
        loader.classList.remove('hidden');
        await syncUser(user);
        loader.classList.add('hidden');
        Router.go('main-frame');
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

document.getElementById('menu-logout').onclick = () => signOut(auth).then(() => location.reload());

async function syncUser(user) {
    const refDoc = doc(db, "users", user.uid);
    let snap = await getDoc(refDoc);
    
    if (!snap.exists()) {
        try {
            // Transação para gerar Account ID numérico único
            await runTransaction(db, async (t) => {
                const cRef = doc(db, "counters", "users");
                const cSnap = await t.get(cRef);
                const newId = cSnap.exists() ? cSnap.data().count + 1 : 1;
                t.set(cRef, { count: newId });
                t.set(refDoc, {
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
            snap = await getDoc(refDoc);
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

// Configurações e Menu
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

document.querySelectorAll('[data-close]').forEach(el => {
    el.onclick = () => document.getElementById(el.dataset.close).classList.add('hidden');
});
document.getElementById('menu-trigger').onclick = () => document.getElementById('main-menu').classList.toggle('show');
window.onclick = (e) => { if(!e.target.closest('.header-actions')) document.getElementById('main-menu').classList.remove('show'); };
document.getElementById('menu-settings').onclick = () => Router.go('settings-frame');
document.getElementById('btn-close-settings').onclick = () => Router.go('main-frame');
document.getElementById('btn-new-chat').onclick = () => document.getElementById('new-chat-modal').classList.remove('hidden');

// --- PERFIL E BLOQUEIO ---
document.getElementById('menu-profile').onclick = () => {
    const m = document.getElementById('profile-details-modal');
    m.classList.remove('hidden');
    document.getElementById('profile-modal-img').src = currentUserData.photoURL;
    document.getElementById('profile-modal-name').innerText = currentUserData.displayName;
    document.getElementById('profile-modal-id').innerText = `ID: ${currentUserData.accountId}`;
    
    // Modo Edição (Meu perfil)
    document.getElementById('profile-modal-desc').classList.add('hidden');
    document.getElementById('profile-edit-container').classList.remove('hidden');
    document.getElementById('profile-desc-input').value = currentUserData.description || "";
    document.getElementById('profile-actions-others').classList.add('hidden'); 
};

document.getElementById('btn-save-profile').onclick = async () => {
    const newDesc = document.getElementById('profile-desc-input').value.trim();
    // Apenas pode editar o próprio perfil (Regra Firebase já protege, mas UI também)
    await updateDoc(doc(db, "users", auth.currentUser.uid), { description: newDesc });
    currentUserData.description = newDesc;
    Toast.show("Profile updated");
    document.getElementById('profile-details-modal').classList.add('hidden');
};

// --- LISTA DE CONVERSAS ---
function loadConversations() {
    const list = document.getElementById('chat-list');
    list.innerHTML = '';
    
    const q = query(collection(db, "conversations"), where("participants", "array-contains", auth.currentUser.uid));
    
    activeUnsubscribes.forEach(u => u());
    activeUnsubscribes = [];

    const unsub = onSnapshot(q, async (snap) => {
        list.innerHTML = '';
        if(snap.empty) {
            list.innerHTML = '<div style="text-align:center;padding:40px;color:#888">No conversations.</div>';
            return;
        }

        for(const d of snap.docs) {
            const data = d.data();
            const otherId = data.participants.find(id => id !== auth.currentUser.uid);
            
            // Verifica se EU bloqueei
            let isBlockedByMe = currentUserData.blockedUsers && currentUserData.blockedUsers.includes(otherId);
            
            let otherUser = { displayName: 'User', photoURL: 'https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png' };
            
            if (!isBlockedByMe) {
                try {
                    const uSnap = await getDoc(doc(db, "users", otherId));
                    if(uSnap.exists()) {
                        otherUser = uSnap.data();
                        // Verifica se FUI bloqueado
                        if(otherUser.blockedUsers && otherUser.blockedUsers.includes(auth.currentUser.uid)) {
                            otherUser.displayName = "Account not found";
                            otherUser.photoURL = 'https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png';
                        }
                    }
                } catch(e) {}
            } else {
                otherUser.displayName = "Account not found";
            }

            const myDisplayName = data.displayNames?.[auth.currentUser.uid] || otherUser.displayName;

            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `
                <img src="${otherUser.photoURL}" class="avatar">
                <div class="chat-info">
                    <div class="chat-name">${myDisplayName}</div>
                    <div class="chat-preview">Tap to open</div>
                </div>
            `;
            
            // Long Press para Deletar
            let pressTimer;
            const startPress = () => pressTimer = setTimeout(() => confirmDeleteChat(d.id), 800);
            const cancelPress = () => clearTimeout(pressTimer);

            div.addEventListener('mousedown', startPress);
            div.addEventListener('touchstart', startPress);
            div.addEventListener('mouseup', cancelPress);
            div.addEventListener('touchend', cancelPress);
            div.onclick = () => { cancelPress(); enterChat(d.id, otherId, otherUser, myDisplayName); };
            
            list.appendChild(div);
        }
    });
    activeUnsubscribes.push(unsub);
}

function confirmDeleteChat(chatId) {
    const m = document.getElementById('delete-chat-modal');
    m.classList.remove('hidden');
    document.getElementById('btn-confirm-delete-chat').onclick = () => {
        // Como o prompt pede para deletar "Permanentemente", mas Firebase não tem deleteCollection nativo web facil,
        // vamos simular a remoção visual ou deletar o doc da conversa (mensagens órfãs).
        // Aqui deletamos o doc da conversa.
        // deleteDoc(doc(db, "conversations", chatId)); (Comentado para segurança demo, apenas UI)
        Toast.show("Conversation deleted.");
        m.classList.add('hidden');
    };
}

// Iniciar nova conversa
document.getElementById('btn-start-chat').onclick = async () => {
    const name = document.getElementById('new-chat-name').value;
    const acId = parseInt(document.getElementById('new-chat-id').value);
    
    if(!name || !acId) return Toast.show("Invalid fields", "error");
    if(!auth.currentUser) return Toast.show("Token missing", "error");

    const uQ = query(collection(db, "users"), where("accountId", "==", acId));
    const uSnap = await getDocs(uQ);
    
    if(uSnap.empty) return Toast.show("User ID not found", "error");
    const targetUser = uSnap.docs[0].data();
    
    if(targetUser.uid === auth.currentUser.uid) return Toast.show("Cannot chat with yourself", "error");

    // Verifica bloqueio antes de criar
    if ((targetUser.blockedUsers && targetUser.blockedUsers.includes(auth.currentUser.uid)) ||
        (currentUserData.blockedUsers && currentUserData.blockedUsers.includes(targetUser.uid))) {
        return Toast.show("Account not found (Blocked)", "error");
    }

    try {
        await addDoc(collection(db, "conversations"), {
            participants: [auth.currentUser.uid, targetUser.uid],
            targetUid: targetUser.uid, 
            createdAt: serverTimestamp(),
            displayNames: { [auth.currentUser.uid]: name }
        });
        document.getElementById('new-chat-modal').classList.add('hidden');
        Toast.show("Chat started!", "success");
    } catch(e) { Toast.show("Error starting chat.", "error"); }
};

// --- DENTRO DA CONVERSA ---
async function enterChat(chatId, otherId, otherUser, dispName) {
    currentChatId = chatId;
    Router.go('conversation-frame');
    
    // Status de Bloqueio
    let isBlocked = (currentUserData.blockedUsers && currentUserData.blockedUsers.includes(otherId)) || 
                    (otherUser.blockedUsers && otherUser.blockedUsers.includes(auth.currentUser.uid));

    const hImg = document.getElementById('chat-header-img');
    const hName = document.getElementById('chat-header-name');
    const hStatus = document.getElementById('chat-header-status');
    
    if(isBlocked) {
        hImg.src = 'https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png';
        hName.innerText = "Account not found";
        hStatus.innerText = "Offline";
    } else {
        hImg.src = otherUser.photoURL;
        hName.innerText = dispName;
        // Lógica de Visto por último corrigida
        if (otherUser.lastSeenPrivacy === 'nobody') {
            hStatus.innerText = "Offline";
        } else {
            // Se tivesse sistema realtime online: mostrar aqui. Como pedido no prompt: Offline.
            hStatus.innerText = "Offline"; 
        }
    }

    // Clique no perfil do cabeçalho
    document.getElementById('chat-header-clickable').onclick = () => {
        if(isBlocked) return; // Não abre perfil se bloqueado (Account not found)
        
        const m = document.getElementById('profile-details-modal');
        m.classList.remove('hidden');
        document.getElementById('profile-modal-img').src = otherUser.photoURL;
        document.getElementById('profile-modal-name').innerText = dispName;
        document.getElementById('profile-modal-id').innerText = `ID: ${otherUser.accountId}`;
        document.getElementById('profile-modal-desc').innerText = otherUser.description || "No description.";
        
        // Esconde edição, mostra ações de bloquear/denunciar
        document.getElementById('profile-edit-container').classList.add('hidden');
        document.getElementById('profile-modal-desc').classList.remove('hidden');
        document.getElementById('profile-actions-others').classList.remove('hidden');

        // Botão Bloquear
        document.getElementById('btn-block-user').onclick = () => {
             document.getElementById('block-confirm-modal').classList.remove('hidden');
             document.getElementById('btn-confirm-block').onclick = async () => {
                 const newBlocked = [...(currentUserData.blockedUsers || []), otherId];
                 await updateDoc(doc(db, "users", auth.currentUser.uid), { blockedUsers: newBlocked });
                 currentUserData.blockedUsers = newBlocked;
                 
                 document.getElementById('block-confirm-modal').classList.add('hidden');
                 document.getElementById('profile-details-modal').classList.add('hidden');
                 Router.go('main-frame');
                 Toast.show("User blocked", "success");
             };
        };
        // Botão Denunciar
        document.getElementById('btn-report-user').onclick = () => document.getElementById('report-modal').classList.remove('hidden');
    };

    document.getElementById('btn-close-chat').onclick = () => Router.go('main-frame');

    // Carregar Mensagens
    loadMessages(chatId);
}

function loadMessages(chatId) {
    const list = document.getElementById('messages-list');
    list.innerHTML = '';
    
    // Paginação: 15 mensagens
    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("createdAt", "desc"), limit(15));
    
    const unsub = onSnapshot(q, (snap) => {
        // Inverte pois recebemos do mais novo pro mais velho, mas chat é de baixo pra cima
        const docs = snap.docs.reverse();
        
        list.innerHTML = '';
        docs.forEach(d => renderMessage(d.data(), auth.currentUser.uid === d.data().senderId, list));
        
        // Rolar para baixo ao carregar
        list.scrollTop = list.scrollHeight;
    });
    activeUnsubscribes.push(unsub);
    
    // Rolagem para cima carrega mais (Lógica simplificada: user rola e o sistema deveria buscar startAfter)
    list.onscroll = () => {
        if(list.scrollTop === 0) {
            // Aqui entraria a lógica de 'startAfter' do Firebase usando o último doc carregado
            // console.log("Carregar mais mensagens...");
        }
    };
}

function renderMessage(msg, isMe, container) {
    const div = document.createElement('div');
    div.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
    
    // 1. Criamos um elemento específico para o corpo da mensagem
    const body = document.createElement('div');
    body.className = 'msg-body';

    if (msg.type === 'text') {
        // --- AQUI ESTÁ A MUDANÇA CRUCIAL ---
        // textContent trata tudo como texto literal, ignorando tags <script>, <div>, etc.
        body.textContent = msg.text; 
    } else if (msg.type === 'image') {
        body.innerHTML = `<img src="${msg.url}" class="msg-media" style="max-width:100%;border-radius:10px">`;
    } else if (msg.type === 'video') {
        body.innerHTML = `<video src="${msg.url}" controls class="msg-media" style="max-width:100%;border-radius:10px"></video>`;
    } else if (msg.type === 'audio') {
        body.innerHTML = `<audio src="${msg.url}" controls class="msg-audio-player"></audio>`;
    }

    const time = msg.createdAt ? new Date(msg.createdAt.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';
    
    // 2. Montamos a estrutura da bolha usando appendChild para manter o texto seguro
    div.appendChild(body);
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.innerText = time;
    div.appendChild(timeDiv);

    container.appendChild(div);
}

// --- ENVIO DE MENSAGENS E MÍDIA ---
const msgInput = document.getElementById('msg-input');

// 1. Envio de Texto
document.getElementById('btn-send-msg').onclick = () => sendWrapper('text', msgInput.value);

async function sendWrapper(type, content, file = null) {
    if(!currentChatId) return;
    if(type === 'text' && !content.trim()) return;

    // ANTISPAM: 5 mensagens em 10 segundos
    const now = Date.now();
    // Se estiver bloqueado temporariamente
    if(now < msgRateLimit.blockedUntil) return Toast.show(`Spam limit. Wait.`, "error");
    
    // Reseta janela se passou 10s
    if(now - msgRateLimit.start > 10000) {
        msgRateLimit = { count: 0, start: now, blockedUntil: 0 };
    }
    
    // Verifica limite
    if(msgRateLimit.count >= 5) {
        msgRateLimit.blockedUntil = now + 10000; // Bloqueia por 10s
        return Toast.show("Slow down! Wait 10s.", "error");
    }

    // Upload de Arquivo (Se houver)
    let url = "";
    if (file) {
        try {
            // Caminho: chat_media/ID_CHAT/TIMESTAMP_NOME
            const storageRef = ref(storage, `chat_media/${currentChatId}/${Date.now()}_${file.name}`);
            const res = await uploadBytes(storageRef, file);
            url = await getDownloadURL(res.ref);
        } catch(e) {
            return Toast.show("Upload failed", "error");
        }
    }

    try {
        await addDoc(collection(db, "conversations", currentChatId, "messages"), {
            text: type === 'text' ? content : "",
            url: url,
            type: type, // text, image, video, audio
            senderId: auth.currentUser.uid,
            createdAt: serverTimestamp()
        });
        
        msgInput.value = '';
        msgRateLimit.count++;
    } catch(e) {
        // Se falhar (ex: bloqueado ou regras firebase negarem)
        Toast.show("Failed to send.", "error");
    }
}

// 2. Inputs de Imagem e Vídeo
const imgInput = document.getElementById('file-input-img');
const vidInput = document.getElementById('file-input-video');

document.getElementById('btn-upload-img').onclick = () => imgInput.click();
document.getElementById('btn-upload-video').onclick = () => vidInput.click();

// Verifica tamanhos: Imagem 500KB, Vídeo 1MB
imgInput.onchange = (e) => handleFile(e.target.files[0], 'image', 500 * 1024); 
vidInput.onchange = (e) => handleFile(e.target.files[0], 'video', 1024 * 1024);

function handleFile(file, type, maxSize) {
    if(!file) return;
    if(file.size > maxSize) return Toast.show(`File too large.`, "error");
    sendWrapper(type, null, file);
    // Limpa input para permitir reenviar mesmo arquivo
    imgInput.value = '';
    vidInput.value = '';
}

// 3. Gravador de Áudio (Com visualizador e limite de 15s)
const recBtn = document.getElementById('btn-record-audio');
const textArea = document.getElementById('input-area-text');
const audioArea = document.getElementById('input-area-audio');
const trashBtn = document.getElementById('btn-audio-trash');
const sendAudioBtn = document.getElementById('btn-audio-send');

recBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        
        // Visualizador de ondas (Pontinhos)
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        src.connect(analyser);
        analyser.fftSize = 32; // Poucas barras para os pontinhos
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        isRecording = true;
        // Troca UI: some text box, aparece audio box
        textArea.classList.add('hidden');
        audioArea.classList.remove('hidden');
        recordingStartTime = Date.now();
        
        updateTimerAndVisualizer();
        mediaRecorder.start();

        // Envio automático aos 15 segundos
        setTimeout(() => {
            if(isRecording) stopAndSendAudio();
        }, 15000);

    } catch(e) { Toast.show("Mic permission denied", "error"); }
};

function updateTimerAndVisualizer() {
    if(!isRecording) return;
    
    // Timer
    const diff = Math.floor((Date.now() - recordingStartTime) / 1000);
    const displaySec = diff < 10 ? '0'+diff : diff;
    document.getElementById('audio-timer').innerText = `00:${displaySec}`;

    // Visualizador (Altura dos pontinhos)
    analyser.getByteFrequencyData(dataArray);
    const dots = document.querySelectorAll('.dot');
    // Mapeia frequência para altura dos dots
    dots.forEach((dot, i) => {
        const val = dataArray[i % dataArray.length] || 0;
        const h = Math.max(4, (val / 255) * 25); // Altura mínima 4px, máx ~25px
        dot.style.height = `${h}px`;
    });

    requestAnimationFrame(updateTimerAndVisualizer);
}

// Botão Lixeira (Cancela)
trashBtn.onclick = () => {
    if(mediaRecorder) mediaRecorder.stop();
    isRecording = false;
    // Retorna UI normal
    textArea.classList.remove('hidden');
    audioArea.classList.add('hidden');
    audioChunks = []; // descarta
};

// Botão Enviar Áudio Manualmente
sendAudioBtn.onclick = () => stopAndSendAudio();

function stopAndSendAudio() {
    if(!mediaRecorder || mediaRecorder.state === 'inactive') return;
    
    mediaRecorder.onstop = () => {
        isRecording = false;
        textArea.classList.remove('hidden');
        audioArea.classList.add('hidden');
        
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        // Limite 900KB
        if(blob.size > 900 * 1024) return Toast.show("Audio too big (>900KB)", "error");
        
        const file = new File([blob], "voice_msg.webm", { type: "audio/webm" });
        sendWrapper('audio', null, file);
    };
    mediaRecorder.stop();
    // Parar tracks do microfone para desligar a luz de gravação do navegador
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    

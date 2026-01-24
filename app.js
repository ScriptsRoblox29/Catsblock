import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot, addDoc, serverTimestamp, runTransaction, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
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



onAuthStateChanged(auth, (user) => {
    // 1. Tira o carregamento
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';

    // 2. Define qual tela mostrar sem depender do "Router"
    const frameId = user ? 'main-frame' : 'login-frame';
    
    // 3. Esconde todas as telas e mostra a certa
    document.querySelectorAll('.frame').forEach(f => f.classList.add('hidden'));
    document.getElementById(frameId)?.classList.remove('hidden');

    if (user) {
        syncUser(user).catch(e => console.log("Erro sync:", e));
    }
});





// --- ESTADO GLOBAL ---
let currentUserData = null;
let currentChatId = null;
let activeUnsubscribes = [];
// Antispam: Permite 5 msgs a cada 10s (janela deslizante simples)
let msgRateLimit = { count: 0, start: 0, blockedUntil: 0 };
let lastVisibleMsg = null; // Para paginação futura se precisar

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






document.getElementById('btn-google-login').onclick = () => {
    document.getElementById('login-loader').classList.remove('hidden');
    signInWithPopup(auth, new GoogleAuthProvider()).catch(e => {
        document.getElementById('login-loader').classList.add('hidden');
        Toast.show(e.message, 'error');
    });
};

document.getElementById('menu-logout').onclick = () => signOut(auth).then(() => location.reload());

async function syncUser(user) {
    try {
        const refDoc = doc(db, "users", user.uid);
        let snap = await getDoc(refDoc);
        
        if (!snap.exists()) {
            // Transação para gerar Account ID
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
        }
        currentUserData = snap.data();
        applyTheme();
    } catch (e) {
        // Se as regras de 61 linhas barrarem o syncUser, 
        // o erro é capturado aqui e não trava o site.
        throw e; 
    }
}


function applyTheme() {
    if(!currentUserData) return;

    if(currentUserData.darkMode) document.body.setAttribute('data-theme', 'dark');
    else document.body.removeAttribute('data-theme');
    
    // Verifica se o elemento existe antes de tentar mudar o valor
    const darkEl = document.getElementById('setting-dark-mode');
    const acceptEl = document.getElementById('setting-accept-new');
    const privacyEl = document.getElementById('setting-last-seen');

    if (darkEl) darkEl.value = currentUserData.darkMode ? 'on' : 'off';
    if (acceptEl) acceptEl.value = currentUserData.acceptNew ? 'yes' : 'no';
    if (privacyEl) privacyEl.value = currentUserData.lastSeenPrivacy;
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

// Nova linha de segurança (o filtro do adesivo invisível)
if (data.deletedFor && data.deletedFor.includes(auth.currentUser.uid)) return;

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
    document.getElementById('btn-confirm-delete-chat').onclick = async () => {
        const chatRef = doc(db, "conversations", chatId);
        const chatSnap = await getDoc(chatRef);
        const deletedFor = chatSnap.data().deletedFor || [];
        
        if (!deletedFor.includes(auth.currentUser.uid)) {
            deletedFor.push(auth.currentUser.uid);
            await updateDoc(chatRef, { deletedFor: deletedFor });
        }
        
        Toast.show("Conversation removed from your list.");
        m.classList.add('hidden');
    };
}

// Iniciar nova conversa (VERSÃO CORRIGIDA)
document.getElementById('btn-start-chat').onclick = async () => {
    const nameInput = document.getElementById('new-chat-name');
    const idInput = document.getElementById('new-chat-id');
    const name = nameInput.value.trim();
    const acId = parseInt(idInput.value);
    
    if(!name || isNaN(acId)) return Toast.show("Display name and ID not found.", "error");
    if(!auth.currentUser) return Toast.show("You need a token.", "error");

    try {
        // A LINHA CORRIGIDA ESTÁ ABAIXO (Apenas um sinal de =)
        const uQ = query(collection(db, "users"), where("accountId", "==", acId));
        const uSnap = await getDocs(uQ);
        
        if(uSnap.empty) return Toast.show("Account ID not found.", "error");
        
        const targetUser = uSnap.docs[0].data();
        
        if(targetUser.uid === auth.currentUser.uid) {
            return Toast.show("You can't start a conversation with yourself", "error");
        }

        if ((targetUser.blockedUsers && targetUser.blockedUsers.includes(auth.currentUser.uid)) ||
            (currentUserData.blockedUsers && currentUserData.blockedUsers.includes(targetUser.uid))) {
            return Toast.show("User not found or blocked.", "error");
        }

        await addDoc(collection(db, "conversations"), {
            participants: [auth.currentUser.uid, targetUser.uid],
            createdAt: serverTimestamp(),
            displayNames: { [auth.currentUser.uid]: name },
            lastMessage: "" 
        });

        nameInput.value = "";
        idInput.value = "";
        document.getElementById('new-chat-modal').classList.add('hidden');
        Toast.show("Conversation started!", "success");

    } catch(e) { 
        console.error("Error:", e);
        Toast.show("The person is not accepting new conversations or you are blocked.", "error"); 
    }
};

// --- DENTRO DA CONVERSA ---
async function enterChat(chatId, otherId, otherUser, dispName) {
    currentChatId = chatId;
    Router.go('conversation-frame');
    
    // Status de Bloqueio (Quem bloqueou quem)
    let iBlockedHim = currentUserData.blockedUsers && currentUserData.blockedUsers.includes(otherId);
    let heBlockedMe = otherUser.blockedUsers && otherUser.blockedUsers.includes(auth.currentUser.uid);

    const hImg = document.getElementById('chat-header-img');
    const hName = document.getElementById('chat-header-name');
    const hStatus = document.getElementById('chat-header-status');
    
    if(heBlockedMe) {
        hImg.src = 'https://www.gstatic.com/images/branding/product/1x/avatar_square_grey_512dp.png';
        hName.innerText = "Account not found";
        hStatus.innerText = "Offline";
    } else {
        hImg.src = otherUser.photoURL;
        hName.innerText = dispName;
        hStatus.innerText = "Offline"; 
    }

    document.getElementById('chat-header-clickable').onclick = () => {
        if(heBlockedMe) return; 
        
        const m = document.getElementById('profile-details-modal');
        m.classList.remove('hidden');
        document.getElementById('profile-modal-img').src = otherUser.photoURL;
        document.getElementById('profile-modal-name').innerText = dispName;
        document.getElementById('profile-modal-id').innerText = `ID: ${otherUser.accountId}`;
        document.getElementById('profile-modal-desc').innerText = otherUser.description || "No description.";
        
        document.getElementById('profile-edit-container').classList.add('hidden');
        document.getElementById('profile-modal-desc').classList.remove('hidden');
        document.getElementById('profile-actions-others').classList.remove('hidden');

                const blockBtn = document.getElementById('btn-block-user');

        // MUDANÇA AQUI: Remove qualquer cor manual e aplica a classe de contorno vermelho
        blockBtn.style.background = ""; 
        blockBtn.className = "btn btn-red-outline"; 

        if (currentUserData.blockedUsers && currentUserData.blockedUsers.includes(otherId)) {
            // DESBLOQUEAR
            blockBtn.innerText = "Unblock this person";
            
            blockBtn.onclick = async () => {
                const newBlocked = currentUserData.blockedUsers.filter(id => id !== otherId);
                await updateDoc(doc(db, "users", auth.currentUser.uid), { blockedUsers: newBlocked });
                currentUserData.blockedUsers = newBlocked;
                
                document.getElementById('profile-details-modal').classList.add('hidden');
                Toast.show("User unblocked");
                loadConversations(); 
            };
        } else {
            // BLOQUEAR
            blockBtn.innerText = "Block user";

            blockBtn.onclick = () => {
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
        }
        

        // --- BOTÃO DENUNCIAR (REPORT) ---
        document.getElementById('btn-report-user').onclick = () => {
            document.getElementById('report-modal').classList.remove('hidden');
        };
    };

    document.getElementById('btn-close-chat').onclick = () => Router.go('main-frame');
    loadMessages(chatId);
                                                                       }
                                         


function loadMessages(chatId) {
    const list = document.getElementById('messages-list');
    list.innerHTML = '';
    
    // Paginação: 15 mensagens
    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("createdAt", "desc"), limit(75));
    
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
    
    const body = document.createElement('div');
    body.className = 'msg-body';
    




function renderMessage(msg, isMe, container) {
    const div = document.createElement('div');
    div.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
    
    const body = document.createElement('div');
    body.className = 'msg-body';

            
        
                
            
                if (msg.type === 'text') {
        if (msg.text.includes("tenor.com/")) {
            const match = msg.text.match(/(\d+)$/);
            const postId = match ? match[1] : "";

            if (postId) {
                body.style.display = "block";
                body.style.width = "100%";
                body.style.minWidth = "200px"; 
                body.style.maxWidth = "100%";
                body.style.position = "relative";
                body.style.minHeight = "200px";

                body.innerHTML = `
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" class="loading-icon">
                        <div class="spinner"></div> 
                    </div>
                    <div class="tenor-gif-embed" 
                         data-postid="${postId}" 
                         data-share-method="host" 
                         data-aspect-ratio="1" 
                         data-width="100%">
                    </div>
                `;

                if (!document.getElementById('tenor-style')) {
                    const style = document.createElement('style');
                    style.id = 'tenor-style';
                    style.innerHTML = `
                        .spinner { width: 30px; height: 30px; border: 4px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: spin 1s ease-in-out infinite; }
                        @keyframes spin { to { transform: rotate(360deg); } }
                        .tenor-gif-embed { overflow: hidden; border-radius: 8px; }
                    `;
                    document.head.appendChild(style);
                }

                // FUNÇÃO PARA ATIVAR O GIF
                const triggerTenor = () => {
                    if (window.Tenor) {
                        window.Tenor.CheckPostElements();
                        let i = 0;
                        const itv = setInterval(() => {
                            if (body.querySelector('iframe')) {
                                body.style.minHeight = "auto";
                                const loader = body.querySelector('.loading-icon');
                                if(loader) loader.remove(); 
                                clearInterval(itv);
                            }
                            if (i++ > 20) clearInterval(itv);
                        }, 200);
                    }
                };

                // Se o script não existe, cria e ativa ao carregar
                if (!document.querySelector('script[src*="tenor.com/embed.js"]')) {
                    const script = document.createElement('script');
                    script.src = "https://tenor.com/embed.js";
                    script.async = true;
                    script.onload = triggerTenor; // Ativa assim que o script baixar
                    document.body.appendChild(script);
                } else {
                    // Se o script já existe, ativa imediatamente
                    triggerTenor();
                }
            } else {
                body.textContent = msg.text;
            }
        } else {
            body.textContent = msg.text;
        }
                }
    
    
    
    
    
    

    // 1. Primeiro você coloca o corpo na bolha
    div.appendChild(body);

    // 2. Agora vem a lógica da data (SEM AQUELA LINHA REPETIDA)
    let timeDisplay = '...';
    if (msg.createdAt) {
        const d = msg.createdAt.toDate();
        const n = new Date();
        const isToday = d.toDateString() === n.toDateString();
        const isThisYear = d.getFullYear() === n.getFullYear();

        if (isToday) {
            timeDisplay = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (isThisYear) {
            timeDisplay = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        } else {
            timeDisplay = d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
        }
    }

    const timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.innerText = timeDisplay; 
    div.appendChild(timeDiv);

    container.appendChild(div);
}
    

// --- ENVIO DE MENSAGENS E MÍDIA ---
const msgInput = document.getElementById('msg-input');

// 1. Envio de Texto
document.getElementById('btn-send-msg').onclick = () => sendWrapper('text', msgInput.value);

async function sendWrapper(type, content) {
    if(!currentChatId || type !== 'text' || !content.trim()) return;

    // Antispam
    const now = Date.now();
    if(now < msgRateLimit.blockedUntil) return Toast.show(`Slow down, buddy!`, "error");
    if(now - msgRateLimit.start > 10000) msgRateLimit = { count: 0, start: now, blockedUntil: 0 };
    if(msgRateLimit.count >= 5) {
        msgRateLimit.blockedUntil = now + 10000;
        return Toast.show("Slow down! Wait 10s.", "error");
    }

    try {
        await addDoc(collection(db, "conversations", currentChatId, "messages"), {
            text: content,
            type: 'text',
            senderId: auth.currentUser.uid,
            createdAt: serverTimestamp()
        });
        msgInput.value = '';
        msgRateLimit.count++;
    } catch(e) {
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

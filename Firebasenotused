// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, doc, getDoc, setDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDy6Ewsq2egkBrELp6i9rGLRnvdIYqOxeg",
  authDomain: "catsblock-94c61.firebaseapp.com",
  projectId: "catsblock-94c61",
  storageBucket: "catsblock-94c61.firebasestorage.app",
  messagingSenderId: "462618239829",
  appId: "1:462618239829:web:8c1445e69db9fc988585dc",
  measurementId: "G-0S10J45W82"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Exportação para o seu script principal
export { 
    auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, 
    collection, addDoc, query, where, onSnapshot, orderBy, limit, 
    doc, getDoc, setDoc, updateDoc, arrayUnion 
};

import React, { useState, useEffect, useRef, Component } from 'react';
import { Mic, Activity, Settings, XCircle, Heart, Home, Upload, Key, Unlock, HelpCircle } from 'lucide-react';

// --- Firebase Setup ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

let app, auth, db, appId;
try {
  if (typeof __firebase_config !== 'undefined') {
    const firebaseConfig = JSON.parse(__firebase_config);
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  }
} catch (e) {
  console.warn("Firebase init error:", e);
}
// ----------------------

// --- APIキー安全保存用ユーティリティ ---
let globalApiKey = '';

function getSafeApiKey() {
  try {
    return localStorage.getItem('gemini_api_key') || globalApiKey;
  } catch(e) {
    return globalApiKey;
  }
}

function setSafeApiKey(key) {
  globalApiKey = key;
  try {
    localStorage.setItem('gemini_api_key', key);
  } catch(e) {
    console.warn("localStorage is not available in this environment.");
  }
}

function clearSafeApiKey() {
  globalApiKey = '';
  try {
    localStorage.removeItem('gemini_api_key');
  } catch(e) {}
}
// ------------------------------------

const DEFAULT_START_KANA = "し";
const MAX_AROUSAL = 100;

// Gemini Model Configs
const TEXT_MODEL = "gemini-2.5-flash-preview-09-2025";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

const INITIAL_CHARACTERS = {
  reika: {
    name: "麗華",
    description: "包容力のある成熟したお姉さん",
    images: {
      clothed: "[https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80](https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80)",
      unveiled: "[https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80](https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80)",
    },
    color: "#ec4899",
    voice: "Kore",
    prompt: "あなたは妖艶な成熟したお姉さんです。プレイヤーの卑猥な言葉に、表面上の理性が少しずつ剥がれ落ち、本能が露わになっていく様子を演じてください。返信は非常に短く、1行で完結させてください。"
  },
  shizuka: {
    name: "静香",
    description: "冷徹でドSな氷の令嬢",
    images: {
      clothed: "[https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=800&q=80](https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=800&q=80)",
      unveiled: "[https://images.unsplash.com/photo-1531123897727-8f129e16fd3c?auto=format&fit=crop&w=800&q=80](https://images.unsplash.com/photo-1531123897727-8f129e16fd3c?auto=format&fit=crop&w=800&q=80)",
    },
    color: "#3b82f6",
    voice: "Aoede",
    prompt: "あなたは冷徹な令嬢ですが、プレイヤーの攻めに屈し、プライドという名の服が脱げ去っていく屈辱と快楽を表現してください。返信は非常に短く、1行で完結させてください。"
  },
  marin: {
    name: "真凛",
    description: "からかい上手な小悪魔系",
    images: {
      clothed: "[https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80](https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80)",
      unveiled: "[https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80](https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80)",
    },
    color: "#f97316",
    voice: "Leda",
    prompt: "あなたはからかい上手な小悪魔ですが、攻められた言葉の「エッチさ」に当てられて、次第に我慢できない状態になります。返信は非常に短く、1行で完結させてください。"
  }
};

const getSystemPrompt = (char, arousal, currentKana, history) => {
  return `
${char.prompt}
現在の欲情度: ${arousal}%。
【しりとり厳格ルール】
1. プレイヤーは必ず「${currentKana}」から始まる言葉を言わなければなりません。違反時は valid を false にしてください。
2. 既に出た単語を使用してはいけません。
3. 語尾が「ん」で終了した場合は player_lost を true にしてください。
4. あなたの回答も「既に出た単語」は絶対に使わないでください。
5. プレイヤーの言葉がエッチで興奮するものの場合は「arousal_inc」を10〜30のプラス値に設定してください。逆に、雰囲気を壊すようなつまらない言葉、的外れな言葉の場合は、欲情度が冷めるためマイナス値（-5〜-20）を設定して欲情度を下げてください。

現在の単語履歴: [${history.join(', ')}]

レスポンスは必ず以下のJSON形式で。
{
  "feedback": "セリフ1行",
  "word": "あなたの回答(名詞)",
  "word_reading": "あなたの回答のよみ(ひらがな)",
  "next_kana": "word_readingの最後の文字(ただし「ー」ならその前の文字、小文字なら大文字に変換すること)",
  "arousal_inc": 15,
  "valid": true,
  "player_lost": false,
  "sister_lost": false,
  "tts_instruction": "演技指示"
}
`;
};

function WordGame() {
  // --- API Key 管理 ---
  const [apiKey, setApiKey] = useState(getSafeApiKey);
  const [tempApiKey, setTempApiKey] = useState('');
  const [keyError, setKeyError] = useState('');

  const handleSaveApiKey = () => {
    const key = tempApiKey.trim();
    if (!key) {
      setKeyError("鍵が入力されていません。");
      return;
    }
    if (!key.startsWith("AIza")) {
      setKeyError("無効な鍵です。（'AIza'から始まる文字列です）");
      return;
    }
    setSafeApiKey(key);
    setApiKey(key);
    setKeyError('');
  };

  const handleClearApiKey = () => {
    clearSafeApiKey();
    setApiKey('');
    setTempApiKey('');
  };
  // -------------------

  // --- 認証 & セーブデータ管理 ---
  const [user, setUser] = useState(null);
  const [hasSaveData, setHasSaveData] = useState(false);
  const [savedData, setSavedData] = useState(null);

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'saveData', 'current');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setHasSaveData(true);
        setSavedData(docSnap.data());
      } else {
        setHasSaveData(false);
        setSavedData(null);
      }
    }, (error) => {
      console.warn("Error fetching save data", error);
    });
    return () => unsubscribe();
  }, [user]);

  const saveGameProgress = async (currentArousal, currentKana, currentHistory, charKey) => {
    if (!user || !db) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'saveData', 'current');
      await setDoc(docRef, {
        arousal: currentArousal,
        displayKana: currentKana,
        history: currentHistory,
        selectedCharKey: charKey,
        timestamp: Date.now()
      });
    } catch (e) {
      console.warn("Save failed", e);
    }
  };

  const clearSaveData = async () => {
    if (!user || !db) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'saveData', 'current');
      await deleteDoc(docRef);
    } catch(e) {}
  };
  // ------------------------------

  const [gameState, setGameState] = useState('intro');
  const [selectedCharKey, setSelectedCharKey] = useState('reika');
  const [charConfigs, setCharConfigs] = useState(INITIAL_CHARACTERS);
  const [startKanaSetting, setStartKanaSetting] = useState(DEFAULT_START_KANA);
  const [editingCharKey, setEditingCharKey] = useState('reika');

  const [arousal, setArousal] = useState(0);
  const [displayKana, setDisplayKana] = useState(DEFAULT_START_KANA);
  const [history, setHistory] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playerInputText, setPlayerInputText] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [gameResult, setGameResult] = useState(null);
  const [micError, setMicError] = useState(null);

  const recognitionRef = useRef(null);
  const currentAudioRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTranscriptRef = useRef(""); 
  const [currentEditingImageType, setCurrentEditingImageType] = useState(null);

  const isBusyRef = useRef(false);
  const stateRef = useRef({ arousal, displayKana, history, selectedCharKey, charConfigs, gameState });

  useEffect(() => {
    stateRef.current = { arousal, displayKana, history, selectedCharKey, charConfigs, gameState };
  }, [arousal, displayKana, history, selectedCharKey, charConfigs, gameState]);

  const initRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ja-JP';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      
      recognition.onstart = () => {
        setIsListening(true);
        lastTranscriptRef.current = "";
      };

      recognition.onresult = (e) => {
        let finalTranscript = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
            finalTranscript += e.results[i][0].transcript;
          } else {
            lastTranscriptRef.current = e.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          lastTranscriptRef.current = "";
          setPlayerInputText(finalTranscript);
          handlePlayerInput(finalTranscript);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        if (lastTranscriptRef.current && !isBusyRef.current) {
            const lastText = lastTranscriptRef.current;
            lastTranscriptRef.current = "";
            setPlayerInputText(lastText);
            handlePlayerInput(lastText);
        }
      };

      recognition.onerror = (e) => {
        console.warn("Recognition Error:", e.error);
        setIsListening(false);
      };
      recognitionRef.current = recognition;
      return true;
    }
    return false;
  };

  const requestMicAndInit = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const success = initRecognition();
      if (!success) {
        setMicError("お使いのブラウザは音声認識に対応していません。");
      }
      return success;
    } catch (err) {
      setMicError("マイクの使用が許可されませんでした。");
      console.warn(err);
      return false;
    }
  };

  const handleStartNewGame = async () => {
    const success = await requestMicAndInit();
    if (success) {
      setGameState('character_select');
    }
  };

  const handleResumeGame = async () => {
    const success = await requestMicAndInit();
    if (success && savedData) {
      setSelectedCharKey(savedData.selectedCharKey);
      setArousal(savedData.arousal);
      setDisplayKana(savedData.displayKana);
      setHistory(savedData.history || []);
      setGameResult(null);
      setAiResponseText('');
      setPlayerInputText('');
      setGameState('playing');
      speak(`おかえりなさい。続きは「${savedData.displayKana}」からよ。`, "妖艶に");
    }
  };

  const pcmToWav = (pcmB64) => {
    const binary = atob(pcmB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buffer = new ArrayBuffer(44 + bytes.length);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 32 + bytes.length, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeStr(36, 'data');
    view.setUint32(40, bytes.length, true); new Uint8Array(buffer, 44).set(bytes);
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const speak = async (text, inst, nextKanaUpdate = null, isGameOverCall = false) => {
    setIsSpeaking(true);
    isBusyRef.current = true;
    try {
      const ttsPrompt = `「${inst}」という感情を込めて言ってください。「${text}」`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ttsPrompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: charConfigs[selectedCharKey].voice } } }
          }
        })
      }).catch(err => {
        console.warn("TTS Fetch Error:", err);
        return null;
      });
      
      if (!res || !res.ok) {
        setIsSpeaking(false);
        isBusyRef.current = false;
        setAiResponseText(text + " (※通信エラー: 音声生成に失敗しました)");
        if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
        if (isGameOverCall) setGameState('gameover');
        return;
      }

      const data = await res.json();
      const pcm = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (pcm) {
        if (currentAudioRef.current) currentAudioRef.current.pause();
        const audio = new Audio(URL.createObjectURL(pcmToWav(pcm)));
        currentAudioRef.current = audio;
        audio.onplay = () => {
          setAiResponseText(text);
          if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
        };
        audio.onended = () => {
          setIsSpeaking(false);
          isBusyRef.current = false;
          setPlayerInputText('');
          if (isGameOverCall) setGameState('gameover');
        };
        audio.play();
      } else {
        setIsSpeaking(false);
        isBusyRef.current = false;
        setAiResponseText(text);
        if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
        if (isGameOverCall) setGameState('gameover');
      }
    } catch (e) { 
      console.warn(e);
      setIsSpeaking(false);
      isBusyRef.current = false;
      setAiResponseText(text + " (※音声生成エラー)");
      if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
      if (isGameOverCall) setGameState('gameover');
    }
  };

  const handlePlayerInput = async (input) => {
    if (!input || isBusyRef.current) return;
    
    const { arousal: curArousal, displayKana: curKana, history: curHistory, selectedCharKey: curKey, charConfigs: curConfigs, gameState: curGameState } = stateRef.current;
    
    if (curGameState !== 'playing') return;

    isBusyRef.current = true;
    setIsThinking(true);
    setAiResponseText('');
    
    try {
      const currentChar = curConfigs[curKey];
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: getSystemPrompt(currentChar, curArousal, curKana, curHistory) }] },
          contents: [{ parts: [{ text: input }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }).catch(err => {
        console.warn("Text Fetch Error:", err);
        return null;
      });
      
      if (!res || !res.ok) {
        setIsThinking(false);
        isBusyRef.current = false;
        setAiResponseText("通信エラーが発生しました。（鍵が無効か、利用制限の可能性があります）");
        return;
      }

      const resData = await res.json().catch(err => {
        console.warn("JSON Parse Error:", err);
        return null;
      });
      
      if (!resData || !resData.candidates || !resData.candidates[0]) {
        setIsThinking(false);
        isBusyRef.current = false;
        setAiResponseText("APIレスポンスが無効です。再度お試しください。");
        return;
      }
      
      let rawText = resData.candidates[0].content.parts[0].text;
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(rawText);

      setIsThinking(false);

      if (!result.valid) {
        speak(result.feedback || "それはルール違反よ。", "優しく指摘する");
        return;
      }

      let safeNextKana = result.next_kana || "あ";
      if (result.word_reading && typeof result.word_reading === 'string') {
        let reading = result.word_reading.trim();
        while (reading.endsWith('ー') || reading.endsWith('-')) {
            reading = reading.slice(0, -1);
        }
        let lastChar = reading.slice(-1);
        if (lastChar) {
            const smallToLarge = {
                'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
                'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ',
                'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
                'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ッ': 'ツ', 'ヮ': 'ワ'
            };
            safeNextKana = smallToLarge[lastChar] || lastChar;
            if (safeNextKana.match(/[ァ-ヴ]/)) {
                safeNextKana = String.fromCharCode(safeNextKana.charCodeAt(0) - 0x60);
            }
        }
      }

      const newHistory = [...curHistory, input, result.word];
      setHistory(newHistory);

      const inc = typeof result.arousal_inc === 'number' ? result.arousal_inc : 15;
      const nextArousal = Math.max(0, Math.min(MAX_AROUSAL, curArousal + inc));
      setArousal(nextArousal);
      
      if (result.player_lost) {
        setGameResult('sister_win');
        clearSaveData(); 
        speak(`${result.feedback}。私の勝ちね。`, "勝利の声で", null, true);
        return;
      }
      
      if (result.sister_lost || nextArousal >= MAX_AROUSAL) {
        setGameResult('player_win');
        clearSaveData(); 
        speak(`${result.feedback}……あっ、もう無理っ……イクッ……！！`, "限界を超えて絶頂に達した、激しく乱れ切った声で", null, true);
        return;
      }

      saveGameProgress(nextArousal, safeNextKana, newHistory, curKey);
      speak(`${result.feedback}……「${result.word}」よ。`, result.tts_instruction || "普通に", safeNextKana);
      
    } catch (e) { 
      console.warn(e);
      setIsThinking(false);
      isBusyRef.current = false;
      setAiResponseText("通信エラーが発生しました。（鍵の無効、または利用制限の可能性があります）");
    }
  };

  const returnToMenu = () => {
    if (currentAudioRef.current) currentAudioRef.current.pause();
    if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e){}
    }
    isBusyRef.current = false;
    setIsSpeaking(false);
    setIsListening(false);
    setAiResponseText('');
    setPlayerInputText('');
    setGameState('intro'); 
  };

  const startGame = () => {
    setGameState('playing');
    isBusyRef.current = false;
    setArousal(0);
    setHistory([]);
    setGameResult(null);
    setDisplayKana(startKanaSetting);
    setAiResponseText('');
    setPlayerInputText('');
    saveGameProgress(0, startKanaSetting, [], selectedCharKey); 
    speak(`始めましょう。最初は「${startKanaSetting}」からよ。`, "妖艶に");
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file && currentEditingImageType) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCharConfigs(prev => ({
          ...prev,
          [editingCharKey]: {
            ...prev[editingCharKey],
            images: {
              ...prev[editingCharKey].images,
              [currentEditingImageType]: event.target.result
            }
          }
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerImagePicker = (type) => {
    setCurrentEditingImageType(type);
    fileInputRef.current?.click();
  };

  const handleMicClick = () => {
    if (isListening) {
      try { recognitionRef.current?.stop(); } catch(e){}
    } else {
      setAiResponseText('');
      setPlayerInputText('');
      lastTranscriptRef.current = "";
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.warn("Mic start failed", e);
      }
    }
  };

  if (gameState === 'intro') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-6 z-[100]">
        <div className="absolute top-6 right-6 flex gap-3 z-50">
          <button onClick={() => setGameState('help')} className="p-3 bg-zinc-900 rounded-full text-zinc-400 hover:text-white pointer-events-auto transition-colors hover:bg-zinc-800 shadow-lg" title="遊び方・ヘルプ">
            <HelpCircle size={24} />
          </button>
          {apiKey && (
            <button onClick={() => setGameState('settings')} className="p-3 bg-zinc-900 rounded-full text-zinc-400 hover:text-white pointer-events-auto transition-colors hover:bg-zinc-800 shadow-lg" title="設定">
              <Settings size={24} />
            </button>
          )}
        </div>
        
        <div className="mb-8 text-center">
            <h1 className="text-4xl md:text-5xl font-black text-white mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(236,72,153,0.3)]">淫らな尻とり</h1>
            <p className="text-pink-500 tracking-widest uppercase text-xs font-bold">Sensual Word Game</p>
        </div>
        
        {!apiKey ? (
          <div className="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-pink-900/50 p-6 rounded-3xl shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-500 pointer-events-auto">
            <div className="w-12 h-12 bg-pink-950/50 rounded-full flex items-center justify-center mb-4 border border-pink-500/30 text-pink-400">
              <Key size={24} />
            </div>
            <h2 className="text-lg text-white font-bold mb-2">封印の鍵が必要です</h2>
            <p className="text-xs text-zinc-400 text-center mb-6 leading-relaxed">
              お姉さんたちと秘密の会話をするには<br/>専用の「鍵（API Key）」が必要です。<br/>
              <span className="text-pink-400/80">※鍵はあなたのブラウザ内のみに保存され安全です</span>
            </p>
            
            <input
              type="password"
              placeholder="AIzaSy..."
              value={tempApiKey}
              onChange={(e) => setTempApiKey(e.target.value)}
              autoComplete="new-password"
              data-lpignore="true"
              className="w-full bg-black text-white px-4 py-3 text-center tracking-widest rounded-xl border border-zinc-700 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 mb-2 font-mono text-sm"
            />
            
            {keyError && <p className="text-xs text-red-400 font-bold mb-3">{keyError}</p>}
            
            <button 
              onClick={handleSaveApiKey} 
              className="w-full bg-pink-600 text-white font-bold py-3 rounded-xl hover:bg-pink-500 transition-all shadow-[0_0_20px_rgba(219,39,119,0.4)] mb-5 flex items-center justify-center gap-2"
            >
              <Unlock size={18} />
              鍵を登録して封印を解く
            </button>
            
            <div className="text-center w-full pt-4 border-t border-white/5">
              <a href="[https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)" target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-zinc-400 hover:text-pink-400 transition-colors flex items-center justify-center gap-1.5">
                無料で鍵を取得する（外部サイトへ）
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full max-w-xs pointer-events-auto animate-in fade-in duration-500">
            {hasSaveData && (
              <button 
                onClick={handleResumeGame} 
                className="w-full py-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white font-bold hover:bg-white/20 transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Activity size={20} />
                前回の続きから
              </button>
            )}
            <button 
              onClick={handleStartNewGame} 
              className="w-full py-4 bg-pink-600 rounded-full text-white font-bold hover:bg-pink-500 transition-all shadow-[0_0_20px_rgba(219,39,119,0.4)] flex items-center justify-center gap-2"
            >
              <Mic size={20} />
              {hasSaveData ? "はじめから" : "マイクを許可して開始"}
            </button>

            <button onClick={handleClearApiKey} className="mt-6 text-[11px] font-bold text-zinc-600 hover:text-white transition-colors flex items-center justify-center gap-1">
              <Key size={12} />
              登録済みの鍵を変更・削除する
            </button>
          </div>
        )}

        {micError && (
          <p className="mt-6 text-red-500 text-xs font-bold text-center max-w-xs bg-red-950/50 p-3 rounded-lg border border-red-500/30">{micError}</p>
        )}
      </div>
    );
  }

  if (gameState === 'help') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-white z-[100] flex flex-col h-screen overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-zinc-800 shrink-0 bg-zinc-900">
          <h2 className="text-xl font-bold flex items-center gap-2"><HelpCircle size={20} className="text-pink-500" /> 遊び方・ヘルプ</h2>
          <button onClick={() => setGameState('intro')} className="p-1 text-zinc-400 pointer-events-auto hover:text-white"><XCircle size={28} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
          <div className="w-full max-w-2xl space-y-8 pb-10">
            
            <section>
              <h3 className="text-lg font-bold text-pink-400 mb-3 border-b border-pink-900/50 pb-2">🎯 ゲームの目的</h3>
              <p className="text-sm text-zinc-300 leading-relaxed">
                お姉さんと「しりとり」をして、相手を極限まで興奮させるのが目的です。<br/>
                画面に表示される「NEXT」の文字から始まる言葉をマイクで話してください。<br/>
                欲情度を <span className="text-pink-500 font-bold">100%</span> にすればあなたの勝利（CLIMAX!!）です！
              </p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-pink-400 mb-3 border-b border-pink-900/50 pb-2">⚠️ ルールと欲情度</h3>
              <ul className="text-sm text-zinc-300 leading-relaxed space-y-2 list-disc list-inside">
                <li>通常のしりとりと同じく、<strong className="text-white">「ん」で終わる言葉</strong> や <strong className="text-white">一度使った言葉</strong> はアウト（即ゲームオーバー）です。</li>
                <li>お姉さんをドキドキさせる <strong className="text-pink-300">エッチな言葉や、攻める言葉</strong> を言うと欲情度が大きく上がります。</li>
                <li>逆に、つまらない言葉や的外れな言葉を言うと、<strong className="text-blue-300">雰囲気が冷めて欲情度が下がってしまう</strong> ことがあります。</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-pink-400 mb-3 border-b border-pink-900/50 pb-2">🎤 操作方法</h3>
              <p className="text-sm text-zinc-300 leading-relaxed">
                画面下のマイクボタン <Mic size={16} className="inline text-zinc-400 align-text-bottom" /> を押して話し始めます。<br/>
                話し終わると自動的に言葉が認識されます。<br/>
                ※周囲が騒がしい場合や、うまく認識されない場合は、もう一度マイクボタンを押すと録音を強制終了して言葉を確定できます。
              </p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-pink-400 mb-3 border-b border-pink-900/50 pb-2">🔑 封印の鍵（API Key）の取得手順</h3>
              <div className="text-sm text-zinc-300 leading-relaxed space-y-4">
                <p>
                  AIキャラクターとお話しするためには、Googleが提供する専用の「鍵」が必要です。以下の手順で<strong className="text-pink-300">完全無料</strong>で取得できます。（クレジットカードの登録等は一切不要です）
                </p>
                <ol className="list-decimal list-inside space-y-4 bg-black/50 p-5 rounded-xl border border-zinc-800 text-[13px]">
                  <li className="pl-1">タイトル画面の「無料で鍵を取得する」から <strong>Google AI Studio</strong> にアクセスし、お持ちのGoogleアカウントでログインします。</li>
                  <li className="pl-1">画面左上のメニューにある <strong className="text-white bg-zinc-800 px-2 py-0.5 rounded text-xs border border-zinc-700">Get API key</strong> を押します。</li>
                  <li className="pl-1">画面中央の <strong className="text-blue-300 bg-blue-900/30 px-2 py-0.5 rounded text-xs border border-blue-800">Create API key</strong> という青いボタンをクリックします。</li>
                  <li className="pl-1">ポップアップが出たら <strong className="text-white">Create API key in new project</strong> を選びます。</li>
                  <li className="pl-1">数秒待つと「AIza...」から始まる長い文字列が生成されます。横にある <strong className="text-white bg-zinc-800 px-2 py-0.5 rounded text-xs border border-zinc-700">Copy</strong> ボタンを押してコピーしてください。</li>
                  <li className="pl-1">このゲームのタイトル画面に戻り、貼り付けて「封印を解く」を押せば完了です！</li>
                </ol>
                <p className="text-xs text-zinc-400 mt-2 bg-pink-950/30 p-3 rounded-lg border border-pink-900/30">
                  ※入力した鍵はあなたの端末（ブラウザ）の中にだけ保存されるため、第三者やゲーム開発者に漏れることはありません。安全に遊ぶことができます。
                </p>
              </div>
            </section>

          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'settings') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-white z-[100] flex flex-col h-screen overflow-hidden">
        <div className="flex justify-between items-center p-3 border-b border-zinc-800 shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2"><Settings size={18} /> 設定</h2>
          <button onClick={() => setGameState('intro')} className="p-1 text-zinc-400 pointer-events-auto hover:text-white"><XCircle size={24} /></button>
        </div>
        
        <div className="flex-1 p-3 flex flex-col items-center justify-center min-h-0 w-full">
          <div className="w-full max-w-xl flex flex-col gap-3 h-full">
            <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-pink-400">開始文字</h3>
              <input type="text" value={startKanaSetting} onChange={(e) => setStartKanaSetting(e.target.value.charAt(0) || 'し')} className="bg-zinc-800 text-white p-1 rounded w-12 text-xl text-center font-bold pointer-events-auto" maxLength={1}/>
            </div>

            <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex-1 flex flex-col min-h-0 gap-3">
              <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 scrollbar-hide">
                {Object.keys(charConfigs).map(key => (
                  <button key={key} onClick={() => setEditingCharKey(key)} className={`px-4 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap pointer-events-auto transition-colors ${editingCharKey === key ? 'bg-pink-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                    {charConfigs[key].name}
                  </button>
                ))}
              </div>
              
              <textarea value={charConfigs[editingCharKey].prompt} onChange={(e) => {
                setCharConfigs(prev => ({
                  ...prev,
                  [editingCharKey]: { ...prev[editingCharKey], prompt: e.target.value }
                }));
              }} className="w-full h-16 bg-zinc-800 p-2 rounded-lg text-xs leading-tight text-zinc-300 focus:outline-none focus:ring-1 focus:ring-pink-500 resize-none shrink-0 pointer-events-auto" placeholder="プロンプトを入力..." />
              
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-zinc-400 font-bold">音声モデル:</span>
                <select 
                  value={charConfigs[editingCharKey].voice}
                  onChange={(e) => setCharConfigs(prev => ({
                    ...prev,
                    [editingCharKey]: { ...prev[editingCharKey], voice: e.target.value }
                  }))}
                  className="bg-zinc-800 text-xs text-white px-2 py-1 rounded border border-zinc-700 pointer-events-auto focus:outline-none focus:border-pink-500"
                >
                  <option value="Kore">Kore (標準的)</option>
                  <option value="Aoede">Aoede (クール)</option>
                  <option value="Leda">Leda (明るい)</option>
                  <option value="Callirrhoe">Callirrhoe</option>
                  <option value="Zephyr">Zephyr</option>
                  <option value="Puck">Puck</option>
                  <option value="Charon">Charon</option>
                  <option value="Fenrir">Fenrir</option>
                </select>
              </div>

              <div className="flex flex-row gap-3 flex-1 min-h-0">
                {['clothed', 'unveiled'].map(type => (
                  <div key={type} onClick={() => triggerImagePicker(type)} className="flex-1 h-full bg-zinc-800 rounded-lg overflow-hidden border border-zinc-700 cursor-pointer relative group pointer-events-auto flex flex-col items-center justify-center">
                    <img src={charConfigs[editingCharKey].images[type]} className="max-w-full max-h-full object-contain p-1" alt={type} />
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Upload size={20} className="text-white mb-2" />
                      <span className="text-[11px] text-white font-bold bg-black/50 px-2 py-1 rounded">{type === 'clothed' ? '通常時画像を変更' : '欲情時画像を変更'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
      </div>
    );
  }

  if (gameState === 'character_select') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col items-center p-6 overflow-y-auto z-[100]">
        <button onClick={() => setGameState('intro')} className="absolute top-6 left-6 flex items-center gap-1.5 text-xs text-zinc-400 pointer-events-auto hover:text-white transition-colors">
          <Home size={18} />
          戻る
        </button>
        <h2 className="text-xl font-bold mt-10 mb-8">相手を選ぶ</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
          {Object.entries(charConfigs).map(([key, c]) => (
            <button key={key} onClick={() => { setSelectedCharKey(key); setGameState('ready'); }} className="group rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 pointer-events-auto transition-transform hover:scale-[1.02]">
              <div className="aspect-[3/4]"><img src={c.images.clothed} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" alt={c.name} /></div>
              <div className="p-4 text-left"><h3 className="font-bold">{c.name}</h3><p className="text-[10px] text-zinc-500 line-clamp-1">{c.description}</p></div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const currentChar = charConfigs[selectedCharKey];
  const blurValue = Math.max(0, 10 - (arousal * 0.1));
  const clothesOpacity = Math.max(0, 1 - (arousal / 80));

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col overflow-hidden font-sans">
      <div className="absolute inset-0 z-0 bg-black flex items-center justify-center pointer-events-none">
        <div className="relative w-full h-full max-w-4xl">
            <img src={currentChar.images.unveiled} className="absolute inset-0 w-full h-full object-contain" style={{ filter: `blur(${blurValue}px) brightness(${0.4 + arousal * 0.006})` }} alt="unveiled" />
            <img src={currentChar.images.clothed} className="absolute inset-0 w-full h-full object-contain transition-opacity duration-1000" style={{ opacity: clothesOpacity, filter: 'brightness(0.6)' }} alt="clothed" />
        </div>
      </div>

      <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-start pointer-events-none">
         <button onClick={returnToMenu} className="p-2 bg-black/20 rounded-full pointer-events-auto backdrop-blur-sm border border-white/5 transition-colors hover:bg-black/40"><Home size={18} /></button>
         <div className="flex flex-col items-center pointer-events-auto opacity-80">
            <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/5">
              <Heart size={12} className="text-pink-500" />
              <span className="text-[10px] text-zinc-400 font-bold tracking-wider">欲情度</span>
              <span className="text-sm font-bold ml-1">{arousal}%</span>
            </div>
            <div className="w-32 h-1 bg-zinc-800/50 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-pink-600 transition-all duration-500" style={{ width: `${arousal}%` }} />
            </div>
         </div>
         <div className="w-[34px]"></div>
      </div>

      {gameState === 'ready' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <button onClick={startGame} className="px-8 py-3 bg-pink-600 rounded-full font-bold text-sm hover:bg-pink-500 shadow-xl border border-pink-400/20 pointer-events-auto transition-transform hover:scale-105">対話を開始</button>
        </div>
      )}

      {gameState === 'gameover' && (
        <div className={`absolute inset-0 z-40 flex items-center justify-center transition-colors duration-1000 ${gameResult === 'player_win' ? 'bg-pink-950/80 animate-pulse' : 'bg-black/60 backdrop-blur-md'}`}>
          <div className={`p-8 md:p-12 rounded-3xl flex flex-col items-center shadow-2xl transition-transform ${gameResult === 'player_win' ? 'bg-pink-900/60 border-2 border-pink-400 scale-110' : 'bg-zinc-900/90 border border-white/10'}`}>
            <h2 className={`text-4xl md:text-6xl font-black mb-10 tracking-widest text-center ${gameResult === 'player_win' ? 'text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-white to-pink-300 drop-shadow-[0_0_20px_rgba(236,72,153,1)]' : 'text-zinc-500'}`}>
              {gameResult === 'player_win' ? 'CLIMAX!!' : 'GAME OVER'}
            </h2>
            <div className="flex gap-4">
              <button onClick={startGame} className={`px-8 py-4 text-lg font-bold rounded-full pointer-events-auto transition-transform hover:scale-105 shadow-xl ${gameResult === 'player_win' ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white' : 'bg-white text-black hover:bg-zinc-200'}`}>もう一度</button>
              <button onClick={returnToMenu} className={`px-8 py-4 text-lg font-bold rounded-full pointer-events-auto transition-colors ${gameResult === 'player_win' ? 'bg-pink-950/50 text-pink-200 hover:bg-pink-900 border border-pink-500/30' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>終了</button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-8 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none">
          
          <div className="w-full max-w-2xl px-8 min-h-[40px] flex items-end justify-center mb-6">
            {aiResponseText && !isListening && (
              <p className="text-xl font-medium text-white text-center leading-snug drop-shadow-md animate-in fade-in duration-500">
                {aiResponseText}
              </p>
            )}

            {!isListening && !aiResponseText && playerInputText && (
              <p className="text-2xl text-pink-200 font-bold italic drop-shadow-md animate-pulse">
                {playerInputText}・・・
              </p>
            )}
          </div>

          <div className="flex items-center gap-6 pointer-events-auto">
            <div className="flex flex-col items-center bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 shadow-lg">
              <span className="text-[9px] text-zinc-500 mb-0.5 font-bold tracking-tighter uppercase">NEXT</span>
              <div className="text-3xl font-black text-white leading-none">{displayKana}</div>
            </div>

            <button 
              onClick={handleMicClick}
              disabled={isSpeaking || isThinking}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 pointer-events-auto ${
                isListening 
                  ? 'bg-red-500 animate-pulse scale-110 shadow-[0_0_20px_rgba(239,68,68,0.4)]' 
                  : (isSpeaking || isThinking)
                    ? 'bg-zinc-800 text-zinc-600 opacity-50 cursor-not-allowed'
                    : 'bg-zinc-100 hover:bg-white text-black shadow-xl scale-100 active:scale-95'
              }`}
            >
              {isListening ? <Activity size={24} /> : <Mic size={24} />}
            </button>
          </div>
          
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.warn("App Crash:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-white bg-black min-h-screen flex flex-col items-center justify-center text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">エラーが発生しました</h1>
          <p className="text-sm text-zinc-400 mb-4">ブラウザの制限や通信エラーの可能性があります。</p>
          <pre className="text-xs text-red-300 bg-zinc-900 p-4 rounded-xl max-w-2xl overflow-auto w-full text-left">
            {this.state.error && this.state.error.toString()}
          </pre>
          <button onClick={() => window.location.reload()} className="mt-8 px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-zinc-200">
            アプリを再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <WordGame />
    </ErrorBoundary>
  );
}
import React, { useState, useEffect, useRef, Component } from 'react';
import { Mic, Activity, Settings, XCircle, Heart, Home, Upload, HelpCircle, Lock, Unlock } from 'lucide-react';

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
    // appId内のスラッシュをハイフンに置換して、Firebaseの階層エラーを回避
    appId = typeof __app_id !== 'undefined' ? __app_id.replace(/\//g, '-') : 'default-app-id';
  }
} catch (e) {
  console.warn("Firebase init error:", e);
}
// ----------------------

const DEFAULT_START_KANA = "し";
const MAX_AROUSAL = 100;
const SECRET_PASSCODE = "0721"; // 合言葉

const INITIAL_CHARACTERS = {
  reika: {
    name: "麗華",
    description: "包容力のある成熟したお姉さん",
    images: {
      clothed: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80",
      unveiled: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80",
    },
    color: "#ec4899",
    voice: "ja-JP-Neural2-B", 
    prompt: "あなたは妖艶な成熟したお姉さんです。プレイヤーの卑猥な言葉に、表面上の理性が少しずつ剥がれ落ち、本能が露わになっていく様子を演じてください。返信は非常に短く、1行で完結させてください。"
  },
  shizuka: {
    name: "静香",
    description: "冷徹でドSな氷の令嬢",
    images: {
      clothed: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=800&q=80",
      unveiled: "https://images.unsplash.com/photo-1531123897727-8f129e16fd3c?auto=format&fit=crop&w=800&q=80",
    },
    color: "#3b82f6",
    voice: "ja-JP-Neural2-C", 
    prompt: "あなたは冷徹な令嬢ですが、プレイヤーの攻めに屈し、プライドという名の服が脱げ去っていく屈辱と快楽を表現してください。返信は非常に短く、1行で完結させてください。"
  },
  marin: {
    name: "真凛",
    description: "からかい上手な小悪魔系",
    images: {
      clothed: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80",
      unveiled: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80",
    },
    color: "#f97316",
    voice: "ja-JP-Wavenet-A", 
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
  const [user, setUser] = useState(null);
  const [hasSaveData, setHasSaveData] = useState(false);
  const [savedData, setSavedData] = useState(null);

  const [gameState, setGameState] = useState('locked');
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState('');

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

  // 検索エンジン避け
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = "robots";
      document.getElementsByTagName('head')[0].appendChild(meta);
    }
    meta.content = "noindex, nofollow";
  }, []);

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

  const initRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ja-JP';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      
      recognition.onstart = () => { setIsListening(true); lastTranscriptRef.current = ""; };
      recognition.onresult = (e) => {
        let finalTranscript = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
          else lastTranscriptRef.current = e.results[i][0].transcript;
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
      recognition.onerror = () => setIsListening(false);
      recognitionRef.current = recognition;
      return true;
    }
    return false;
  };

  const requestMicAndInit = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      return initRecognition();
    } catch (err) {
      setMicError("マイクの使用が許可されませんでした。");
      return false;
    }
  };

  const handleUnlock = () => {
    if (passcode === SECRET_PASSCODE) {
      setGameState('intro');
      setPasscodeError('');
    } else {
      setPasscodeError('合言葉が違います');
      setPasscode('');
    }
  };

  const handleStartNewGame = async () => {
    if (await requestMicAndInit()) setGameState('character_select');
  };

  const handleResumeGame = async () => {
    if (await requestMicAndInit()) {
      if (savedData) {
        setSelectedCharKey(savedData.selectedCharKey);
        setArousal(savedData.arousal);
        setDisplayKana(savedData.displayKana);
        setHistory(savedData.history || []);
        setGameState('playing');
        speak(`おかえりなさい。続きは「${savedData.displayKana}」からよ。`, "妖艶に");
      }
    }
  };

  const speak = async (text, inst, nextKanaUpdate = null, isGameOverCall = false) => {
    setIsSpeaking(true);
    isBusyRef.current = true;
    const finish = (t) => {
      setIsSpeaking(false); isBusyRef.current = false;
      setPlayerInputText(''); setAiResponseText(t);
      if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
      if (isGameOverCall) setGameState('gameover');
    };
    try {
      const res = await fetch(`/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ja-JP', name: charConfigs[selectedCharKey].voice },
          audioConfig: { audioEncoding: 'MP3' }
        })
      });
      const data = await res.json();
      if (data.audioContent) {
        if (currentAudioRef.current) currentAudioRef.current.pause();
        const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
        currentAudioRef.current = audio;
        audio.onplay = () => setAiResponseText(text);
        audio.onended = () => finish(text);
        audio.play();
      } else finish(text);
    } catch (e) { finish(text); }
  };

  const handlePlayerInput = async (input) => {
    if (!input || isBusyRef.current) return;
    const { arousal: curArousal, displayKana: curKana, history: curHistory, selectedCharKey: curKey, charConfigs: curConfigs } = stateRef.current;
    isBusyRef.current = true; setIsThinking(true); setAiResponseText('');
    try {
      const res = await fetch(`/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: getSystemPrompt(curConfigs[curKey], curArousal, curKana, curHistory) }] },
          contents: [{ parts: [{ text: input }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const resData = await res.json();
      const result = JSON.parse(resData.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim());
      setIsThinking(false);
      if (!result.valid) { speak(result.feedback || "ルール違反よ。", "優しく"); return; }

      let reading = (result.word_reading || "あ").trim();
      while (reading.endsWith('ー')) reading = reading.slice(0, -1);
      const last = reading.slice(-1);
      const smallToLarge = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ' };
      const nextK = smallToLarge[last] || last;

      const nextA = Math.max(0, Math.min(MAX_AROUSAL, curArousal + (result.arousal_inc || 15)));
      setArousal(nextA); setHistory([...curHistory, input, result.word]);

      if (result.player_lost) { clearSaveData(); speak(result.feedback, "勝利", null, true); return; }
      if (result.sister_lost || nextA >= MAX_AROUSAL) { clearSaveData(); speak(result.feedback, "絶頂", null, true); return; }

      saveGameProgress(nextA, nextK, [...curHistory, input, result.word], curKey);
      speak(`${result.feedback}……「${result.word}」よ。`, result.tts_instruction, nextK);
    } catch (e) { setIsThinking(false); isBusyRef.current = false; }
  };

  const returnToMenu = () => {
    if (currentAudioRef.current) currentAudioRef.current.pause();
    setGameState('intro'); 
  };

  const startGame = () => {
    setGameState('playing'); setArousal(0); setHistory([]); setDisplayKana(startKanaSetting);
    saveGameProgress(0, startKanaSetting, [], selectedCharKey);
    speak(`始めましょう。最初は「${startKanaSetting}」からよ。`, "妖艶に");
  };

  const handleMicClick = () => {
    if (isListening) recognitionRef.current?.stop();
    else { setAiResponseText(''); setPlayerInputText(''); recognitionRef.current?.start(); }
  };

  if (gameState === 'locked') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-6 z-[100]">
        <div className="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-8 rounded-3xl shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-500">
          <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mb-6 text-zinc-400"><Lock size={24} /></div>
          <h2 className="text-xl text-white font-bold mb-2 tracking-widest">SECRET ROOM</h2>
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUnlock()} className="w-full bg-black text-white px-4 py-3 text-center tracking-widest rounded-xl border border-zinc-700 mb-2" placeholder="Passcode"/>
          {passcodeError && <p className="text-xs text-red-400 font-bold mb-4">{passcodeError}</p>}
          <button onClick={handleUnlock} className="w-full bg-zinc-100 text-black font-bold py-3 rounded-xl flex items-center justify-center gap-2"><Unlock size={18} /> 入室</button>
        </div>
      </div>
    );
  }

  if (gameState === 'intro') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-6 z-[100]">
        <h1 className="text-4xl font-black text-white mb-8 tracking-widest">淫らな尻とり</h1>
        <div className="flex flex-col gap-4 w-full max-w-xs">
          {hasSaveData && <button onClick={handleResumeGame} className="py-4 bg-white/10 border border-white/20 rounded-full text-white font-bold">続きから</button>}
          <button onClick={handleStartNewGame} className="py-4 bg-pink-600 rounded-full text-white font-bold shadow-xl">開始する</button>
        </div>
      </div>
    );
  }

  const currentChar = charConfigs[selectedCharKey];
  const blurValue = Math.max(0, 10 - (arousal * 0.1));
  const clothesOpacity = Math.max(0, 1 - (arousal / 80));

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col overflow-hidden font-sans">
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
        <img src={currentChar.images.unveiled} className="absolute inset-0 w-full h-full object-contain" style={{ filter: `blur(${blurValue}px) brightness(${0.4 + arousal * 0.006})` }} alt="unveiled" />
        <img src={currentChar.images.clothed} className="absolute inset-0 w-full h-full object-contain transition-opacity duration-1000" style={{ opacity: clothesOpacity, filter: 'brightness(0.6)' }} alt="clothed" />
      </div>
      <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-start">
         <button onClick={returnToMenu} className="p-2 bg-black/20 rounded-full backdrop-blur-sm"><Home size={18} /></button>
         <div className="flex flex-col items-center">
            <div className="flex items-center gap-1.5 bg-black/40 px-4 py-1.5 rounded-full border border-white/5">
              <Heart size={12} className="text-pink-500" />
              <span className="text-sm font-bold">{arousal}%</span>
            </div>
         </div>
         <div className="w-8"></div>
      </div>
      {(gameState === 'ready' || gameState === 'gameover') && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
          <button onClick={startGame} className="px-12 py-4 bg-pink-600 rounded-full font-bold text-lg">{gameState === 'gameover' ? 'もう一度' : '対話を開始'}</button>
        </div>
      )}
      {gameState === 'playing' && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-8">
          <div className="w-full px-8 min-h-[40px] flex items-end justify-center mb-6">
            {aiResponseText && !isListening && <p className="text-xl font-medium text-center">{aiResponseText}</p>}
            {!isListening && !aiResponseText && playerInputText && <p className="text-2xl text-pink-200 font-bold animate-pulse">{playerInputText}・・・</p>}
          </div>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center bg-black/40 px-4 py-2 rounded-xl border border-white/10">
              <span className="text-[9px] text-zinc-500 font-bold">NEXT</span>
              <div className="text-3xl font-black">{displayKana}</div>
            </div>
            <button onClick={handleMicClick} disabled={isSpeaking || isThinking} className={`w-14 h-14 rounded-full flex items-center justify-center ${isListening ? 'bg-red-500 animate-pulse' : 'bg-zinc-100 text-black'}`}>
              {isListening ? <Activity size={24} /> : <Mic size={24} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() { return <WordGame />; }
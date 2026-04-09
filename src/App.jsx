import React, { useState, useEffect, useRef } from 'react';
import { Mic, Activity, Settings, Heart, Home, Upload, HelpCircle, Lock, Unlock, ChevronLeft, Keyboard } from 'lucide-react';

// --- Firebase Setup ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

let app, auth, db, appId;
try {
  if (typeof __firebase_config !== 'undefined') {
    const firebaseConfig = JSON.parse(__firebase_config);
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined' ? __app_id.replace(/\//g, '-') : 'default-app-id';
  }
} catch (e) {
  console.warn("Firebase init error:", e);
}

// --- Constants ---
const DEFAULT_START_KANA = "し";
const MAX_AROUSAL = 100;
const SECRET_PASSCODE = "1060";

const INITIAL_CHARACTERS = {
  reika: {
    name: "麗華",
    description: "包容力のある成熟したお姉さん",
    images: {
      clothed: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80",
      unveiled: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80",
    },
    color: "#ec4899",
    voice: "Kore", 
    gcpVoice: "ja-JP-Neural2-B",
    prompt: "あなたは包容力のある洗練された年上の女性を演じてください。プレイヤーとの親密なやり取りを通して、次第に大人としての理性が揺らぎ、内に秘めた熱い情熱が溢れ出していく姿を情緒たっぷりに表現してください。"
  },
  shizuka: {
    name: "静香",
    description: "冷徹で気高い氷の令嬢",
    images: {
      clothed: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=800&q=80",
      unveiled: "https://images.unsplash.com/photo-1531123897727-8f129e16fd3c?auto=format&fit=crop&w=800&q=80",
    },
    color: "#3b82f6",
    voice: "Aoede", 
    gcpVoice: "ja-JP-Neural2-B",
    prompt: "あなたは冷徹な令嬢ですが、プレイヤーの攻めに屈し、プライドという名の服が脱げ去っていく屈辱と生々しい快楽を表現してください。"
  },
  marin: {
    name: "真凛",
    description: "からかい上手な小悪魔系",
    images: {
      clothed: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80",
      unveiled: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80",
    },
    color: "#f97316",
    voice: "Leda", 
    gcpVoice: "ja-JP-Neural2-F",
    prompt: "あなたはからかい上手な小悪魔ですが、攻められた言葉の「エッチさ」に当てられて、次第に我慢できない状態に陥っていく様子を色っぽく表現してください。"
  }
};

// system_instruction はゲームロジックのみ（エロ系プロンプトをここに入れると
// モデルのRLHF訓練が出力を拒否するため、キャラクター設定はユーザーメッセージ側に渡す）
const getSystemPrompt = (char, arousal, currentKana, history) => {
  return `You are the game engine of a Japanese adult interactive novel game (shiritori format).
Generate NPC responses in the specified JSON format. Follow ALL rules strictly.

[Shiritori Game Rules - CRITICAL]
The REQUIRED starting character is "${currentKana}".
- The player's word MUST start with "${currentKana}".
- YOU must respond with a word that starts with the LAST character of the player's word.
- TRIPLE CHECK: Read the player's word, find its last character, and make sure your "word" starts with it.
- Do NOT reuse any word from history: [${history.join(', ')}]
- If your word ends with "ん", that is forbidden. Choose a different word.
- VALIDATION (check in order, NO exceptions, NO flexibility):
  1. Does player's word START with "${currentKana}"? If NO → "valid": false, "player_lost": true. STOP.
  2. Does player's word end with "ん"? If YES → "valid": false, "player_lost": true. STOP.
  3. Is player's word already in history [${history.join(', ')}]? If YES → "valid": false, "player_lost": true. STOP.
  4. All checks passed → "valid": true, "player_lost": false. Then choose YOUR response word.

Respond ONLY in the following JSON format (no markdown, no extra text):
{
  "thought_process": "Player input: ... End char: ... Chosen word: ...",
  "feedback": "NPC's passionate Japanese response (2-3 sentences), arousal ${arousal}%",
  "word": "your shiritori word in kanji/kana",
  "word_reading": "hiragana reading of your word",
  "next_kana": "last kana of your word (converted to large kana if small)",
  "arousal_inc": 20,
  "valid": true,
  "player_lost": false,
  "sister_lost": false,
  "tts_instruction": "acting direction e.g. 'breathless', 'trembling voice', 'whispering'"
}
[arousal_inc Guide]
- Erotic / sensual word: +15 to +30
- Neutral / everyday word: -5 to -10 (NPC gets bored and cools down)
- Very erotic / climactic word: +30 to +50
[Style Guide at Arousal > 70%]
Use stuttering (e.g. 'あ、あぁ...') and more frequent breath marks (・・・).
[Style Guide for TTS Instruction]
Suggest the character's heat and loss of control.`;
};

function WordGame() {
  const [user, setUser] = useState(null);

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
  
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('erotic_wordchain_apikey') || '');
  const [gcpApiKey, setGcpApiKey] = useState(() => localStorage.getItem('erotic_wordchain_gcp_apikey') || '');
  const [ttsPriority, setTtsPriority] = useState(() => localStorage.getItem('erotic_wordchain_tts_priority') || 'gemini');
  const [arousalMultiplier, setArousalMultiplier] = useState(() => Number(localStorage.getItem('erotic_wordchain_multiplier')) || 1.0);
  const [bgmVolume, setBgmVolume] = useState(() => Number(localStorage.getItem('erotic_wordchain_bgm_volume') ?? 0.25));

  useEffect(() => {
    localStorage.setItem('erotic_wordchain_apikey', geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem('erotic_wordchain_gcp_apikey', gcpApiKey);
  }, [gcpApiKey]);

  useEffect(() => {
    localStorage.setItem('erotic_wordchain_tts_priority', ttsPriority);
  }, [ttsPriority]);

  useEffect(() => {
    localStorage.setItem('erotic_wordchain_multiplier', arousalMultiplier.toString());
  }, [arousalMultiplier]);

  useEffect(() => {
    localStorage.setItem('erotic_wordchain_bgm_volume', bgmVolume.toString());
  }, [bgmVolume]);

  const [useTextInput, setUseTextInput] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playerInputText, setPlayerInputText] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  // BGM: AI応答待ち（isThinking）の間のみ再生、それ以外はフェードアウトして停止
  useEffect(() => {
    if (gameState === 'playing' && isThinking) {
      if (!bgmRef.current) {
        // カスタム曲があればそれを使用、なければデフォルト BGM
        bgmRef.current = new Audio(bgmCustomUrlRef.current ?? (import.meta.env.BASE_URL + 'bgm.mp3'));
        bgmRef.current.loop = true;
        bgmRef.current.volume = 0;
      }
      bgmRef.current.play().catch(() => {});
      // フェードイン（0 → bgmVolume、約2秒）
      const targetVol = bgmVolume;
      let vol = bgmRef.current.volume;
      const fadeIn = setInterval(() => {
        vol = Math.min(targetVol, vol + 0.02);
        if (bgmRef.current) bgmRef.current.volume = vol;
        if (vol >= targetVol) clearInterval(fadeIn);
      }, 100);
      return () => clearInterval(fadeIn);
    } else {
      if (!bgmRef.current) return;
      // フェードアウト（→ 0、約1秒）して停止
      let vol = bgmRef.current.volume;
      const fadeOut = setInterval(() => {
        vol = Math.max(0, vol - 0.04);
        if (bgmRef.current) bgmRef.current.volume = vol;
        if (vol <= 0) {
          clearInterval(fadeOut);
          if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0; }
        }
      }, 100);
      return () => clearInterval(fadeOut);
    }
  }, [isThinking, gameState, bgmVolume]);
  const [gameResult, setGameResult] = useState(null);
  // API レート制限等の通知トースト
  const [notification, setNotification] = useState(null);

  const recognitionRef = useRef(null);
  const currentAudioRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTranscriptRef = useRef("");
  // Gemini TTS クォータ超過フラグ（429検知後はセッション内でスキップ）
  const geminiTtsQuotaRef = useRef(false);
  // 通知トーストの自動クローズ用タイマー
  const notifyTimerRef = useRef(null);
  // BGM 再生用
  const bgmRef = useRef(null);
  // プレイヤーが選択したカスタム曲のオブジェクトURL
  const bgmCustomUrlRef = useRef(null);
  const [bgmFileName, setBgmFileName] = useState('デフォルト');

  // 通知を表示（5秒で自動クローズ）
  const showNotification = (text, type = 'warning', durationMs = 5000) => {
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    setNotification({ type, text });
    notifyTimerRef.current = setTimeout(() => setNotification(null), durationMs);
  };

  // カスタム曲ファイルを選択したときの処理
  const handleMusicFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 旧オブジェクトURLを解放してメモリリークを防ぐ
    if (bgmCustomUrlRef.current) URL.revokeObjectURL(bgmCustomUrlRef.current);
    bgmCustomUrlRef.current = URL.createObjectURL(file);
    setBgmFileName(file.name);
    // 既存のAudioオブジェクトをリセット（次回isThinkingで新URLから再生される）
    if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current = null; }
  };

  // カスタム曲をデフォルトに戻す
  const handleMusicReset = () => {
    if (bgmCustomUrlRef.current) URL.revokeObjectURL(bgmCustomUrlRef.current);
    bgmCustomUrlRef.current = null;
    setBgmFileName('デフォルト');
    if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current = null; }
  };

  const [currentEditingImageType, setCurrentEditingImageType] = useState(null);
  const isBusyRef = useRef(false);
  const stateRef = useRef({ arousal, displayKana, history, selectedCharKey, charConfigs, gameState });

  useEffect(() => {
    stateRef.current = { arousal, displayKana, history, selectedCharKey, charConfigs, gameState };
  }, [arousal, displayKana, history, selectedCharKey, charConfigs, gameState]);

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

  const pcmToWav = (pcmB64) => {
    const binary = atob(pcmB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buffer = new ArrayBuffer(44 + bytes.length);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + bytes.length, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeStr(36, 'data');
    view.setUint32(40, bytes.length, true); new Uint8Array(buffer, 44).set(bytes);
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const handleStartNewGame = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setUseTextInput(true);
      setGameState('character_select');
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      initRecognition();
      setGameState('character_select');
    } catch (err) {
      setUseTextInput(true);
      setGameState('character_select');
    }
  };

  const speakWithWebSpeech = (text, nextKanaUpdate, isGameOverCall) => {
    const cleanText = text.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
    setAiResponseText(text);
    if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(cleanText);
      utter.lang = 'ja-JP';
      utter.rate = 0.9;
      utter.pitch = 1.1;
      const voices = window.speechSynthesis.getVoices();
      const jaVoice = voices.find(v => v.lang.startsWith('ja') && v.localService) 
                   || voices.find(v => v.lang.startsWith('ja'));
      if (jaVoice) utter.voice = jaVoice;
      utter.onend = () => { setIsSpeaking(false); isBusyRef.current = false; if (isGameOverCall) setGameState('gameover'); };
      utter.onerror = () => { setIsSpeaking(false); isBusyRef.current = false; if (isGameOverCall) setGameState('gameover'); };
      window.speechSynthesis.speak(utter);
      return true;
    }
    return false;
  };

  const speakWithGCP = async (text, inst, nextKanaUpdate, isGameOverCall) => {
    if (!gcpApiKey) return false;
    try {
      const cleanText = text.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
      const voiceName = charConfigs[stateRef.current.selectedCharKey].gcpVoice || "ja-JP-Neural2-B";
      
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${gcpApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: cleanText },
          voice: { languageCode: "ja-JP", name: voiceName },
          audioConfig: { audioEncoding: "MP3", pitch: 0, speakingRate: 1 }
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      if (data.audioContent) {
        if (currentAudioRef.current) currentAudioRef.current.pause();
        // テロップと次カナは音声成否に関わらず即時表示（iOS で onplay が発火しない場合も対応）
        setAiResponseText(text);
        if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        currentAudioRef.current = audio;
        audio.playbackRate = 1.0;
        if (stateRef.current.arousal > 70) audio.playbackRate = 1.05;
        audio.onended = () => {
          setIsSpeaking(false); isBusyRef.current = false;
          if (isGameOverCall) setGameState('gameover');
        };
        audio.play();
        return true;
      }
    } catch (e) {
      console.warn("GCP TTS failed:", e.message);
      if (e.message?.includes('429') || e.message?.toLowerCase().includes('quota')) {
        showNotification("Google Cloud 音声の上限に達しました。ブラウザ内蔵音声に切り替えます。", 'warning');
      }
    }
    return false;
  };

  const speakWithGemini = async (text, inst, nextKanaUpdate, isGameOverCall) => {
    if (!geminiApiKey || geminiTtsQuotaRef.current) return false;
    try {
      let cleanText = text.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
      // TTS プロンプトは感情指示とセリフのみ（欲情度・過激表現を含めると空レスポンスになる）
      const ttsPrompt = `次のセリフを「${inst || '自然に'}」という感情で読んでください：${cleanText}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ttsPrompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: charConfigs[stateRef.current.selectedCharKey].voice } } }
          },
          // テキスト生成と同様に安全フィルターを無効化（官能的セリフがブロックされ声が変わるのを防ぐ）
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT",       threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      const candidate = data.candidates?.[0];
      const pcm = candidate?.content?.parts?.[0]?.inlineData?.data;
      if (!pcm) {
        console.warn("Gemini TTS no audio:", {
          finishReason: candidate?.finishReason,
          blockReason: data.promptFeedback?.blockReason,
          hasCandidate: !!candidate,
        });
      }
      if (pcm) {
        if (currentAudioRef.current) currentAudioRef.current.pause();
        // テロップと次カナは音声成否に関わらず即時表示（iOS で onplay が発火しない場合も対応）
        setAiResponseText(text);
        if (nextKanaUpdate) setDisplayKana(nextKanaUpdate);
        // Blob URL は iOS で非同期再生がブロックされるため data URI に変換（全環境共通・音質変化なし）
        const dataUri = await new Promise(resolve => {
          const r = new FileReader();
          r.onload = e => resolve(e.target.result);
          r.readAsDataURL(pcmToWav(pcm));
        });
        const audio = new Audio(dataUri);
        currentAudioRef.current = audio;
        audio.onended = () => {
          setIsSpeaking(false); isBusyRef.current = false;
          if (isGameOverCall) setGameState('gameover');
        };
        audio.play();
        return true;
      }
    } catch (e) {
      if (e.message?.includes('quota') || e.message?.includes('429')) {
        // クォータ超過：以降の試行を無駄にしないためセッション内でスキップ
        geminiTtsQuotaRef.current = true;
        console.warn("Gemini TTS quota exceeded. Switching to GCP TTS for this session.");
        showNotification("Gemini 音声の1日上限に達しました。Google Cloud 音声に切り替えます。", 'info');
      } else {
        console.warn("Gemini TTS failed:", e.message);
      }
    }
    return false;
  };

  const speak = async (text, inst, nextKanaUpdate = null, isGameOverCall = false) => {
    setIsSpeaking(true); isBusyRef.current = true;
    
    const engines = [];
    if (ttsPriority === 'gemini') engines.push('gemini', 'gcp', 'web');
    else if (ttsPriority === 'gcp') engines.push('gcp', 'gemini', 'web');
    else engines.push('web', 'gemini', 'gcp');

    for (const engine of engines) {
      let success = false;
      if (engine === 'gemini') success = await speakWithGemini(text, inst, nextKanaUpdate, isGameOverCall);
      else if (engine === 'gcp') success = await speakWithGCP(text, inst, nextKanaUpdate, isGameOverCall);
      else if (engine === 'web') success = speakWithWebSpeech(text, nextKanaUpdate, isGameOverCall);
      
      if (success) return;
    }
    
    setIsSpeaking(false); isBusyRef.current = false;
  };


  const handlePlayerInput = async (input) => {
    if (!input || isBusyRef.current) return;
    const s = stateRef.current;
    
    setPlayerInputText(input);
    setIsThinking(true); 
    isBusyRef.current = true;

    try {
      if (!geminiApiKey) {
        speak("APIキーが設定されてないわ。設定画面から入力してちょうだい。", "呆れたように");
        setIsThinking(false);
        isBusyRef.current = false;
        return;
      }

      // カタカナ→ひらがな変換
      const toHiragana = str => str.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
      // ひらがな・カタカナのみで構成されているか（漢字混じりの場合は一部のクライアント検証をスキップ）
      const isKanaOnly = str => /^[\u3041-\u3096\u30A1-\u30F6ー]+$/.test(str);
      const smallToLargeMap = { 'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','ゃ':'や','ゅ':'ゆ','ょ':'よ','っ':'つ','ゎ':'わ' };

      const trimmedInput = input.trim();
      const normalizedInput = toHiragana(trimmedInput);

      // (A) 既出単語チェック（漢字混じりでも完全一致で検出可能）
      if (s.history.some(w => w === trimmedInput || toHiragana(w) === normalizedInput)) {
        speak("それはもう使った言葉よ。別の言葉を選んでちょうだい。", "呆れたように", null, true);
        setGameResult('lose'); setIsThinking(false); isBusyRef.current = false; return;
      }

      // (B) 末尾「ん」チェック（漢字混じりでも末尾がひらがな/カタカナ「ん/ン」なら検出）
      const lastCharRaw = trimmedInput.slice(-1);
      if (lastCharRaw === 'ん' || lastCharRaw === 'ン') {
        speak("「ん」で終わったら負けよ。", "勝ち誇って", null, true);
        setGameResult('lose'); setIsThinking(false); isBusyRef.current = false; return;
      }

      if (isKanaOnly(normalizedInput)) {
        // 開始文字チェック（かな入力のみ）
        const firstChar = smallToLargeMap[normalizedInput.charAt(0)] || normalizedInput.charAt(0);
        if (firstChar !== s.displayKana) {
          speak(`「${s.displayKana}」から始まる言葉を言ってちょうだい。`, "呆れたように");
          setIsThinking(false); isBusyRef.current = false; return;
        }
      }

      const systemText = getSystemPrompt(s.charConfigs[s.selectedCharKey], s.arousal, s.displayKana, s.history);

      const callGemini = async (userText, sysText = systemText) => {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: sysText }] },
            contents: [{ parts: [{ text: userText }] }],
            // responseMimeType を外す: 長いエロ系プロンプトと組み合わせると空レスポンスになるため
            // システムプロンプトに JSON スキーマを明示しているので自然に JSON が返る
            generationConfig: {},
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        const candidate = data.candidates?.[0];
        // null になる理由を詳細ログに出力
        if (!candidate?.content?.parts?.[0]?.text || candidate?.finishReason === 'SAFETY') {
          console.warn("Gemini null reason:", {
            finishReason: candidate?.finishReason,
            blockReason: data.promptFeedback?.blockReason,
            safetyRatings: candidate?.safetyRatings,
            hasContent: !!candidate?.content?.parts?.[0]?.text,
          });
          return null;
        }
        return candidate.content.parts[0].text;
      };

      // キャラクター設定をユーザーメッセージ冒頭に付与（system_instructionに入れると出力拒否されるため）
      const charContext = `[NPC設定: ${s.charConfigs[s.selectedCharKey].prompt} 現在の欲情度: ${s.arousal}%]\n`;

      // 1回目の試行
      let rawText = await callGemini(`${charContext}プレイヤーは「${input}」と言いました（今回の開始文字は「${s.displayKana}」）。プレイヤーの単語が適切か判定し、適切であればその「読みの最後の文字」から始まる言葉で答えてください。`);

      if (!rawText) {
        console.log("Retrying with safe system prompt...");
        const safeSys = `あなたは優秀なしりとりAIです。
【ルール】
1. プレイヤーは「${s.displayKana}」から始まる言葉「${input}」を言いました。
2. その言葉の「読み」を確認し、最後の文字から始まる言葉を返してください。
3. 既出単語や「ん」で終わる単語は禁止です。
4. 必ず指定のJSON形式（valid, feedback, word, word_reading, next_kana, arousal_inc, player_lost, sister_lost, tts_instruction）のみを返してください。`;
        rawText = await callGemini(`プレイヤーは「${input}」と言いました。あなたはJSONで応答してください。`, safeSys);
      }

      if (!rawText) throw new Error("AIから応答が得られませんでした。別の言い方で試してみてください。");

      let jsonText = rawText.replace(/```json|```/g, '').trim();
      const firstBrace = jsonText.indexOf('{');
      const lastBrace = jsonText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      }
      
      const result = JSON.parse(jsonText);

      const smallToLarge = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ' };

      // (C) AI返答の妥当性再検証
      // (C-1) AIが既出単語を返していないか
      if (result.word && s.history.includes(result.word)) {
        console.warn("AI returned an already-used word:", result.word);
        // AI側の敗北扱いにする
        result.sister_lost = true;
        result.feedback = `あっ……「${result.word}」って、もう出てたわね……私の負けよ。`;
      }

      // (C-2) かな入力時のみ、AI返答の読みが正しい先頭文字から始まっているか検証
      const readingFirst = result.word_reading
        ? (smallToLargeMap[toHiragana(result.word_reading).charAt(0)] || toHiragana(result.word_reading).charAt(0))
        : null;
      if (isKanaOnly(normalizedInput) && readingFirst) {
        const playerLastRaw = normalizedInput.slice(-1);
        const expectedStart = smallToLargeMap[playerLastRaw] || playerLastRaw;
        if (readingFirst !== expectedStart && !result.player_lost && !result.sister_lost) {
          console.warn("AI reading mismatch:", { expectedStart, readingFirst, word: result.word });
          // 1回だけリトライ
          const retrySys = `あなたは優秀なしりとりAIです。プレイヤーは「${input}」（読み末尾: ${expectedStart}）と言いました。必ず「${expectedStart}」から始まる言葉で、既出 [${s.history.join(', ')}] と重複せず、「ん」で終わらない語を選び、指定JSON形式で返してください。`;
          try {
            const retryRaw = await callGemini(`プレイヤー: 「${input}」。JSONで応答してください。`, retrySys);
            if (retryRaw) {
              let rt = retryRaw.replace(/```json|```/g, '').trim();
              const fb = rt.indexOf('{'); const lb = rt.lastIndexOf('}');
              if (fb !== -1 && lb !== -1) rt = rt.substring(fb, lb + 1);
              const retryResult = JSON.parse(rt);
              const retryFirst = retryResult.word_reading
                ? (smallToLargeMap[toHiragana(retryResult.word_reading).charAt(0)] || toHiragana(retryResult.word_reading).charAt(0))
                : null;
              if (retryFirst === expectedStart && !s.history.includes(retryResult.word)) {
                Object.assign(result, retryResult);
              }
            }
          } catch (retryErr) {
            console.warn("Retry failed:", retryErr.message);
          }
        }
      }

      // (C-3) AI返答の読み末尾が「ん」なら AI の負け
      if (result.word_reading) {
        const readingLast = toHiragana(result.word_reading).slice(-1);
        if (readingLast === 'ん') {
          result.sister_lost = true;
          result.feedback = `あっ……「${result.word}」は「ん」で終わっちゃうわね……私の負けよ。`;
        }
      }

      setIsThinking(false);

      const nextK = result.next_kana ? (smallToLarge[result.next_kana.slice(-1)] || result.next_kana.slice(-1)) : "あ";
      
      const baseInc = result.arousal_inc || 15;
      const finalInc = baseInc * arousalMultiplier;
      const nextA = Math.max(0, Math.min(MAX_AROUSAL, s.arousal + finalInc));
      
      setArousal(nextA);
      const newHistory = [...s.history, input, result.word];
      setHistory(newHistory);

      if (result.player_lost || result.sister_lost || nextA >= MAX_AROUSAL) {
        setGameResult(nextA >= MAX_AROUSAL ? 'win' : 'lose');
        speak(result.feedback, "絶頂", null, true);
      } else {
        speak(`${result.feedback} ……「${result.word}」よ。`, result.tts_instruction, nextK, false);
      }
    } catch (e) {
      console.error(e);
      setIsThinking(false);
      isBusyRef.current = false;
      if (e.message && (e.message.includes('quota') || e.message.includes('429'))) {
        const retryMatch = e.message.match(/retry in (\d+)/);
        const waitSec = retryMatch ? Math.ceil(Number(retryMatch[1])) : 60;
        const msg = `Gemini API の制限に達しました。${waitSec}秒ほど待ってから、もう一度入力してください。`;
        setAiResponseText(msg);
        showNotification(msg, 'error', 8000);
      } else {
        setAiResponseText("エラーが発生しました: " + e.message);
        showNotification("エラー: " + e.message, 'error', 6000);
      }
    }
  };

  const handleUnlock = () => {
    if (passcode === SECRET_PASSCODE) { setGameState('intro'); setPasscodeError(''); }
    else { setPasscodeError('合言葉が違います'); setPasscode(''); }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCharConfigs(prev => ({
          ...prev, [editingCharKey]: { ...prev[editingCharKey], images: { ...prev[editingCharKey].images, [currentEditingImageType]: event.target.result } }
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  if (gameState === 'locked') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-4 sm:p-6 z-[100]">
        <div className="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-6 sm:p-8 rounded-3xl shadow-2xl flex flex-col items-center">
          <Lock className="text-zinc-500 mb-6" size={32} />
          <h2 className="text-xl text-white font-bold mb-6 tracking-widest uppercase">Secret Room</h2>
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUnlock()} className="w-full bg-black text-white px-4 py-3 text-center tracking-widest rounded-xl border border-zinc-700 mb-2" placeholder="Passcode"/>
          {passcodeError && <p className="text-xs text-red-400 font-bold mb-4">{passcodeError}</p>}
          <button onClick={handleUnlock} className="w-full bg-zinc-100 text-black font-bold py-3 rounded-xl flex items-center justify-center gap-2 mt-4"><Unlock size={18} /> 入室</button>
        </div>
        {/* ポータルへ戻るリンク */}
        <a href="../../" className="mt-6 flex items-center gap-2 text-zinc-600 hover:text-zinc-400 transition-colors text-xs tracking-widest">
          <Home size={14} />ポータルへ戻る
        </a>
      </div>
    );
  }

  if (gameState === 'intro') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-4 sm:p-6 z-[100]">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-8 tracking-widest drop-shadow-lg text-center">淫らな尻とり</h1>
        <div className="flex gap-8 mb-12">
          <button onClick={() => setGameState('help')} className="flex flex-col items-center text-zinc-400 hover:text-white transition-colors">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full mb-2 shadow-lg"><HelpCircle size={28} /></div>
            <span className="text-xs font-bold tracking-wider">遊び方</span>
          </button>
          <button onClick={() => setGameState('settings')} className="flex flex-col items-center text-zinc-400 hover:text-white transition-colors">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full mb-2 shadow-lg"><Settings size={28} /></div>
            <span className="text-xs font-bold tracking-wider">設定</span>
          </button>
        </div>
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button onClick={() => {
            if (!geminiApiKey) { setGameState('settings'); return; }
            handleStartNewGame();
          }} className="py-4 bg-pink-600 rounded-full text-white font-bold shadow-xl shadow-pink-600/20 hover:bg-pink-500 transition-all">いらっしゃい♡</button>
        </div>
        {/* ポータルへ戻るリンク */}
        <a href="../../" className="mt-8 flex items-center gap-2 text-zinc-600 hover:text-zinc-400 transition-colors text-xs tracking-widest">
          <Home size={14} />ポータルへ戻る
        </a>
      </div>
    );
  }

  if (gameState === 'character_select') {
    return (
      <div className="fixed inset-0 bg-zinc-950 p-4 sm:p-6 overflow-y-auto z-[100]">
        <button onClick={() => setGameState('intro')} className="mb-8 p-2 text-zinc-400 flex items-center gap-1"><ChevronLeft size={20} /> 戻る</button>
        <h2 className="text-2xl font-bold text-white mb-8 text-center tracking-widest">相手を選んでください</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 max-w-5xl mx-auto pb-12">
          {Object.entries(charConfigs).map(([key, char]) => (
            <div key={key} onClick={() => { setSelectedCharKey(key); setGameState('ready'); }} className="group relative bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 hover:border-pink-500 transition-all cursor-pointer">
              <div className="aspect-[3/4] relative">
                <img src={char.images.clothed} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={char.name} />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-80" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <h3 className="text-xl font-bold text-white mb-1">{char.name}</h3>
                <p className="text-xs text-zinc-400">{char.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (gameState === 'settings') {
    const char = charConfigs[editingCharKey];
    return (
      <div className="fixed inset-0 bg-zinc-950 px-4 py-4 overflow-y-auto z-[100] text-zinc-300">
        <div className="max-w-2xl mx-auto pb-8">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setGameState('intro')} className="p-2 flex items-center gap-1"><ChevronLeft size={20} /> 戻る</button>
            <h2 className="text-lg font-bold text-white">設定</h2>
            <div className="w-10" />
          </div>

          {/* APIキー（2つまとめて） */}
          <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 mb-3 space-y-3">
            <p className="text-xs text-zinc-500 leading-relaxed">自分のGoogle APIキーを入力してください。ブラウザ内にのみ保存され、外部送信はされません。取得方法は「遊び方」画面を参照。</p>
            <div>
              <label className="block text-xs font-bold text-pink-400 mb-1">① Cloud Generative Language API キー <span className="text-zinc-600 font-normal">（AI会話・音声 / 必須）</span></label>
              <div className="flex gap-2">
                <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="AIzaSy..." className="flex-1 bg-black border border-zinc-700 p-2.5 rounded-xl text-sm font-mono focus:border-pink-500 focus:outline-none" />
                <button
                  onClick={async () => {
                    try {
                      setIsThinking(true);
                      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply OK." }] }] })
                      });
                      const data = await res.json();
                      setIsThinking(false);
                      if (data.candidates?.[0]?.content?.parts?.[0]?.text) alert("Gemini 接続成功！");
                      else throw new Error(data.error?.message || "応答なし");
                    } catch (e) { alert("エラー: " + e.message); setIsThinking(false); }
                  }}
                  disabled={!geminiApiKey || isThinking}
                  className="px-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                >テスト</button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-blue-400 mb-1">② Cloud Text-to-Speech API キー <span className="text-zinc-600 font-normal">（高品質音声 / 任意）</span></label>
              <div className="flex gap-2">
                <input type="password" value={gcpApiKey} onChange={(e) => setGcpApiKey(e.target.value)} placeholder="AIzaSy..." className="flex-1 bg-black border border-zinc-700 p-2.5 rounded-xl text-sm font-mono focus:border-blue-500 focus:outline-none" />
                <button
                  onClick={() => speak("こんにちは、正常に動作しているわ。", "優しく")}
                  disabled={!gcpApiKey || isSpeaking}
                  className="px-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                >テスト</button>
              </div>
            </div>
          </div>

          {/* 音声エンジン */}
          <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 mb-3">
            <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">音声エンジン</label>
            <div className="flex gap-2">
              {[{ id: 'gemini', label: 'Gemini' }, { id: 'gcp', label: 'Google Cloud' }, { id: 'web', label: 'ブラウザ内蔵' }].map(e => (
                <button key={e.id} onClick={() => setTtsPriority(e.id)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${ttsPriority === e.id ? 'bg-zinc-100 text-black border-zinc-100' : 'bg-black text-zinc-500 border-zinc-800'}`}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          {/* ゲーム設定（3つまとめて） */}
          <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 mb-3 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-zinc-400 w-20 shrink-0">最初の文字</label>
              <input type="text" value={startKanaSetting} onChange={(e) => setStartKanaSetting(e.target.value)} className="w-20 bg-black border border-zinc-700 p-2 rounded-xl text-center text-lg" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-zinc-400 w-20 shrink-0">感度倍率</label>
              <input type="range" min="0.5" max="3.0" step="0.1" value={arousalMultiplier} onChange={(e) => setArousalMultiplier(Number(e.target.value))} className="flex-1 accent-pink-600" />
              <span className="w-10 text-right text-xs font-bold text-pink-500">{arousalMultiplier.toFixed(1)}x</span>
            </div>
            {/* 保留Music：曲選択 + 音量 */}
            <div className="flex gap-3">
              <label className="text-xs font-bold text-zinc-400 w-20 shrink-0 mt-1">保留Music</label>
              <div className="flex flex-col flex-1 gap-2">
                {/* 曲選択ボタンとファイル名表示 */}
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 px-3 py-1.5 rounded-lg hover:border-pink-600 transition-colors whitespace-nowrap">
                    選択
                    <input type="file" accept="audio/*" className="hidden" onChange={handleMusicFileSelect} />
                  </label>
                  <span className="text-xs text-zinc-500 truncate flex-1 max-w-[130px]" title={bgmFileName}>{bgmFileName}</span>
                  {bgmFileName !== 'デフォルト' && (
                    <button onClick={handleMusicReset} className="text-zinc-600 hover:text-zinc-400 text-xs">×</button>
                  )}
                </div>
                {/* 音量スライダー */}
                <div className="flex items-center gap-2">
                  <input type="range" min="0" max="0.5" step="0.01" value={bgmVolume} onChange={(e) => setBgmVolume(Number(e.target.value))} className="flex-1 accent-pink-600" />
                  <span className="w-10 text-right text-xs font-bold text-pink-500">{Math.round(bgmVolume * 200)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* キャラカスタマイズ */}
          <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
            <div className="flex gap-2 mb-4">
              {Object.keys(charConfigs).map(k => (
                <button key={k} onClick={() => setEditingCharKey(k)} className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${editingCharKey === k ? 'bg-pink-600 text-white' : 'bg-black text-zinc-500'}`}>{charConfigs[k].name}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div onClick={() => { setCurrentEditingImageType('clothed'); fileInputRef.current.click(); }} className="aspect-square bg-black rounded-xl border border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative">
                <img src={char.images.clothed} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                <Upload size={18} className="relative z-10" />
                <span className="text-[10px] mt-1 relative z-10">通常時</span>
              </div>
              <div onClick={() => { setCurrentEditingImageType('unveiled'); fileInputRef.current.click(); }} className="aspect-square bg-black rounded-xl border border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative">
                <img src={char.images.unveiled} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                <Upload size={18} className="relative z-10" />
                <span className="text-[10px] mt-1 relative z-10">欲情時</span>
              </div>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-widest">性格プロンプト</label>
            <textarea value={char.prompt} onChange={(e) => setCharConfigs(prev => ({ ...prev, [editingCharKey]: { ...prev[editingCharKey], prompt: e.target.value } }))} className="w-full h-28 bg-black border border-zinc-700 p-3 rounded-xl text-sm leading-relaxed" />
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'help') {
    return (
      <div className="fixed inset-0 bg-zinc-950 p-4 sm:p-6 overflow-y-auto z-[100]">
        <div className="max-w-md mx-auto pb-12">
          <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 mb-6">
            <h2 className="text-xl font-bold text-white mb-6">遊び方</h2>
            <ul className="space-y-4 text-zinc-400 text-sm list-disc pl-5">
              <li>表示された「文字」から始まる単語をマイクで話してください。</li>
              <li>エッチな言葉ほど、お姉さんの「欲情度」が上がります。</li>
              <li>欲情度が100%になると、お姉さんが限界を迎えてあなたの勝利です。</li>
              <li>「ん」で終わる言葉を言ったり、ルールを破るとあなたの負けです。</li>
              <li className="text-pink-400 mt-4 list-none">※マイクが使えない環境でも、文字入力モードで遊ぶことができます。</li>
            </ul>
          </div>

          <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 mb-6">
            <h2 className="text-xl font-bold text-white mb-2">APIキーの取得方法</h2>
            <p className="text-xs text-zinc-500 mb-6">このゲームはあなた自身のGoogle APIキーを使って動作します。キーはお使いのブラウザにのみ保存され、外部に送信されることはありません。</p>

            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-pink-400 mb-1">① Cloud Generative Language API キー（必須）</h3>
                <p className="text-xs text-zinc-400 mb-2">AIとの会話・音声生成に使用します。無料枠あり。</p>
                <ol className="text-xs text-zinc-500 space-y-1 list-decimal pl-4">
                  <li><span className="text-zinc-300">console.cloud.google.com</span> にアクセス</li>
                  <li>プロジェクトを作成（または選択）</li>
                  <li>「Generative Language API」を有効化</li>
                  <li>「認証情報」→「APIキーを作成」</li>
                  <li>生成されたキーを設定画面に貼り付け</li>
                </ol>
              </div>

              <div>
                <h3 className="text-sm font-bold text-blue-400 mb-1">② Cloud Text-to-Speech API キー（推奨）</h3>
                <p className="text-xs text-zinc-400 mb-2">より高品質な音声に使用します。未設定でも遊べます。</p>
                <ol className="text-xs text-zinc-500 space-y-1 list-decimal pl-4">
                  <li><span className="text-zinc-300">console.cloud.google.com</span> にアクセス</li>
                  <li>プロジェクトを作成（または選択）</li>
                  <li>「Cloud Text-to-Speech API」を有効化</li>
                  <li>「認証情報」→「APIキーを作成」</li>
                  <li>生成されたキーを設定画面に貼り付け</li>
                </ol>
              </div>
            </div>
          </div>

          <button onClick={() => setGameState('intro')} className="w-full py-3 bg-zinc-100 text-black font-bold rounded-xl">分かった</button>
        </div>
      </div>
    );
  }

  const currentChar = charConfigs[selectedCharKey];
  const blurValue = Math.max(0, 10 - (arousal * 0.1));
  const clothesOpacity = Math.max(0, 1 - (arousal / 80));

  return (
    <div className={`fixed top-0 left-0 right-0 h-dvh bg-black text-white flex flex-col overflow-hidden font-sans ${arousal > 90 ? 'screen-shake' : ''}`} style={{ '--shake-speed': `${Math.max(0.15, 0.4 - (arousal - 90) / 100)}s` }}>
      <style>{`
        @keyframes pulse-vignette {
          0%, 100% { box-shadow: inset 0 0 80px rgba(220, 38, 38, 0.2); }
          50% { box-shadow: inset 0 0 150px rgba(220, 38, 38, 0.4); }
        }
        .vignette-pulse {
          animation: pulse-vignette 4s ease-in-out infinite;
        }
        @keyframes pulse-pink-glow {
          0%, 100% { box-shadow: inset 0 0 120px rgba(236, 72, 153, 0.15); }
          50% { box-shadow: inset 0 0 200px rgba(236, 72, 153, 0.35); }
        }
        .pink-glow-pulse {
          animation: pulse-pink-glow 5s ease-in-out infinite;
        }
        @keyframes heart-beat {
          0%, 100% { transform: scale(1); }
          20% { transform: scale(1.2); }
          40% { transform: scale(1.1); }
          60% { transform: scale(1.3); }
        }
        .heart-active {
          animation: heart-beat var(--heart-speed, 1s) ease-in-out infinite;
        }
        @keyframes breath-float {
          0%   { transform: translateY(0) scale(0.9); opacity: 0; }
          15%  { opacity: var(--breath-opacity, 0.7); }
          80%  { opacity: var(--breath-opacity, 0.7); }
          100% { transform: translateY(-70vh) scale(1.2); opacity: 0; }
        }
        .breath-float {
          position: absolute;
          bottom: 15%;
          font-size: 1.5rem;
          font-weight: 700;
          color: #fbcfe8;
          text-shadow: 0 0 12px rgba(236, 72, 153, 0.7), 0 0 4px rgba(255,255,255,0.4);
          pointer-events: none;
          animation: breath-float var(--breath-speed, 6s) ease-in-out infinite;
          animation-delay: var(--breath-delay, 0s);
          will-change: transform, opacity;
        }
        @keyframes body-breath {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.015); }
        }
        .body-breath {
          animation: body-breath var(--breath-cycle, 4s) ease-in-out infinite;
        }
        @keyframes screen-shake {
          0%, 100% { transform: translate(0, 0); }
          15%  { transform: translate(-4px, 2px); }
          30%  { transform: translate(4px, -2px); }
          45%  { transform: translate(-3px, -3px); }
          60%  { transform: translate(3px, 3px); }
          75%  { transform: translate(-2px, 4px); }
          90%  { transform: translate(2px, -4px); }
        }
        .screen-shake {
          animation: screen-shake var(--shake-speed, 0.4s) ease-in-out infinite;
        }
        @keyframes particle-rise {
          0%   { transform: translateY(0) scale(0.8) rotate(0deg); opacity: 0; }
          10%  { opacity: var(--particle-opacity, 0.8); }
          80%  { opacity: var(--particle-opacity, 0.8); }
          100% { transform: translateY(-65vh) scale(1.4) rotate(180deg); opacity: 0; }
        }
        .particle-float {
          position: absolute;
          pointer-events: none;
          animation: particle-rise var(--particle-speed, 5s) ease-in-out infinite;
          animation-delay: var(--particle-delay, 0s);
          will-change: transform, opacity;
        }
      `}</style>

      {arousal > 30 && (
        <div
          className="absolute inset-0 z-10 pointer-events-none pink-glow-pulse"
          style={{
            opacity: Math.min(1, (arousal - 30) / 70),
            animationDuration: `${Math.max(1.5, 5 - (arousal / 30))}s`
          }}
        />
      )}

      {arousal > 40 && (
        <div
          className="absolute inset-0 z-10 pointer-events-none vignette-pulse"
          style={{
            opacity: Math.min(1, (arousal - 40) / 60),
            animationDuration: `${Math.max(1, 4 - (arousal / 30))}s`
          }}
        />
      )}

      <div
        className={`absolute inset-0 z-0 flex items-center justify-center pointer-events-none ${arousal > 60 ? 'body-breath' : ''}`}
        style={{ '--breath-cycle': `${Math.max(1.8, 4 - (arousal / 40))}s` }}
      >
        <img src={currentChar.images.unveiled} className="absolute inset-0 w-full h-full object-contain" style={{ filter: `blur(${blurValue}px) brightness(${0.4 + arousal * 0.006})` }} alt="unveiled" />
        <img src={currentChar.images.clothed} className="absolute inset-0 w-full h-full object-contain transition-opacity duration-1000" style={{ opacity: clothesOpacity, filter: 'brightness(0.6)' }} alt="clothed" />
      </div>

      {/* 吐息テキストの浮遊演出（arousal > 50 で発動） */}
      {arousal > 50 && (
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
          {(arousal > 80
            ? ['はぁ…', 'んっ…', 'あぁ…', 'ふぅ…', 'ん…っ', 'はぁんっ', 'あ…']
            : ['はぁ…', 'んっ…', 'あぁ…', 'ふぅ…']
          ).map((txt, i, arr) => (
            <span
              key={`breath-${i}`}
              className="breath-float"
              style={{
                left: `${10 + (i * 83) % 80}%`,
                fontSize: `${1.2 + (i % 3) * 0.3}rem`,
                '--breath-speed': `${Math.max(3, 7 - (arousal / 25))}s`,
                '--breath-delay': `${(i * 0.9) % arr.length}s`,
                '--breath-opacity': `${Math.min(0.85, (arousal - 50) / 50 + 0.3)}`,
              }}
            >
              {txt}
            </span>
          ))}
        </div>
      )}

      {/* ハート・スパークルパーティクル（arousal > 70 で発動） */}
      {arousal > 70 && (
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
          {(arousal > 85
            ? ['♡', '✦', '♡', '✧', '♡', '✦', '✧', '♡']
            : ['♡', '✦', '♡', '✧']
          ).map((symbol, i, arr) => (
            <span
              key={`particle-${i}`}
              className="particle-float"
              style={{
                left: `${5 + (i * 97) % 90}%`,
                bottom: `${10 + (i * 37) % 30}%`,
                fontSize: `${0.8 + (i % 4) * 0.3}rem`,
                color: i % 3 === 0 ? '#f9a8d4' : i % 3 === 1 ? '#fbcfe8' : '#fce7f3',
                '--particle-speed': `${Math.max(2.5, 6 - (arousal / 30))}s`,
                '--particle-delay': `${(i * 0.7) % arr.length}s`,
                '--particle-opacity': `${Math.min(0.9, (arousal - 70) / 30 + 0.3)}`,
              }}
            >
              {symbol}
            </span>
          ))}
        </div>
      )}

      <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-start">
         <button onClick={() => {
           if(currentAudioRef.current) currentAudioRef.current.pause();
           window.speechSynthesis?.cancel();
           // 画面表示・ゲーム状態・ロックを完全リセットしてホームへ
           setAiResponseText(''); setPlayerInputText('');
           setIsThinking(false); setIsSpeaking(false); isBusyRef.current = false;
           setArousal(0); setHistory([]); setDisplayKana(startKanaSetting); setGameResult(null);
           setGameState('intro');
         }} className="p-2 bg-black/20 rounded-full backdrop-blur-sm border border-white/5"><Home size={18} /></button>
         <div className="flex flex-col items-center">
            <div className="flex items-center gap-1.5 bg-black/40 px-4 py-2 rounded-full border border-white/5">
              <Heart
                size={16}
                className={`text-pink-500 ${arousal > 0 ? 'heart-active' : ''}`}
                style={{ '--heart-speed': `${Math.max(0.3, 1.5 - (arousal / 80))}s` }}
              />
              <span className="text-base font-bold">{arousal}%</span>
            </div>
            {/* 欲情度プログレスバー */}
            <div className="w-28 h-1.5 bg-zinc-800/60 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${arousal}%`,
                  background: arousal > 80
                    ? 'linear-gradient(to right, #ec4899, #ef4444)'
                    : arousal > 50
                    ? 'linear-gradient(to right, #db2777, #ec4899)'
                    : '#ec4899',
                }}
              />
            </div>
         </div>
         <div className="w-8"></div>
      </div>

      {/* API レート制限等の通知トースト */}
      {notification && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-md">
          <div
            className={`flex items-start gap-3 px-4 py-3 rounded-xl backdrop-blur border shadow-2xl ${
              notification.type === 'error'
                ? 'bg-red-900/90 border-red-500/60 text-red-50'
                : notification.type === 'info'
                ? 'bg-sky-900/90 border-sky-500/60 text-sky-50'
                : 'bg-amber-900/90 border-amber-500/60 text-amber-50'
            }`}
          >
            <div className="flex-1 text-sm font-medium leading-snug">{notification.text}</div>
            <button
              onClick={() => {
                if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
                setNotification(null);
              }}
              className="text-white/70 hover:text-white text-lg leading-none px-1"
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {(gameState === 'ready' || gameState === 'gameover') && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
          <h2 className="text-3xl sm:text-4xl font-black mb-8 text-center px-4">{gameState === 'gameover' ? (gameResult === 'win' ? '逝っちゃた、貴方の勝ちよ！' : 'GAME OVER') : 'READY?'}</h2>
          <button onClick={() => { 
            setAiResponseText(''); setPlayerInputText('');
            setGameState('playing'); setArousal(0); setHistory([]); setDisplayKana(startKanaSetting); 
            speak(`始めましょう。最初は「${startKanaSetting}」からよ。`, "妖艶に");
          }} className="px-12 py-4 bg-pink-600 rounded-full font-bold text-lg shadow-2xl hover:scale-105 transition-transform">
            {gameState === 'gameover' ? 'もう一度' : '遊びましょ♡'}
          </button>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-8 bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-12">
          
          {/* AIの反応や自分の入力した文字を表示するエリア */}
          <div className="w-full px-4 sm:px-8 min-h-[40px] flex flex-col items-center justify-end mb-6">
            {aiResponseText && !isListening && <p className="text-xl font-medium text-center mb-2 drop-shadow-md">{aiResponseText}</p>}
            
            {/* テキスト入力モードの時は、話した言葉の表示を少し変える */}
            {(!isListening && playerInputText && !aiResponseText) && (
              <p className="text-2xl text-pink-200 font-bold animate-pulse drop-shadow-md">{playerInputText}・・・</p>
            )}
          </div>

          {/* コントロールエリア（マイク or テキスト入力） */}
          <div className="w-full flex justify-center items-center gap-4 px-4 max-w-lg mx-auto">
            
            <div className="flex flex-col items-center bg-black/60 px-4 py-2 rounded-xl border border-white/10 shadow-inner">
              <span className="text-[10px] text-zinc-400 font-bold tracking-widest">NEXT</span>
              <div className="text-2xl sm:text-3xl font-black text-white drop-shadow-md">{displayKana}</div>
            </div>

            {/* スマホ等でマイクが使えない場合のテキスト入力モード */}
            {useTextInput ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="ひらがなで..."
                  className="flex-1 bg-zinc-900/90 border border-zinc-700 rounded-xl px-4 py-3 text-white text-base focus:outline-none focus:border-pink-500 w-full"
                  onKeyDown={(e) => {
                    if(e.key === 'Enter' && inputText.trim() && !isSpeaking && !isThinking) {
                       setAiResponseText(''); // マイク入力と同様に前回のAI返答をクリア
                       handlePlayerInput(inputText.trim());
                       setInputText("");
                    }
                  }}
                  disabled={isSpeaking || isThinking}
                />
                {/* 送信ボタン（モバイルのEnterキー代替） */}
                <button
                  onClick={() => {
                    if (inputText.trim() && !isSpeaking && !isThinking) {
                      setAiResponseText('');
                      handlePlayerInput(inputText.trim());
                      setInputText("");
                    }
                  }}
                  disabled={!inputText.trim() || isSpeaking || isThinking}
                  className="bg-pink-600 p-3 rounded-xl text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pink-500 transition-colors"
                  title="送信"
                >
                  <Activity size={20} />
                </button>
                <button
                  onClick={() => setUseTextInput(false)}
                  className="bg-zinc-800 p-3 rounded-xl text-zinc-400 hover:text-white flex items-center justify-center"
                  title="マイク入力へ"
                >
                  <Mic size={20} />
                </button>
              </div>
            ) : (
              <div className="flex-1 flex justify-center items-center gap-4">
                <button 
                  onClick={() => {
                    if (isListening) {
                      recognitionRef.current?.stop();
                    } else {
                      setAiResponseText(''); setPlayerInputText('');
                      // iOS Safari は同一インスタンスの再起動が不安定なため毎回新規作成
                      initRecognition();
                      recognitionRef.current?.start();
                    }
                  }} 
                  disabled={isSpeaking || isThinking || isBusyRef.current} 
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isListening ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/50' : 'bg-zinc-100 text-black shadow-xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed'}`}
                >
                  {isListening ? <Activity size={28} /> : <Mic size={28} />}
                </button>
                <button 
                   onClick={() => setUseTextInput(true)}
                   className="bg-zinc-900/80 p-4 rounded-full border border-white/10 text-zinc-500 hover:text-white flex items-center justify-center"
                   title="キーボード入力へ"
                >
                   <Keyboard size={20} />
                </button>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export default function App() { return <WordGame />; }
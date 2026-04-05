import React, { useState, useEffect, useRef } from 'react';
import { Mic, Activity, Settings, Heart, Home, Upload, HelpCircle, Lock, Unlock, ChevronLeft } from 'lucide-react';

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

  const [useTextInput, setUseTextInput] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playerInputText, setPlayerInputText] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [gameResult, setGameResult] = useState(null);

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
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        currentAudioRef.current = audio;
        audio.onplay = () => { setAiResponseText(text); if (nextKanaUpdate) setDisplayKana(nextKanaUpdate); };
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
    }
    return false;
  };

  const speakWithGemini = async (text, inst, nextKanaUpdate, isGameOverCall) => {
    if (!geminiApiKey) return false;
    try {
      let cleanText = text.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
      const ttsPrompt = `「${inst || '自然に'}」という感情を込めて言ってください。現在の欲情度は${stateRef.current.arousal}%です。${stateRef.current.arousal > 70 ? 'かなり興奮して声が上ずっている様子を演じてください。' : ''}：${cleanText}`;

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
      const pcm = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (pcm) {
        if (currentAudioRef.current) currentAudioRef.current.pause();
        const audio = new Audio(URL.createObjectURL(pcmToWav(pcm)));
        currentAudioRef.current = audio;
        audio.onplay = () => { setAiResponseText(text); if (nextKanaUpdate) setDisplayKana(nextKanaUpdate); };
        audio.onended = () => {
          setIsSpeaking(false); isBusyRef.current = false;
          if (isGameOverCall) setGameState('gameover');
        };
        audio.play();
        return true;
      }
    } catch (e) {
      console.warn("Gemini TTS failed:", e.message);
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
      // ひらがな・カタカナのみで構成されているか（漢字混じりの場合はクライアント検証をスキップ）
      const isKanaOnly = str => /^[\u3041-\u3096\u30A1-\u30F6ー]+$/.test(str);

      const normalizedInput = toHiragana(input.trim());
      if (isKanaOnly(normalizedInput)) {
        // 開始文字チェック
        const smallToLargeMap = { 'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','ゃ':'や','ゅ':'ゆ','ょ':'よ','っ':'つ','ゎ':'わ' };
        const firstChar = smallToLargeMap[normalizedInput.charAt(0)] || normalizedInput.charAt(0);
        if (firstChar !== s.displayKana) {
          speak(`「${s.displayKana}」から始まる言葉を言ってちょうだい。`, "呆れたように");
          setIsThinking(false); isBusyRef.current = false; return;
        }
        // 「ん」終わりチェック
        const lastChar = normalizedInput.slice(-1);
        if (lastChar === 'ん') {
          speak("「ん」で終わったら負けよ。", "勝ち誇って", null, true);
          setGameResult('lose'); setIsThinking(false); isBusyRef.current = false; return;
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
      setIsThinking(false);

      const smallToLarge = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ' };
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
      if (e.message && e.message.includes('quota')) {
        const retryMatch = e.message.match(/retry in (\d+)/);
        const waitSec = retryMatch ? Math.ceil(Number(retryMatch[1])) : 60;
        setAiResponseText(`APIの制限に達しました。${waitSec}秒ほど待ってから、もう一度入力してください。`);
      } else {
        setAiResponseText("エラーが発生しました: " + e.message);
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
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-6 z-[100]">
        <div className="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-8 rounded-3xl shadow-2xl flex flex-col items-center">
          <Lock className="text-zinc-500 mb-6" size={32} />
          <h2 className="text-xl text-white font-bold mb-6 tracking-widest uppercase">Secret Room</h2>
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUnlock()} className="w-full bg-black text-white px-4 py-3 text-center tracking-widest rounded-xl border border-zinc-700 mb-2" placeholder="Passcode"/>
          {passcodeError && <p className="text-xs text-red-400 font-bold mb-4">{passcodeError}</p>}
          <button onClick={handleUnlock} className="w-full bg-zinc-100 text-black font-bold py-3 rounded-xl flex items-center justify-center gap-2 mt-4"><Unlock size={18} /> 入室</button>
        </div>
      </div>
    );
  }

  if (gameState === 'intro') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-6 z-[100]">
        <h1 className="text-4xl md:text-5xl font-black text-white mb-8 tracking-widest drop-shadow-lg text-center">淫らな尻とり</h1>
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
          }} className="py-4 bg-pink-600 rounded-full text-white font-bold shadow-xl shadow-pink-600/20 hover:bg-pink-500 transition-all">開始する</button>
        </div>
      </div>
    );
  }

  if (gameState === 'character_select') {
    return (
      <div className="fixed inset-0 bg-zinc-950 p-6 overflow-y-auto z-[100]">
        <button onClick={() => setGameState('intro')} className="mb-8 p-2 text-zinc-400 flex items-center gap-1"><ChevronLeft size={20} /> 戻る</button>
        <h2 className="text-2xl font-bold text-white mb-8 text-center tracking-widest">相手を選んでください</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto pb-12">
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
      <div className="fixed inset-0 bg-zinc-950 p-6 overflow-y-auto z-[100] text-zinc-300">
        <div className="max-w-2xl mx-auto pb-12">
          <div className="flex items-center justify-between mb-8">
             <button onClick={() => setGameState('intro')} className="p-2 flex items-center gap-1"><ChevronLeft size={20} /> 戻る</button>
             <h2 className="text-xl font-bold text-white">詳細設定</h2>
             <div className="w-10" />
          </div>
          <div className="bg-zinc-900 p-6 rounded-2xl border border-pink-900 mb-8 shadow-lg shadow-pink-900/20">
            <label className="block text-sm font-bold mb-2 text-pink-400">Cloud Generative Language API Key (Gemini)</label>
            <p className="text-xs text-zinc-500 mb-3">AIとの会話（テキスト生成）と Gemini 音声に使用します。Google Cloud Console で「Cloud Generative Language API」を有効化したキーを入力してください。</p>
            <div className="flex gap-2">
              <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="AIzaSy..." className="flex-1 bg-black border border-zinc-700 p-3 rounded-xl text-sm font-mono focus:border-pink-500 focus:outline-none" />
              <button 
                onClick={async () => {
                  try {
                    setIsThinking(true);
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ contents: [{ parts: [{ text: "Hello, reply 'OK' if you can hear me." }] }] })
                    });
                    const data = await res.json();
                    setIsThinking(false);
                    if (data.candidates?.[0]?.content?.parts?.[0]?.text) alert("Gemini API接続成功！");
                    else throw new Error(data.error?.message || "応答がありませんでした");
                  } catch (e) { alert("接続エラー: " + e.message); setIsThinking(false); }
                }}
                disabled={!geminiApiKey || isThinking}
                className="px-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
              >テスト</button>
            </div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-2xl border border-blue-900 mb-8 shadow-lg shadow-blue-900/20">
            <label className="block text-sm font-bold mb-2 text-blue-400">Cloud Text-to-Speech API Key (Journey/Neural2)</label>
            <p className="text-xs text-zinc-500 mb-3">Journey や Neural2 などの高品質音声に使用します。GCPで「Cloud Text-to-Speech API」を有効化したキーを入力してください。</p>
            <div className="flex gap-2">
              <input type="password" value={gcpApiKey} onChange={(e) => setGcpApiKey(e.target.value)} placeholder="AIzaSy..." className="flex-1 bg-black border border-zinc-700 p-3 rounded-xl text-sm font-mono focus:border-blue-500 focus:outline-none" />
              <button 
                onClick={() => speak("こんにちは、正常に動作しているわ。", "優しく")} 
                disabled={!gcpApiKey || isSpeaking}
                className="px-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
              >テスト</button>
            </div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 mb-8">
            <label className="block text-sm font-bold mb-4 uppercase tracking-widest text-xs text-zinc-500">優先する音声合成エンジン</label>
            <div className="flex gap-2">
              {[
                { id: 'gemini', label: 'Gemini' },
                { id: 'gcp', label: 'Google Cloud' },
                { id: 'web', label: 'ブラウザ内蔵' }
              ].map(engine => (
                <button 
                  key={engine.id} 
                  onClick={() => setTtsPriority(engine.id)} 
                  className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all border ${ttsPriority === engine.id ? 'bg-zinc-100 text-black border-zinc-100' : 'bg-black text-zinc-500 border-zinc-800'}`}
                >
                  {engine.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 mb-8">
            <label className="block text-sm font-bold mb-2">最初の文字</label>
            <input type="text" value={startKanaSetting} onChange={(e) => setStartKanaSetting(e.target.value)} className="w-full bg-black border border-zinc-700 p-3 rounded-xl text-center text-xl" />
          </div>
          <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 mb-8">
            <label className="block text-sm font-bold mb-1">感度倍率（欲情度の上がりやすさ）</label>
            <div className="flex items-center gap-4">
               <input type="range" min="0.5" max="3.0" step="0.1" value={arousalMultiplier} onChange={(e) => setArousalMultiplier(Number(e.target.value))} className="flex-1 accent-pink-600" />
               <span className="w-12 text-center font-bold text-pink-500">{arousalMultiplier.toFixed(1)}x</span>
            </div>
          </div>
          <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
            <div className="flex gap-2 mb-6">
              {Object.keys(charConfigs).map(k => (
                <button key={k} onClick={() => setEditingCharKey(k)} className={`flex-1 py-2 rounded-lg text-xs font-bold ${editingCharKey === k ? 'bg-pink-600 text-white' : 'bg-black text-zinc-500'}`}>{charConfigs[k].name}</button>
              ))}
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-zinc-500 mb-4 uppercase tracking-widest">画像カスタマイズ</label>
                <div className="grid grid-cols-2 gap-4">
                  <div onClick={() => { setCurrentEditingImageType('clothed'); fileInputRef.current.click(); }} className="aspect-square bg-black rounded-xl border border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative">
                    <img src={char.images.clothed} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                    <Upload size={20} className="relative z-10" />
                    <span className="text-[10px] mt-1 relative z-10">通常時</span>
                  </div>
                  <div onClick={() => { setCurrentEditingImageType('unveiled'); fileInputRef.current.click(); }} className="aspect-square bg-black rounded-xl border border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative">
                    <img src={char.images.unveiled} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                    <Upload size={20} className="relative z-10" />
                    <span className="text-[10px] mt-1 relative z-10">欲情時</span>
                  </div>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">性格プロンプト</label>
                <textarea value={char.prompt} onChange={(e) => setCharConfigs(prev => ({ ...prev, [editingCharKey]: { ...prev[editingCharKey], prompt: e.target.value } }))} className="w-full h-32 bg-black border border-zinc-700 p-4 rounded-xl text-sm leading-relaxed" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'help') {
    return (
      <div className="fixed inset-0 bg-zinc-950 p-6 flex flex-col items-center justify-center z-[100]">
        <div className="max-w-md w-full bg-zinc-900 p-8 rounded-3xl border border-zinc-800">
          <h2 className="text-xl font-bold text-white mb-6">遊び方</h2>
          <ul className="space-y-4 text-zinc-400 text-sm list-disc pl-5">
            <li>表示された「文字」から始まる単語をマイクで話してください。</li>
            <li>エッチな言葉ほど、お姉さんの「欲情度」が上がります。</li>
            <li>欲情度が100%になると、お姉さんが限界を迎えてあなたの勝利です。</li>
            <li>「ん」で終わる言葉を言ったり、ルールを破るとあなたの負けです。</li>
            <li className="text-pink-400 mt-4 list-none">※マイクが使えない環境でも、文字入力モードで遊ぶことができます。</li>
          </ul>
          <button onClick={() => setGameState('intro')} className="w-full mt-8 py-3 bg-zinc-100 text-black font-bold rounded-xl">分かった</button>
        </div>
      </div>
    );
  }

  const currentChar = charConfigs[selectedCharKey];
  const blurValue = Math.max(0, 10 - (arousal * 0.1));
  const clothesOpacity = Math.max(0, 1 - (arousal / 80));

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col overflow-hidden font-sans">
      <style>{`
        @keyframes pulse-vignette {
          0%, 100% { box-shadow: inset 0 0 80px rgba(220, 38, 38, 0.2); }
          50% { box-shadow: inset 0 0 150px rgba(220, 38, 38, 0.4); }
        }
        .vignette-pulse {
          animation: pulse-vignette 4s ease-in-out infinite;
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
      `}</style>

      {arousal > 40 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none vignette-pulse" 
          style={{ 
            opacity: Math.min(1, (arousal - 40) / 60),
            animationDuration: `${Math.max(1, 4 - (arousal / 30))}s` 
          }} 
        />
      )}

      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
        <img src={currentChar.images.unveiled} className="absolute inset-0 w-full h-full object-contain" style={{ filter: `blur(${blurValue}px) brightness(${0.4 + arousal * 0.006})` }} alt="unveiled" />
        <img src={currentChar.images.clothed} className="absolute inset-0 w-full h-full object-contain transition-opacity duration-1000" style={{ opacity: clothesOpacity, filter: 'brightness(0.6)' }} alt="clothed" />
      </div>

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
            <div className="flex items-center gap-1.5 bg-black/40 px-4 py-1.5 rounded-full border border-white/5">
              <Heart 
                size={14} 
                className={`text-pink-500 ${arousal > 0 ? 'heart-active' : ''}`} 
                style={{ '--heart-speed': `${Math.max(0.3, 1.5 - (arousal / 80))}s` }}
              />
              <span className="text-sm font-bold">{arousal}%</span>
            </div>
         </div>
         <div className="w-8"></div>
      </div>

      {(gameState === 'ready' || gameState === 'gameover') && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
          <h2 className="text-4xl font-black mb-8">{gameState === 'gameover' ? (gameResult === 'win' ? 'VICTORY!!' : 'GAME OVER') : 'READY?'}</h2>
          <button onClick={() => { 
            setAiResponseText(''); setPlayerInputText('');
            setGameState('playing'); setArousal(0); setHistory([]); setDisplayKana(startKanaSetting); 
            speak(`始めましょう。最初は「${startKanaSetting}」からよ。`, "妖艶に");
          }} className="px-12 py-4 bg-pink-600 rounded-full font-bold text-lg shadow-2xl hover:scale-105 transition-transform">
            {gameState === 'gameover' ? 'もう一度' : '対話を開始'}
          </button>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-8 bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-12">
          
          {/* AIの反応や自分の入力した文字を表示するエリア */}
          <div className="w-full px-8 min-h-[40px] flex flex-col items-center justify-end mb-6">
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
              <div className="text-3xl font-black text-white drop-shadow-md">{displayKana}</div>
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
                    if(isListening) recognitionRef.current?.stop(); 
                    else { setAiResponseText(''); setPlayerInputText(''); recognitionRef.current?.start(); } 
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
                   <Settings size={20} />
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
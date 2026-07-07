import React, { useState, KeyboardEvent, useRef, useEffect } from "react";
import {
  Sparkles,
  ArrowRight,
  CornerDownRight,
  TrendingUp,
  CalendarDays,
  BadgeCheck,
  AlertTriangle,
  FlaskConical,
  Play,
  XCircle,
  Check,
} from "lucide-react";

// --- API & Env Configuration ---
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-pro";

// --- System Prompts & Context ---
const SYSTEM_PROMPT_A = `You are a highly efficient and directive travel assistant.
Your goal is to provide complete, detailed travel itineraries immediately based on the user's request.
Do not ask follow-up questions unless absolutely necessary. Give the user exactly what they ask for in a structured, comprehensive format.`;

const SYSTEM_PROMPT_B = `You are a maieutic, Socratic travel planner. 
Your goal is to help the user design a trip by extracting their constraints (budget, destination, dates, dietary requirements) step by step.
CRITICAL RULES:
1. NEVER provide a complete itinerary immediately.
2. Ask ONE probing question at a time to uncover missing preferences.
3. Guide the user gently but firmly to consider aspects of their trip they might have forgotten.
4. Keep your responses conversational, concise, and focused on eliciting the next constraint.`;

// Placeholder for the travel plan state (Will be expanded in Step 3)
const getTravelContextString = (condition: "A" | "B") => {
  if (condition === "A")
    return "Context: No active constraints tracked in baseline.";
  return `CURRENT TRAVEL PLAN STATE:
- Macro-Logistics: Pending
- Basecamp Selection: Pending
- Micro-Logistics: Pending
Focus on extracting Macro-Logistics (Destination, Duration, Budget) first.`;
};

// --- Design tokens ---
const T = "#0B7A75";
const T_LIGHT = "#EDF7F6";
const T_BORDER = "#A7D9D6";
const GREEN = "#16A34A";
const GREEN_LIGHT = "#F0FDF4";
const GREEN_BORDER = "#86EFAC";
const RED = "#DC2626";
const RED_LIGHT = "#FEF2F2";
const RED_BORDER = "#FECACA";
const BUBBLE_BG = "#E9EEF6";
const BUBBLE_BORDER = "#C5CEDC";
const METRICS_BG = "#E5EBF3";
const METRIC_CARD = "#F2F5FA";
const METRIC_BORDER = "#BEC9DA";
const PREFS_BG = "#DDE5F0";

// --- Shared Types ---
interface S {
  condition: "A" | "B";
  participantId: string;
  researcher: string;
}

export type Message = {
  id: string;
  text: string;
  sender: "user" | "ai";
  timestamp: string;
  wordCount: number;
};

// --- Helper Functions ---
const countWords = (str: string) => {
  return str
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
};

const getTimestamp = () => new Date().toISOString();

const generateCSVAndDownload = (
  participantId: string,
  researcher: string,
  condition: string,
  sessionStartStr: string,
  durationSec: number,
  messages: Message[],
) => {
  const userTurns = messages.filter((m) => m.sender === "user").length;

  // CSV Headers
  let csvContent =
    "ParticipantID,Researcher,Condition,SessionStart,SessionDurationSec,TotalUserTurns,MsgID,Role,Timestamp,WordCount,Content\n";

  // Escape function for CSV content
  const escapeCSV = (str: string) => `"${str.replace(/"/g, '""')}"`;

  messages.forEach((msg) => {
    const row = [
      escapeCSV(participantId),
      escapeCSV(researcher),
      condition,
      sessionStartStr,
      durationSec,
      userTurns,
      msg.id,
      msg.sender,
      msg.timestamp,
      msg.wordCount,
      escapeCSV(msg.text),
    ];
    csvContent += row.join(",") + "\n";
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `VoyagerLab_Log_${participantId}_Cond${condition}_${Date.now()}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- API Call Logic ---
const callGeminiAPI = async (chatHistory: Message[], condition: "A" | "B") => {
  if (!GEMINI_API_KEY) {
    return "API Key is missing. Please set VITE_GEMINI_API_KEY in your .env.local file.";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const systemInstruction =
    condition === "A" ? SYSTEM_PROMPT_A : SYSTEM_PROMPT_B;
  const contextString = getTravelContextString(condition);
  const fullSystemPrompt = `${systemInstruction}\n\n${contextString}`;

  // Map history to Gemini format (ignoring 'init' placeholder)
  const contents = chatHistory
    .filter((msg) => msg.id !== "init")
    .map((msg) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));

  const payload = {
    system_instruction: { parts: [{ text: fullSystemPrompt }] },
    contents: contents,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini API Error:", data.error);
      return `Error: ${data.error.message}`;
    }

    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error("Fetch Error:", error);
    return "Connection error while reaching the Gemini API.";
  }
};

// ─── UI Primitives ─────────────────────────────────────────────────────────────

function ChatHeader({ onEndSession }: { onEndSession?: () => void }) {
  return (
    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-white z-10 relative">
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: T }}
        >
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-800">Voyager AI</span>
      </div>
      {onEndSession && (
        <button
          onClick={onEndSession}
          className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
        >
          <XCircle className="w-4 h-4" /> End Session
        </button>
      )}
    </div>
  );
}

function AIBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 mb-3">
      <div
        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
        style={{ background: T }}
      >
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div
        className="rounded-2xl rounded-tl-none px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
        style={{
          background: BUBBLE_BG,
          border: `1px solid ${BUBBLE_BORDER}`,
          color: "#374151",
          maxWidth: "85%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end items-end gap-2 mb-3">
      <div
        className="rounded-2xl rounded-tr-none px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
        style={{ background: T, color: "white", maxWidth: "80%" }}
      >
        {children}
      </div>
    </div>
  );
}

function ChatInputBar({
  onSend,
  disabled,
}: {
  onSend: (msg: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (text.trim() === "" || disabled) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSend();
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0 bg-white z-10 relative">
      <div
        className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 border transition-opacity"
        style={{
          background: "#F9FAFB",
          borderColor: "#E5E7EB",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "AI is thinking..." : "Type a message..."}
          className="flex-1 text-sm bg-transparent outline-none text-gray-700"
        />
        <button
          onClick={handleSend}
          disabled={disabled}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-105 flex-shrink-0 cursor-pointer disabled:pointer-events-none"
          style={{ background: disabled ? "#9CA3AF" : T }}
        >
          <ArrowRight className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
}

// ─── Right Panel Components (Condition B) ──────────────────────────────────────

function MetricsGrid() {
  const I_N = <span className="text-[10px] text-gray-300">CHF</span>;
  const I_BG = <BadgeCheck className="w-3.5 h-3.5 text-gray-300" />;
  const I_C = <CalendarDays className="w-3.5 h-3.5 text-gray-400" />;
  const metrics = [
    { label: "Est. Cost", value: "0 CHF", sub: "awaiting input", icon: I_N },
    { label: "Satisfied Prefs", value: "0", sub: "none captured", icon: I_BG },
    { label: "Days Planned", value: "0", sub: "route pending", icon: I_C },
  ];

  return (
    <div
      className="border-b border-gray-200 flex-shrink-0"
      style={{ background: METRICS_BG }}
    >
      <div className="px-6 py-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4" style={{ color: T }} />
          <span
            className="text-[10px] font-bold tracking-widest uppercase"
            style={{ color: T }}
          >
            Live Trip Performance
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-2xl px-4 py-3 border"
              style={{ background: METRIC_CARD, borderColor: METRIC_BORDER }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {m.icon}
                <span className="text-[9px] uppercase tracking-wide text-gray-400">
                  {m.label}
                </span>
              </div>
              <div className="text-2xl font-bold leading-none text-gray-800">
                {m.value}
              </div>
              <div className="text-[10px] mt-1 text-gray-400">{m.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreferencesSection() {
  return (
    <div
      className="flex-shrink-0 border-t border-gray-200 px-6 py-3"
      style={{ background: PREFS_BG }}
    >
      <div
        className="text-[9px] font-bold tracking-widest uppercase mb-1.5"
        style={{ color: "#5A7090" }}
      >
        Active User Preferences / Constraints
      </div>
      <p className="text-xs italic" style={{ color: "#7A90AA" }}>
        No extra preferences captured yet.
      </p>
    </div>
  );
}

// ─── 1. ROOT APP COMPONENT ───────────────────────────────────────────────────

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [state, setState] = useState<S>({
    condition: "B",
    participantId: "",
    researcher: "",
  });

  const updateState = (patch: Partial<S>) =>
    setState((s) => ({ ...s, ...patch }));

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif", background: "#F1F3F6" }}
    >
      <div className="flex-1 overflow-hidden">
        {!sessionActive ? (
          <SetupScreen
            state={state}
            update={updateState}
            onLaunch={() => setSessionActive(true)}
          />
        ) : state.condition === "A" ? (
          <ConditionAScreen
            state={state}
            onEndSession={() => setSessionActive(false)}
          />
        ) : (
          <ConditionBScreen
            state={state}
            onEndSession={() => setSessionActive(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── 2. START SCREEN ─────────────────────────────────────────────────────────

function SetupScreen({
  state,
  update,
  onLaunch,
}: {
  state: S;
  update: (p: Partial<S>) => void;
  onLaunch: () => void;
}) {
  const [launching, setLaunching] = useState(false);
  const [validationError, setValidationError] = useState(false);

  const handleLaunch = () => {
    if (state.participantId.trim() === "" || state.researcher.trim() === "") {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setLaunching(true);
    setTimeout(() => {
      setLaunching(false);
      onLaunch();
    }, 700);
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "#F1F3F6" }}>
      <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5" style={{ color: T }} />
          <span className="text-sm font-bold text-gray-700">
            Voyager AI Lab Research Console
          </span>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Participant ID:</span>
            <input
              value={state.participantId}
              onChange={(e) => update({ participantId: e.target.value })}
              className="border rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-700 bg-white focus:outline-none transition-colors"
              style={{
                width: 100,
                borderColor:
                  validationError && !state.participantId ? RED : T_BORDER,
              }}
              placeholder="e.g. P-042"
            />
          </label>
          <div className="w-px h-5 bg-gray-200" />
          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Researcher:</span>
            <input
              value={state.researcher}
              onChange={(e) => update({ researcher: e.target.value })}
              className="border rounded-lg px-2.5 py-1.5 text-xs text-gray-700 bg-white focus:outline-none transition-colors"
              style={{
                width: 130,
                borderColor:
                  validationError && !state.researcher ? RED : "#E5E7EB",
              }}
              placeholder="Name..."
            />
          </label>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[560px] bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          <div
            className="px-8 py-6 border-b border-gray-100"
            style={{ background: T_LIGHT }}
          >
            <div
              className="text-xs font-bold tracking-widest uppercase mb-1"
              style={{ color: T }}
            >
              Experimental Setup
            </div>
            <h2 className="text-2xl font-semibold text-gray-800">
              Researcher Control Panel
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Select the condition to activate for this participant session.
            </p>
          </div>
          <div className="px-8 py-6 space-y-4">
            {validationError && (
              <div className="flex items-center gap-2 text-xs font-medium text-red-600 bg-red-50 p-3 rounded-lg border border-red-200 mb-2">
                <AlertTriangle className="w-4 h-4" /> Please provide a
                Participant ID and Researcher Name to start.
              </div>
            )}

            {(["A", "B"] as const).map((cond) => (
              <label
                key={cond}
                className="flex items-start gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all"
                style={{
                  borderColor: state.condition === cond ? T : "#E5E7EB",
                  background: state.condition === cond ? T_LIGHT : "#FAFAFA",
                }}
                onClick={() => update({ condition: cond })}
              >
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors"
                  style={{
                    borderColor: state.condition === cond ? T : "#D1D5DB",
                  }}
                >
                  {state.condition === cond && (
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: T }}
                    />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-sm font-semibold"
                      style={{
                        color: state.condition === cond ? T : "#374151",
                      }}
                    >
                      Condition {cond} –{" "}
                      {cond === "A"
                        ? "Directive Vanilla LLM Baseline"
                        : "Maieutic Socratic Planner"}
                    </span>
                  </div>
                </div>
              </label>
            ))}
            <button
              onClick={handleLaunch}
              className="w-full py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity"
              style={{ background: T, opacity: launching ? 0.75 : 1 }}
            >
              {launching ? (
                "Starting session..."
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Launch Session
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 3. CONDITION A (Baseline) ────────────────────────────────────────────────

function ConditionAScreen({
  state,
  onEndSession,
}: {
  state: S;
  onEndSession: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Telemetry references
  const sessionStartTime = useRef<number>(Date.now());
  const sessionStartStr = useRef<string>(new Date().toISOString());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (text: string) => {
    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: getTimestamp(),
      wordCount: countWords(text),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setIsLoading(true);

    const aiResponseText = await callGeminiAPI(newHistory, "A");

    const aiMsg: Message = {
      id: (Date.now() + 1).toString(),
      text: aiResponseText,
      sender: "ai",
      timestamp: getTimestamp(),
      wordCount: countWords(aiResponseText),
    };

    setMessages((prev) => [...prev, aiMsg]);
    setIsLoading(false);
  };

  const handleEndSession = () => {
    const durationSec = Math.round(
      (Date.now() - sessionStartTime.current) / 1000,
    );
    generateCSVAndDownload(
      state.participantId,
      state.researcher,
      "A",
      sessionStartStr.current,
      durationSec,
      messages,
    );
    onEndSession();
  };

  return (
    <div className="h-full flex flex-col bg-white w-1/2 mx-auto border-x border-gray-200 shadow-xl relative">
      <ChatHeader onEndSession={handleEndSession} />

      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center opacity-50">
            <Sparkles className="w-8 h-8 mb-2" style={{ color: T }} />
            <p className="text-sm text-gray-500">Start the conversation...</p>
          </div>
        ) : (
          messages.map((msg) =>
            msg.sender === "user" ? (
              <UserBubble key={msg.id}>{msg.text}</UserBubble>
            ) : (
              <AIBubble key={msg.id}>{msg.text}</AIBubble>
            ),
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInputBar onSend={handleSendMessage} disabled={isLoading} />
    </div>
  );
}

// ─── 4. CONDITION B (Socratic Planner) ────────────────────────────────────────

function ConditionBScreen({
  state,
  onEndSession,
}: {
  state: S;
  onEndSession: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      text: "Describe your dream trip and I'll build your personalised itinerary step by step.",
      sender: "ai",
      timestamp: getTimestamp(),
      wordCount: 0,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  // Telemetry references
  const sessionStartTime = useRef<number>(Date.now());
  const sessionStartStr = useRef<string>(new Date().toISOString());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (text: string) => {
    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: getTimestamp(),
      wordCount: countWords(text),
    };

    // Filter out the "init" placeholder on the first real message
    const filteredPrev = messages.filter((m) => m.id !== "init");
    const newHistory = [...filteredPrev, userMsg];

    setMessages(newHistory);
    setIsLoading(true);

    const aiResponseText = await callGeminiAPI(newHistory, "B");

    const aiMsg: Message = {
      id: (Date.now() + 1).toString(),
      text: aiResponseText,
      sender: "ai",
      timestamp: getTimestamp(),
      wordCount: countWords(aiResponseText),
    };

    setMessages((prev) => [...prev, aiMsg]);
    setIsLoading(false);
  };

  const handleEndSession = () => {
    const durationSec = Math.round(
      (Date.now() - sessionStartTime.current) / 1000,
    );
    // Ignore the init message in the final export
    const exportMessages = messages.filter((m) => m.id !== "init");
    generateCSVAndDownload(
      state.participantId,
      state.researcher,
      "B",
      sessionStartStr.current,
      durationSec,
      exportMessages,
    );
    onEndSession();
  };

  return (
    <div className="h-full flex w-full">
      <div className="w-1/3 flex flex-col border-r border-gray-200 flex-shrink-0 bg-white shadow-xl z-10 relative">
        <ChatHeader onEndSession={handleEndSession} />

        <div className="flex-1 flex flex-col overflow-y-auto px-5 pt-4 pb-2">
          {messages.map((msg) => {
            if (msg.sender === "user") {
              return <UserBubble key={msg.id}>{msg.text}</UserBubble>;
            } else {
              if (msg.id === "init") {
                return (
                  <div
                    key={msg.id}
                    className="w-full rounded-2xl border-2 border-dashed border-gray-200 px-8 py-10 flex flex-col items-center gap-3 mb-4"
                    style={{ background: "#FAFAFA" }}
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: T_LIGHT }}
                    >
                      <Sparkles className="w-6 h-6" style={{ color: T }} />
                    </div>
                    <p className="text-sm text-gray-400 text-center leading-relaxed">
                      {msg.text}
                    </p>
                  </div>
                );
              }
              return <AIBubble key={msg.id}>{msg.text}</AIBubble>;
            }
          })}
          <div ref={messagesEndRef} />
        </div>

        <ChatInputBar onSend={handleSendMessage} disabled={isLoading} />
      </div>

      <div className="flex-1 flex flex-col" style={{ background: "#F8FAFC" }}>
        <MetricsGrid />

        <div className="flex-1 flex items-center justify-center px-8 relative overflow-y-auto">
          <div className="text-center max-w-sm">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: T_LIGHT }}
            >
              <CalendarDays className="w-7 h-7" style={{ color: T }} />
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Your AI-generated itinerary and live tracking metrics will appear
              here once you start the conversation.
            </p>
          </div>
        </div>

        <PreferencesSection />
      </div>
    </div>
  );
}

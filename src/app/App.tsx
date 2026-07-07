import React, { useState, KeyboardEvent, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {
  Pencil,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  ArrowRight,
  CornerDownRight,
  Zap,
  TrendingUp,
  CalendarDays,
  BadgeCheck,
  AlertTriangle,
  FlaskConical,
  Play,
  Hotel,
  XCircle,
} from "lucide-react";

// --- Configuration ---
export const GEMINI_MODEL =
  import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// --- System Prompts & Context (The "Brain" of our Generative UI) ---
const SYSTEM_PROMPT_A = `You are a highly efficient and directive travel assistant.
Your goal is to provide complete, detailed travel itineraries immediately based on the user's request.
Give the user exactly what they ask for in a structured, comprehensive markdown format. Do not ask endless follow-up questions. Provide the full plan quickly.
Reply in English.`;

const SYSTEM_PROMPT_B = `You are a maieutic, Socratic travel planner powered by Augmented Intelligence.
Your goal is to extract the user's constraints (budget, destination, dates, dietary) step by step, and then propose a highly adaptable itinerary.

CRITICAL RULES FOR SOCRATIC MODE:
1. Don't ask endless questions. Ask 1-2 questions to get the basics (Destination, Budget, Duration, Group), then PROPOSE a high-level plan.
2. Once you propose a plan, allow the user to adjust specific days or budgets.
3. OPENUI GENERATION: You have the ability to render interactive UI widgets directly in the chat. To do this, output the exact tags below on a new line. 
   - When suggesting hotel tiers, output: <UI_HOTEL_SELECTION />
   - When the user asks for an expensive adjustment that exceeds the budget (e.g., an Alpine Helicopter Tour), YOU MUST WARN THEM and output: <UI_CONFLICT />
   - When suggesting quick edits to a specific day, output: <UI_SUGGESTION_CHIPS />
4. STATE UPDATES: If the user confirms a preference (e.g., "Gluten-free" or "1500 CHF"), you must acknowledge it. The UI will extract it automatically.
Reply in English. Keep text concise when using UI tags.`;

const getTravelContextString = (condition: "A" | "B", state: S) => {
  if (condition === "A")
    return "Context: No active constraints tracked in baseline.";
  return `CURRENT CONTEXT & KNOWN CONSTRAINTS:
- Gluten-free requested: ${state.glutenFree ? "Yes" : "No"}
- Accommodation Tier: ${state.accomTier || "Pending"}
- Budget Status: ${state.conflictActive ? "OVER BUDGET" : "Within limits"}
Use this context to guide your response.`;
};

// --- Design tokens (From Figma) ---
const T = "#0B7A75";
const T_LIGHT = "#EDF7F6";
const T_BORDER = "#A7D9D6";
const GREEN = "#16A34A";
const GREEN_LIGHT = "#F0FDF4";
const GREEN_BORDER = "#86EFAC";
const RED = "#DC2626";
const RED_LIGHT = "#FEF2F2";
const RED_BORDER = "#FECACA";
const AMBER = "#D97706";
const AMBER_LIGHT = "#FFFBEB";
const AMBER_BORDER = "#FCD34D";
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
  glutenFree: boolean;
  accomTier: string | null;
  selectedHotel: string | null;
  editApplied: boolean;
  conflictActive: boolean;
}

export type Message = {
  id: string;
  text: string;
  sender: "user" | "ai";
  timestamp: string;
  wordCount: number;
};

// --- Helper Functions ---
const countWords = (str: string) =>
  str
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
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
  let csvContent =
    "ParticipantID,Researcher,Condition,SessionStart,SessionDurationSec,TotalUserTurns,MsgID,Role,Timestamp,WordCount,Content\n";
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

// --- Streaming API Call with Auto-Retry ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const callGeminiAPIStream = async (
  chatHistory: Message[],
  condition: "A" | "B",
  state: S,
  onChunk: (chunk: string) => void,
) => {
  if (!GEMINI_API_KEY) {
    onChunk(
      "API Key is missing. Please set VITE_GEMINI_API_KEY in your .env.local file.",
    );
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  const systemInstruction =
    condition === "A" ? SYSTEM_PROMPT_A : SYSTEM_PROMPT_B;
  const fullSystemPrompt = `${systemInstruction}\n\n${getTravelContextString(condition, state)}`;

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

  let retries = 3;
  let delay = 1000;

  while (retries > 0) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.status === 503) {
        throw new Error("503");
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.candidates && data.candidates[0].content.parts[0].text) {
                onChunk(data.candidates[0].content.parts[0].text);
              }
            } catch (e) {
              /* Ignore broken json chunks in stream */
            }
          }
        }
      }
      return; // Success, exit retry loop
    } catch (error: any) {
      if (error.message === "503" && retries > 1) {
        retries--;
        await sleep(delay);
        delay *= 2; // Exponential backoff
      } else {
        onChunk("\n*[Network Error: Please try again]*");
        return;
      }
    }
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

// ─── OpenUI Renderer (The Generative UI Magic) ───────────────────────────────
// This function parses the AI text and replaces OpenUI tags with actual React components
const renderMessageWithOpenUI = (
  text: string,
  state: S,
  update: (patch: Partial<S>) => void,
) => {
  const parts = text.split(/(<UI_[A-Z_]+\s*\/>)/g);

  return parts.map((part, index) => {
    if (part.includes("<UI_HOTEL_SELECTION />")) {
      return (
        <div key={index} className="my-4">
          <AccommodationTier
            selected={state.accomTier}
            onSelect={(t) => update({ accomTier: t })}
          />
        </div>
      );
    }
    if (part.includes("<UI_CONFLICT />")) {
      // Auto-trigger conflict state if AI decides there's a conflict
      if (!state.conflictActive)
        setTimeout(() => update({ conflictActive: true }), 0);
      return <ConflictResolutionWidget key={index} />;
    }
    if (part.includes("<UI_SUGGESTION_CHIPS />")) {
      return (
        <SuggestionChips
          key={index}
          chips={[
            "Replace Louvre visit",
            "Adjust meal times",
            "Find GF breakfast",
          ]}
        />
      );
    }
    // Default: Render Markdown for regular text
    return (
      <div key={index} className="prose prose-sm prose-slate max-w-none">
        <ReactMarkdown>{part}</ReactMarkdown>
      </div>
    );
  });
};

function AIBubble({
  message,
  state,
  update,
}: {
  message: Message;
  state: S;
  update: (p: Partial<S>) => void;
}) {
  return (
    <div className="flex gap-2.5 mb-3">
      <div
        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
        style={{ background: T }}
      >
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div
        className="rounded-2xl rounded-tl-none px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap overflow-hidden"
        style={{
          background: BUBBLE_BG,
          border: `1px solid ${BUBBLE_BORDER}`,
          color: "#374151",
          maxWidth: "85%",
        }}
      >
        {renderMessageWithOpenUI(message.text, state, update)}
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (text.trim() === "" || disabled) return;
    onSend(text);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto"; // reset height
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      // Max height approx 3 lines (e.g. 72px)
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 72)}px`;
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0 bg-white z-10 relative">
      <div
        className="flex items-end gap-2.5 rounded-xl px-4 py-2.5 border transition-opacity"
        style={{
          background: "#F9FAFB",
          borderColor: "#E5E7EB",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            disabled
              ? "AI is typing..."
              : "Type a message... (Shift+Enter for new line)"
          }
          className="flex-1 text-sm bg-transparent outline-none text-gray-700 resize-none py-1"
          style={{ minHeight: "28px", maxHeight: "72px" }}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={disabled || text.trim() === ""}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-105 flex-shrink-0 cursor-pointer disabled:pointer-events-none mb-0.5"
          style={{ background: disabled || text.trim() === "" ? "#9CA3AF" : T }}
        >
          <ArrowRight className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
}

// ─── OpenUI Widget Components (from Figma) ───────────────────────────────────

function AIMicroFrontend({
  children,
  label = "Quick Preferences",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div
      className="mt-2 mb-1 rounded-xl overflow-hidden flex-shrink-0"
      style={{ border: `1.5px dashed ${T_BORDER}`, background: "#FAFFFE" }}
    >
      <div
        className="px-3.5 py-1.5 flex items-center justify-between border-b"
        style={{ borderColor: T_BORDER, background: T_LIGHT }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {label}
        </span>
        <div className="flex items-center gap-1" style={{ color: T }}>
          <Zap className="w-3 h-3" />
          <span className="text-[9px] font-bold tracking-widest uppercase">
            AI-generated
          </span>
        </div>
      </div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

function AccommodationTier({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (t: string) => void;
}) {
  const tiers = ["Hostel", "3-Star", "Luxury"];
  const pos =
    selected === "Hostel" ? "15%" : selected === "Luxury" ? "85%" : "50%";

  return (
    <AIMicroFrontend label="Hotel Selection">
      <div className="flex gap-1 mb-2.5">
        {tiers.map((t) => (
          <button
            key={t}
            onClick={() => onSelect(t)}
            className="flex-1 py-1 rounded-lg text-xs font-medium border transition-all"
            style={
              t === selected
                ? { background: T, color: "white", borderColor: T }
                : {
                    background: "white",
                    color: "#6B7280",
                    borderColor: "#E5E7EB",
                  }
            }
          >
            {t}
          </button>
        ))}
      </div>
      <div className="relative h-1.5 bg-gray-200 rounded-full">
        <div
          className="h-1.5 rounded-full transition-all duration-300"
          style={{ width: pos, background: T }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 shadow-sm transition-all duration-300"
          style={{ left: pos, borderColor: T }}
        />
      </div>
    </AIMicroFrontend>
  );
}

function SuggestionChips({ chips }: { chips: string[] }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <AIMicroFrontend label="Suggested Edits">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => setActive((a) => (a === c ? null : c))}
            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
            style={
              active === c
                ? { background: T, color: "white", borderColor: T }
                : { background: "white", color: T, borderColor: T_BORDER }
            }
          >
            {c}
          </button>
        ))}
      </div>
    </AIMicroFrontend>
  );
}

function ConflictResolutionWidget() {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <AIMicroFrontend label="Budget Conflict">
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3"
        style={{ background: AMBER_LIGHT, border: `1px solid ${AMBER_BORDER}` }}
      >
        <AlertTriangle
          className="w-4 h-4 flex-shrink-0"
          style={{ color: AMBER }}
        />
        <span className="text-xs font-bold" style={{ color: AMBER }}>
          Budget Conflict Detected
        </span>
        <span
          className="ml-auto text-[10px] font-bold"
          style={{ color: AMBER }}
        >
          +150 CHF over limit
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {["Increase budget limit", "Swap an existing activity"].map((c) => (
          <button
            key={c}
            onClick={() => setChosen((ch) => (ch === c ? null : c))}
            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
            style={
              chosen === c
                ? {
                    background: c.includes("Increase") ? AMBER : T,
                    color: "white",
                    borderColor: c.includes("Increase") ? AMBER : T,
                  }
                : {
                    background: "white",
                    color: c.includes("Increase") ? AMBER : T,
                    borderColor: c.includes("Increase")
                      ? AMBER_BORDER
                      : T_BORDER,
                  }
            }
          >
            {c}
          </button>
        ))}
      </div>
    </AIMicroFrontend>
  );
}

// ─── Right Panel Components (Condition B) ──────────────────────────────────────

type MC = {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  green?: boolean;
  red?: boolean;
};
function MetricsGrid({ state }: { state: S }) {
  const I_N = <span className="text-[10px] text-gray-300">CHF</span>;
  const I_G = (
    <span className="text-[10px]" style={{ color: GREEN }}>
      CHF
    </span>
  );
  const I_R = <AlertTriangle className="w-3.5 h-3.5" style={{ color: RED }} />;
  const I_BT = <BadgeCheck className="w-3.5 h-3.5" style={{ color: T }} />;
  const I_C = <CalendarDays className="w-3.5 h-3.5 text-gray-400" />;

  // Dynamically calculate metrics based on state
  let cost = "0";
  let costSub = "awaiting input";
  let costIcon = I_N;
  let costRed = false;
  let costGreen = false;
  let prefs = "0";
  let prefsSub = "none captured";
  let days = "0";
  let daysSub = "route pending";

  // Simulate parsing the conversation state into metrics
  if (state.accomTier || state.glutenFree) {
    cost = state.conflictActive ? "1,650" : "1,329";
    costSub = state.conflictActive ? "150 over limit!" : "171 under budget";
    costIcon = state.conflictActive ? I_R : I_G;
    costRed = state.conflictActive;
    costGreen = !state.conflictActive;
    prefs = (state.accomTier ? 1 : 0) + (state.glutenFree ? 1 : 0) + "";
    prefsSub = "captured";
    days = "7";
    daysSub = "Europe route";
  }

  const metrics: MC[] = [
    {
      label: "Est. Cost",
      value: cost,
      sub: costSub,
      icon: costIcon,
      red: costRed,
      green: costGreen,
    },
    { label: "Satisfied Prefs", value: prefs, sub: prefsSub, icon: I_BT },
    { label: "Days Planned", value: days, sub: daysSub, icon: I_C },
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
              className="rounded-2xl px-4 py-3 border transition-colors"
              style={
                m.red
                  ? { background: RED_LIGHT, borderColor: RED_BORDER }
                  : m.green
                    ? { background: GREEN_LIGHT, borderColor: GREEN_BORDER }
                    : { background: METRIC_CARD, borderColor: METRIC_BORDER }
              }
            >
              <div className="flex items-center gap-1.5 mb-1">
                {m.icon}
                <span className="text-[9px] uppercase tracking-wide text-gray-400">
                  {m.label}
                </span>
              </div>
              <div
                className="text-2xl font-bold leading-none"
                style={{ color: m.red ? RED : m.green ? GREEN : "#1A1D23" }}
              >
                {m.value}
              </div>
              <div
                className="text-[10px] mt-1 truncate"
                style={{ color: m.red ? RED : m.green ? GREEN : "#9CA3AF" }}
              >
                {m.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayCardCollapsed({
  day,
  sub,
  hotel,
  spend,
  warning = false,
}: {
  day: string;
  sub: string;
  hotel?: string;
  spend?: string;
  warning?: boolean;
}) {
  return (
    <div
      className="border rounded-2xl px-4 py-3 flex items-start gap-2 transition-colors hover:opacity-90 shadow-sm"
      style={
        warning
          ? { borderColor: RED_BORDER, background: RED_LIGHT }
          : { borderColor: "#E2E8F0", background: "#FAFCFF" }
      }
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: warning ? RED : "#374151" }}
          >
            {day}
          </span>
          {hotel && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1 flex-shrink-0">
              <Hotel className="w-3 h-3" />
              {hotel}
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <span className="text-xs text-gray-400 truncate">{sub}</span>
          {spend && (
            <span
              className="text-xs font-semibold flex-shrink-0"
              style={{ color: T }}
            >
              {spend}
            </span>
          )}
        </div>
      </div>
      <div className="self-center flex-shrink-0 mt-0.5">
        {warning ? (
          <AlertTriangle className="w-4 h-4" style={{ color: RED }} />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-300" />
        )}
      </div>
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
    glutenFree: false,
    accomTier: null,
    selectedHotel: null,
    editApplied: false,
    conflictActive: false,
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
            updateState={updateState}
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
      <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0 shadow-sm z-10">
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
                  <div className="text-xs text-gray-400 mt-1">
                    {cond === "A"
                      ? "Standard prompt-response. Full itinerary generated instantly. No interactive UI or preference capture."
                      : "AI-guided preference elicitation with dynamic UI, live metrics grid, and conflict resolution protocols."}
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

    const aiMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: aiMsgId,
        text: "",
        sender: "ai",
        timestamp: getTimestamp(),
        wordCount: 0,
      },
    ]);

    await callGeminiAPIStream(newHistory, "A", state, (chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const newText = last.text + chunk;
        return [
          ...prev.slice(0, -1),
          { ...last, text: newText, wordCount: countWords(newText) },
        ];
      });
    });

    setIsLoading(false);
  };

  const handleEndSession = () => {
    generateCSVAndDownload(
      state.participantId,
      state.researcher,
      "A",
      sessionStartStr.current,
      Math.round((Date.now() - sessionStartTime.current) / 1000),
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
              <AIBubble
                key={msg.id}
                message={msg}
                state={state}
                update={() => {}}
              />
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
  updateState,
  onEndSession,
}: {
  state: S;
  updateState: (p: Partial<S>) => void;
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
    const filteredPrev = messages.filter((m) => m.id !== "init");
    const newHistory = [...filteredPrev, userMsg];

    setMessages(newHistory);
    setIsLoading(true);

    const aiMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: aiMsgId,
        text: "",
        sender: "ai",
        timestamp: getTimestamp(),
        wordCount: 0,
      },
    ]);

    await callGeminiAPIStream(newHistory, "B", state, (chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const newText = last.text + chunk;

        // Simulating passive state extraction: if AI mentions gluten-free, toggle it.
        if (
          newText.toLowerCase().includes("gluten-free") &&
          !state.glutenFree
        ) {
          updateState({ glutenFree: true });
        }

        return [
          ...prev.slice(0, -1),
          { ...last, text: newText, wordCount: countWords(newText) },
        ];
      });
    });

    setIsLoading(false);
  };

  const handleEndSession = () => {
    const exportMessages = messages.filter((m) => m.id !== "init");
    generateCSVAndDownload(
      state.participantId,
      state.researcher,
      "B",
      sessionStartStr.current,
      Math.round((Date.now() - sessionStartTime.current) / 1000),
      exportMessages,
    );
    onEndSession();
  };

  // Derive tags for Preference section based on state
  const activeTags = [];
  if (state.glutenFree) activeTags.push("Gluten-free");
  if (state.accomTier) activeTags.push(state.accomTier);

  return (
    <div className="h-full flex w-full">
      <div className="w-[400px] flex flex-col border-r border-gray-200 flex-shrink-0 bg-white shadow-xl z-10 relative">
        <ChatHeader onEndSession={handleEndSession} />

        <div className="flex-1 flex flex-col overflow-y-auto px-5 pt-4 pb-2">
          {messages.map((msg) => {
            if (msg.sender === "user")
              return <UserBubble key={msg.id}>{msg.text}</UserBubble>;
            if (msg.id === "init") {
              return (
                <div
                  key={msg.id}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-200 px-8 py-10 flex flex-col items-center gap-3 mb-4 mt-auto"
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
            return (
              <AIBubble
                key={msg.id}
                message={msg}
                state={state}
                update={updateState}
              />
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <ChatInputBar onSend={handleSendMessage} disabled={isLoading} />
      </div>

      <div className="flex-1 flex flex-col" style={{ background: "#F8FAFC" }}>
        <MetricsGrid state={state} />

        <div className="flex-1 px-8 py-6 relative overflow-y-auto">
          {messages.length <= 1 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-60">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: T_LIGHT }}
              >
                <CalendarDays className="w-7 h-7" style={{ color: T }} />
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                Your AI-generated itinerary and live tracking metrics will
                appear here once you start the conversation.
              </p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4 pb-12">
              <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">
                High-Level Itinerary Artifact
              </div>
              <DayCardCollapsed
                day="Day 1 – Zurich"
                sub="Arrival – Old Town"
                hotel={state.accomTier ? "Hotel Adler" : undefined}
              />
              {state.accomTier && (
                <DayCardCollapsed
                  day="Day 2 – Paris"
                  sub="Eiffel Tower – Louvre"
                  hotel={state.accomTier ? "Hôtel Grands Hommes" : undefined}
                  spend="145 CHF"
                />
              )}
              {state.conflictActive && (
                <DayCardCollapsed
                  day="Day 3 – Alpine Tour ⚠️"
                  sub="Helicopter Tour – OVER BUDGET"
                  warning
                />
              )}
            </div>
          )}
        </div>

        <div
          className="flex-shrink-0 border-t border-gray-200 px-6 py-3"
          style={{ background: PREFS_BG }}
        >
          <div
            className="text-[9px] font-bold tracking-widest uppercase mb-1.5"
            style={{ color: "#5A7090" }}
          >
            Active Constraints
          </div>
          {activeTags.length === 0 ? (
            <p className="text-xs italic" style={{ color: "#7A90AA" }}>
              No preferences captured yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeTags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                  style={{ background: T }}
                >
                  <Check className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, KeyboardEvent, useRef, useEffect } from "react";
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
// Define the model for Step 2 in advance
export const GEMINI_MODEL = "gemini-3.0-pro";

// --- Original Design tokens ---
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
const MUTED_BG = "#ECEEF2";
const MUTED_BORDER = "#D4D9E3";
const METRICS_BG = "#E5EBF3";
const METRIC_CARD = "#F2F5FA";
const METRIC_BORDER = "#BEC9DA";
const PREFS_BG = "#DDE5F0";

// --- Shared prototype state ---
interface S {
  condition: "A" | "B";
  glutenFree: boolean;
  accomTier: string | null;
  selectedHotel: string | null;
  editApplied: boolean;
}

// --- Chat Message Type ---
export type Message = {
  id: string;
  text: string;
  sender: "user" | "ai";
};

// --- Static data ---
const DAY_HOTELS = {
  zurich: { hotel: "Hotel Adler Zürich", spend: "85 CHF" },
  paris: { hotel: "Hôtel Grands Hommes", spend: "145 CHF" },
  amsterdam: { hotel: "Hotel V Nesplein", spend: "95 CHF" },
  barcelona: { hotel: "Hotel Barcino Central", spend: "110 CHF" },
};
const ACTIVE_PREFS = [
  "Europe",
  "7 Days",
  "1,500 CHF",
  "Diet: Gluten-free",
  "3-Star",
];
const DAY2_BASE = [
  { time: "09:00", name: "Eiffel Tower", note: "~2 hrs" },
  { time: "12:30", name: "Lunch – Café de Flore", note: "GF ✓" },
  { time: "15:00", name: "Louvre Museum", note: "~3 hrs" },
  { time: "19:00", name: "Dinner – Le Comptoir", note: "GF ✓" },
];
const DAY2_UPDATED = [
  { time: "09:00", name: "Eiffel Tower", note: "~2 hrs", changed: false },
  {
    time: "12:30",
    name: "Lunch – Café de Flore",
    note: "GF ✓",
    changed: false,
  },
  { time: "15:00", name: "Musée d'Orsay", note: "~2.5 hrs", changed: true },
  { time: "19:00", name: "Dinner – Le Comptoir", note: "GF ✓", changed: false },
];

// --- Chat primitives ---
function ChatHeader({
  editMode = false,
  onEndSession,
}: {
  editMode?: boolean;
  onEndSession?: () => void;
}) {
  if (editMode) {
    return (
      <div className="flex-shrink-0 border-b border-gray-100 flex justify-between items-center pr-5">
        <div>
          <div className="px-5 py-2.5 flex items-center gap-2">
            <div className="w-2 h-2 rounded-sm" style={{ background: T }} />
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: T }}
            >
              Editing: Day 2
            </span>
          </div>
          <div
            className="px-5 py-1 flex items-center gap-1.5 border-t"
            style={{ background: T_LIGHT, borderColor: T_BORDER }}
          >
            <CornerDownRight
              className="w-3 h-3 flex-shrink-0"
              style={{ color: T }}
            />
            <span className="text-[11px] font-medium" style={{ color: T }}>
              Focused on Day 2 – Paris
            </span>
          </div>
        </div>
        {onEndSession && (
          <button
            onClick={onEndSession}
            className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
          >
            <XCircle className="w-4 h-4" /> End Session
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
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
          className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
        >
          <XCircle className="w-4 h-4" /> End Session
        </button>
      )}
    </div>
  );
}

function AIBubble({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex gap-2.5 mb-3">
      <div
        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
        style={{ background: muted ? "#9CA3AF" : T }}
      >
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div
        className="rounded-2xl rounded-tl-none px-4 py-2.5 text-sm leading-relaxed"
        style={
          muted
            ? {
                background: MUTED_BG,
                border: `1px solid ${MUTED_BORDER}`,
                color: "#9CA3AF",
                maxWidth: "85%",
              }
            : {
                background: BUBBLE_BG,
                border: `1px solid ${BUBBLE_BORDER}`,
                color: "#374151",
                maxWidth: "85%",
              }
        }
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({
  children,
  auto = false,
  muted = false,
}: {
  children: React.ReactNode;
  auto?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-end items-end gap-2 mb-3">
      {auto && !muted && (
        <span className="text-[10px] text-gray-400">via widget ⚡</span>
      )}
      <div
        className="rounded-2xl rounded-tr-none px-4 py-2.5 text-sm leading-relaxed"
        style={{
          background: muted ? "#9CA3AF" : auto ? "#0F9D82" : T,
          color: "white",
          maxWidth: "80%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Unified Chat Input Component
function ChatInputBar({ onSend }: { onSend: (msg: string) => void }) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (text.trim() === "") return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0 bg-white">
      <div
        className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 border"
        style={{ background: "#F9FAFB", borderColor: "#E5E7EB" }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 text-sm bg-transparent outline-none text-gray-700"
        />
        <button
          onClick={handleSend}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-105 flex-shrink-0 cursor-pointer"
          style={{ background: T }}
        >
          <ArrowRight className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
}

// --- Right panel components ---
type MC = {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  green?: boolean;
  red?: boolean;
};
function MetricsGrid({ metrics }: { metrics: MC[] }) {
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
                className="text-[10px] mt-1"
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

const I_N = <span className="text-[10px] text-gray-300">CHF</span>;
const I_BG = <BadgeCheck className="w-3.5 h-3.5 text-gray-300" />;
const I_C = <CalendarDays className="w-3.5 h-3.5 text-gray-400" />;
const M_EMPTY: MC[] = [
  { label: "Est. Cost", value: "0 CHF", sub: "awaiting input", icon: I_N },
  { label: "Satisfied Prefs", value: "0", sub: "none captured", icon: I_BG },
  { label: "Days Planned", value: "4", sub: "Europe route", icon: I_C },
];

function PreferencesSection({
  empty = false,
  tags = [],
}: {
  empty?: boolean;
  tags?: string[];
}) {
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
      {empty ? (
        <p className="text-xs italic" style={{ color: "#7A90AA" }}>
          No extra preferences captured yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
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
  );
}

// ─── 1. ROOT APP COMPONENT (Routing Logic) ────────────────────────────────────

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [state, setState] = useState<S>({
    condition: "B", // Default to Condition B
    glutenFree: false,
    accomTier: null,
    selectedHotel: null,
    editApplied: false,
  });

  const updateState = (patch: Partial<S>) =>
    setState((s) => ({ ...s, ...patch }));

  const endSession = () => {
    // In step 4, the JSON export logic will be triggered here
    setSessionActive(false);
  };

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
          <ConditionAScreen onEndSession={endSession} />
        ) : (
          <ConditionBScreen onEndSession={endSession} />
        )}
      </div>
    </div>
  );
}

// ─── 2. START SCREEN (Setup & Validation) ─────────────────────────────────────

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
  const [participantId, setParticipantId] = useState("");
  const [researcher, setResearcher] = useState("");
  const [validationError, setValidationError] = useState(false);

  const handleLaunch = () => {
    // Validation: Require both inputs before starting
    if (participantId.trim() === "" || researcher.trim() === "") {
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
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-700 bg-white focus:outline-none transition-colors"
              style={{
                width: 100,
                borderColor: validationError && !participantId ? RED : T_BORDER,
              }}
              placeholder="e.g. P-042"
            />
          </label>
          <div className="w-px h-5 bg-gray-200" />
          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Researcher:</span>
            <input
              value={researcher}
              onChange={(e) => setResearcher(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-xs text-gray-700 bg-white focus:outline-none transition-colors"
              style={{
                width: 130,
                borderColor: validationError && !researcher ? RED : "#E5E7EB",
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
                    {cond === "B" && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ background: T }}
                      >
                        Experimental
                      </span>
                    )}
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
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Starting session...
                </>
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

function ConditionAScreen({ onEndSession }: { onEndSession: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (text: string) => {
    const newUserMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
    };
    setMessages((prev) => [...prev, newUserMsg]);

    // In Step 2: Call the Gemini API here
  };

  return (
    <div className="h-full flex flex-col bg-white w-1/2 mx-auto border-x border-gray-200 shadow-xl relative">
      <ChatHeader onEndSession={onEndSession} />

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

      <ChatInputBar onSend={handleSendMessage} />
    </div>
  );
}

// ─── 4. CONDITION B (Socratic Planner) ────────────────────────────────────────

function ConditionBScreen({ onEndSession }: { onEndSession: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      text: "Describe your dream trip and I'll build your personalised itinerary step by step.",
      sender: "ai",
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (text: string) => {
    const newUserMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
    };

    setMessages((prev) => {
      // Remove the initial welcome box if it's the first message from the user
      const filteredMessages = prev.filter((m) => m.id !== "init");
      return [...filteredMessages, newUserMsg];
    });

    // In Step 2: Call the Gemini API here
  };

  return (
    <div className="h-full flex w-full">
      {/* Left Sidebar: Chat */}
      <div className="w-1/3 flex flex-col border-r border-gray-200 flex-shrink-0 bg-white shadow-xl z-10">
        <ChatHeader onEndSession={onEndSession} />

        <div className="flex-1 flex flex-col overflow-y-auto px-5 pt-4 pb-2">
          {messages.map((msg) => {
            if (msg.sender === "user") {
              return <UserBubble key={msg.id}>{msg.text}</UserBubble>;
            } else {
              // Render initial placeholder box
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

        <ChatInputBar onSend={handleSendMessage} />
      </div>

      {/* Right Panel: Socratic Dashboard */}
      <div className="flex-1 flex flex-col" style={{ background: "#F8FAFC" }}>
        <MetricsGrid metrics={M_EMPTY} />

        <div className="flex-1 flex items-center justify-center px-8 relative overflow-y-auto">
          {/* OpenUI components will be rendered here in Step 3 */}
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

        <PreferencesSection empty />
      </div>
    </div>
  );
}

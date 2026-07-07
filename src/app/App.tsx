// @ts-ignore
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
  Map,
} from "lucide-react";

// --- Configuration ---
export const GEMINI_MODEL =
  import.meta.env.VITE_GEMINI_MODEL || "gemini-3.0-pro";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// --- System Prompts & Context Engine ---
const SYSTEM_PROMPT_A = `You are a highly efficient and directive travel assistant.
Your goal is to provide complete, detailed travel itineraries immediately based on the user's request.
Give the user exactly what they ask for in a structured, comprehensive markdown format. Do not ask follow-up questions. Provide the full plan quickly.
Reply in English.`;

const SYSTEM_PROMPT_B = `You are a maieutic, Socratic travel planner.
Your goal is to extract the user's constraints (budget, destination, dates, dietary) step by step, and propose an adaptable itinerary.

CRITICAL RULES FOR SOCRATIC MODE:
1. Ask 1-2 questions to get basics (Destination, Budget, Duration), then PROPOSE a high-level plan.
2. OPENUI GENERATION: You MUST output structured data to drive the UI. Do this by appending a Markdown code block with the language "oui" containing specific tags.
3. ALWAYS include a State Update tag in every response to keep the UI in sync:
   \`\`\`oui
   <UI_StateUpdate cost="number" prefs="number" days="number" plan='[{"day":1,"title":"...","activities":[{"time":"...","name":"...","note":"..."}]}]' />
   \`\`\`
4. When suggesting hotels, add: \`\`\`oui <UI_HotelSelection options='[{"tier":"Budget","price":"80 CHF"},{"tier":"3-Star","price":"150 CHF"}]' /> \`\`\`
5. When the user requests something exceeding the budget (e.g. Helicopter), add: \`\`\`oui <UI_Conflict issue="Budget exceeded by 150 CHF" /> \`\`\`
6. Acknowledge user choices in text, but let the OUI tags drive the dashboard.
Reply in English. Keep text concise.`;

const getTravelContextString = (condition: "A" | "B", state: S) => {
  if (condition === "A")
    return "Context: No active constraints tracked in baseline.";
  return `CURRENT CONTEXT & KNOWN CONSTRAINTS:
- Edit Focus: ${state.focusDay !== null ? `User is editing Day ${state.focusDay}` : "None"}
- Known Preferences: ${state.tags.join(", ") || "None yet"}
Use this context to guide your response.`;
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
const AMBER = "#D97706";
const AMBER_LIGHT = "#FFFBEB";
const AMBER_BORDER = "#FCD34D";
const BUBBLE_BG = "#E9EEF6";
const BUBBLE_BORDER = "#C5CEDC";
const METRICS_BG = "#E5EBF3";
const METRIC_CARD = "#F2F5FA";
const METRIC_BORDER = "#BEC9DA";
const PREFS_BG = "#DDE5F0";

// --- Types ---
type Activity = { time: string; name: string; note: string; changed?: boolean };
type DayPlan = {
  day: number;
  title: string;
  hotel?: string;
  spend?: string;
  warning?: boolean;
  activities: Activity[];
};

interface S {
  condition: "A" | "B";
  participantId: string;
  researcher: string;
  metrics: { cost: string; prefs: string; days: string };
  tags: string[];
  plan: DayPlan[];
  focusDay: number | null;
}

export type Message = {
  id: string;
  text: string; // Raw text
  ouiCode?: string; // Extracted OpenUI Code
  sender: "user" | "ai";
  timestamp: string;
  wordCount: number;
};

// --- Helpers & CSV Export ---
const countWords = (str: string) =>
  str
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
const getTimestamp = () => new Date().toISOString();

const generateCSVAndDownload = (
  state: S,
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
      escapeCSV(state.participantId),
      escapeCSV(state.researcher),
      state.condition,
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
  const link = document.createElement("a");
  link.setAttribute("href", URL.createObjectURL(blob));
  link.setAttribute(
    "download",
    `VoyagerLab_Log_${state.participantId}_Cond${state.condition}_${Date.now()}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- OpenUI Parser ---
const parseMessageContent = (rawText: string) => {
  const ouiRegex = /```oui\n([\s\S]*?)\n```/;
  const match = rawText.match(ouiRegex);
  if (match) {
    return {
      text: rawText.replace(match[0], "").trim(),
      ouiCode: match[1].trim(),
    };
  }
  return { text: rawText, ouiCode: undefined };
};

// --- Streaming API Call with Auto-Retry ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const callGeminiAPIStream = async (
  chatHistory: Message[],
  condition: "A" | "B",
  state: S,
  onChunk: (chunk: string) => void,
) => {
  if (!GEMINI_API_KEY)
    return onChunk("API Key is missing. Set VITE_GEMINI_API_KEY.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  const fullSystemPrompt = `${condition === "A" ? SYSTEM_PROMPT_A : SYSTEM_PROMPT_B}\n\n${getTravelContextString(condition, state)}`;

  const contents = chatHistory
    .filter((m) => m.id !== "init")
    .map((m) => ({
      role: m.sender === "user" ? "user" : "model",
      parts: [
        {
          text: m.text + (m.ouiCode ? `\n\`\`\`oui\n${m.ouiCode}\n\`\`\`` : ""),
        },
      ],
    }));

  let retries = 3,
    delay = 1500;
  while (retries > 0) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: fullSystemPrompt }] },
          contents,
        }),
      });
      if (res.status === 503) throw new Error("503");
      if (!res.body) throw new Error("No body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        chunk.split("\n").forEach((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              onChunk(
                JSON.parse(line.slice(6)).candidates[0].content.parts[0].text,
              );
            } catch (e) {}
          }
        });
      }
      return;
    } catch (err: any) {
      if (err.message === "503" && retries > 1) {
        retries--;
        await sleep(delay);
        delay *= 2;
      } else
        return onChunk("\n*[System: High demand. Attempting to reconnect...]*");
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

// --- OpenUI React Engine ---
// Parses XML-like strings extracted from Gemini's .oui code blocks
function OpenUIRenderer({
  code,
  onAction,
  updateState,
}: {
  code: string;
  onAction: (msg: string) => void;
  updateState: (p: Partial<S>) => void;
}) {
  // Silent State Updater
  useEffect(() => {
    const stateMatch = code.match(
      /<UI_StateUpdate\s+cost="([^"]*)"\s+prefs="([^"]*)"\s+days="([^"]*)"\s+plan='([^']*)'\s*\/>/,
    );
    if (stateMatch) {
      try {
        updateState({
          metrics: {
            cost: stateMatch[1],
            prefs: stateMatch[2],
            days: stateMatch[3],
          },
          plan: JSON.parse(stateMatch[4]),
        });
      } catch (e) {
        console.error("OUI JSON Parse error", e);
      }
    }
  }, [code, updateState]);

  const components = [];

  if (code.includes("<UI_HotelSelection")) {
    components.push(
      <div
        key="hotel"
        className="mt-2 w-full p-4 border border-dashed rounded-xl bg-white"
        style={{ borderColor: T_BORDER }}
      >
        <h4 className="text-xs font-bold uppercase mb-3 text-gray-500 flex items-center gap-1">
          <Zap size={12} color={T} /> Accommodation Options
        </h4>
        <div className="flex gap-2">
          {["Budget", "3-Star", "Luxury"].map((tier) => (
            <button
              key={tier}
              onClick={() => onAction(`I select the ${tier} option.`)}
              className="flex-1 py-2 text-xs font-medium border rounded-lg hover:bg-slate-50 transition-colors"
              style={{ color: T, borderColor: T_BORDER }}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>,
    );
  }

  if (code.includes("<UI_Conflict")) {
    components.push(
      <div
        key="conflict"
        className="mt-2 w-full p-4 rounded-xl border"
        style={{ background: AMBER_LIGHT, borderColor: AMBER_BORDER }}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4" style={{ color: AMBER }} />
          <span className="text-xs font-bold" style={{ color: AMBER }}>
            Constraint Conflict Detected
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onAction("Increase my budget limit.")}
            className="px-3 py-2 text-xs font-bold text-white rounded-lg transition-transform hover:scale-105"
            style={{ background: AMBER }}
          >
            Increase Budget
          </button>
          <button
            onClick={() => onAction("Swap the expensive activity.")}
            className="px-3 py-2 text-xs font-bold text-white rounded-lg transition-transform hover:scale-105"
            style={{ background: T }}
          >
            Swap Activity
          </button>
        </div>
      </div>,
    );
  }

  return <>{components}</>;
}

function ChatMessageRow({
  message,
  state,
  onAction,
  updateState,
}: {
  message: Message;
  state: S;
  onAction: (m: string) => void;
  updateState: (p: Partial<S>) => void;
}) {
  if (message.sender === "user") {
    return (
      <div className="flex justify-end items-end gap-2 mb-4">
        <div
          className="rounded-2xl rounded-tr-none px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm"
          style={{ background: T, color: "white", maxWidth: "80%" }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col mb-5 w-full">
      <div className="flex gap-2.5">
        <div
          className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 shadow-sm"
          style={{ background: T }}
        >
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div
          className="rounded-2xl rounded-tl-none px-5 py-3 text-sm leading-relaxed shadow-sm w-full"
          style={{
            background: BUBBLE_BG,
            border: `1px solid ${BUBBLE_BORDER}`,
            color: "#374151",
          }}
        >
          <div className="prose prose-sm prose-slate max-w-none">
            <ReactMarkdown>{message.text}</ReactMarkdown>
          </div>
        </div>
      </div>
      {/* OUI Components render strictly AFTER the bubble */}
      {message.ouiCode && (
        <div className="ml-9 mt-1 max-w-[85%]">
          <OpenUIRenderer
            code={message.ouiCode}
            onAction={onAction}
            updateState={updateState}
          />
        </div>
      )}
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
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0 bg-white z-10 relative shadow-sm">
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
          onChange={(e) => {
            setText(e.target.value);
            if (textareaRef.current) {
              textareaRef.current.style.height = "auto";
              textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 72)}px`;
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
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
          className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-105 flex-shrink-0 mb-0.5 disabled:pointer-events-none"
          style={{ background: disabled || text.trim() === "" ? "#9CA3AF" : T }}
        >
          <ArrowRight className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
}

// ─── Artifacts & Right Panel ───────────────────────────────────────────────────

function MetricsGrid({ metrics }: { metrics: S["metrics"] }) {
  const mData = [
    {
      label: "Est. Cost",
      value: metrics.cost,
      icon: <span className="text-[10px] text-gray-400">CHF</span>,
    },
    {
      label: "Satisfied Prefs",
      value: metrics.prefs,
      icon: <BadgeCheck className="w-3.5 h-3.5 text-gray-400" />,
    },
    {
      label: "Days Planned",
      value: metrics.days,
      icon: <CalendarDays className="w-3.5 h-3.5 text-gray-400" />,
    },
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
          {mData.map((m) => (
            <div
              key={m.label}
              className="rounded-2xl px-4 py-3 border bg-white"
              style={{ borderColor: METRIC_BORDER }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {m.icon}
                <span className="text-[9px] uppercase tracking-wide text-gray-400">
                  {m.label}
                </span>
              </div>
              <div className="text-2xl font-bold leading-none text-slate-800">
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ItineraryArtifact({
  plan,
  focusDay,
  onSetFocus,
}: {
  plan: DayPlan[];
  focusDay: number | null;
  onSetFocus: (d: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!plan || plan.length === 0)
    return (
      <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
          style={{ background: T_LIGHT }}
        >
          <Map className="w-7 h-7" style={{ color: T }} />
        </div>
        <p className="text-sm text-gray-400 max-w-xs">
          Your AI-generated itinerary artifacts will appear here once proposed.
        </p>
      </div>
    );

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 pb-12 pt-6">
      <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">
        High-Level Itinerary Artifact
      </div>
      {plan.map((d) => (
        <div
          key={d.day}
          className="rounded-2xl overflow-hidden shadow-sm transition-all"
          style={{ border: `2px solid ${focusDay === d.day ? T : "#E2E8F0"}` }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between cursor-pointer bg-white hover:bg-slate-50"
            onClick={() => setExpanded(expanded === d.day ? null : d.day)}
          >
            <div>
              <div
                className="text-sm font-semibold"
                style={{ color: focusDay === d.day ? T : "#374151" }}
              >
                Day {d.day} – {d.title}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {d.activities?.length || 0} activities{" "}
                {d.hotel ? `• Stay: ${d.hotel}` : ""}
              </div>
            </div>
            {expanded === d.day ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            )}
          </div>
          {expanded === d.day && (
            <div className="bg-slate-50 px-4 py-3 border-t border-slate-100">
              <div className="space-y-2 mb-3">
                {d.activities?.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-xl px-2 py-1"
                  >
                    <span className="text-[10px] font-mono text-gray-400 w-11 mt-0.5">
                      {a.time}
                    </span>
                    <span className="flex-1 text-sm text-slate-700">
                      {a.name}
                    </span>
                    <span className="text-xs text-gray-400">{a.note}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetFocus(d.day);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border shadow-sm transition-colors hover:bg-slate-100"
                  style={{ color: T, borderColor: T_BORDER }}
                >
                  <Pencil className="w-3 h-3" />{" "}
                  {focusDay === d.day ? "Currently Editing" : "Edit this day"}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main App Components ─────────────────────────────────────────────────────

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [state, setState] = useState<S>({
    condition: "B",
    participantId: "",
    researcher: "",
    metrics: { cost: "0", prefs: "0", days: "0" },
    tags: [],
    plan: [],
    focusDay: null,
  });

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif", background: "#F1F3F6" }}
    >
      <div className="flex-1 overflow-hidden">
        {!sessionActive ? (
          <SetupScreen
            state={state}
            update={(p) => setState((s) => ({ ...s, ...p }))}
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
            updateState={(p) => setState((s) => ({ ...s, ...p }))}
            onEndSession={() => setSessionActive(false)}
          />
        )}
      </div>
    </div>
  );
}

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
    if (!state.participantId.trim() || !state.researcher.trim())
      return setValidationError(true);
    setValidationError(false);
    setLaunching(true);
    setTimeout(() => {
      setLaunching(false);
      onLaunch();
    }, 700);
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 pb-10">
      <div className="w-full max-w-[560px] bg-white rounded-3xl border border-gray-200 shadow-xl overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-100 bg-slate-50">
          <h2 className="text-xl font-bold text-slate-800">
            Voyager AI Lab Console
          </h2>
        </div>
        <div className="px-8 py-6 space-y-4">
          <div className="flex gap-4">
            <input
              value={state.participantId}
              onChange={(e) => update({ participantId: e.target.value })}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              style={{
                borderColor:
                  validationError && !state.participantId ? RED : "#e2e8f0",
              }}
              placeholder="Participant ID"
            />
            <input
              value={state.researcher}
              onChange={(e) => update({ researcher: e.target.value })}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              style={{
                borderColor:
                  validationError && !state.researcher ? RED : "#e2e8f0",
              }}
              placeholder="Researcher Name"
            />
          </div>
          {(["A", "B"] as const).map((cond) => (
            <label
              key={cond}
              className="flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all"
              style={{
                borderColor: state.condition === cond ? T : "#E5E7EB",
                background: state.condition === cond ? T_LIGHT : "#FAFAFA",
              }}
              onClick={() => update({ condition: cond })}
            >
              <div
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5"
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
              <div className="text-sm font-semibold text-slate-800">
                Condition {cond}{" "}
                {cond === "B" && (
                  <span className="ml-2 text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    Socratic / OpenUI
                  </span>
                )}
              </div>
            </label>
          ))}
          <button
            onClick={handleLaunch}
            className="w-full py-3 rounded-xl text-sm font-bold text-white shadow-md transition-transform hover:scale-[1.02]"
            style={{ background: T }}
          >
            {launching ? "Starting..." : "Launch Session"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConditionAScreen({
  state,
  onEndSession,
}: {
  state: S;
  onEndSession: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const startRef = useRef({ time: Date.now(), str: new Date().toISOString() });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text: string) => {
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

  return (
    <div className="h-full flex flex-col bg-white w-1/2 mx-auto border-x border-gray-200 shadow-2xl relative">
      <ChatHeader
        onEndSession={() => {
          generateCSVAndDownload(
            state,
            startRef.current.str,
            Math.round((Date.now() - startRef.current.time) / 1000),
            messages,
          );
          onEndSession();
        }}
      />
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col">
        {messages.map((m) => (
          <ChatMessageRow
            key={m.id}
            message={m}
            state={state}
            onAction={() => {}}
            updateState={() => {}}
          />
        ))}
        <div ref={endRef} />
      </div>
      <ChatInputBar onSend={handleSend} disabled={isLoading} />
    </div>
  );
}

function ConditionBScreen({
  state,
  updateState,
  onEndSession,
}: {
  state: S;
  updateState: (p: Partial<S>) => void;
  onEndSession: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const startRef = useRef({ time: Date.now(), str: new Date().toISOString() });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text: string) => {
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

    await callGeminiAPIStream(newHistory, "B", state, (chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const { text: cleanText, ouiCode } = parseMessageContent(
          last.text + chunk,
        );
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            text: cleanText,
            ouiCode: ouiCode || last.ouiCode,
            wordCount: countWords(cleanText),
          },
        ];
      });
    });
    setIsLoading(false);
  };

  const setEditFocus = (day: number) => {
    updateState({ focusDay: day });
    handleSend(`I want to edit Day ${day}.`);
  };

  return (
    <div className="h-full flex w-full bg-slate-50">
      <div className="w-1/3 flex flex-col border-r border-gray-200 bg-white shadow-xl z-10 relative">
        <ChatHeader
          onEndSession={() => {
            generateCSVAndDownload(
              state,
              startRef.current.str,
              Math.round((Date.now() - startRef.current.time) / 1000),
              messages,
            );
            onEndSession();
          }}
        />
        <div className="flex-1 flex flex-col overflow-y-auto px-5 pt-5 pb-2">
          {state.focusDay && (
            <div
              className="mb-4 text-xs font-bold text-white py-1.5 px-3 rounded-md self-center flex items-center gap-2"
              style={{ background: T }}
            >
              <Pencil size={12} /> Focus: Editing Day {state.focusDay}
              <button
                onClick={() => updateState({ focusDay: null })}
                className="ml-2 hover:text-red-200"
              >
                <XCircle size={14} />
              </button>
            </div>
          )}
          {messages.map((m) => (
            <ChatMessageRow
              key={m.id}
              message={m}
              state={state}
              onAction={handleSend}
              updateState={updateState}
            />
          ))}
          <div ref={endRef} />
        </div>
        <ChatInputBar onSend={handleSend} disabled={isLoading} />
      </div>

      <div className="w-2/3 flex flex-col">
        <MetricsGrid metrics={state.metrics} />
        <div className="flex-1 px-8 relative overflow-y-auto">
          <ItineraryArtifact
            plan={state.plan}
            focusDay={state.focusDay}
            onSetFocus={setEditFocus}
          />
        </div>
        <div
          className="flex-shrink-0 border-t border-gray-200 px-6 py-3"
          style={{ background: PREFS_BG }}
        >
          <div
            className="text-[9px] font-bold tracking-widest uppercase mb-1.5"
            style={{ color: "#5A7090" }}
          >
            Extracted Constraints
          </div>
          {state.tags.length === 0 ? (
            <p className="text-xs italic" style={{ color: "#7A90AA" }}>
              No preferences captured yet.
            </p>
          ) : (
            <div className="flex gap-1.5">
              {state.tags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white bg-slate-700"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

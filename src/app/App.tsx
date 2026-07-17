import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Hotel,
  Map,
  Pencil,
  Play,
  Sparkles,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import {
  BuiltinActionType,
  Renderer,
  createLibrary,
  defineComponent,
  useIsStreaming,
  useTriggerAction,
  type ActionEvent,
  type ElementNode,
  type OpenUIError,
  type ParseResult,
} from "@openuidev/react-lang";
import { z } from "zod/v4";

// --- Configuration -----------------------------------------------------------
export const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || "gemini-3.0-pro";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// --- Design tokens -----------------------------------------------------------
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

// --- Types -------------------------------------------------------------------
type Condition = "A" | "B";

type UserPreference = {
  label: string;
  value?: string;
  category?: "destination" | "budget" | "duration" | "people" | "diet" | "lodging" | "pace" | "activity" | "transport" | "accessibility" | "other";
  status?: "captured" | "satisfied" | "conflict";
};

type Activity = {
  time: string;
  name: string;
  note?: string;
  cost?: number;
  constraintMatch?: string;
  changed?: boolean;
};

type HotelStay = {
  name: string;
  tier?: string;
  city?: string;
  pricePerNight?: number;
};

type DayPlan = {
  day: number;
  title: string;
  city?: string;
  summary?: string;
  hotel?: HotelStay | null;
  spend?: number;
  warning?: boolean;
  activities: Activity[];
};

type TripState = {
  destination?: string;
  budget?: number;
  currency: string;
  durationDays?: number;
  travelers?: number;
  status?: string;
  preferences: UserPreference[];
  days: DayPlan[];
};

interface S {
  condition: Condition;
  participantId: string;
  researcher: string;
  trip: TripState;
  focusDay: number | null;
}

export type Message = {
  id: string;
  text: string;
  rawText: string;
  openUI?: string;
  sender: "user" | "ai";
  source?: "typed" | "ui_action";
  timestamp: string;
  wordCount: number;
};

type SessionEvent = {
  id: string;
  type:
    | "session_start"
    | "session_end"
    | "chat_user"
    | "chat_ai"
    | "ui_action"
    | "state_update"
    | "api_request"
    | "api_response"
    | "api_error";
  timestamp: string;
  role?: "user" | "ai" | "system";
  messageId?: string;
  source?: string;
  wordCount?: number;
  content?: string;
  metadata?: Record<string, unknown>;
};

type TripPatch = Partial<Omit<TripState, "preferences" | "days">> & {
  preferences?: UserPreference[];
  days?: DayPlan[];
};

type StateUpdate = Partial<S> | ((prev: S) => S);
type StateUpdater = (update: StateUpdate) => void;

// --- OpenUI component library ------------------------------------------------
const PreferenceSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
  category: z
    .enum([
      "destination",
      "budget",
      "duration",
      "people",
      "diet",
      "lodging",
      "pace",
      "activity",
      "transport",
      "accessibility",
      "other",
    ])
    .optional(),
  status: z.enum(["captured", "satisfied", "conflict"]).optional(),
});

const ActivitySchema = z.object({
  time: z.string(),
  name: z.string(),
  note: z.string().optional(),
  cost: z.number().optional(),
  constraintMatch: z.string().optional(),
  changed: z.boolean().optional(),
});

const HotelStaySchema = z.object({
  name: z.string(),
  tier: z.string().optional(),
  city: z.string().optional(),
  pricePerNight: z.number().optional(),
});

const DayPlanSchema = z.object({
  day: z.number(),
  title: z.string(),
  city: z.string().optional(),
  summary: z.string().optional(),
  hotel: HotelStaySchema.nullable().optional(),
  spend: z.number().optional(),
  warning: z.boolean().optional(),
  activities: z.array(ActivitySchema),
});

const StateUpdateComponent = defineComponent({
  name: "StateUpdate",
  description:
    "Hidden state patch for the travel dashboard. Use it in every Socratic response after trip data is known.",
  props: z.object({
    destination: z.string().nullable().optional(),
    budget: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    durationDays: z.number().nullable().optional(),
    travelers: z.number().nullable().optional(),
    preferences: z.array(PreferenceSchema).nullable().optional(),
    days: z.array(DayPlanSchema).nullable().optional(),
    status: z.string().nullable().optional(),
  }),
  component: () => null,
});

const HotelOptionsComponent = defineComponent({
  name: "HotelOptions",
  description:
    "Interactive hotel tier or hotel-card selector. Every option click continues the conversation.",
  props: z.object({
    title: z.string(),
    options: z.array(
      z.object({
        tier: z.string(),
        name: z.string().optional(),
        pricePerNight: z.number().optional(),
        summary: z.string().optional(),
        fit: z.string().optional(),
      }),
    ),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const isStreaming = useIsStreaming();

    return (
      <div className="mt-2 w-full rounded-2xl border border-dashed bg-white p-4 shadow-sm" style={{ borderColor: T_BORDER }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Hotel className="h-4 w-4" style={{ color: T }} />
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{props.title}</h4>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T }}>
            AI-generated
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {props.options.map((option) => {
            const label = option.name ? `${option.tier}: ${option.name}` : option.tier;
            const price = formatMoney(option.pricePerNight);
            return (
              <button
                key={`${option.tier}-${option.name ?? "option"}`}
                disabled={isStreaming}
                onClick={() => triggerAction(`I choose ${label}.`)}
                className="min-h-[112px] rounded-xl border bg-white px-3 py-3 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: T_BORDER }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">{option.tier}</span>
                  {price && <span className="text-xs font-bold" style={{ color: T }}>{price}</span>}
                </div>
                {option.name && <div className="text-xs font-medium text-gray-500">{option.name}</div>}
                {option.summary && <p className="mt-2 text-xs leading-relaxed text-gray-500">{option.summary}</p>}
                {option.fit && <p className="mt-2 text-[11px] font-semibold" style={{ color: T }}>{option.fit}</p>}
              </button>
            );
          })}
        </div>
      </div>
    );
  },
});

const ConflictWarningComponent = defineComponent({
  name: "ConflictWarning",
  description:
    "Visible trade-off or constraint-conflict warning with resolution actions.",
  props: z.object({
    issue: z.string(),
    severity: z.enum(["budget", "time", "preference", "feasibility"]).optional(),
    actions: z.array(z.string()).optional(),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const isStreaming = useIsStreaming();
    const actions = props.actions?.length ? props.actions : ["Prioritize my budget", "Suggest a cheaper alternative"];

    return (
      <div className="mt-2 w-full rounded-2xl border p-4" style={{ background: AMBER_LIGHT, borderColor: AMBER_BORDER }}>
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" style={{ color: AMBER }} />
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: AMBER }}>
            Constraint Conflict
          </span>
          {props.severity && (
            <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase" style={{ color: AMBER }}>
              {props.severity}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-slate-700">{props.issue}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              disabled={isStreaming}
              onClick={() => triggerAction(action)}
              className="rounded-xl px-3 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: action.toLowerCase().includes("budget") ? AMBER : T }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    );
  },
});

const SuggestionChipsComponent = defineComponent({
  name: "SuggestionChips",
  description:
    "Contextual Socratic quick-reply chips that help the user answer or refine the current planning step.",
  props: z.object({
    title: z.string(),
    suggestions: z.array(z.string()),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const isStreaming = useIsStreaming();

    return (
      <div className="mt-2 w-full rounded-2xl border border-dashed bg-white p-4" style={{ borderColor: T_BORDER }}>
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4" style={{ color: T }} />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{props.title}</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              disabled={isStreaming}
              onClick={() => triggerAction(suggestion)}
              className="rounded-full border bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: T_BORDER, color: T }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    );
  },
});

const PreferenceOptionsComponent = defineComponent({
  name: "PreferenceOptions",
  description:
    "A compact choice set for eliciting a preference or constraint with one click.",
  props: z.object({
    question: z.string(),
    options: z.array(z.string()),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const isStreaming = useIsStreaming();

    return (
      <div className="mt-2 w-full rounded-2xl border border-dashed bg-white p-4" style={{ borderColor: T_BORDER }}>
        <p className="mb-3 text-sm font-semibold text-slate-700">{props.question}</p>
        <div className="flex flex-wrap gap-2">
          {props.options.map((option) => (
            <button
              key={option}
              disabled={isStreaming}
              onClick={() => triggerAction(option)}
              className="rounded-xl border px-3 py-2 text-xs font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: T_BORDER, color: T }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  },
});

const TravelUIComponent = defineComponent({
  name: "TravelUI",
  description:
    "Root container for Socratic travel UI widgets. Hidden StateUpdate may be combined with visible widgets.",
  props: z.object({
    children: z.array(
      z.union([
        StateUpdateComponent.ref,
        HotelOptionsComponent.ref,
        ConflictWarningComponent.ref,
        SuggestionChipsComponent.ref,
        PreferenceOptionsComponent.ref,
      ]),
    ),
  }),
  component: ({ props, renderNode }) => (
    <div className="flex w-full flex-col gap-2">{renderNode(props.children)}</div>
  ),
});

const travelOpenUILibrary = createLibrary({
  root: "TravelUI",
  components: [
    TravelUIComponent,
    StateUpdateComponent,
    HotelOptionsComponent,
    ConflictWarningComponent,
    SuggestionChipsComponent,
    PreferenceOptionsComponent,
  ],
  componentGroups: [
    {
      name: "State",
      components: ["StateUpdate"],
      notes: [
        "- StateUpdate is invisible and should be included whenever you know or change trip data.",
        "- Preserve previously known constraints. Do not omit known preferences from StateUpdate.",
      ],
    },
    {
      name: "Interactive Widgets",
      components: ["HotelOptions", "ConflictWarning", "SuggestionChips", "PreferenceOptions"],
      notes: [
        "- Use widgets as standalone blocks below your natural-language answer.",
        "- Every visible widget should help the user make a concrete planning decision.",
      ],
    },
  ],
});

const OPENUI_PROMPT = travelOpenUILibrary.prompt({
  inlineMode: true,
  toolCalls: false,
  bindings: false,
  preamble:
    "You are a Socratic travel-planning assistant that can answer in concise English prose and append OpenUI Lang code for interactive UI widgets.",
  additionalRules: [
    "Use English for all prose and UI labels.",
    "After the user provides 3-4 basics (destination or region, budget, duration, travelers), stop asking broad setup questions and propose a first high-level route.",
    "Ask at most one focused Socratic question at a time before the first route is proposed.",
    "Always append one fenced ```openui-lang code block when the Socratic condition needs to update dashboard state or show widgets.",
    "The fenced OpenUI code must start with root = TravelUI([...]).",
    "Always include StateUpdate in Socratic responses once any travel data is known.",
    "Use numeric CHF values without currency symbols in budget, spend, cost, and pricePerNight fields; currency goes in the currency field.",
    "Use HotelOptions when accommodation tier or hotel choice is useful.",
    "Use ConflictWarning when budget, time, preference, or feasibility constraints collide.",
    "Use SuggestionChips or PreferenceOptions for contextual quick replies, not generic suggestions.",
    "When a focus day is active, treat the user's request as applying only to that day and update only that day in the itinerary.",
  ],
  examples: [
    `I have enough to draft the first route. Here is a compact 7-day Europe loop that stays under your current budget.

\`\`\`openui-lang
root = TravelUI([state, hotels, chips])
state = StateUpdate("Europe", 1500, "CHF", 7, 2, [{label: "Budget", value: "1500 CHF", category: "budget", status: "captured"}, {label: "Duration", value: "7 days", category: "duration", status: "captured"}], [day1, day2], "draft")
day1 = {day: 1, title: "Zurich arrival", city: "Zurich", summary: "Arrival, Old Town walk, relaxed dinner", hotel: {name: "Hotel Adler Zurich", tier: "3-Star", city: "Zurich", pricePerNight: 145}, spend: 245, warning: false, activities: [{time: "15:00", name: "Old Town walk", note: "Low-pressure arrival activity", cost: 0}]}
day2 = {day: 2, title: "Paris highlights", city: "Paris", summary: "Train to Paris and classic sights", hotel: {name: "Hotel des Grands Hommes", tier: "3-Star", city: "Paris", pricePerNight: 155}, spend: 310, warning: false, activities: [{time: "09:00", name: "TGV to Paris", note: "Book early for budget control", cost: 95}]}
hotels = HotelOptions("Accommodation direction", [{tier: "Budget", pricePerNight: 80, summary: "Hostels or simple hotels"}, {tier: "3-Star", pricePerNight: 150, summary: "Best balance for comfort and budget"}, {tier: "Boutique", pricePerNight: 230, summary: "More comfort, less budget margin"}])
chips = SuggestionChips("Refine next", ["Make it slower paced", "Prioritize museums", "Keep hotels central"])
\`\`\``,
    `That helicopter idea is exciting, but it creates a budget trade-off.

\`\`\`openui-lang
root = TravelUI([state, conflict])
state = StateUpdate("Europe", 1500, "CHF", 7, 2, [{label: "Budget", value: "1500 CHF", category: "budget", status: "conflict"}], [day3], "conflict")
day3 = {day: 3, title: "Alpine helicopter option", city: "Interlaken", summary: "Premium scenic flight exceeds current budget", hotel: null, spend: 520, warning: true, activities: [{time: "10:00", name: "Helicopter tour", note: "Over budget unless another item is reduced", cost: 380}]}
conflict = ConflictWarning("The helicopter tour adds about 380 CHF and pushes the plan over the 1500 CHF limit.", "budget", ["Increase budget limit", "Swap another activity", "Find a cheaper scenic alternative"])
\`\`\``,
  ],
});

// --- Prompts and context ------------------------------------------------------
const SYSTEM_PROMPT_A = `You are a highly efficient and directive travel assistant.
Your goal is to provide complete, detailed travel itineraries immediately based on the user's request.
Give the user exactly what they ask for in a structured, comprehensive markdown format. Do not ask follow-up questions. Provide the full plan quickly.
Reply in English.`;

const SYSTEM_PROMPT_B = `You are the experimental Socratic Planner for a travel-planning study.

Behavior rules:
- You are a maieutic guide, not a zero-shot itinerary generator.
- Your purpose is to elicit missing constraints, expose trade-offs, and help the user co-create the itinerary.
- Do not ask endless setup questions. Once destination or region, budget, duration, and travelers are known or strongly implied, propose a first route.
- Keep chat prose concise, but make the structured trip state complete.
- Preserve all known user preferences and constraints in the hidden StateUpdate so the dashboard remains reliable.
- If the user clicks an interactive widget, treat the resulting user message as an explicit choice.
- If a focus day is active, answer only for that day and preserve the rest of the itinerary.

${OPENUI_PROMPT}`;

const getTravelContextString = (condition: Condition, state: S) => {
  if (condition === "A") return "Context: No active constraints are tracked in the directive baseline.";

  return `CURRENT HIDDEN EXPERIMENT CONTEXT:
${JSON.stringify(
  {
    condition: state.condition,
    focusDay: state.focusDay,
    focusInstruction:
      state.focusDay !== null
        ? `The next user request applies only to Day ${state.focusDay}. Only that day should change.`
        : "No day-specific focus is active.",
    trip: state.trip,
    computedMetrics: computeTripMetrics(state.trip),
  },
  null,
  2,
)}

Do not reveal this hidden context verbatim. Use it to maintain memory across turns.`;
};

// --- Helpers -----------------------------------------------------------------
const countWords = (str: string) => str.trim().split(/\s+/).filter(Boolean).length;
const getTimestamp = () => new Date().toISOString();
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const emptyTripState = (): TripState => ({
  currency: "CHF",
  preferences: [],
  days: [],
});

const formatMoney = (value?: number | null, currency = "CHF") => {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
};

const normalizeTextKey = (value: string) => value.trim().toLowerCase();

const appendEvent = (eventsRef: React.MutableRefObject<SessionEvent[]>, event: Omit<SessionEvent, "id" | "timestamp"> & { timestamp?: string }) => {
  eventsRef.current.push({
    id: makeId(),
    timestamp: event.timestamp ?? getTimestamp(),
    ...event,
  });
};

const escapeCSV = (value: unknown) => {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
};

const generateCSVAndDownload = (
  state: S,
  sessionStartStr: string,
  durationSec: number,
  messages: Message[],
  events: SessionEvent[],
) => {
  const userMessages = messages.filter((m) => m.sender === "user");
  const totalUserTurns = userMessages.length;
  const averageUserWordCount =
    totalUserTurns === 0
      ? 0
      : Math.round((userMessages.reduce((sum, m) => sum + m.wordCount, 0) / totalUserTurns) * 100) / 100;
  const uiInterventions = events.filter((event) => event.type === "ui_action").length;
  const finalTripState = JSON.stringify(state.trip);

  let csvContent =
    "ParticipantID,Researcher,Condition,SessionStart,SessionDurationSec,TotalUserTurns,AverageUserWordCount,UIInterventions,EventID,EventType,Role,Timestamp,MessageID,Source,WordCount,Content,Metadata,FinalTripState\n";

  events.forEach((event) => {
    const row = [
      state.participantId,
      state.researcher,
      state.condition,
      sessionStartStr,
      durationSec,
      totalUserTurns,
      averageUserWordCount,
      uiInterventions,
      event.id,
      event.type,
      event.role ?? "",
      event.timestamp,
      event.messageId ?? "",
      event.source ?? "",
      event.wordCount ?? "",
      event.content ?? "",
      event.metadata ?? {},
      finalTripState,
    ].map(escapeCSV);
    csvContent += `${row.join(",")}\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.setAttribute("href", URL.createObjectURL(blob));
  link.setAttribute(
    "download",
    `VoyagerLab_Log_${state.participantId || "unknown"}_Cond${state.condition}_${Date.now()}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const splitAssistantResponse = (rawText: string) => {
  const closedFenceRegex = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  const codeBlocks: string[] = [];
  let text = rawText;
  let match: RegExpExecArray | null;

  while ((match = closedFenceRegex.exec(rawText)) !== null) {
    const language = match[1].toLowerCase();
    if (["openui-lang", "openui", "oui"].includes(language)) {
      codeBlocks.push(match[2].trim());
      text = text.replace(match[0], "");
    }
  }

  if (codeBlocks.length === 0) {
    const openingFence = rawText.match(/```(openui-lang|openui|oui)\s*\n/i);
    if (openingFence?.index !== undefined) {
      const codeStart = openingFence.index + openingFence[0].length;
      const openCode = rawText.slice(codeStart).replace(/```\s*$/, "").trim();
      if (openCode) {
        codeBlocks.push(openCode);
        text = rawText.slice(0, openingFence.index);
      }
    }
  }

  const trimmed = rawText.trim();
  if (codeBlocks.length === 0 && trimmed.startsWith("root =")) {
    return { text: "", openUI: trimmed };
  }

  return {
    text: text.trim(),
    openUI: codeBlocks.length ? codeBlocks.join("\n") : undefined,
  };
};

const getMessageTextForModel = (message: Message) => message.rawText || message.text;

const computeDayCost = (day: DayPlan) => {
  if (typeof day.spend === "number" && !Number.isNaN(day.spend)) return day.spend;
  const activitiesCost = day.activities.reduce((sum, activity) => sum + (activity.cost ?? 0), 0);
  return activitiesCost + (day.hotel?.pricePerNight ?? 0);
};

function computeTripMetrics(trip: TripState) {
  const totalCost = trip.days.reduce((sum, day) => sum + computeDayCost(day), 0);
  const capturedPrefs = trip.preferences.length;
  const satisfiedPrefs = trip.preferences.filter((pref) => pref.status !== "conflict").length;
  const conflicts = trip.preferences.filter((pref) => pref.status === "conflict").length + trip.days.filter((day) => day.warning).length;
  const budgetDelta = typeof trip.budget === "number" ? trip.budget - totalCost : null;

  return {
    totalCost,
    capturedPrefs,
    satisfiedPrefs,
    conflicts,
    daysPlanned: trip.days.length,
    budgetDelta,
  };
}

const metricCardsFromTrip = (trip: TripState) => {
  const metrics = computeTripMetrics(trip);
  const currency = trip.currency || "CHF";
  const hasCost = metrics.totalCost > 0;
  const costSub =
    metrics.budgetDelta === null
      ? hasCost
        ? "budget not set"
        : "awaiting plan"
      : metrics.budgetDelta >= 0
        ? `${formatMoney(metrics.budgetDelta, currency)} under budget`
        : `${formatMoney(Math.abs(metrics.budgetDelta), currency)} over budget`;

  return [
    {
      label: "Est. Cost",
      value: hasCost ? formatMoney(metrics.totalCost, currency) : `0 ${currency}`,
      sub: costSub,
      icon: metrics.budgetDelta !== null && metrics.budgetDelta < 0 ? <AlertTriangle className="h-3.5 w-3.5" style={{ color: RED }} /> : <span className="text-[10px] text-gray-300">{currency}</span>,
      red: metrics.budgetDelta !== null && metrics.budgetDelta < 0,
      green: metrics.budgetDelta !== null && metrics.budgetDelta >= 0 && hasCost,
    },
    {
      label: "Satisfied Prefs",
      value: `${metrics.satisfiedPrefs}`,
      sub: metrics.capturedPrefs ? `${metrics.capturedPrefs} captured${metrics.conflicts ? `, ${metrics.conflicts} conflict` : ""}` : "none captured",
      icon: metrics.conflicts ? <AlertTriangle className="h-3.5 w-3.5" style={{ color: AMBER }} /> : <BadgeCheck className="h-3.5 w-3.5" style={{ color: T }} />,
      red: false,
      green: metrics.satisfiedPrefs > 0 && metrics.conflicts === 0,
    },
    {
      label: "Days Planned",
      value: `${metrics.daysPlanned || 0}`,
      sub: trip.durationDays ? `target: ${trip.durationDays} days` : "duration unknown",
      icon: <CalendarDays className="h-3.5 w-3.5 text-gray-400" />,
      red: false,
      green: trip.durationDays ? metrics.daysPlanned === trip.durationDays : metrics.daysPlanned > 0,
    },
  ];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const asBoolean = (value: unknown) => (typeof value === "boolean" ? value : undefined);

const coercePreferences = (value: unknown): UserPreference[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const label = asString(item.label);
      if (!label) return null;
      return {
        label,
        value: asString(item.value),
        category: asString(item.category) as UserPreference["category"],
        status: asString(item.status) as UserPreference["status"],
      };
    })
    .filter(Boolean) as UserPreference[];
};

const coerceActivities = (value: unknown): Activity[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const time = asString(item.time) ?? "";
      const name = asString(item.name);
      if (!name) return null;
      return {
        time,
        name,
        note: asString(item.note),
        cost: asNumber(item.cost),
        constraintMatch: asString(item.constraintMatch),
        changed: asBoolean(item.changed),
      };
    })
    .filter(Boolean) as Activity[];
};

const coerceHotel = (value: unknown): HotelStay | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const name = asString(value.name);
  if (!name) return undefined;
  return {
    name,
    tier: asString(value.tier),
    city: asString(value.city),
    pricePerNight: asNumber(value.pricePerNight),
  };
};

const coerceDays = (value: unknown): DayPlan[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const day = asNumber(item.day);
      const title = asString(item.title);
      if (!day || !title) return null;
      return {
        day,
        title,
        city: asString(item.city),
        summary: asString(item.summary),
        hotel: coerceHotel(item.hotel),
        spend: asNumber(item.spend),
        warning: asBoolean(item.warning),
        activities: coerceActivities(item.activities),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.day - b.day) as DayPlan[];
};

const tripPatchFromStateNode = (props: Record<string, unknown>): TripPatch => {
  const patch: TripPatch = {};
  const destination = asString(props.destination);
  const budget = asNumber(props.budget);
  const currency = asString(props.currency);
  const durationDays = asNumber(props.durationDays);
  const travelers = asNumber(props.travelers);
  const status = asString(props.status);
  const preferences = coercePreferences(props.preferences);
  const days = coerceDays(props.days);

  if (destination) patch.destination = destination;
  if (budget !== undefined) patch.budget = budget;
  if (currency) patch.currency = currency;
  if (durationDays !== undefined) patch.durationDays = durationDays;
  if (travelers !== undefined) patch.travelers = travelers;
  if (status) patch.status = status;
  if (preferences) patch.preferences = preferences;
  if (days) patch.days = days;

  return patch;
};

const collectStateUpdatePatches = (node: ElementNode | null): TripPatch[] => {
  if (!node) return [];
  const patches: TripPatch[] = [];

  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isRecord(current) || current.type !== "element") return;

    if (current.typeName === "StateUpdate" && isRecord(current.props)) {
      patches.push(tripPatchFromStateNode(current.props));
    }

    if (isRecord(current.props)) {
      Object.values(current.props).forEach(visit);
    }
  };

  visit(node);
  return patches;
};

const combineTripPatches = (patches: TripPatch[]): TripPatch => {
  return patches.reduce<TripPatch>((combined, patch) => {
    return {
      ...combined,
      ...patch,
      preferences: patch.preferences ?? combined.preferences,
      days: patch.days ?? combined.days,
    };
  }, {});
};

const mergePreferences = (existing: UserPreference[], incoming?: UserPreference[]) => {
  if (!incoming) return existing;
  const byLabel = new Map(existing.map((pref) => [normalizeTextKey(pref.label), pref]));
  incoming.forEach((pref) => {
    byLabel.set(normalizeTextKey(pref.label), { ...byLabel.get(normalizeTextKey(pref.label)), ...pref });
  });
  return Array.from(byLabel.values());
};

const mergeDays = (existing: DayPlan[], incoming?: DayPlan[], focusDay?: number | null) => {
  if (!incoming) return existing;
  if (focusDay && existing.length) {
    const incomingFocusDay = incoming.find((day) => day.day === focusDay);
    if (!incomingFocusDay) return existing;
    return existing.map((day) => (day.day === focusDay ? incomingFocusDay : day));
  }
  return incoming;
};

const applyTripPatch = (trip: TripState, patch: TripPatch, focusDay?: number | null): TripState => ({
  ...trip,
  ...patch,
  currency: patch.currency ?? trip.currency ?? "CHF",
  preferences: mergePreferences(trip.preferences, patch.preferences),
  days: mergeDays(trip.days, patch.days, focusDay),
});

// --- Gemini API ---------------------------------------------------------------
class RetryableGeminiError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const callGeminiAPIStream = async (
  chatHistory: Message[],
  condition: Condition,
  state: S,
  onChunk: (chunk: string) => void,
  eventsRef?: React.MutableRefObject<SessionEvent[]>,
) => {
  if (!GEMINI_API_KEY) {
    const missingKeyMessage = "API key is missing. Set VITE_GEMINI_API_KEY in .env.local.";
    onChunk(missingKeyMessage);
    return missingKeyMessage;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  const fullSystemPrompt = `${condition === "A" ? SYSTEM_PROMPT_A : SYSTEM_PROMPT_B}\n\n${getTravelContextString(condition, state)}`;
  const contents = chatHistory.map((message) => ({
    role: message.sender === "user" ? "user" : "model",
    parts: [{ text: getMessageTextForModel(message) }],
  }));

  const requestPayload = {
    system_instruction: { parts: [{ text: fullSystemPrompt }] },
    contents,
  };

  console.groupCollapsed(`[VoyagerLab] Gemini request ${new Date().toLocaleTimeString()}`);
  console.log("Model", GEMINI_MODEL);
  console.log("System prompt", fullSystemPrompt);
  console.log("Complete history", contents);
  console.log("Request payload", requestPayload);
  console.groupEnd();

  appendEventIfAvailable(eventsRef, {
    type: "api_request",
    role: "system",
    content: "Gemini request",
    metadata: { model: GEMINI_MODEL, systemPrompt: fullSystemPrompt, contents },
  });

  let retries = 4;
  let delay = 1500;
  let rawResponse = "";

  while (retries > 0) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const retryable = response.status === 503 || /high demand|overloaded|temporarily unavailable/i.test(errorText);
        if (retryable) throw new RetryableGeminiError(errorText || `HTTP ${response.status}`);
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error("Gemini response did not include a body.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        chunk.split("\n").forEach((line) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";
            if (text) {
              rawResponse += text;
              onChunk(text);
            }
          } catch (error) {
            console.warn("[VoyagerLab] Could not parse Gemini SSE line", line, error);
          }
        });
      }

      console.groupCollapsed(`[VoyagerLab] Gemini raw response ${new Date().toLocaleTimeString()}`);
      console.log(rawResponse);
      console.groupEnd();

      appendEventIfAvailable(eventsRef, {
        type: "api_response",
        role: "ai",
        content: rawResponse,
        metadata: { model: GEMINI_MODEL },
      });

      return rawResponse;
    } catch (error) {
      if (error instanceof RetryableGeminiError && retries > 1) {
        retries -= 1;
        console.info(`[VoyagerLab] Gemini high-demand response. Retrying in ${delay} ms.`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      const message = error instanceof Error ? error.message : "Unknown Gemini error";
      console.error("[VoyagerLab] Gemini request failed", error);
      appendEventIfAvailable(eventsRef, {
        type: "api_error",
        role: "system",
        content: message,
      });

      const visibleMessage =
        error instanceof RetryableGeminiError
          ? "The assistant is still reconnecting. Please try again in a moment."
          : `System error: ${message}`;
      onChunk(visibleMessage);
      return rawResponse || visibleMessage;
    }
  }

  return rawResponse;
};

const appendEventIfAvailable = (
  eventsRef: React.MutableRefObject<SessionEvent[]> | undefined,
  event: Omit<SessionEvent, "id" | "timestamp">,
) => {
  if (eventsRef) appendEvent(eventsRef, event);
};

// --- UI primitives ------------------------------------------------------------
function ChatHeader({ onEndSession }: { onEndSession?: () => void }) {
  return (
    <div className="relative z-10 flex flex-shrink-0 items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ background: T }}>
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-800">Voyager AI</span>
      </div>
      {onEndSession && (
        <button
          onClick={onEndSession}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
        >
          <XCircle className="h-4 w-4" />
          End Session
        </button>
      )}
    </div>
  );
}

function FocusBanner({ day, onCancel }: { day: number; onCancel: () => void }) {
  return (
    <div className="z-10 flex flex-shrink-0 items-center justify-between border-b px-5 py-2.5" style={{ background: T_LIGHT, borderColor: T_BORDER }}>
      <div className="flex items-center gap-2">
        <Pencil className="h-3.5 w-3.5" style={{ color: T }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T }}>
          Focus: Editing Day {day}
        </span>
      </div>
      <button
        onClick={onCancel}
        className="flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-slate-50"
        style={{ color: T, borderColor: T_BORDER }}
      >
        <XCircle className="h-3.5 w-3.5" />
        Cancel
      </button>
    </div>
  );
}

function ChatMessageRow({
  message,
  isStreaming,
  onOpenUIAction,
  onTripPatch,
}: {
  message: Message;
  isStreaming?: boolean;
  onOpenUIAction: (event: ActionEvent) => void;
  onTripPatch: (patch: TripPatch, messageId: string) => void;
}) {
  const lastPatchSignature = useRef<string>("");

  if (message.sender === "user") {
    return (
      <div className="mb-4 flex items-end justify-end gap-2">
        {message.source === "ui_action" && <span className="pb-1 text-[10px] text-gray-400">via widget</span>}
        <div className="rounded-2xl rounded-tr-none px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm" style={{ background: T, maxWidth: "80%" }}>
          {message.text}
        </div>
      </div>
    );
  }

  const handleParseResult = (result: ParseResult | null) => {
    const patches = collectStateUpdatePatches(result?.root ?? null);
    if (!patches.length) return;
    const patch = combineTripPatches(patches);
    const signature = JSON.stringify(patch);
    if (!signature || signature === lastPatchSignature.current) return;
    lastPatchSignature.current = signature;
    onTripPatch(patch, message.id);
  };

  return (
    <div className="mb-5 flex w-full flex-col">
      {message.text.trim() && (
        <div className="flex gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full shadow-sm" style={{ background: T }}>
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="w-full rounded-2xl rounded-tl-none px-5 py-3 text-sm leading-relaxed shadow-sm" style={{ background: BUBBLE_BG, border: `1px solid ${BUBBLE_BORDER}`, color: "#374151" }}>
            <div className="prose prose-sm prose-slate max-w-none">
              <ReactMarkdown>{message.text}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
      {message.openUI && (
        <div className={`${message.text.trim() ? "ml-9" : ""} mt-1 max-w-[92%]`}>
          <Renderer
            response={message.openUI}
            library={travelOpenUILibrary}
            isStreaming={isStreaming}
            onAction={onOpenUIAction}
            onParseResult={handleParseResult}
            onError={(errors: OpenUIError[]) => {
              if (errors.length) console.warn("[VoyagerLab] OpenUI render errors", errors);
            }}
          />
        </div>
      )}
    </div>
  );
}

function ChatInputBar({ onSend, disabled }: { onSend: (message: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (text.trim() === "" || disabled) return;
    onSend(text.trim());
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="relative z-10 flex-shrink-0 border-t border-gray-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-end gap-2.5 rounded-xl border px-4 py-2.5 transition-opacity" style={{ background: "#F9FAFB", borderColor: "#E5E7EB", opacity: disabled ? 0.6 : 1 }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (textareaRef.current) {
              textareaRef.current.style.height = "auto";
              textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 72)}px`;
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
          placeholder={disabled ? "AI is typing..." : "Type a message..."}
          className="flex-1 resize-none bg-transparent py-1 text-sm text-gray-700 outline-none"
          style={{ minHeight: 28, maxHeight: 72 }}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={disabled || text.trim() === ""}
          className="mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 disabled:pointer-events-none"
          style={{ background: disabled || text.trim() === "" ? "#9CA3AF" : T }}
        >
          <ArrowRight className="h-4 w-4 text-white" />
        </button>
      </div>
    </div>
  );
}

// --- Right panel --------------------------------------------------------------
function MetricsGrid({ trip }: { trip: TripState }) {
  const metrics = metricCardsFromTrip(trip);

  return (
    <div className="flex-shrink-0 border-b border-gray-200" style={{ background: METRICS_BG }}>
      <div className="px-6 py-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" style={{ color: T }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T }}>
            Live Trip Performance
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border px-4 py-3"
              style={
                metric.red
                  ? { background: RED_LIGHT, borderColor: RED_BORDER }
                  : metric.green
                    ? { background: GREEN_LIGHT, borderColor: GREEN_BORDER }
                    : { background: METRIC_CARD, borderColor: METRIC_BORDER }
              }
            >
              <div className="mb-1 flex items-center gap-1.5">
                {metric.icon}
                <span className="text-[9px] uppercase tracking-wide text-gray-400">{metric.label}</span>
              </div>
              <div className="break-words text-2xl font-bold leading-none" style={{ color: metric.red ? RED : metric.green ? GREEN : "#1A1D23" }}>
                {metric.value}
              </div>
              <div className="mt-1 text-[10px]" style={{ color: metric.red ? RED : metric.green ? GREEN : "#9CA3AF" }}>
                {metric.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ItineraryArtifact({
  trip,
  focusDay,
  onSetFocus,
}: {
  trip: TripState;
  focusDay: number | null;
  onSetFocus: (day: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (trip.days.length && expanded === null) setExpanded(trip.days[0].day);
  }, [expanded, trip.days]);

  if (!trip.days.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center opacity-70">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: T_LIGHT }}>
          <Map className="h-7 w-7" style={{ color: T }} />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-gray-400">
          Your AI-generated itinerary and live tracking metrics will appear here once the first route is proposed.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 pb-12 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Itinerary</div>
          <h2 className="text-lg font-semibold text-slate-800">{trip.destination || "Current trip plan"}</h2>
        </div>
        {trip.status && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-500 shadow-sm">{trip.status}</span>}
      </div>

      {trip.days.map((day) => {
        const isOpen = expanded === day.day;
        const dayCost = computeDayCost(day);
        return (
          <div
            key={day.day}
            className="overflow-hidden rounded-2xl border bg-white shadow-sm transition-all"
            style={{ borderWidth: focusDay === day.day ? 2 : 1, borderColor: focusDay === day.day ? T : day.warning ? RED_BORDER : "#E2E8F0" }}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : day.day)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
              style={{ background: focusDay === day.day ? T_LIGHT : "white" }}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" style={{ color: day.warning ? RED : focusDay === day.day ? T : "#374151" }}>
                  Day {day.day}: {day.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-400">
                  {day.city ? `${day.city} - ` : ""}
                  {day.activities.length} activities
                  {day.hotel?.name ? ` - Stay: ${day.hotel.name}` : ""}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                {dayCost > 0 && <span className="text-xs font-semibold" style={{ color: day.warning ? RED : T }}>{formatMoney(dayCost, trip.currency)}</span>}
                {day.warning ? <AlertTriangle className="h-4 w-4" style={{ color: RED }} /> : isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                {(day.summary || day.hotel) && (
                  <div className="mb-3 grid gap-2 sm:grid-cols-2">
                    {day.summary && <p className="rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-gray-500">{day.summary}</p>}
                    {day.hotel && (
                      <div className="rounded-xl bg-white px-3 py-2 text-xs text-gray-500">
                        <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
                          <Hotel className="h-3.5 w-3.5" />
                          {day.hotel.name}
                        </div>
                        <div>
                          {[day.hotel.tier, day.hotel.city, formatMoney(day.hotel.pricePerNight, trip.currency)].filter(Boolean).join(" - ")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mb-3 space-y-2">
                  {day.activities.map((activity, index) => (
                    <div key={`${activity.time}-${activity.name}-${index}`} className="flex items-start gap-3 rounded-xl bg-white px-3 py-2" style={activity.changed ? { background: GREEN_LIGHT } : undefined}>
                      <span className="mt-0.5 w-12 flex-shrink-0 font-mono text-[10px] text-gray-400">{activity.time || "--:--"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium" style={{ color: activity.changed ? GREEN : "#374151" }}>{activity.name}</div>
                        {activity.note && <div className="text-xs text-gray-400">{activity.note}</div>}
                      </div>
                      {typeof activity.cost === "number" && <span className="flex-shrink-0 text-xs font-semibold" style={{ color: T }}>{formatMoney(activity.cost, trip.currency)}</span>}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end border-t border-gray-100 pt-2.5">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetFocus(day.day);
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors"
                    style={focusDay === day.day ? { background: T, color: "white" } : { border: `1.5px solid ${T}`, color: T, background: "white" }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {focusDay === day.day ? "Currently editing" : "Edit this day"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PreferencesSection({ trip }: { trip: TripState }) {
  const tags = trip.preferences;
  return (
    <div className="flex-shrink-0 border-t border-gray-200 px-6 py-3" style={{ background: PREFS_BG }}>
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#5A7090" }}>
        Active User Preferences / Constraints
      </div>
      {tags.length === 0 ? (
        <p className="text-xs italic" style={{ color: "#7A90AA" }}>
          No preferences captured yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const conflict = tag.status === "conflict";
            return (
              <span
                key={`${tag.label}-${tag.value ?? ""}`}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                style={{ background: conflict ? AMBER : T }}
                title={[tag.category, tag.value].filter(Boolean).join(": ")}
              >
                {conflict ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                {tag.value ? `${tag.label}: ${tag.value}` : tag.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Main app ----------------------------------------------------------------
export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [state, setState] = useState<S>({
    condition: "B",
    participantId: "",
    researcher: "",
    trip: emptyTripState(),
    focusDay: null,
  });

  const updateState: StateUpdater = (update) => {
    setState((previous) => (typeof update === "function" ? update(previous) : { ...previous, ...update }));
  };

  const resetSession = () => {
    updateState((previous) => ({
      ...previous,
      trip: emptyTripState(),
      focusDay: null,
    }));
    setSessionActive(false);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ fontFamily: "'Inter', sans-serif", background: "#F1F3F6" }}>
      <div className="flex-1 overflow-hidden">
        {!sessionActive ? (
          <SetupScreen state={state} update={updateState} onLaunch={() => setSessionActive(true)} />
        ) : state.condition === "A" ? (
          <ConditionAScreen state={state} onEndSession={resetSession} />
        ) : (
          <ConditionBScreen state={state} updateState={updateState} onEndSession={resetSession} />
        )}
      </div>
    </div>
  );
}

function SetupScreen({ state, update, onLaunch }: { state: S; update: StateUpdater; onLaunch: () => void }) {
  const [launching, setLaunching] = useState(false);
  const [validationError, setValidationError] = useState(false);

  const handleLaunch = () => {
    if (!state.participantId.trim() || !state.researcher.trim()) {
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
    <div className="flex h-full flex-col" style={{ background: "#F1F3F6" }}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" style={{ color: T }} />
          <span className="text-sm font-bold text-gray-700">VoyagerLab Research Console</span>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Participant ID:</span>
            <input
              className="rounded-lg border bg-white px-2.5 py-1.5 font-mono text-xs text-gray-700 focus:outline-none"
              style={{ width: 80, borderColor: validationError && !state.participantId.trim() ? RED : T_BORDER }}
              value={state.participantId}
              onChange={(event) => update({ participantId: event.target.value })}
              placeholder="P-042"
            />
          </label>
          <div className="h-5 w-px bg-gray-200" />
          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Researcher:</span>
            <input
              className="rounded-lg border bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none"
              style={{ width: 130, borderColor: validationError && !state.researcher.trim() ? RED : "#E5E7EB" }}
              value={state.researcher}
              onChange={(event) => update({ researcher: event.target.value })}
              placeholder="Dr. M. Petit"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-[560px] overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-8 py-6" style={{ background: T_LIGHT }}>
            <div className="mb-1 text-xs font-bold uppercase tracking-widest" style={{ color: T }}>
              Experimental Setup
            </div>
            <h2 className="text-2xl font-semibold text-gray-800">Researcher Control Panel</h2>
            <p className="mt-1 text-sm text-gray-500">Select the condition to activate for this participant session.</p>
          </div>
          <div className="space-y-4 px-8 py-6">
            {(["A", "B"] as const).map((condition) => (
              <label
                key={condition}
                className="flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition-all"
                style={{
                  borderColor: state.condition === condition ? T : "#E5E7EB",
                  background: state.condition === condition ? T_LIGHT : "#FAFAFA",
                }}
                onClick={() => update({ condition })}
              >
                <div
                  className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                  style={{ borderColor: state.condition === condition ? T : "#D1D5DB" }}
                >
                  {state.condition === condition && <div className="h-2.5 w-2.5 rounded-full" style={{ background: T }} />}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: state.condition === condition ? T : "#374151" }}>
                      Condition {condition} - {condition === "A" ? "Directive Vanilla LLM Baseline" : "Maieutic Socratic Planner"}
                    </span>
                    {condition === "B" && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: T }}>
                        Experimental
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {condition === "A"
                      ? "Standard prompt-response. Full itinerary generated instantly. No interactive UI or preference capture."
                      : "AI-guided preference elicitation with dynamic UI, live metrics grid, and conflict resolution protocols."}
                  </div>
                </div>
              </label>
            ))}
            <button
              onClick={handleLaunch}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white transition-opacity"
              style={{ background: T, opacity: launching ? 0.75 : 1 }}
            >
              {launching ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Starting session...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
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

function ConditionAScreen({ state, onEndSession }: { state: S; onEndSession: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const eventsRef = useRef<SessionEvent[]>([]);
  const startRef = useRef({ time: Date.now(), str: new Date().toISOString() });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    appendEvent(eventsRef, { type: "session_start", role: "system", content: "Condition A session started" });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text: string) => {
    const userMsg: Message = {
      id: makeId(),
      text,
      rawText: text,
      sender: "user",
      source: "typed",
      timestamp: getTimestamp(),
      wordCount: countWords(text),
    };
    const newHistory = [...messagesRef.current, userMsg];
    messagesRef.current = newHistory;
    setMessages(newHistory);
    appendEvent(eventsRef, { type: "chat_user", role: "user", messageId: userMsg.id, source: "typed", wordCount: userMsg.wordCount, content: text });

    setIsLoading(true);
    const aiMsgId = makeId();
    const aiPlaceholder: Message = { id: aiMsgId, text: "", rawText: "", sender: "ai", timestamp: getTimestamp(), wordCount: 0 };
    messagesRef.current = [...newHistory, aiPlaceholder];
    setMessages(messagesRef.current);

    const rawResponse = await callGeminiAPIStream(newHistory, "A", state, (chunk) => {
      setMessages((previous) => {
        const updated = previous.map((message) => {
          if (message.id !== aiMsgId) return message;
          const rawText = message.rawText + chunk;
          return { ...message, text: rawText, rawText, wordCount: countWords(rawText) };
        });
        messagesRef.current = updated;
        return updated;
      });
    }, eventsRef);

    appendEvent(eventsRef, { type: "chat_ai", role: "ai", messageId: aiMsgId, content: rawResponse, wordCount: countWords(rawResponse) });
    setIsLoading(false);
  };

  const handleEndSession = () => {
    const durationSec = Math.round((Date.now() - startRef.current.time) / 1000);
    appendEvent(eventsRef, {
      type: "session_end",
      role: "system",
      content: "Condition A session ended",
      metadata: { durationSec },
    });
    generateCSVAndDownload(state, startRef.current.str, durationSec, messagesRef.current, eventsRef.current);
    onEndSession();
  };

  return (
    <div className="relative mx-auto flex h-full w-1/2 flex-col border-x border-gray-200 bg-white shadow-2xl">
      <ChatHeader onEndSession={handleEndSession} />
      <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
        {messages.length === 0 && (
          <div className="mt-auto rounded-2xl border-2 border-dashed border-gray-200 px-8 py-10 text-center" style={{ background: "#FAFAFA" }}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: T_LIGHT }}>
              <Sparkles className="h-6 w-6" style={{ color: T }} />
            </div>
            <p className="text-sm leading-relaxed text-gray-400">Enter the participant's travel request to start the directive baseline conversation.</p>
          </div>
        )}
        {messages.map((message) => (
          <ChatMessageRow key={message.id} message={message} isStreaming={isLoading && message.id === messages[messages.length - 1]?.id} onOpenUIAction={() => undefined} onTripPatch={() => undefined} />
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
  updateState: StateUpdater;
  onEndSession: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const stateRef = useRef(state);
  const eventsRef = useRef<SessionEvent[]>([]);
  const startRef = useRef({ time: Date.now(), str: new Date().toISOString() });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    appendEvent(eventsRef, { type: "session_start", role: "system", content: "Condition B session started" });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, state.focusDay]);

  const applyOpenUITripPatch = (patch: TripPatch, messageId: string) => {
    updateState((previous) => ({
      ...previous,
      trip: applyTripPatch(previous.trip, patch, previous.focusDay),
    }));
    appendEvent(eventsRef, {
      type: "state_update",
      role: "system",
      messageId,
      content: "OpenUI StateUpdate applied",
      metadata: patch,
    });
  };

  const handleSend = async (text: string, source: "typed" | "ui_action" = "typed") => {
    const userMsg: Message = {
      id: makeId(),
      text,
      rawText: text,
      sender: "user",
      source,
      timestamp: getTimestamp(),
      wordCount: countWords(text),
    };
    const newHistory = [...messagesRef.current, userMsg];
    messagesRef.current = newHistory;
    setMessages(newHistory);
    appendEvent(eventsRef, { type: "chat_user", role: "user", messageId: userMsg.id, source, wordCount: userMsg.wordCount, content: text });

    setIsLoading(true);
    const aiMsgId = makeId();
    const aiPlaceholder: Message = { id: aiMsgId, text: "", rawText: "", sender: "ai", timestamp: getTimestamp(), wordCount: 0 };
    messagesRef.current = [...newHistory, aiPlaceholder];
    setMessages(messagesRef.current);

    const rawResponse = await callGeminiAPIStream(newHistory, "B", stateRef.current, (chunk) => {
      setMessages((previous) => {
        const updated = previous.map((message) => {
          if (message.id !== aiMsgId) return message;
          const rawText = message.rawText + chunk;
          const parsed = splitAssistantResponse(rawText);
          return {
            ...message,
            rawText,
            text: parsed.text,
            openUI: parsed.openUI ?? message.openUI,
            wordCount: countWords(parsed.text),
          };
        });
        messagesRef.current = updated;
        return updated;
      });
    }, eventsRef);

    appendEvent(eventsRef, { type: "chat_ai", role: "ai", messageId: aiMsgId, content: rawResponse, wordCount: countWords(rawResponse) });
    setIsLoading(false);
  };

  const handleOpenUIAction = (event: ActionEvent) => {
    const message =
      event.humanFriendlyMessage ||
      (event.type === BuiltinActionType.ContinueConversation && typeof event.params?.message === "string" ? event.params.message : "Continue");

    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "openui",
      content: message,
      metadata: {
        actionType: event.type,
        params: event.params,
        formName: event.formName,
        formState: event.formState,
      },
    });

    void handleSend(message, "ui_action");
  };

  const setEditFocus = (day: number) => {
    updateState({ focusDay: day });
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "itinerary_focus",
      content: `Focus editing Day ${day}`,
      metadata: { day },
    });
  };

  const cancelFocus = () => {
    const previousFocus = stateRef.current.focusDay;
    updateState({ focusDay: null });
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "focus_cancel",
      content: "Cancel focus mode",
      metadata: { previousFocus },
    });
  };

  const handleEndSession = () => {
    const durationSec = Math.round((Date.now() - startRef.current.time) / 1000);
    appendEvent(eventsRef, {
      type: "session_end",
      role: "system",
      content: "Condition B session ended",
      metadata: { durationSec, trip: stateRef.current.trip },
    });
    generateCSVAndDownload(stateRef.current, startRef.current.str, durationSec, messagesRef.current, eventsRef.current);
    onEndSession();
  };

  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <div className="grid h-full w-full bg-slate-50" style={{ gridTemplateColumns: "minmax(320px, 1fr) minmax(0, 2fr)" }}>
      <div className="relative z-10 flex min-w-0 flex-col border-r border-gray-200 bg-white shadow-xl">
        <ChatHeader onEndSession={handleEndSession} />
        {state.focusDay && <FocusBanner day={state.focusDay} onCancel={cancelFocus} />}
        <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-2 pt-5">
          {messages.length === 0 && (
            <div className="mt-auto rounded-2xl border-2 border-dashed border-gray-200 px-8 py-10 text-center" style={{ background: "#FAFAFA" }}>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: T_LIGHT }}>
                <Sparkles className="h-6 w-6" style={{ color: T }} />
              </div>
              <p className="text-sm leading-relaxed text-gray-400">
                Describe your trip and Voyager AI will build the itinerary step by step.
              </p>
            </div>
          )}
          {messages.map((message) => (
            <ChatMessageRow
              key={message.id}
              message={message}
              isStreaming={isLoading && message.id === lastMessageId}
              onOpenUIAction={handleOpenUIAction}
              onTripPatch={applyOpenUITripPatch}
            />
          ))}
          <div ref={endRef} />
        </div>
        <ChatInputBar onSend={(message) => handleSend(message, "typed")} disabled={isLoading} />
      </div>

      <div className="flex min-w-0 flex-col">
        <MetricsGrid trip={state.trip} />
        <div className="relative flex-1 overflow-y-auto px-8">
          <ItineraryArtifact trip={state.trip} focusDay={state.focusDay} onSetFocus={setEditFocus} />
        </div>
        <PreferencesSection trip={state.trip} />
      </div>
    </div>
  );
}

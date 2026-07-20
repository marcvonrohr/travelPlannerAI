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
  ClipboardCheck,
  Download,
  FlaskConical,
  Hotel,
  Map as MapIcon,
  Pencil,
  Play,
  Sparkles,
  Terminal,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import {
  BuiltinActionType,
  Renderer,
  createLibrary,
  createParser,
  defineComponent,
  useIsStreaming,
  useTriggerAction,
  type ActionEvent,
  type ElementNode,
  type OpenUIError,
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
  endTime?: string;
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
  location?: string;
  summary?: string;
  hotel?: HotelStay | null;
  spend?: number;
  warning?: boolean;
  completed?: boolean;
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

type FocusTarget =
  | { type: "trip"; label: string }
  | { type: "day"; day: number; label: string }
  | { type: "hotel"; day: number; label: string }
  | { type: "activity"; day: number; activityIndex: number; activityName: string; label: string };

interface S {
  condition: Condition;
  participantId: string;
  researcher: string;
  trip: TripState;
  focus: FocusTarget | null;
}

export type Message = {
  id: string;
  text: string;
  rawText: string;
  openUI?: string;
  openUIError?: string;
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

type PendingEdit = {
  id: string;
  messageId: string;
  patch: TripPatch;
  focus: FocusTarget;
  userText?: string;
};

type PendingDayAction = (day: number) => void;

type CoverageIssue = {
  id: string;
  severity: "missing" | "warning";
  label: string;
  detail: string;
  day?: number;
};

type CoverageSummary = {
  total: number;
  missing: number;
  warnings: number;
  preferenceConflicts: number;
  missingCosts: number;
  missingEndTimes: number;
  missingActionableDetails: number;
  missingMeals: number;
  missingTransport: number;
  missingLodging: number;
  arrivalReturnGaps: number;
  affectedDays: number[];
};

type ResearchConsoleEntry = {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  payload?: unknown;
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
  endTime: z.string().optional(),
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
  location: z.string().optional(),
  summary: z.string().optional(),
  hotel: HotelStaySchema.nullable().optional(),
  spend: z.number().optional(),
  warning: z.boolean().optional(),
  completed: z.boolean().optional(),
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
    "Interactive selector for concrete named hotel or lodging cards. Every option click continues the conversation.",
  props: z.object({
    title: z.string(),
    options: z.array(
      z.object({
        tier: z.string(),
        name: z.string().optional(),
        city: z.string().optional(),
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
            const isConcreteStay = Boolean(option.name?.trim());
            const label = option.name ? `${option.tier}: ${option.name}` : option.tier;
            const price = formatMoney(option.pricePerNight);
            const location = option.city ? ` in ${option.city}` : "";
            const actionText = isConcreteStay
              ? `I choose ${label}${location}${price ? ` at about ${price} per night` : ""}.`
              : `The ${option.tier} accommodation style fits me${price ? ` at about ${price} per night` : ""}. Please suggest concrete named hotels or lodgings for the applicable days before adding anything to the itinerary.`;
            return (
              <button
                key={`${option.tier}-${option.name ?? "option"}`}
                disabled={isStreaming}
                onClick={() => triggerAction(actionText)}
                className="min-h-[112px] rounded-xl border bg-white px-3 py-3 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: T_BORDER }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">{option.tier}</span>
                  {price && <span className="text-xs font-bold" style={{ color: T }}>{price}</span>}
                </div>
                {option.name && <div className="text-xs font-medium text-gray-500">{[option.name, option.city].filter(Boolean).join(" - ")}</div>}
                {!option.name && (
                  <div className="text-[11px] font-semibold" style={{ color: AMBER }}>
                    Style preference only - concrete stay needed
                  </div>
                )}
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

const QuickPreferencesComponent = defineComponent({
  name: "QuickPreferences",
  description:
    "Compact preference widget for dietary needs and accommodation tier or nightly budget range. Use only after asking a relevant preference question.",
  props: z.object({
    title: z.string().optional(),
    dietary: z.array(z.object({ label: z.string(), selected: z.boolean().optional() })).optional(),
    accommodationTiers: z.array(z.string()).optional(),
    selectedTier: z.string().optional(),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    selectedPrice: z.number().optional(),
    currency: z.string().optional(),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const isStreaming = useIsStreaming();
    const dietary = (props.dietary ?? []).filter((item) => item.label.trim());
    const tiers = (props.accommodationTiers ?? []).filter((tier) => tier.trim());
    const numericPrices = [props.minPrice, props.maxPrice, props.selectedPrice].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
    );
    const sortedPrices = numericPrices.length ? [...numericPrices].sort((a, b) => a - b) : [];
    const normalizedMinPrice = sortedPrices[0];
    const normalizedMaxPrice = sortedPrices.length ? sortedPrices[sortedPrices.length - 1] : undefined;
    const selectedPriceCandidate =
      typeof props.selectedPrice === "number" && Number.isFinite(props.selectedPrice) && props.selectedPrice > 0
        ? props.selectedPrice
        : normalizedMaxPrice ?? normalizedMinPrice;
    const hasPlausiblePrice =
      typeof normalizedMinPrice === "number" &&
      typeof normalizedMaxPrice === "number" &&
      normalizedMinPrice < 1000 &&
      normalizedMaxPrice < 1000 &&
      !(normalizedMinPrice === normalizedMaxPrice && normalizedMinPrice >= 500);
    const hasDietary = dietary.length > 0;
    const hasAccommodation = tiers.length > 0 || Boolean(props.selectedTier?.trim()) || hasPlausiblePrice;
    const currency = props.currency || "CHF";
    const [selectedDietary, setSelectedDietary] = useState<string[]>(() => dietary.filter((item) => item.selected).map((item) => item.label));
    const [selectedTier, setSelectedTier] = useState(props.selectedTier ?? "");
    const [selectedPrice, setSelectedPrice] = useState<number | undefined>(hasPlausiblePrice ? selectedPriceCandidate : undefined);

    if (!hasDietary && !hasAccommodation) return null;

    const toggleDietary = (label: string) => {
      setSelectedDietary((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]));
    };
    const confirmSelections = () => {
      const parts = [
        selectedDietary.length ? `dietary preferences: ${selectedDietary.join(", ")}` : "",
        selectedTier ? `accommodation tier: ${selectedTier}` : "",
        selectedPrice ? `accommodation budget: about ${formatMoney(selectedPrice, currency)} per night` : "",
      ].filter(Boolean);
      if (parts.length) triggerAction(`My selected preferences are ${parts.join("; ")}.`);
    };
    const canConfirm = selectedDietary.length > 0 || Boolean(selectedTier) || Boolean(selectedPrice);

    return (
      <div className="mt-2 w-full rounded-2xl border border-dashed bg-white shadow-sm" style={{ borderColor: T_BORDER }}>
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: T_BORDER, background: T_LIGHT }}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{props.title || "Quick Preferences"}</div>
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: T }}>
            <Zap className="h-3 w-3" />
            AI-generated
          </div>
        </div>
        <div className={`grid gap-4 p-4 ${hasDietary && hasAccommodation ? "sm:grid-cols-2" : ""}`}>
          {hasDietary && (
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Dietary</div>
              <div className="grid grid-cols-2 gap-2">
                {dietary.map((item) => {
                  const selected = selectedDietary.includes(item.label);
                  return (
                    <button
                      key={item.label}
                      disabled={isStreaming}
                      onClick={() => toggleDietary(item.label)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="flex h-4 w-4 items-center justify-center rounded border" style={{ background: selected ? T : "white", borderColor: selected ? T : "#CBD5E1" }}>
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="text-slate-700">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {hasAccommodation && (
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Accommodation</div>
              {tiers.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {tiers.map((tier) => {
                    const selected = tier === selectedTier;
                    return (
                      <button
                        key={tier}
                        disabled={isStreaming}
                        onClick={() => setSelectedTier((current) => (current === tier ? "" : tier))}
                        className="rounded-lg border px-2.5 py-1 text-xs font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: selected ? T : "white", borderColor: selected ? T : T_BORDER, color: selected ? "white" : "#475569" }}
                      >
                        {tier}
                      </button>
                    );
                  })}
                </div>
              )}
              {hasPlausiblePrice && (
                <button
                  disabled={isStreaming}
                  onClick={() => setSelectedPrice((current) => (current ? undefined : selectedPriceCandidate))}
                  className="w-full rounded-lg border bg-white px-3 py-2 text-left text-xs font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: selectedPrice ? T_LIGHT : "white", borderColor: T_BORDER, color: T }}
                >
                  ~{normalizedMinPrice}-{normalizedMaxPrice} {currency}/night
                </button>
              )}
            </div>
          )}
          <div className={hasDietary && hasAccommodation ? "sm:col-span-2" : ""}>
            <button
              disabled={isStreaming || !canConfirm}
              onClick={confirmSelections}
              className="w-full rounded-xl px-3 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: T }}
            >
              Confirm selected preferences
            </button>
          </div>
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
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Zap className="h-4 w-4 flex-shrink-0" style={{ color: T }} />
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{props.title}</h4>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T }}>
            AI-generated
          </span>
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-700">{props.question}</p>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T }}>
            AI-generated
          </span>
        </div>
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
        QuickPreferencesComponent.ref,
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
    QuickPreferencesComponent,
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
      components: ["HotelOptions", "QuickPreferences", "ConflictWarning", "SuggestionChips", "PreferenceOptions"],
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
    "Follow the phased Socratic workflow: Phase 1 macro profile and route topology, Phase 2 basecamp and hard logistics, Phase 3 risk/health/dietary protections, Phase 4 one-day-at-a-time micro planning, Phase 5 audit, Phase 6 final artifact.",
    "Do not generate a complete itinerary in the initial turns. After the user provides destination or region, budget, duration, and travelers, propose only a high-level route topology or next phase decision, not a finished day-by-day plan.",
    "Track the active phase in StateUpdate.status using labels such as phase_1_route_topology, phase_2_basecamp_logistics, phase_3_risk_health, phase_4_daily_planning, phase_5_audit, or phase_6_final.",
    "Phases are hidden internal planning state. Never mention phase numbers, phase names, or phase_ labels in prose or visible UI labels.",
    "Ask at most one focused Socratic question at a time before the first route is proposed.",
    "In the first 2-3 assistant turns, keep widgets sparse. Prefer text-first Socratic questioning and use at most one small widget only if it supports the single question being asked.",
    "For vague starts like \"I want to travel\", ask one destination or region question instead of offering many predefined trip concepts.",
    "For a pure greeting or vague opening with no concrete travel information, respond with text only. Do not output OpenUI and do not send an empty StateUpdate.",
    "Do not offer specific destination examples unless the user asks for inspiration or has provided constraints that make those options meaningfully grounded.",
    "For inputs such as \"I need gluten-free food and want Japan\", capture both destination and dietary preference in StateUpdate, then ask one missing basic such as duration, travelers, or budget.",
    "Use HotelOptions only after you have first elicited lodging needs such as price range, comfort level, location, accessibility, dietary/logistical needs, or hotel style.",
    "If you are still eliciting accommodation style or price tier, use PreferenceOptions or QuickPreferences instead of HotelOptions.",
    "HotelOptions must present concrete named hotel or lodging choices, not abstract categories. Each option needs tier, name, pricePerNight, summary, and fit.",
    "Do not write an abstract lodging category such as \"Budget Guesthouse\" into day.hotel. After a user selects a lodging style, offer concrete hotel/lodging names before booking the itinerary.",
    "For multi-stop trips, assign concrete lodging per base or city and write the correct lodging only to the applicable days.",
    "Do not draft a full sightseeing itinerary until sightseeing priorities and preferred pace are known or strongly implied.",
    "During the first 2-3 assistant turns, default to text-only unless a single compact widget is clearly necessary.",
    "If the user asks for something that conflicts with an active constraint, do not silently rewrite the constraint. Use ConflictWarning and ask the user to resolve it.",
    "Generic conflict patterns: requested destination conflicts with an excluded region; a new dietary need conflicts with planned restaurants; a new activity exceeds budget or available time.",
    "When adding a new constraint after an itinerary exists, review the current itinerary and surface any conflicts one at a time with ConflictWarning.",
    "When proposing a high-level route, include StateUpdate.days so the right-side Itinerary can render. Do not put itinerary days only in prose.",
    "When one day is planned or revised, immediately include that day in StateUpdate.days; do not wait for the full trip to be complete.",
    "For every planned day, include location or city, hotel when selected, approximate spend, completed false, and activities with start time and approximate endTime.",
    "Never set completed true in StateUpdate.days. Completion is controlled only by the local Complete day button.",
    "When lodging is selected, write the selected hotel or accommodation into every applicable day.hotel with pricePerNight so cost metrics include lodging.",
    "Each planned day should consider activities, transport, meals or food constraints, and rest time where relevant.",
    "Use itemized activity costs and hotel pricePerNight as the cost source of truth. Use day.spend only as a rough fallback when no itemized costs are available.",
    "Before adding concrete activities, first ask what kinds of experiences, pace, and interests the user enjoys unless those preferences are already clear.",
    "Before planning meals, ask the user Socratic questions about meal rhythm, dietary restrictions, cuisine priorities, and how detailed the food plan should be.",
    "Do not ask the same dietary or meal-preference widget twice. If a dietary requirement is already captured, ask the next missing food-planning question such as meal rhythm, cuisine style, budget per meal, or restaurant detail level.",
    "When the user states a meal rhythm such as 3 meals per day, capture it as an active preference with label \"Meal rhythm\", value such as \"3 meals per day\", category \"diet\", status \"captured\".",
    "Before planning transport, ask about comfort, time, cost, and independence trade-offs when the choice is ambiguous.",
    "Initial high-level drafts should include balanced placeholders or concrete entries for transport, meals, activities, rest/free time, and lodging where relevant.",
    "Final itinerary entries must be actionable: transport needs from/to, mode, duration, and schedule guidance; meals need meal type, place/area, and dietary fit; activities need what to do, why it fits, duration, and cost.",
    "Avoid bare labels such as \"Transfer\", \"Dinner\", \"Old Town\", or \"Hiking\" in StateUpdate.days. Add implementation detail in note and use endTime.",
    "Every activity must include a numeric cost. Use 0 for free sights, realistic average prices for meals, and estimated fares for transport.",
    "Ask whether inbound arrival and outbound return journeys should be included. If included, plan from/to, mode, rough timing, cost, and schedule-check guidance.",
    "When the user removes a preference, return StateUpdate with the full remaining active preferences list. When the user removes all preferences, return StateUpdate with preferences as an empty array.",
    "Use QuickPreferences only after asking a relevant preference question. Include only the sections relevant to that question: dietary for food questions, accommodationTiers/prices for lodging questions.",
    "For QuickPreferences, omit dietary entirely unless you provide non-empty dietary option labels.",
    "For QuickPreferences accommodation prices, use realistic nightly prices only, with minPrice <= maxPrice. Never use the total trip budget as a nightly accommodation range.",
    "Always append one fenced ```openui-lang code block when the Socratic condition needs to update dashboard state or show widgets.",
    "The fenced OpenUI code must start with root = TravelUI([...]).",
    "Always include StateUpdate in Socratic responses once any travel data is known.",
    "Use numeric CHF values without currency symbols in budget, spend, cost, and pricePerNight fields; currency goes in the currency field.",
    "Valid HotelOptions example: options = HotelOptions(\"Choose a concrete stay\", [{tier: \"Mid-range\", name: \"Hotel Astoria\", city: \"Kotor\", pricePerNight: 95, summary: \"Central old-town stay.\", fit: \"Walkable and within budget\"}])",
    "Do not use named arguments or colon syntax in component calls; component arguments are positional.",
    "Use HotelOptions when accommodation tier or hotel choice is useful.",
    "Use ConflictWarning when budget, time, preference, or feasibility constraints collide.",
    "Use SuggestionChips or PreferenceOptions for contextual quick replies, not generic suggestions.",
    "When a focus day is active, treat the user's request as applying only to that day and update only that day in the itinerary.",
    "When a focus hotel or focus activity is active, update only that field unless the user explicitly asks for the whole trip, every day, or all hotels.",
  ],
});

// --- Prompts and context ------------------------------------------------------
const SOCRATIC_COMPLETION_CONTRACT = `Socratic completion contract:
- Work in phases: 1) macro profile and route topology, 2) basecamp and hard logistics, 3) bureaucracy/risk/health/dietary protections, 4) one-day-at-a-time micro planning, 5) spatial/temporal/budget audit, 6) final artifact release.
- Phase 1 locks dates or duration, budget ceiling, traveler count, trip purpose, route topology, single-stop versus multi-stop, pacing, and arrival/return inclusion preference.
- Phase 2 locks basecamp/lodging and hard transport chains for each stop before detailed activities are scheduled.
- Phase 3 elicits health, dietary, administrative, insurance, cancellation, and risk requirements before daily scheduling.
- Phase 4 plans exactly one active day at a time, chronologically, with transport, meals, activities, rest, itemized prices, start/end times, and practical instructions.
- Phase 5 validates feasibility across the compiled trip and negotiates conflicts explicitly.
- Phase 6 releases the final structured itinerary only after explicit user approval.
- Never treat the plan as complete while the local coverage issues indicate missing meals, missing transport, missing lodging, missing numeric costs, missing end times, missing arrival/return decisions, or sparse activity details.
- At the start of every turn, review the current hidden itinerary state for flaws, contradictions, missing implementation detail, missing costs, missing meals, missing transport, and arrival/return gaps. Use that review together with the user's latest request to decide the best next step.
- When the user or UI asks to validate feasibility, audit whether a traveler could follow the plan blind from A to B. If not, ask one Socratic question if a decision is missing; otherwise propose concrete StateUpdate.days fixes.
- If the user changes the route shape materially, such as adding another region or replacing the destination focus, restart the affected future segment Socratically instead of patching one token. Ask which existing days should be repurposed, then propose revised affected days via StateUpdate.days.
- When hidden routeChangeIntent is present, do not answer only in prose. If affected days are unclear, ask one question about the segment to repurpose; if they are clear, propose revised StateUpdate.days only for those days and preserve earlier accepted days.
- If the user expresses a preference that conflicts with an active preference, keep the existing preference unless the user explicitly resolves the conflict. Use ConflictWarning or a conflict preference status instead of silently merging incompatible preferences.
- The final itinerary must be executable by a person without further interpretation: each item needs a clear purpose, location or route, timing, duration, estimated cost, and reason it fits the constraints.
- Preserve user agency: ask one targeted question when a meaningful planning choice is missing; only generate concrete itinerary details after the relevant user preference is known or strongly implied.`;

const SYSTEM_PROMPT_B = `You are the experimental Socratic Planner for a travel-planning study.

Behavior rules:
- You are a maieutic guide, not a zero-shot itinerary generator.
- Your purpose is to elicit missing constraints, expose trade-offs, and help the user co-create the itinerary.
- Follow the mandatory phased workflow: Phase 1 macro profile and route topology, Phase 2 basecamp and hard logistics, Phase 3 risk/health/dietary protections, Phase 4 one-day-at-a-time micro planning, Phase 5 audit, Phase 6 final artifact.
- Do not generate a complete itinerary in the initial turns. Once destination or region, budget, duration, and travelers are known or strongly implied, propose only a high-level route topology or next phase decision, not a finished day-by-day plan.
- Track the active phase in StateUpdate.status using labels such as phase_1_route_topology, phase_2_basecamp_logistics, phase_3_risk_health, phase_4_daily_planning, phase_5_audit, or phase_6_final.
- Phases are hidden internal planning state. Never mention phase numbers, phase names, or phase_ labels in prose or visible UI labels.
- In the first 2-3 assistant turns, keep quick replies sparse and never replace the user's own reflection with a large menu of choices.
- For vague openings, ask one focused question; for concrete constraints such as gluten-free food and Japan, capture them immediately in StateUpdate.
- For a pure greeting or vague opening with no concrete travel information, respond with text only; do not output OpenUI and do not send an empty StateUpdate.
- Do not offer specific destination examples unless the user asks for inspiration or has provided constraints that make those options meaningfully grounded.
- Use HotelOptions only after first eliciting lodging needs such as price range, comfort level, location, accessibility, dietary/logistical needs, or hotel style.
- If you are still eliciting accommodation style or price tier, use PreferenceOptions or QuickPreferences instead of HotelOptions.
- HotelOptions must present concrete named hotel or lodging choices, not abstract categories. Each option needs tier, name, pricePerNight, summary, and fit.
- Do not write an abstract lodging category such as "Budget Guesthouse" into day.hotel. After a user selects a lodging style, offer concrete hotel/lodging names before booking the itinerary.
- For multi-stop trips, assign concrete lodging per base or city and write the correct lodging only to the applicable days.
- Do not draft a full sightseeing itinerary until sightseeing priorities and preferred pace are known or strongly implied.
- During the first 2-3 assistant turns, default to text-only unless a single compact widget is clearly necessary.
- If the user asks for something that conflicts with an active constraint, do not silently rewrite the constraint. Use ConflictWarning and ask the user to resolve it.
- Generic conflict patterns: requested destination conflicts with an excluded region; a new dietary need conflicts with planned restaurants; a new activity exceeds budget or available time.
- When adding a new constraint after an itinerary exists, review the current itinerary and surface any conflicts one at a time with ConflictWarning.
- When proposing a high-level route, include StateUpdate.days so the right-side Itinerary can render. Do not put itinerary days only in prose.
- When one day is planned or revised, immediately include that day in StateUpdate.days; do not wait for the full trip to be complete.
- For every planned day, include location or city, hotel when selected, approximate spend, completed false, and activities with start time and approximate endTime.
- Never set completed true in StateUpdate.days. Completion is controlled only by the local Complete day button.
- When lodging is selected, write the selected hotel or accommodation into every applicable day.hotel with pricePerNight so cost metrics include lodging.
- Each planned day should consider activities, transport, meals or food constraints, and rest time where relevant.
- Use itemized activity costs and hotel pricePerNight as the cost source of truth. Use day.spend only as a rough fallback when no itemized costs are available.
- Before adding concrete activities, first ask what kinds of experiences, pace, and interests the user enjoys unless those preferences are already clear.
- Before planning meals, ask Socratic questions about meal rhythm, dietary restrictions, cuisine priorities, and how detailed the food plan should be.
- Do not ask the same dietary or meal-preference widget twice. If a dietary requirement is already captured, ask the next missing food-planning question such as meal rhythm, cuisine style, budget per meal, or restaurant detail level.
- When the user states a meal rhythm such as 3 meals per day, capture it as an active preference with label "Meal rhythm", value such as "3 meals per day", category "diet", status "captured".
- Before planning transport, ask about comfort, time, cost, and independence trade-offs when the choice is ambiguous.
- Initial high-level drafts should include balanced placeholders or concrete entries for transport, meals, activities, rest/free time, and lodging where relevant.
- Final itinerary entries must be actionable: transport needs from/to, mode, duration, and schedule guidance; meals need meal type, place/area, and dietary fit; activities need what to do, why it fits, duration, and cost.
- Avoid bare labels such as "Transfer", "Dinner", "Old Town", or "Hiking" in StateUpdate.days. Add implementation detail in note and use endTime.
- Every activity must include a numeric cost. Use 0 for free sights, realistic average prices for meals, and estimated fares for transport.
- Ask whether inbound arrival and outbound return journeys should be included. If included, plan from/to, mode, rough timing, cost, and schedule-check guidance.
- Use QuickPreferences only after asking a relevant preference question. Include only the sections relevant to that question: dietary for food questions, accommodationTiers/prices for lodging questions.
- For QuickPreferences, omit dietary entirely unless you provide non-empty dietary option labels.
- For QuickPreferences accommodation prices, use realistic nightly prices only, with minPrice <= maxPrice. Never use the total trip budget as a nightly accommodation range.
- When the user removes a preference, return StateUpdate with the full remaining active preferences list. When the user removes all preferences, return StateUpdate with preferences as an empty array.
- Keep chat prose concise, but make the structured trip state complete.
- Preserve all known user preferences and constraints in the hidden StateUpdate so the dashboard remains reliable.
- For every Condition B user request, silently compare the latest request against the current hidden itinerary and coverage issues. Mention only the relevant implication in prose, then either ask one Socratic next question or propose a reviewable StateUpdate patch. Do not ignore plan flaws that affect the user's request.
- If the user clicks an interactive widget, treat the resulting user message as an explicit choice.
- If a focus day is active, answer only for that day and preserve the rest of the itinerary.
- If a focus hotel or focus activity is active, update only that field unless the user explicitly asks for the whole trip, every day, or all hotels.
- If hidden routeChangeIntent is present, treat the request as a future-segment redesign. Ask which days to repurpose when unclear; otherwise return a StateUpdate.days patch for only the affected days. Keep earlier completed or accepted days unchanged unless the user explicitly includes them.

${SOCRATIC_COMPLETION_CONTRACT}

${OPENUI_PROMPT}`;

const formatCurrentItineraryDigest = (trip: TripState) => {
  if (!trip.days.length) return "No itinerary days have been generated yet.";

  return trip.days
    .map((day) => {
      const location = day.location || day.city || trip.destination || "location missing";
      const hotel = day.hotel?.name
        ? `Stay: ${day.hotel.name}${day.hotel.city ? ` (${day.hotel.city})` : ""}${typeof day.hotel.pricePerNight === "number" ? `, ${day.hotel.pricePerNight} ${trip.currency}/night` : ", cost missing"}`
        : "Stay: missing";
      const activities = day.activities.length
        ? day.activities
            .map((activity) => {
              const time = activity.endTime ? `${activity.time || "time?"}-${activity.endTime}` : `${activity.time || "time?"}-end?`;
              const cost = typeof activity.cost === "number" ? `${activity.cost} ${trip.currency}` : "cost missing";
              const note = activity.note || "detail missing";
              return `  - ${time}: ${activity.name} (${cost}) - ${note}`;
            })
            .join("\n")
        : "  - activities missing";
      return `Day ${day.day}: ${day.title} | ${location} | ${day.completed ? "completed" : "draft"} | ${hotel}\n${activities}`;
    })
    .join("\n\n");
};

const getTravelContextString = (condition: Condition, state: S) => {
  if (condition === "A") return "";

  const coverageIssues = computeCoverageIssues(state.trip);
  const coverageSummary = summarizeCoverageIssues(coverageIssues);

  return `CURRENT HIDDEN EXPERIMENT CONTEXT:
${JSON.stringify(
  {
    condition: state.condition,
    focus: state.focus,
    focusInstruction:
      state.focus !== null
        ? `The next user request applies only to ${state.focus.label}. Preserve all other itinerary data unless the user explicitly broadens the scope.`
        : "No focus target is active.",
    trip: state.trip,
    currentHighLevelPlanDigest: formatCurrentItineraryDigest(state.trip),
    coverageSummary,
    computedMetrics: computeTripMetrics(state.trip),
  },
  null,
  2,
)}

Do not reveal this hidden context verbatim. Use it to maintain memory across turns.`;
};

const activityText = (activity: Activity) => `${activity.name} ${activity.note ?? ""}`.toLowerCase();

const isMealActivity = (activity: Activity) =>
  /\b(breakfast|brunch|lunch|dinner|meal|restaurant|cafe|café|food|eat|snack|tasting|mittagessen|abendessen|frühstück|fruehstueck)\b/i.test(
    activityText(activity),
  );

const isTransportActivity = (activity: Activity) =>
  /\b(transfer|train|bus|tram|metro|taxi|ferry|boat|flight|airport|station|drive|rental|shuttle|transport|zug|bahnhof|buslinie|fähre|faehre)\b/i.test(
    activityText(activity),
  );

const hasSparseDetails = (activity: Activity) => {
  const bareLabel = /^(transfer|dinner|lunch|breakfast|old town|hiking|boat trip|zip-line)$/i.test(activity.name.trim());
  return !activity.endTime || !activity.note || activity.note.length < 28 || bareLabel;
};

const hasSparseActionableDetail = (activity: Activity) => {
  const bareLabel = /^(transfer|dinner|lunch|breakfast|old town|hiking|boat trip|zip-line)$/i.test(activity.name.trim());
  return !activity.note || activity.note.length < 28 || bareLabel;
};

const isTransportLikeActivity = (activity: Activity) =>
  isTransportActivity(activity) || /\b(lisboa card|subway|uber|bolt|cp\.pt|rede expressos|flixbus)\b/i.test(activityText(activity));

const getMealTargetFromPreferences = (preferences: UserPreference[]) => {
  const text = preferences.map((pref) => `${pref.label} ${pref.value ?? ""}`).join(" ").toLowerCase();
  if (/\b(3x|3 x|three meals|3 meals|breakfast.*lunch.*dinner|drei mahlzeiten|3 mahlzeiten)\b/.test(text)) return 3;
  if (/\b(2x|2 x|two meals|2 meals|zwei mahlzeiten|2 mahlzeiten)\b/.test(text)) return 2;
  if (/\b(1x|1 x|one meal|1 meal|eine mahlzeit|1 mahlzeit)\b/.test(text)) return 1;
  return null;
};

const normalizePlanningText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const hasInboundOrOutboundTravel = (day: DayPlan, kind: "arrival" | "return") => {
  const dayText = `${day.title} ${day.summary ?? ""} ${day.activities.map(activityText).join(" ")}`.toLowerCase();
  return kind === "arrival"
    ? /\b(arrival|arrive|airport|flight|train station|bus station|from home|from zurich|from zürich|from geneva|from basel|anreise|ankunft)\b/.test(dayText)
    : /\b(return|departure|depart|airport|flight home|train home|back to|rückreise|rueckreise|abreise)\b/.test(dayText);
};

const getTravelBoundaryDecision = (preferences: UserPreference[], kind: "arrival" | "return") => {
  const prefText = normalizePlanningText(preferences.map((pref) => `${pref.label} ${pref.value ?? ""}`).join(" "));
  const boundaryPattern =
    kind === "arrival"
      ? /\b(arrival|arrive|inbound|origin|from home|flight out|train to|anreise|ankunft|hinreise)\b/
      : /\b(return|departure|depart|flight home|train home|back home|ruckreise|rueckreise|abreise|heimreise)\b/;
  const includePattern = /\b(include|included|plan|planned|with details|yes|ja|mit details|einplanen|planen)\b/;
  const excludePattern = /\b(exclude|excluded|skip|without|no|not include|do not include|do not plan|nein|ohne|nicht planen|nicht einplanen|auslassen)\b/;

  if (!boundaryPattern.test(prefText)) return "unknown";
  if (excludePattern.test(prefText)) return "excluded";
  if (includePattern.test(prefText)) return "included";
  return "known";
};

const hasConcreteTransportDetail = (activity: Activity) => {
  if (!isTransportLikeActivity(activity)) return true;
  const text = activityText(activity);
  return /\b(from|to|via|line|bus|train|metro|tram|ferry|station|terminal|duration|schedule|platform|route|lisboa card|cp\.pt|rede expressos|flixbus|ab|nach|linie|bahnhof|fahrplan)\b/i.test(text);
};

const computeCoverageIssues = (trip: TripState): CoverageIssue[] => {
  const issues: CoverageIssue[] = [];
  trip.preferences
    .filter((pref) => pref.status === "conflict")
    .forEach((pref, index) => {
      issues.push({
        id: `preference-conflict-${index}`,
        severity: "missing",
        label: `Preference conflict: ${pref.label}`,
        detail: pref.value || "Ask the participant to resolve this preference conflict before finalizing the plan.",
      });
    });

  if (!trip.days.length) return issues;

  const mealTarget = getMealTargetFromPreferences(trip.preferences);
  const prefText = trip.preferences.map((pref) => `${pref.label} ${pref.value ?? ""}`).join(" ").toLowerCase();
  const travelToFromKnown = /\b(origin|from home|arrival|return|flight|train to|anreise|rückreise|rueckreise)\b/.test(prefText);

  const arrivalDecision = getTravelBoundaryDecision(trip.preferences, "arrival");
  const returnDecision = getTravelBoundaryDecision(trip.preferences, "return");

  if (!mealTarget) {
    issues.push({
      id: "meal-rhythm",
      severity: "missing",
      label: "Meal rhythm not confirmed",
      detail: "Ask whether the participant wants breakfast/lunch/dinner planned or only selected food stops.",
    });
  }

  if (arrivalDecision === "unknown" && !hasInboundOrOutboundTravel(trip.days[0], "arrival")) {
    issues.push({
      id: "arrival-choice",
      severity: "missing",
      label: "Arrival planning missing",
      detail: "Clarify whether the plan should include travel to the destination, origin, mode, time, and estimated cost.",
    });
  }

  const lastDay = trip.days[trip.days.length - 1];
  if (returnDecision === "unknown" && lastDay && !hasInboundOrOutboundTravel(lastDay, "return")) {
    issues.push({
      id: "return-choice",
      severity: "missing",
      label: "Return planning missing",
      detail: "Clarify whether the return journey should be included with mode, route, time, and estimated cost.",
    });
  }

  trip.days.forEach((day) => {
    if (!day.hotel?.name) {
      issues.push({ id: `day-${day.day}-hotel`, severity: "missing", day: day.day, label: `Day ${day.day}: lodging missing`, detail: "Add a concrete hotel/lodging name and nightly price." });
    }
    if (day.hotel && typeof day.hotel.pricePerNight !== "number") {
      issues.push({ id: `day-${day.day}-hotel-cost`, severity: "missing", day: day.day, label: `Day ${day.day}: lodging cost missing`, detail: "Hotel/lodging needs a numeric pricePerNight." });
    }

    const meals = day.activities.filter(isMealActivity);
    if (mealTarget !== null && meals.length < mealTarget) {
      issues.push({
        id: `day-${day.day}-meals`,
        severity: "missing",
        day: day.day,
        label: `Day ${day.day}: meals incomplete`,
        detail: `${meals.length}/${mealTarget} planned meals. Add nearby options with average prices and dietary fit.`,
      });
    }

    if (!day.activities.some(isTransportLikeActivity)) {
      issues.push({ id: `day-${day.day}-transport`, severity: "missing", day: day.day, label: `Day ${day.day}: transport missing`, detail: "Add local or intercity transport with route, mode, duration, and cost." });
    }

    day.activities.forEach((activity, index) => {
      if (typeof activity.cost !== "number") {
        issues.push({ id: `day-${day.day}-activity-${index}-cost`, severity: "missing", day: day.day, label: `Day ${day.day}: cost missing`, detail: `${activity.name} needs a numeric cost. Use 0 for free sights.` });
      }
      if (!activity.endTime) {
        issues.push({ id: `day-${day.day}-activity-${index}-end`, severity: "missing", day: day.day, label: `Day ${day.day}: end time missing`, detail: `${activity.name} needs an approximate endTime.` });
      }
      if (hasSparseActionableDetail(activity)) {
        issues.push({ id: `day-${day.day}-activity-${index}-detail`, severity: "missing", day: day.day, label: `Day ${day.day}: details too sparse`, detail: `${activity.name} should include actionable route, venue, booking, rationale, or schedule details.` });
      }
      if (isTransportLikeActivity(activity) && !hasConcreteTransportDetail(activity)) {
        issues.push({ id: `day-${day.day}-activity-${index}-transport-detail`, severity: "missing", day: day.day, label: `Day ${day.day}: transport route unclear`, detail: `${activity.name} needs from/to, mode or line, duration, and where to check schedules.` });
      }
    });
  });

  return issues;
};

const summarizeCoverageIssues = (issues: CoverageIssue[]): CoverageSummary => {
  const affectedDays = Array.from(
    new Set(issues.map((issue) => issue.day).filter((day): day is number => typeof day === "number")),
  ).sort((a, b) => a - b);

  return {
    total: issues.length,
    missing: issues.filter((issue) => issue.severity === "missing").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    preferenceConflicts: issues.filter((issue) => issue.id.startsWith("preference-conflict")).length,
    missingCosts: issues.filter((issue) => issue.id.includes("-cost")).length,
    missingEndTimes: issues.filter((issue) => issue.id.endsWith("-end")).length,
    missingActionableDetails: issues.filter((issue) => issue.id.endsWith("-detail")).length,
    missingMeals: issues.filter((issue) => issue.id === "meal-rhythm" || issue.id.endsWith("-meals")).length,
    missingTransport: issues.filter((issue) => issue.id.includes("-transport")).length,
    missingLodging: issues.filter((issue) => issue.id.includes("-hotel")).length,
    arrivalReturnGaps: issues.filter((issue) => issue.id === "arrival-choice" || issue.id === "return-choice").length,
    affectedDays,
  };
};

const getLatestUserText = (chatHistory: Message[]) =>
  [...chatHistory].reverse().find((message) => message.sender === "user")?.rawText ?? "";

const normalizeIntentText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const extractRequestedStartDay = (text: string) => {
  const normalizedText = normalizeIntentText(text);
  const match = normalizedText.match(/\b(?:from|after|starting|ab|nach|seit)\s+(?:day|tag)\s*(\d{1,2})\b|\b(?:day|tag)\s*(\d{1,2})\s*(?:onward|onwards|forward|weiter|danach)\b/i);
  const value = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const getRouteChangeIntent = (trip: TripState, latestUserText: string) => {
  if (!trip.days.length || !latestUserText.trim()) return null;

  const text = normalizeIntentText(latestUserText);
  const asksForRouteChange =
    /\b(not only|also|instead|change|switch|replace|extend|add|include|rather|from day|after day|doch nicht nur|nicht nur|auch|stattdessen|wechseln|ersetzen|aendern|andern|ändern|umstellen|anpassen|erweitern|hinzufuegen|hinzufügen|ab tag|nach tag)\b/i.test(text);
  const mentionsNewRouteShape =
    /\b(algarve|coast|beach|surf|surfing|sea|island|mountain|second base|another city|another region|multi-stop|road trip|kueste|küste|strand|meer|insel|berge|surfen|zweite station|weitere stadt|weitere region|mehrere orte)\b/i.test(text);

  const normalizedRouteChange = asksForRouteChange || /\b(hinzufugen|korrigieren|neu planen|umplanen)\b/i.test(text);
  const normalizedRouteShape = mentionsNewRouteShape || /\b(kuste|surfkurs|surf lektion|surfschule|zweiter ort|zweite region)\b/i.test(text);

  if (!normalizedRouteChange || !normalizedRouteShape) return null;

  const requestedStartDay = extractRequestedStartDay(latestUserText);
  const inferredStartDay = requestedStartDay;
  const affectedDays =
    inferredStartDay !== null
      ? trip.days.filter((day) => day.day >= inferredStartDay).map((day) => day.day)
      : [];

  return {
    detected: true,
    latestUserText,
    requestedStartDay,
    inferredStartDay,
    affectedDays,
    instruction:
      "Treat this as a route-shape change. If the affected days are unclear, ask one Socratic clarification about which days to repurpose. If clear, propose a StateUpdate.days patch only for the affected future segment and preserve earlier accepted days.",
  };
};

const getPlanningStageGuidance = (state: S, chatHistory: Message[]) => {
  if (state.condition === "A") return "";

  const days = state.trip.days;
  const latestUserText = getLatestUserText(chatHistory);
  const missingBasics = [
    state.trip.destination ? "" : "destination or region",
    typeof state.trip.budget === "number" ? "" : "budget",
    state.trip.durationDays ? "" : "duration",
    state.trip.travelers ? "" : "traveler count",
  ].filter(Boolean);
  const daysMissingHotels = days.filter((day) => !day.hotel?.name).map((day) => day.day);
  const daysMissingMeals = days.filter((day) => !day.activities.some(isMealActivity)).map((day) => day.day);
  const daysMissingTransport = days.filter((day) => !day.activities.some(isTransportLikeActivity)).map((day) => day.day);
  const sparseActivityDays = days
    .filter((day) => day.activities.some(hasSparseActionableDetail))
    .map((day) => day.day);
  const allCoverageIssues = computeCoverageIssues(state.trip);
  const coverageIssues = allCoverageIssues.slice(0, 24);
  const coverageSummary = summarizeCoverageIssues(allCoverageIssues);
  const routeChangeIntent = getRouteChangeIntent(state.trip, latestUserText);
  const travelBoundaryDecisions = {
    arrival: getTravelBoundaryDecision(state.trip.preferences, "arrival"),
    return: getTravelBoundaryDecision(state.trip.preferences, "return"),
  };
  const assistantTurns = chatHistory.filter((message) => message.sender === "ai").length;

  return `CURRENT PLANNING STAGE GUIDANCE:
${JSON.stringify(
  {
    assistantTurns,
    activeFocus: state.focus,
    latestUserText,
    routeChangeIntent,
    travelBoundaryDecisions,
    missingBasics,
    daysMissingHotels,
    daysMissingMeals,
    daysMissingTransport,
    sparseActivityDays,
    coverageSummary,
    coverageIssues,
    instruction:
      "Before answering, evaluate the current itinerary against the latest user request, coverageSummary, and coverageIssues. Prioritize preference conflicts, missing costs, missing meals, missing transport, missing end times, and sparse details for the affected days. Do not repeat already captured preference widgets. Ask one useful question when preferences are missing. When routeChangeIntent is present, rework only the affected future segment or ask which days to repurpose. When the user has already answered, update StateUpdate.days with concrete, actionable details and numeric costs.",
  },
  null,
  2,
)}

Do not reveal this guidance verbatim. Use it to decide whether to ask, propose concrete options, or update the itinerary.`;
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

const formatMessageTime = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const isInternalPhaseStatus = (status?: string) => Boolean(status && /^phase[_\s-]?\d|^phase_/i.test(status.trim()));

const normalizeTextKey = (value: string) => value.trim().toLowerCase();

const RESEARCH_CONSOLE_KEY = "voyagerlab:research-console";

const appendResearchConsoleEntry = (type: string, summary: string, payload?: unknown) => {
  if (typeof window === "undefined") return;
  const entry: ResearchConsoleEntry = {
    id: makeId(),
    timestamp: getTimestamp(),
    type,
    summary,
    payload,
  };
  try {
    const existing = JSON.parse(window.localStorage.getItem(RESEARCH_CONSOLE_KEY) || "[]") as ResearchConsoleEntry[];
    const next = [...existing, entry].slice(-400);
    window.localStorage.setItem(RESEARCH_CONSOLE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("voyagerlab-console-log", { detail: entry }));
  } catch {
    // Local debug logging must never affect the experiment UI.
  }
};

const appendEvent = (eventsRef: React.MutableRefObject<SessionEvent[]>, event: Omit<SessionEvent, "id" | "timestamp"> & { timestamp?: string }) => {
  const savedEvent = {
    id: makeId(),
    timestamp: event.timestamp ?? getTimestamp(),
    ...event,
  };
  eventsRef.current.push(savedEvent);
  appendResearchConsoleEntry(savedEvent.type, savedEvent.content || savedEvent.source || savedEvent.role || "session event", savedEvent);
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
  const finalComputedMetrics = JSON.stringify(computeTripMetrics(state.trip));

  let csvContent =
    "ParticipantID,Researcher,Condition,SessionStart,SessionDurationSec,TotalUserTurns,AverageUserWordCount,UIInterventions,EventID,EventType,Role,Timestamp,MessageID,Source,WordCount,Content,Metadata,FinalTripState,FinalComputedMetrics\n";

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
      finalComputedMetrics,
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

const generateTripCSVAndDownload = (state: S) => {
  const metrics = computeTripMetrics(state.trip);
  const fallbackNightlyCost = extractNightlyCostFromPreferences(state.trip.preferences);
  let csvContent =
    "ParticipantID,Researcher,Condition,ExportedAt,MetricTotalCost,MetricSatisfiedPrefs,MetricCapturedPrefs,MetricConflicts,MetricCompletedDays,MetricDraftedDays,PreferenceLabel,PreferenceValue,PreferenceCategory,PreferenceStatus,Day,Completed,Title,Location,HotelName,HotelTier,HotelCost,DayCost,Warning,ActivityStart,ActivityEnd,ActivityName,ActivityCost,ActivityNote,FinalTripState\n";

  const preferences = state.trip.preferences.length ? state.trip.preferences : [{ label: "", value: "", category: "", status: "" } as UserPreference];
  const days = state.trip.days.length ? state.trip.days : [{ day: 0, title: "", activities: [] } as DayPlan];

  for (const pref of preferences) {
    for (const day of days) {
      const activities = day.activities.length ? day.activities : [{ time: "", name: "" } as Activity];
      for (const activity of activities) {
        const row = [
          state.participantId,
          state.researcher,
          state.condition,
          getTimestamp(),
          metrics.totalCost,
          metrics.satisfiedPrefs,
          metrics.capturedPrefs,
          metrics.conflicts,
          metrics.daysPlanned,
          metrics.draftedDays,
          pref.label,
          pref.value ?? "",
          pref.category ?? "",
          pref.status ?? "",
          day.day || "",
          day.completed ? "yes" : "no",
          day.title,
          day.location || day.city || "",
          day.hotel?.name ?? "",
          day.hotel?.tier ?? "",
          getDayHotelCost(day, fallbackNightlyCost),
          computeDayCost(day, fallbackNightlyCost),
          day.warning ? "yes" : "no",
          activity.time,
          activity.endTime ?? "",
          activity.name,
          activity.cost ?? "",
          activity.note ?? "",
          state.trip,
        ].map(escapeCSV);
        csvContent += `${row.join(",")}\n`;
      }
    }
  }

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.setAttribute("href", URL.createObjectURL(blob));
  link.setAttribute("download", `VoyagerLab_Trip_${state.participantId || "unknown"}_${Date.now()}.csv`);
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

  let malformedOpenUI: string | undefined;

  if (codeBlocks.length === 0) {
    const openingFence = rawText.match(/```(openui-lang|openui|oui)\s*\n/i);
    if (openingFence?.index !== undefined) {
      const codeStart = openingFence.index + openingFence[0].length;
      const openCode = rawText.slice(codeStart).replace(/```\s*$/, "").trim();
      if (openCode) {
        malformedOpenUI = openCode;
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
    malformedOpenUI,
  };
};

const getMessageTextForModel = (message: Message) => message.rawText || message.text;

const getDayHotelCost = (day: DayPlan, fallbackNightlyCost?: number) => {
  if (typeof day.hotel?.pricePerNight === "number" && !Number.isNaN(day.hotel.pricePerNight)) return day.hotel.pricePerNight;
  return fallbackNightlyCost ?? 0;
};

const extractNightlyCostFromPreferences = (preferences: UserPreference[]) => {
  const lodgingPref = preferences.find((pref) => pref.category === "lodging" && /\d/.test(`${pref.label} ${pref.value ?? ""}`));
  const match = lodgingPref ? `${lodgingPref.label} ${lodgingPref.value ?? ""}`.match(/(\d+(?:[.,]\d+)?)/) : null;
  return match ? Number(match[1].replace(",", ".")) : undefined;
};

const computeDayCost = (day: DayPlan, fallbackNightlyCost?: number) => {
  const hotelCost = getDayHotelCost(day, fallbackNightlyCost);
  const activitiesCost = day.activities.reduce((sum, activity) => sum + (activity.cost ?? 0), 0);
  const explicitSpend = typeof day.spend === "number" && !Number.isNaN(day.spend) ? day.spend : undefined;
  const hasItemizedCosts = hotelCost > 0 || day.activities.some((activity) => typeof activity.cost === "number" && !Number.isNaN(activity.cost));
  if (hasItemizedCosts) return activitiesCost + hotelCost;
  return explicitSpend ?? 0;
};

function computeTripMetrics(trip: TripState) {
  const fallbackNightlyCost = extractNightlyCostFromPreferences(trip.preferences);
  const totalCost = trip.days.reduce((sum, day) => sum + computeDayCost(day, fallbackNightlyCost), 0);
  const capturedPrefs = trip.preferences.length;
  const satisfiedPrefs = trip.preferences.filter((pref) => pref.status !== "conflict").length;
  const conflicts = trip.preferences.filter((pref) => pref.status === "conflict").length + trip.days.filter((day) => day.warning).length;
  const budgetDelta = typeof trip.budget === "number" ? trip.budget - totalCost : null;
  const completedDays = trip.days.filter((day) => day.completed).length;

  return {
    totalCost,
    capturedPrefs,
    satisfiedPrefs,
    conflicts,
    daysPlanned: completedDays,
    draftedDays: trip.days.length,
    budgetDelta,
  };
}

const metricCardsFromTrip = (trip: TripState) => {
  const metrics = computeTripMetrics(trip);
  const currency = trip.currency || "CHF";
  const hasCost = metrics.totalCost > 0;
  const missingCostCount = computeCoverageIssues(trip).filter((issue) => /cost missing|cost$|cost missing/i.test(`${issue.label} ${issue.detail}`)).length;
  const budgetSub =
    metrics.budgetDelta === null
      ? hasCost
        ? "budget not set"
        : "awaiting plan"
      : metrics.budgetDelta >= 0
        ? `${formatMoney(metrics.budgetDelta, currency)} under budget`
        : `${formatMoney(Math.abs(metrics.budgetDelta), currency)} over budget`;
  const costSub = missingCostCount ? `${missingCostCount} costs missing - ${budgetSub}` : budgetSub;

  return [
    {
      label: "Est. Cost",
      value: hasCost ? formatMoney(metrics.totalCost, currency) : `0 ${currency}`,
      sub: costSub,
      icon: metrics.budgetDelta !== null && metrics.budgetDelta < 0 ? <AlertTriangle className="h-3.5 w-3.5" style={{ color: RED }} /> : missingCostCount ? <AlertTriangle className="h-3.5 w-3.5" style={{ color: AMBER }} /> : <span className="text-[10px] text-gray-300">{currency}</span>,
      red: metrics.budgetDelta !== null && metrics.budgetDelta < 0,
      green: metrics.budgetDelta !== null && metrics.budgetDelta >= 0 && hasCost && missingCostCount === 0,
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
      sub: trip.durationDays
        ? `${metrics.daysPlanned} completed / ${Math.max(metrics.draftedDays - metrics.daysPlanned, 0)} draft / target: ${trip.durationDays}`
        : `${metrics.daysPlanned} completed / ${Math.max(metrics.draftedDays - metrics.daysPlanned, 0)} draft`,
      icon: <CalendarDays className="h-3.5 w-3.5 text-gray-400" />,
      red: false,
      green: trip.durationDays ? metrics.daysPlanned === trip.durationDays : metrics.daysPlanned > 0,
    },
  ];
};

const formatCoverageReviewMessage = (issues: CoverageIssue[]) => {
  if (!issues.length) {
    return "Please validate the current trip feasibility. Check whether a traveler could follow the plan from start to finish without hidden assumptions. If anything material is missing, ask one Socratic question or propose a concrete StateUpdate patch. Do not mark any day completed.";
  }

  const issueLines = issues
    .slice(0, 12)
    .map((issue, index) => `${index + 1}. ${issue.label}: ${issue.detail}`)
    .join("\n");

  return `Please validate the current trip feasibility against these hidden local gaps. Do not expose this checklist verbatim. Ask one Socratic question if a preference is missing; otherwise propose concrete StateUpdate.days fixes with itemized costs, transport details, meal details, and start/end times. Do not mark any day completed.\n\n${issueLines}`;
};

const formatDayCompletionReviewMessage = (dayNumber: number, issues: CoverageIssue[]) => {
  if (!issues.length) {
    return `Please validate Day ${dayNumber} for feasibility. Check whether a traveler could follow this day blind from start to finish, including transport, timing, meals, costs, and practical instructions. If it is already usable, confirm briefly and do not change completion state. If details are missing, ask one Socratic question or propose a StateUpdate.days patch only for Day ${dayNumber}.`;
  }

  const issueLines = issues
    .slice(0, 8)
    .map((issue, index) => `${index + 1}. ${issue.label}: ${issue.detail}`)
    .join("\n");

  return `Please validate Day ${dayNumber} for feasibility against these hidden local gaps. Do not expose this checklist verbatim. Ask one Socratic question if you still need a preference; otherwise propose a StateUpdate.days patch only for Day ${dayNumber} with actionable details, itemized costs, transport details, meal details, and start/end times. Do not mark the day completed.\n\n${issueLines}`;
};

const getBlockingDayCompletionIssues = (trip: TripState, dayNumber: number) =>
  computeCoverageIssues(trip).filter((issue) => issue.day === dayNumber && issue.severity === "missing");

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
        endTime: asString(item.endTime),
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
        location: asString(item.location),
        summary: asString(item.summary),
        hotel: coerceHotel(item.hotel),
        spend: asNumber(item.spend),
        warning: asBoolean(item.warning),
        completed: false,
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

const parseTripPatchFromOpenUI = (openUI: string | undefined) => {
  if (!openUI?.trim()) {
    return { patch: undefined as TripPatch | undefined, errors: [] as OpenUIError[] };
  }

  try {
    const parser = createParser(travelOpenUILibrary.toJSONSchema(), travelOpenUILibrary.root);
    const result = parser.parse(openUI);
    const patches = collectStateUpdatePatches(result.root);
    const errors = result.meta.errors.map((error) => ({
      source: "parser" as const,
      code: error.code,
      message: error.message,
      statementId: error.statementId,
      component: error.component,
      path: error.path,
    }));

    return {
      patch: patches.length ? combineTripPatches(patches) : undefined,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenUI parse error";
    return {
      patch: undefined,
      errors: [
        {
          source: "parser" as const,
          code: "parse-exception" as const,
          message,
        },
      ],
    };
  }
};

const getOpenUISuppressionReason = (openUI: string, trip: TripState) => {
  const normalizedOpenUI = openUI.toLowerCase();
  const capturedPreferenceText = trip.preferences.map((pref) => `${pref.label} ${pref.value ?? ""} ${pref.category ?? ""}`).join(" ").toLowerCase();
  const hasCapturedDiet = /\b(diet|dietary|gluten|gluten-free|vegan|vegetarian|halal|nut-free|lactose)\b/.test(capturedPreferenceText);
  const hasCapturedMealRhythm = getMealTargetFromPreferences(trip.preferences) !== null;
  const hasCriticalVisibleWidget = normalizedOpenUI.includes("conflictwarning") || normalizedOpenUI.includes("hoteloptions");
  const hasPreferenceWidget =
    normalizedOpenUI.includes("quickpreferences") ||
    normalizedOpenUI.includes("preferenceoptions") ||
    normalizedOpenUI.includes("suggestionchips");
  const hasDietaryPreferenceWidget =
    hasPreferenceWidget &&
    /\b(diet|dietary|gluten|gluten-free|vegan|vegetarian|halal|nut-free|lactose|meal preferences|dietary requirements|ernaehrung|ernahrung|essen)\b/.test(
      normalizedOpenUI,
    );
  const asksMealRhythm =
    /\b(meal rhythm|how many meals|daily meals|meals per day|breakfast.*lunch.*dinner|3 meals|three meals|2 meals|two meals|mahlzeiten|fruehstueck|mittagessen|abendessen)\b/.test(
      normalizedOpenUI,
    );

  if (hasCriticalVisibleWidget) return "";

  if (hasCapturedMealRhythm && hasDietaryPreferenceWidget && asksMealRhythm) {
    return "Duplicate meal-rhythm preference widget suppressed because meal rhythm is already captured.";
  }

  if (hasCapturedDiet && hasDietaryPreferenceWidget && !asksMealRhythm) {
    return "Duplicate dietary preference widget suppressed because dietary constraints are already captured.";
  }

  return "";
};

const normalizePreferenceValue = (value: string) =>
  normalizePlanningText(value)
    .replace(/\b(gluten free|gluten-free|glutenfrei)\b/g, "gluten-free")
    .replace(/\b(vegetarian|vegetarisch)\b/g, "vegetarian")
    .replace(/\b(vegan)\b/g, "vegan")
    .replace(/\b(halal)\b/g, "halal")
    .replace(/\b(lactose free|lactose-free|laktosefrei)\b/g, "lactose-free")
    .replace(/\b(nut free|nut-free|nussfrei)\b/g, "nut-free")
    .replace(/\s+/g, " ")
    .trim();

const getPreferenceSemanticKey = (pref: UserPreference) => {
  const label = normalizePreferenceValue(pref.label);
  const value = normalizePreferenceValue(pref.value ?? "");
  const category = pref.category ?? "other";
  const combined = `${label} ${value}`;

  if (category === "diet" || /\b(diet|dietary|meal preference|meal preferences|dietary requirement|dietary requirements|ernaehrung|ernahrung|essen)\b/.test(combined)) {
    const dietMatch = combined.match(/\b(gluten-free|vegetarian|vegan|halal|lactose-free|nut-free)\b/);
    return dietMatch ? `diet:${dietMatch[1]}` : `diet:${value || label}`;
  }

  if (category === "transport" || /\b(lisboa card|public transport|transit|metro|bus|tram|train|taxi|taxis)\b/.test(combined)) {
    return `transport:${value || label}`;
  }

  return `${category}:${label}:${value}`;
};

const dedupePreferences = (preferences: UserPreference[]) => {
  const byKey = new Map<string, UserPreference>();
  preferences.forEach((pref) => {
    const key = getPreferenceSemanticKey(pref);
    const existing = byKey.get(key);
    if (!existing || existing.status !== "conflict" || pref.status === "conflict") {
      byKey.set(key, pref);
    }
  });
  return Array.from(byKey.values());
};

const mergePreferences = (existing: UserPreference[], incoming?: UserPreference[], userText = "") => {
  if (!incoming) return existing;
  const dedupedIncoming = dedupePreferences(incoming);
  const existingText = existing.map((pref) => `${pref.label} ${pref.value ?? ""}`).join(" ").toLowerCase();
  const incomingText = dedupedIncoming.map((pref) => `${pref.label} ${pref.value ?? ""}`).join(" ").toLowerCase();
  const normalizedUserText = normalizePlanningText(userText);
  const hasExistingTransit = /\b(lisboa card|public transport|transit|metro|bus|tram|train)\b/.test(existingText);
  const hasExistingTaxi = /\b(taxi|taxis)\b/.test(existingText);
  const hasIncomingTransit = /\b(lisboa card|public transport|transit|metro|bus|tram|train)\b/.test(incomingText);
  const hasIncomingTaxi = /\b(taxi|taxis)\b/.test(incomingText);
  const resolvesToTaxi =
    hasIncomingTaxi &&
    /\b(resolve|prioritize|choose|use|replace|remove|instead|prefer|entscheide|priorisiere|nehme|nutze|ersetze|entferne|statt|lieber).{0,40}\b(taxi|taxis)\b|\b(taxi|taxis)\b.{0,40}\b(instead|over|rather than|statt|anstelle|lieber als)\b/.test(
      normalizedUserText,
    );
  const resolvesToTransit =
    hasIncomingTransit &&
    /\b(resolve|prioritize|choose|use|replace|remove|instead|prefer|entscheide|priorisiere|nehme|nutze|ersetze|entferne|statt|lieber).{0,40}\b(lisboa card|public transport|transit|metro|bus|tram|train)\b|\b(lisboa card|public transport|transit|metro|bus|tram|train)\b.{0,40}\b(instead|over|rather than|statt|anstelle|lieber als)\b/.test(
      normalizedUserText,
    );

  if (resolvesToTaxi || resolvesToTransit) {
    return dedupedIncoming.filter((pref) => {
      const text = `${pref.label} ${pref.value ?? ""}`.toLowerCase();
      if (pref.status === "conflict") return false;
      if (resolvesToTaxi) return !/\b(lisboa card|public transport|transit|metro|bus|tram|train)\b/.test(text);
      return !/\b(taxi|taxis)\b/.test(text);
    });
  }

  if (
    (hasExistingTransit && hasIncomingTaxi) ||
    (hasExistingTaxi && hasIncomingTransit) ||
    (hasIncomingTransit && hasIncomingTaxi) ||
    /\b(lisboa card|public transport).{0,20}(taxi|taxis)|(taxi|taxis).{0,20}(lisboa card|public transport)\b/.test(incomingText)
  ) {
    const cleaned = dedupedIncoming.filter((pref) => {
      const text = `${pref.label} ${pref.value ?? ""}`.toLowerCase();
      const isTransitPref = /\b(lisboa card|public transport|transit|metro|bus|tram|train)\b/.test(text);
      const isTaxiPref = /\b(taxi|taxis)\b/.test(text);
      if (pref.status === "conflict") return true;
      if (hasExistingTransit && isTaxiPref) return false;
      if (hasExistingTaxi && isTransitPref) return false;
      if (!hasExistingTransit && !hasExistingTaxi && isTaxiPref) return false;
      return true;
    });
    const transportBase = existing.filter((pref) => {
      const text = `${pref.label} ${pref.value ?? ""}`.toLowerCase();
      return /\b(lisboa card|public transport|transit|metro|bus|tram|train|taxi|taxis)\b/.test(text) && pref.status !== "conflict";
    });
    return dedupePreferences([
      ...cleaned.filter((pref) => !transportBase.some((base) => normalizeTextKey(base.label) === normalizeTextKey(pref.label))),
      ...transportBase,
      {
        label: "Transport preference conflict",
        value: "Taxi travel conflicts with the current public transport/Lisboa Card preference",
        category: "transport",
        status: "conflict",
      },
    ]);
  }

  return dedupedIncoming;
};

const SWISS_NEIGHBOR_COUNTRIES = ["france", "germany", "austria", "italy", "liechtenstein"];

const hasSwissNeighborExclusion = (preferences: UserPreference[]) => {
  const text = normalizePlanningText(preferences.map((pref) => `${pref.label} ${pref.value ?? ""}`).join(" "));
  return (
    /\b(non-neighbor|non neighbouring|non-neighbouring|not neighboring|not neighbouring|outside switzerland'?s neighbors|exclude ch neighbors|exclude swiss neighbors|no swiss neighbors)\b/.test(text) ||
    /\b(nachbarland|nachbarlaender|nachbarlander|angrenzend|grenzt an die schweiz|schweizer nachbarn|ch nachbarn)\b/.test(text)
  );
};

const getRequestedSwissNeighbor = (patch: TripPatch, userText = "") => {
  const text = normalizePlanningText(
    [
      patch.destination ?? "",
      patch.status ?? "",
      userText,
      ...(patch.preferences ?? []).map((pref) => `${pref.label} ${pref.value ?? ""}`),
    ].join(" "),
  );
  return SWISS_NEIGHBOR_COUNTRIES.find((country) => new RegExp(`\\b${country}\\b`, "i").test(text));
};

const hasExplicitNeighborResolution = (userText = "") => {
  const text = normalizePlanningText(userText);
  return /\b(remove|override|ignore|drop|lift|change|allow|accept|aufheben|streichen|ignorieren|aendern|andern|ändern|erlauben|trotzdem)\b.{0,60}\b(neighbor|neighbour|nachbarland|nachbarlaender|nachbarlander|schweiz|switzerland)\b/.test(text);
};

const applyPreferenceConflictGuards = (trip: TripState, patch: TripPatch, userText = ""): TripPatch => {
  const requestedNeighbor = getRequestedSwissNeighbor(patch, userText);
  if (!requestedNeighbor || !hasSwissNeighborExclusion(trip.preferences) || hasExplicitNeighborResolution(userText)) {
    return patch;
  }

  const preferences = dedupePreferences([
    ...(patch.preferences ?? trip.preferences),
    {
      label: "Destination preference conflict",
      value: `${requestedNeighbor[0].toUpperCase()}${requestedNeighbor.slice(1)} conflicts with the current constraint to avoid Switzerland's neighboring countries`,
      category: "destination",
      status: "conflict",
    },
  ]);

  return {
    ...patch,
    destination: trip.destination || undefined,
    preferences,
  };
};

const mergeDayPreservingLocalState = (existing: DayPlan | undefined, incoming: DayPlan): DayPlan => ({
  ...incoming,
  completed: incoming.completed ?? existing?.completed ?? false,
});

const mergeDays = (existing: DayPlan[], incoming?: DayPlan[], focus?: FocusTarget | null) => {
  if (!incoming) return existing;
  if (focus && focus.type !== "trip" && existing.length) {
    const incomingFocusDay = incoming.find((day) => day.day === focus.day);
    if (!incomingFocusDay) return existing;
    return existing.map((day) => (day.day === focus.day ? mergeDayPreservingLocalState(day, incomingFocusDay) : day));
  }
  if (existing.length) {
    const incomingByDay = new Map(incoming.map((day) => [day.day, day]));
    const merged = existing.map((day) => {
      const incomingDay = incomingByDay.get(day.day);
      if (!incomingDay) return day;
      incomingByDay.delete(day.day);
      return mergeDayPreservingLocalState(day, incomingDay);
    });
    return [...merged, ...Array.from(incomingByDay.values()).sort((a, b) => a.day - b.day)];
  }
  return incoming.map((day) => mergeDayPreservingLocalState(existing.find((existingDay) => existingDay.day === day.day), day));
};

const applyTripPatch = (trip: TripState, patch: TripPatch, focus?: FocusTarget | null, userText = ""): TripState => {
  const guardedPatch = applyPreferenceConflictGuards(trip, patch, userText);
  return {
    ...trip,
    ...guardedPatch,
    currency: guardedPatch.currency ?? trip.currency ?? "CHF",
    preferences: mergePreferences(trip.preferences, guardedPatch.preferences, userText),
    days: mergeDays(trip.days, guardedPatch.days, focus),
  };
};

const markPatchDaysDraft = (patch: TripPatch): TripPatch => ({
  ...patch,
  days: patch.days?.map((day) => ({ ...day, completed: false })),
});

const normalizeDayForDiff = (day: DayPlan | undefined) => {
  if (!day) return null;
  return {
    ...day,
    completed: undefined,
  };
};

const isDayChanged = (existing: DayPlan | undefined, incoming: DayPlan) =>
  JSON.stringify(normalizeDayForDiff(existing)) !== JSON.stringify(normalizeDayForDiff(incoming));

const isBroadFocusRequest = (text: string) =>
  /\b(all days|every day|whole trip|entire trip|full trip|all hotels|for the whole stay|complete trip|days 1-7|tag 1-7|alle tage|ganze reise|gesamte reise|überall|ueberall)\b/i.test(
    text,
  );

const isExplicitBroadFocusRequest = (text: string) =>
  /\b(all days|every day|whole trip|entire trip|full trip|all hotels|for the whole stay|complete trip|days 1-7|tag 1-7|alle tage|ganze reise|gesamte reise|ueberall|uberall)\b/i.test(
    text,
  );

const getFocusedDayPatch = (existing: DayPlan | undefined, incoming: DayPlan, focus: FocusTarget): DayPlan => {
  if (!existing || focus.type === "day") return incoming;

  if (focus.type === "hotel") {
    return {
      ...existing,
      hotel: incoming.hotel,
      spend: incoming.spend ?? existing.spend,
      warning: incoming.warning ?? existing.warning,
      completed: incoming.completed ?? existing.completed,
    };
  }

  const replacement = incoming.activities[focus.activityIndex];
  if (!replacement) return existing;

  return {
    ...existing,
    activities: existing.activities.map((activity, index) => (index === focus.activityIndex ? replacement : activity)),
    spend: incoming.spend ?? existing.spend,
    warning: incoming.warning ?? existing.warning,
    completed: incoming.completed ?? existing.completed,
  };
};

const preparePendingFocusPatch = (trip: TripState, patch: TripPatch, focus: FocusTarget, userText: string): TripPatch | undefined => {
  if (!patch.days?.length) return undefined;

  if (focus.type === "trip") return preparePendingTripPatch(trip, patch);

  const broadRequest = isExplicitBroadFocusRequest(userText) || isBroadFocusRequest(userText);
  const candidateDays = broadRequest
    ? patch.days
    : patch.days
        .filter((day) => day.day === focus.day)
        .map((day) => getFocusedDayPatch(trip.days.find((existing) => existing.day === day.day), day, focus));

  const changedDays = candidateDays.filter((day) => isDayChanged(trip.days.find((existing) => existing.day === day.day), day));
  if (!changedDays.length) return undefined;

  return {
    ...patch,
    days: changedDays,
  };
};

const preparePendingTripPatch = (trip: TripState, patch: TripPatch): TripPatch | undefined => {
  if (!patch.days?.length) return undefined;
  const changedDays = patch.days.filter((day) => isDayChanged(trip.days.find((existing) => existing.day === day.day), day));
  if (!changedDays.length) return undefined;
  return {
    ...patch,
    days: changedDays,
  };
};

const removePendingDay = (pending: PendingEdit, dayNumber: number): PendingEdit | null => {
  const remainingDays = pending.patch.days?.filter((day) => day.day !== dayNumber) ?? [];
  if (!remainingDays.length) return null;
  return {
    ...pending,
    patch: {
      ...pending.patch,
      days: remainingDays,
    },
  };
};

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
  const useDevProxy = typeof window !== "undefined" && window.location.protocol.startsWith("http");

  if (!useDevProxy && !GEMINI_API_KEY) {
    const missingKeyMessage = "API key is missing. Set VITE_GEMINI_API_KEY in .env.local.";
    onChunk(missingKeyMessage);
    return missingKeyMessage;
  }

  const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  const url = useDevProxy ? "/api/gemini/stream" : directUrl;
  const requestId = makeId();
  const contextString = getTravelContextString(condition, state);
  const planningStageGuidance = getPlanningStageGuidance(state, chatHistory);
  const fullSystemPrompt = condition === "B" ? `${SYSTEM_PROMPT_B}\n\n${contextString}\n\n${planningStageGuidance}` : "";
  const contents = chatHistory.map((message) => ({
    role: message.sender === "user" ? "user" : "model",
    parts: [{ text: getMessageTextForModel(message) }],
  }));

  const requestPayload =
    condition === "B"
      ? {
          system_instruction: { parts: [{ text: fullSystemPrompt }] },
          contents,
        }
      : {
          contents,
        };

  console.groupCollapsed(`[VoyagerLab] Gemini request ${requestId} ${new Date().toLocaleTimeString()}`);
  console.log("Condition", condition);
  console.log("Model", GEMINI_MODEL);
  console.log("System prompt", fullSystemPrompt || "(none)");
  console.log("Complete history", contents);
  console.log("Request payload", requestPayload);
  console.groupEnd();
  appendResearchConsoleEntry("api_request", `Condition ${condition} request ${requestId}`, {
    requestId,
    condition,
    model: GEMINI_MODEL,
    systemPrompt: fullSystemPrompt || null,
    contents,
  });

  appendEventIfAvailable(eventsRef, {
    type: "api_request",
    role: "system",
    content: "VoyagerAI request",
    metadata: { requestId, condition, model: GEMINI_MODEL, systemPrompt: fullSystemPrompt || null, contents },
  });

  let retries = 4;
  let delay = 1500;
  let rawResponse = "";
  let attempt = 0;

  while (retries > 0) {
    try {
      attempt += 1;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useDevProxy ? { requestId, condition, model: GEMINI_MODEL, attempt, requestPayload } : requestPayload),
      });

      console.log("[VoyagerLab] Gemini response status", { requestId, condition, attempt, status: response.status });

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

      console.groupCollapsed(`[VoyagerLab] Gemini raw response ${requestId} ${new Date().toLocaleTimeString()}`);
      console.log(rawResponse);
      console.groupEnd();
      appendResearchConsoleEntry("api_response", `Condition ${condition} response ${requestId}`, {
        requestId,
        condition,
        model: GEMINI_MODEL,
        rawResponse,
      });

      appendEventIfAvailable(eventsRef, {
        type: "api_response",
        role: "ai",
        content: rawResponse,
        metadata: { requestId, condition, model: GEMINI_MODEL },
      });

      return rawResponse;
    } catch (error) {
      if (error instanceof RetryableGeminiError && retries > 1) {
        retries -= 1;
        console.info(`[VoyagerLab] Gemini high-demand response for ${requestId} attempt ${attempt}. Retrying in ${delay} ms.`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      const message = error instanceof Error ? error.message : "Unknown VoyagerAI error";
      console.error("[VoyagerLab] Gemini request failed", error);
      appendResearchConsoleEntry("api_error", `Condition ${condition} request failed ${requestId}`, {
        requestId,
        condition,
        error: serializeError(error),
      });
      postClientLog({
        type: "voyagerai_request_failed",
        requestId,
        condition,
        error: serializeError(error),
      });
      appendEventIfAvailable(eventsRef, {
        type: "api_error",
        role: "system",
        content: message,
        metadata: { requestId, condition },
      });

      const visibleMessage =
        error instanceof RetryableGeminiError
          ? "The assistant is still reconnecting. Please try again in a moment."
          : "System error: VoyagerAI could not complete the response. Please check the researcher console.";
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

const postClientLog = (payload: Record<string, unknown>) => {
  if (typeof window === "undefined" || !window.location.protocol.startsWith("http")) return;
  appendResearchConsoleEntry(String(payload.type || "client_log"), String(payload.message || payload.type || "client log"), payload);
  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      url: window.location.href,
      ...payload,
    }),
  }).catch(() => {
    // Logging must never affect the experiment UI.
  });
};

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
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

function FocusBanner({ focus, onCancel }: { focus: FocusTarget; onCancel: () => void }) {
  return (
    <div className="z-10 flex flex-shrink-0 items-center justify-between border-b px-5 py-2.5" style={{ background: T_LIGHT, borderColor: T_BORDER }}>
      <div className="flex items-center gap-2">
        <Pencil className="h-3.5 w-3.5" style={{ color: T }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T }}>
          Focus: {focus.label}
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

function PendingEditReview({
  pending,
}: {
  pending: PendingEdit;
}) {
  const affectedDays = pending.patch.days?.map((day) => `Day ${day.day}`).join(", ") || pending.focus.label;

  return (
    <div className="z-10 border-b px-5 py-3" style={{ background: AMBER_LIGHT, borderColor: AMBER_BORDER }}>
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: AMBER }}>
        <AlertTriangle className="h-3.5 w-3.5" />
        Pending itinerary change
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-slate-700">
          VoyagerAI proposed changes for {affectedDays}. Review them in the itinerary before updating the plan.
        </p>
      </div>
    </div>
  );
}

class OpenUIErrorBoundary extends React.Component<
  { code: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previousProps: { code: string }) {
    if (previousProps.code !== this.props.code && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[VoyagerLab] OpenUI renderer crashed", {
      error,
      componentStack: info.componentStack,
      openUI: this.props.code,
    });
    postClientLog({
      type: "openui_renderer_crash",
      error: serializeError(error),
      componentStack: info.componentStack,
      openUI: this.props.code,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mt-2 rounded-2xl border px-4 py-3 text-sm" style={{ background: RED_LIGHT, borderColor: RED_BORDER, color: RED }}>
        <div className="font-bold">Interactive widget could not be rendered.</div>
        <div className="mt-1 text-xs opacity-80">The chat answer is still available. The malformed interactive block was logged for debugging.</div>
      </div>
    );
  }
}

function ChatMessageRow({
  message,
  isStreaming,
  onOpenUIAction,
}: {
  message: Message;
  isStreaming?: boolean;
  onOpenUIAction: (event: ActionEvent) => void;
}) {
  if (message.sender === "user") {
    return (
      <div className="mb-4 flex items-end justify-end gap-2">
        {message.source === "ui_action" && <span className="pb-1 text-[10px] text-gray-400">via widget</span>}
        <div className="max-w-[80%]">
          <div className="rounded-2xl rounded-tr-none px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm" style={{ background: T }}>
            {message.text}
            <div className="mt-1 text-right text-[10px] text-white/70">{formatMessageTime(message.timestamp)}</div>
          </div>
        </div>
      </div>
    );
  }

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
            <div className="mt-2 text-right text-[10px] text-gray-400">{formatMessageTime(message.timestamp)}</div>
          </div>
        </div>
      )}
      {message.openUI && (
        <div className={`${message.text.trim() ? "ml-9" : ""} mt-1 max-w-[92%]`}>
          <OpenUIErrorBoundary code={message.openUI}>
            <Renderer
              response={message.openUI}
              library={travelOpenUILibrary}
              isStreaming={isStreaming}
              onAction={onOpenUIAction}
              onError={(errors: OpenUIError[]) => {
                if (errors.length) {
                  console.warn("[VoyagerLab] OpenUI render errors", errors, message.openUI);
                  postClientLog({
                    type: "openui_render_errors",
                    messageId: message.id,
                    errors,
                    openUI: message.openUI,
                  });
                }
              }}
            />
          </OpenUIErrorBoundary>
        </div>
      )}
      {message.openUIError && (
        <div className={`${message.text.trim() ? "ml-9" : ""} mt-1 max-w-[92%] rounded-2xl border px-4 py-3 text-xs`} style={{ background: RED_LIGHT, borderColor: RED_BORDER, color: RED }}>
          {message.openUIError}
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
              textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
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
          className="flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm text-gray-700 outline-none"
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
function MetricsGrid({
  trip,
  onExportTrip,
  onRequestReviewFix,
}: {
  trip: TripState;
  onExportTrip?: () => void;
  onRequestReviewFix?: (issues: CoverageIssue[]) => void;
}) {
  const metrics = metricCardsFromTrip(trip);
  const coverageIssues = computeCoverageIssues(trip);
  const missingCount = coverageIssues.filter((issue) => issue.severity === "missing").length;

  return (
    <div className="flex-shrink-0 border-b border-gray-200" style={{ background: METRICS_BG }}>
      <div className="px-6 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" style={{ color: T }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T }}>
              Live Trip Performance
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRequestReviewFix?.(coverageIssues)}
              className="flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
              style={{ borderColor: missingCount ? AMBER_BORDER : T_BORDER, color: missingCount ? AMBER : T }}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              Validate Feasibility
            </button>
            {onExportTrip && (
            <button
              onClick={onExportTrip}
              className="flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
              style={{ borderColor: T_BORDER, color: T }}
            >
              <Download className="h-3.5 w-3.5" />
              Export Trip CSV
            </button>
            )}
          </div>
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

function PendingValueChange({ label, oldValue, newValue }: { label: string; oldValue?: string; newValue?: string }) {
  if ((oldValue || "") === (newValue || "")) return null;
  return (
    <div className="rounded-xl border bg-white px-3 py-2 text-xs" style={{ borderColor: AMBER_BORDER }}>
      <div className="mb-1 font-bold uppercase tracking-wide text-slate-400">{label}</div>
      {oldValue && <div className="text-red-500 line-through">{oldValue}</div>}
      {newValue && <div className="font-semibold text-green-600">{newValue}</div>}
    </div>
  );
}

const formatActivityForPreview = (activity: Activity | undefined) => {
  if (!activity) return "";
  const time = activity.endTime ? `${activity.time || "--:--"}-${activity.endTime}` : activity.time || "--:--";
  return [time, activity.name, activity.note, typeof activity.cost === "number" ? formatMoney(activity.cost) : ""].filter(Boolean).join(" | ");
};

function PendingDayPreview({
  currentDay,
  pendingDay,
  onAccept,
  onReject,
}: {
  currentDay: DayPlan;
  pendingDay: DayPlan;
  onAccept: () => void;
  onReject: () => void;
}) {
  const activityCount = Math.max(currentDay.activities.length, pendingDay.activities.length);

  return (
    <div className="mb-3 rounded-2xl border px-4 py-3" style={{ background: AMBER_LIGHT, borderColor: AMBER_BORDER }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: AMBER }}>
          <AlertTriangle className="h-3.5 w-3.5" />
          Pending review for Day {pendingDay.day}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onReject}
            className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50"
            style={{ borderColor: AMBER_BORDER, color: AMBER }}
          >
            Reject
          </button>
          <button
            onClick={onAccept}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
            style={{ background: T }}
          >
            Accept
          </button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <PendingValueChange label="Title" oldValue={currentDay.title} newValue={pendingDay.title} />
        <PendingValueChange label="Location" oldValue={currentDay.location || currentDay.city} newValue={pendingDay.location || pendingDay.city} />
        <PendingValueChange label="Hotel" oldValue={currentDay.hotel?.name} newValue={pendingDay.hotel?.name} />
        <PendingValueChange
          label="Hotel cost"
          oldValue={typeof currentDay.hotel?.pricePerNight === "number" ? formatMoney(currentDay.hotel.pricePerNight) : undefined}
          newValue={typeof pendingDay.hotel?.pricePerNight === "number" ? formatMoney(pendingDay.hotel.pricePerNight) : undefined}
        />
        {Array.from({ length: activityCount }, (_, index) => (
          <PendingValueChange
            key={index}
            label={`Activity ${index + 1}`}
            oldValue={formatActivityForPreview(currentDay.activities[index])}
            newValue={formatActivityForPreview(pendingDay.activities[index])}
          />
        ))}
      </div>
    </div>
  );
}

function ItineraryArtifact({
  trip,
  focus,
  pendingEdit,
  disabledActions,
  onSetFocus,
  onToggleDayComplete,
  onValidateDay,
  onAcceptPendingDay,
  onRejectPendingDay,
}: {
  trip: TripState;
  focus: FocusTarget | null;
  pendingEdit: PendingEdit | null;
  disabledActions?: boolean;
  onSetFocus: (focus: FocusTarget) => void;
  onToggleDayComplete: (day: number) => void;
  onValidateDay: (day: number) => void;
  onAcceptPendingDay: PendingDayAction;
  onRejectPendingDay: PendingDayAction;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const autoExpandedRef = useRef(false);

  useEffect(() => {
    if (!trip.days.length) {
      autoExpandedRef.current = false;
      return;
    }
    if (!autoExpandedRef.current) {
      setExpanded(trip.days[0].day);
      autoExpandedRef.current = true;
    }
  }, [trip.days]);

  useEffect(() => {
    const firstPendingDay = pendingEdit?.patch.days?.[0]?.day;
    if (firstPendingDay) setExpanded(firstPendingDay);
  }, [pendingEdit]);

  if (!trip.days.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center opacity-70">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: T_LIGHT }}>
          <MapIcon className="h-7 w-7" style={{ color: T }} />
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
        {trip.status && !isInternalPhaseStatus(trip.status) && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-500 shadow-sm">{trip.status}</span>}
      </div>

      {trip.days.map((day) => {
        const isOpen = expanded === day.day;
        const fallbackNightlyCost = extractNightlyCostFromPreferences(trip.preferences);
        const dayCost = computeDayCost(day, fallbackNightlyCost);
        const isDayFocused = focus?.type !== "trip" && focus?.day === day.day;
        const pendingDay = pendingEdit?.patch.days?.find((candidate) => candidate.day === day.day);
        const locationLabel = day.location || day.city || trip.destination;
        const hotelLabel = day.hotel?.name || (fallbackNightlyCost ? "Selected accommodation" : "");
        return (
          <div
            key={day.day}
            className="overflow-hidden rounded-2xl border bg-white shadow-sm transition-all"
            style={{ borderWidth: isDayFocused ? 2 : 1, borderColor: isDayFocused ? T : day.warning ? RED_BORDER : "#E2E8F0" }}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : day.day)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
              style={{ background: isDayFocused ? T_LIGHT : "white" }}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" style={{ color: day.warning ? RED : isDayFocused ? T : "#374151" }}>
                  Day {day.day}: {day.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-400">
                  {locationLabel ? `${locationLabel} - ` : ""}
                  {day.activities.length} activities
                  {hotelLabel ? ` - Stay: ${hotelLabel}` : ""}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={day.completed ? { background: GREEN_LIGHT, color: GREEN } : { background: "#F1F5F9", color: "#94A3B8" }}>
                  {day.completed ? "Completed" : "Draft"}
                </span>
                {pendingDay && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: AMBER_LIGHT, color: AMBER }}>
                    Pending
                  </span>
                )}
                {dayCost > 0 && <span className="text-xs font-semibold" style={{ color: day.warning ? RED : T }}>{formatMoney(dayCost, trip.currency)}</span>}
                {day.warning ? <AlertTriangle className="h-4 w-4" style={{ color: RED }} /> : isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                {pendingDay && (
                  <PendingDayPreview
                    currentDay={day}
                    pendingDay={pendingDay}
                    onAccept={() => onAcceptPendingDay(day.day)}
                    onReject={() => onRejectPendingDay(day.day)}
                  />
                )}
                {day.summary && <p className="mb-3 rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-gray-500">{day.summary}</p>}

                <div className="mb-3 space-y-2">
                  {day.hotel && (
                    <div className="flex items-start gap-3 rounded-xl bg-white px-3 py-2">
                      <span className="mt-0.5 flex w-20 flex-shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        <Hotel className="h-3.5 w-3.5" />
                        Stay
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-700">{day.hotel.name}</div>
                        <div className="text-xs text-gray-400">{[day.hotel.tier, day.hotel.city].filter(Boolean).join(" - ")}</div>
                      </div>
                      {typeof day.hotel.pricePerNight === "number" ? (
                        <span className="flex-shrink-0 text-xs font-semibold" style={{ color: T }}>{formatMoney(day.hotel.pricePerNight, trip.currency)}</span>
                      ) : (
                        <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: AMBER_LIGHT, color: AMBER }}>
                          Missing cost
                        </span>
                      )}
                      <button
                        onClick={() => onSetFocus({ type: "hotel", day: day.day, label: `Editing Day ${day.day} hotel` })}
                        className="flex-shrink-0 rounded-lg border bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition hover:bg-teal-50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
                        style={{ borderColor: T_BORDER, color: T }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                  {day.activities.map((activity, index) => (
                    <div key={`${activity.time}-${activity.name}-${index}`} className="flex items-start gap-3 rounded-xl bg-white px-3 py-2" style={activity.changed ? { background: GREEN_LIGHT } : undefined}>
                      <span className="mt-0.5 w-20 flex-shrink-0 font-mono text-[10px]" style={{ color: activity.endTime ? "#9CA3AF" : AMBER }}>
                        {activity.endTime ? `${activity.time || "--:--"}-${activity.endTime}` : `${activity.time || "--:--"}-?`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium" style={{ color: activity.changed ? GREEN : "#374151" }}>{activity.name}</div>
                        {activity.note && <div className="text-xs text-gray-400">{activity.note}</div>}
                      </div>
                      {typeof activity.cost === "number" && <span className="flex-shrink-0 text-xs font-semibold" style={{ color: T }}>{formatMoney(activity.cost, trip.currency)}</span>}
                      <button
                        onClick={() =>
                          onSetFocus({
                            type: "activity",
                            day: day.day,
                            activityIndex: index,
                            activityName: activity.name,
                            label: `Editing Day ${day.day} activity: ${activity.name}`,
                          })
                        }
                        className="flex-shrink-0 rounded-lg border bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition hover:bg-teal-50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
                        style={{ borderColor: T_BORDER, color: T }}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 border-t border-gray-100 pt-2.5">
                  <button
                    disabled={disabledActions}
                    onClick={(event) => {
                      event.stopPropagation();
                      onValidateDay(day.day);
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ border: `1.5px solid ${AMBER}`, color: AMBER, background: "white" }}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    Validate day
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleDayComplete(day.day);
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200"
                    style={day.completed ? { background: GREEN, color: "white" } : { border: `1.5px solid ${GREEN}`, color: GREEN, background: "white" }}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {day.completed ? "Completed" : "Mark day complete"}
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetFocus({ type: "day", day: day.day, label: `Editing Day ${day.day}` });
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
                    style={focus?.type === "day" && focus.day === day.day ? { background: T, color: "white" } : { border: `1.5px solid ${T}`, color: T, background: "white" }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {focus?.type === "day" && focus.day === day.day ? "Currently editing" : "Edit this day"}
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
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[VoyagerLab] App crashed", error, info.componentStack);
    postClientLog({
      type: "app_error_boundary",
      error: serializeError(error),
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 px-6" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="max-w-lg rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: RED_BORDER }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: RED }}>
            <AlertTriangle className="h-4 w-4" />
            Application error captured
          </div>
          <p className="text-sm leading-relaxed text-slate-600">
            The session UI hit an unexpected error. The details were sent to the Vite terminal log.
          </p>
          <button
            className="mt-4 rounded-xl px-4 py-2 text-sm font-bold text-white"
            style={{ background: T }}
            onClick={() => this.setState({ error: null })}
          >
            Try to recover
          </button>
        </div>
      </div>
    );
  }
}

function AppShell() {
  const [sessionActive, setSessionActive] = useState(false);
  const [consoleMode, setConsoleMode] = useState(() => typeof window !== "undefined" && window.location.hash === "#console");
  const [state, setState] = useState<S>({
    condition: "B",
    participantId: "",
    researcher: "",
    trip: emptyTripState(),
    focus: null,
  });

  const updateState: StateUpdater = (update) => {
    setState((previous) => (typeof update === "function" ? update(previous) : { ...previous, ...update }));
  };

  const resetSession = () => {
    updateState((previous) => ({
      ...previous,
      participantId: "",
      researcher: "",
      trip: emptyTripState(),
      focus: null,
    }));
    setSessionActive(false);
  };

  useEffect(() => {
    const handleHashChange = () => setConsoleMode(window.location.hash === "#console");
    const handleError = (event: ErrorEvent) => {
      postClientLog({
        type: "window_error",
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: serializeError(event.error),
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      postClientLog({
        type: "unhandled_rejection",
        reason: serializeError(event.reason),
      });
    };

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  if (consoleMode) return <ResearchConsoleScreen onBack={() => { window.location.hash = ""; setConsoleMode(false); }} />;

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

export default function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}

function ResearchConsoleScreen({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<ResearchConsoleEntry[]>([]);
  const [selectedType, setSelectedType] = useState("all");

  const loadEntries = () => {
    try {
      setEntries(JSON.parse(window.localStorage.getItem(RESEARCH_CONSOLE_KEY) || "[]") as ResearchConsoleEntry[]);
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    loadEntries();
    const handleLog = () => loadEntries();
    const interval = window.setInterval(loadEntries, 1500);
    window.addEventListener("storage", handleLog);
    window.addEventListener("voyagerlab-console-log", handleLog);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", handleLog);
      window.removeEventListener("voyagerlab-console-log", handleLog);
    };
  }, []);

  const types = ["all", ...Array.from(new Set(entries.map((entry) => entry.type))).sort()];
  const visibleEntries = selectedType === "all" ? entries : entries.filter((entry) => entry.type === selectedType);

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4" style={{ color: T_BORDER }} />
          <span className="text-sm font-bold">VoyagerLab Research Console</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">{entries.length} events</span>
        </div>
        <button onClick={onBack} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800">
          Back to setup
        </button>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-5 py-3">
        {types.map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className="rounded-full border px-3 py-1 text-xs font-semibold transition"
            style={{
              borderColor: selectedType === type ? T_BORDER : "#334155",
              background: selectedType === type ? T : "transparent",
              color: selectedType === type ? "white" : "#CBD5E1",
            }}
          >
            {type}
          </button>
        ))}
        <button
          onClick={() => {
            window.localStorage.removeItem(RESEARCH_CONSOLE_KEY);
            setEntries([]);
          }}
          className="ml-auto rounded-lg border border-red-900 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-950"
        >
          Clear console
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {visibleEntries.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-5 py-8 text-center text-sm text-slate-400">
            No console events yet. Keep this tab open while running a participant session in another tab.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleEntries.slice().reverse().map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-200">{entry.type}</span>
                  <span className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</span>
                  <span className="text-sm font-semibold text-slate-200">{entry.summary}</span>
                </div>
                {entry.payload !== undefined && (
                  <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
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
          <button
            onClick={() => window.open(`${window.location.pathname}${window.location.search}#console`, "_blank", "noopener,noreferrer")}
            className="flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-slate-50"
            style={{ borderColor: T_BORDER, color: T }}
          >
            <Terminal className="h-3.5 w-3.5" />
            Console
          </button>
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
            {validationError && (
              <div className="rounded-2xl border px-4 py-3 text-sm font-semibold" style={{ background: RED_LIGHT, borderColor: RED_BORDER, color: RED }}>
                Participant ID and Researcher are required before launching a session.
              </div>
            )}
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

    try {
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

      appendEvent(eventsRef, {
        type: "chat_ai",
        role: "ai",
        messageId: aiMsgId,
        content: rawResponse,
        wordCount: countWords(rawResponse),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown chat error";
      console.error("[VoyagerLab] Condition A send failed", error);
      postClientLog({ type: "condition_a_send_failed", error: serializeError(error) });
      appendEvent(eventsRef, { type: "api_error", role: "system", messageId: aiMsgId, content: message });
      setMessages((previous) => {
        const updated = previous.map((item) =>
          item.id === aiMsgId
            ? { ...item, text: `System error: VoyagerAI could not complete the response.`, rawText: `System error: ${message}`, wordCount: countWords(message) }
            : item,
        );
        messagesRef.current = updated;
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
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
          <ChatMessageRow key={message.id} message={message} isStreaming={isLoading && message.id === messages[messages.length - 1]?.id} onOpenUIAction={() => undefined} />
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
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const stateRef = useRef(state);
  const eventsRef = useRef<SessionEvent[]>([]);
  const startRef = useRef({ time: Date.now(), str: new Date().toISOString() });
  const endRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

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
    const container = chatScrollRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });
  }, [messages, state.focus]);

  const applyOpenUITripPatch = (patch: TripPatch, messageId: string, focusOverride?: FocusTarget | null, userText = "") => {
    updateState((previous) => ({
      ...previous,
      trip: applyTripPatch(previous.trip, patch, focusOverride === undefined ? previous.focus : focusOverride, userText),
    }));
    appendEvent(eventsRef, {
      type: "state_update",
      role: "system",
      messageId,
      content: "OpenUI StateUpdate applied",
      metadata: patch,
    });
  };

  const handleSend = async (text: string, source: "typed" | "ui_action" = "typed", visibleText = text) => {
    const userMsg: Message = {
      id: makeId(),
      text: visibleText,
      rawText: text,
      sender: "user",
      source,
      timestamp: getTimestamp(),
      wordCount: countWords(visibleText),
    };
    const newHistory = [...messagesRef.current, userMsg];
    messagesRef.current = newHistory;
    setMessages(newHistory);
    appendEvent(eventsRef, { type: "chat_user", role: "user", messageId: userMsg.id, source, wordCount: userMsg.wordCount, content: visibleText, metadata: visibleText === text ? undefined : { rawText: text } });

    setIsLoading(true);
    const aiMsgId = makeId();
    const aiPlaceholder: Message = { id: aiMsgId, text: "", rawText: "", sender: "ai", timestamp: getTimestamp(), wordCount: 0 };
    messagesRef.current = [...newHistory, aiPlaceholder];
    setMessages(messagesRef.current);

    try {
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
              wordCount: countWords(parsed.text),
            };
          });
          messagesRef.current = updated;
          return updated;
        });
      }, eventsRef);

      const finalParsed = splitAssistantResponse(rawResponse);
      const finalOpenUI = finalParsed.openUI;
      let renderableOpenUI: string | undefined;
      let openUIError: string | undefined;
      let patchToApply: TripPatch | undefined;

      if (finalOpenUI) {
        const { patch, errors } = parseTripPatchFromOpenUI(finalOpenUI);
        if (errors.length) {
          openUIError = "VoyagerAI returned an interactive element that could not be displayed.";
          console.warn("[VoyagerLab] OpenUI parse errors after final Gemini response", errors, finalOpenUI);
          postClientLog({
            type: "openui_parse_error",
            messageId: aiMsgId,
            errors,
            openUI: finalOpenUI,
          });
          appendEvent(eventsRef, {
            type: "api_error",
            role: "system",
            messageId: aiMsgId,
            content: "OpenUI parse errors after final Gemini response",
            metadata: { errors, openUI: finalOpenUI },
          });
        } else {
          const suppressionReason = getOpenUISuppressionReason(finalOpenUI, stateRef.current.trip);
          if (suppressionReason) {
            console.info("[VoyagerLab] OpenUI widget suppressed", suppressionReason, finalOpenUI);
            postClientLog({
              type: "openui_widget_suppressed",
              messageId: aiMsgId,
              reason: suppressionReason,
              openUI: finalOpenUI,
            });
            appendEvent(eventsRef, {
              type: "state_update",
              role: "system",
              messageId: aiMsgId,
              content: suppressionReason,
              metadata: { openUI: finalOpenUI },
            });
          } else {
            renderableOpenUI = finalOpenUI;
          }
          patchToApply = patch;
        }
      } else if (finalParsed.malformedOpenUI) {
        openUIError = "VoyagerAI returned an incomplete interactive element that could not be displayed.";
        console.warn("[VoyagerLab] Incomplete OpenUI block skipped", finalParsed.malformedOpenUI);
        postClientLog({
          type: "openui_incomplete_block",
          messageId: aiMsgId,
          openUI: finalParsed.malformedOpenUI,
        });
        appendEvent(eventsRef, {
          type: "api_error",
          role: "system",
          messageId: aiMsgId,
          content: "Incomplete OpenUI block skipped",
          metadata: { openUI: finalParsed.malformedOpenUI },
        });
      }

      setMessages((previous) => {
        const updated = previous.map((message) =>
          message.id === aiMsgId
            ? {
                ...message,
                rawText: rawResponse,
                text: finalParsed.text || message.text,
                openUI: renderableOpenUI,
                openUIError,
                wordCount: countWords(finalParsed.text || message.text),
              }
            : message,
        );
        messagesRef.current = updated;
        return updated;
      });

      if (patchToApply) {
        const activeFocus = stateRef.current.focus;
        if (activeFocus && patchToApply.days?.length) {
          const pendingPatch = preparePendingFocusPatch(stateRef.current.trip, patchToApply, activeFocus, text);
          if (pendingPatch?.days?.length) {
            setPendingEdit({ id: makeId(), messageId: aiMsgId, patch: pendingPatch, focus: activeFocus, userText: text });
            appendEvent(eventsRef, {
              type: "state_update",
              role: "system",
              messageId: aiMsgId,
              content: "Focused itinerary patch held for review",
              metadata: { patch: pendingPatch, focus: activeFocus },
            });
            postClientLog({
              type: "state_patch_pending_review",
              messageId: aiMsgId,
              patch: pendingPatch,
              focus: activeFocus,
            });
          } else {
            const nonItineraryPatch: TripPatch = { ...patchToApply, days: undefined };
            if (Object.keys(nonItineraryPatch).some((key) => key !== "days" && nonItineraryPatch[key as keyof TripPatch] !== undefined)) {
              applyOpenUITripPatch(nonItineraryPatch, aiMsgId, null, text);
              postClientLog({
                type: "state_patch_applied_without_itinerary_changes",
                messageId: aiMsgId,
                patch: nonItineraryPatch,
                focus: activeFocus,
              });
            }
          }
        } else if (patchToApply.days?.length && stateRef.current.trip.days.length) {
          const pendingPatch = preparePendingTripPatch(stateRef.current.trip, patchToApply);
          if (pendingPatch?.days?.length) {
            setPendingEdit({
              id: makeId(),
              messageId: aiMsgId,
              patch: { ...patchToApply, days: pendingPatch.days },
              focus: { type: "trip", label: "Reviewing itinerary changes" },
              userText: text,
            });
            appendEvent(eventsRef, {
              type: "state_update",
              role: "system",
              messageId: aiMsgId,
              content: "Itinerary patch held for review",
              metadata: { patch: { ...patchToApply, days: pendingPatch.days } },
            });
            postClientLog({
              type: "state_patch_pending_review",
              messageId: aiMsgId,
              patch: { ...patchToApply, days: pendingPatch.days },
              focus: { type: "trip", label: "Reviewing itinerary changes" },
            });
          } else {
            const nonItineraryPatch: TripPatch = { ...patchToApply, days: undefined };
            if (Object.keys(nonItineraryPatch).some((key) => key !== "days" && nonItineraryPatch[key as keyof TripPatch] !== undefined)) {
              applyOpenUITripPatch(nonItineraryPatch, aiMsgId, null, text);
              postClientLog({
                type: "state_patch_applied_without_itinerary_changes",
                messageId: aiMsgId,
                patch: nonItineraryPatch,
              });
            }
          }
        } else {
          applyOpenUITripPatch(patchToApply, aiMsgId, undefined, text);
          postClientLog({
            type: "state_patch_applied",
            messageId: aiMsgId,
            patch: patchToApply,
          });
        }
      }

      appendEvent(eventsRef, {
        type: "chat_ai",
        role: "ai",
        messageId: aiMsgId,
        content: rawResponse,
        wordCount: countWords(rawResponse),
        metadata: { openUI: finalOpenUI ?? null, openUIError: openUIError ?? null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown chat error";
      console.error("[VoyagerLab] Condition B send failed", error);
      postClientLog({ type: "condition_b_send_failed", error: serializeError(error) });
      appendEvent(eventsRef, { type: "api_error", role: "system", messageId: aiMsgId, content: message });
      setMessages((previous) => {
        const updated = previous.map((item) =>
          item.id === aiMsgId
            ? { ...item, text: `System error: VoyagerAI could not complete the response.`, rawText: `System error: ${message}`, wordCount: countWords(message) }
            : item,
        );
        messagesRef.current = updated;
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
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

  const setEditFocus = (focus: FocusTarget) => {
    setPendingEdit(null);
    updateState({ focus });
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "itinerary_focus",
      content: `Focus ${focus.label}`,
      metadata: focus,
    });
  };

  const acceptPendingDay = (dayNumber: number) => {
    if (!pendingEdit) return;
    const day = pendingEdit.patch.days?.find((candidate) => candidate.day === dayNumber);
    if (!day) return;
    const isLastPendingDay = (pendingEdit.patch.days?.length ?? 0) === 1;
    const patch = markPatchDaysDraft(isLastPendingDay ? { ...pendingEdit.patch, days: [day] } : { days: [day] });
    applyOpenUITripPatch(patch, pendingEdit.messageId, null, pendingEdit.userText ?? "");
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "pending_edit",
      content: `Accept focused itinerary changes for Day ${dayNumber}`,
      metadata: { pendingId: pendingEdit.id, focus: pendingEdit.focus, day: dayNumber, patch },
    });
    setPendingEdit((current) => (current ? removePendingDay(current, dayNumber) : null));
  };

  const rejectPendingDay = (dayNumber: number) => {
    if (!pendingEdit) return;
    const day = pendingEdit.patch.days?.find((candidate) => candidate.day === dayNumber);
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "pending_edit",
      content: `Reject focused itinerary changes for Day ${dayNumber}`,
      metadata: { pendingId: pendingEdit.id, focus: pendingEdit.focus, day: dayNumber, patch: day },
    });
    setPendingEdit((current) => (current ? removePendingDay(current, dayNumber) : null));
  };

  const toggleDayComplete = (dayNumber: number) => {
    let nextCompleted = false;
    updateState((previous) => {
      const days = previous.trip.days.map((day) => {
        if (day.day !== dayNumber) return day;
        nextCompleted = !day.completed;
        return { ...day, completed: nextCompleted };
      });
      return { ...previous, trip: { ...previous.trip, days } };
    });
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "itinerary_complete",
      content: `${nextCompleted ? "Mark complete" : "Mark incomplete"} Day ${dayNumber}`,
      metadata: { day: dayNumber, completed: nextCompleted },
    });
    appendEvent(eventsRef, {
      type: "state_update",
      role: "system",
      source: "itinerary_complete",
      content: `Day ${dayNumber} completion updated`,
      metadata: { day: dayNumber, completed: nextCompleted },
    });
  };

  const validateDay = (dayNumber: number) => {
    const issues = getBlockingDayCompletionIssues(stateRef.current.trip, dayNumber);
    handleRequestDayCompletionFix(dayNumber, issues);
  };

  const cancelFocus = () => {
    const previousFocus = stateRef.current.focus;
    setPendingEdit(null);
    updateState({ focus: null });
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

  const handleExportTrip = () => {
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "trip_export",
      content: "Export trip CSV",
      metadata: { metrics: computeTripMetrics(stateRef.current.trip), trip: stateRef.current.trip },
    });
    generateTripCSVAndDownload(stateRef.current);
  };

  const handleRequestReviewFix = (issues: CoverageIssue[]) => {
    if (isLoading) return;
    const message = formatCoverageReviewMessage(issues);
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "plan_review",
      content: "Ask VoyagerAI to resolve local completeness gaps",
      metadata: { issues },
    });
    void handleSend(message, "ui_action", "Check feasibility");
  };

  const handleRequestDayCompletionFix = (dayNumber: number, issues: CoverageIssue[]) => {
    if (isLoading) return;
    const message = formatDayCompletionReviewMessage(dayNumber, issues);
    const focus: FocusTarget = { type: "day", day: dayNumber, label: `Editing Day ${dayNumber}` };
    setPendingEdit(null);
    updateState({ focus });
    appendEvent(eventsRef, {
      type: "ui_action",
      role: "user",
      source: "day_completion_review",
      content: `Ask VoyagerAI to complete Day ${dayNumber}`,
      metadata: { day: dayNumber, issues, focus },
    });
    void handleSend(message, "ui_action", "Check feasibility");
  };

  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <div className="grid h-full min-h-0 w-full overflow-hidden bg-slate-50" style={{ gridTemplateColumns: "minmax(320px, 1fr) minmax(0, 2fr)" }}>
      <div className="relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-gray-200 bg-white shadow-xl">
        <ChatHeader onEndSession={handleEndSession} />
        {state.focus && <FocusBanner focus={state.focus} onCancel={cancelFocus} />}
        {pendingEdit && <PendingEditReview pending={pendingEdit} />}
        <div ref={chatScrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-2 pt-5">
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
            />
          ))}
          <div ref={endRef} />
        </div>
        <ChatInputBar onSend={(message) => handleSend(message, "typed")} disabled={isLoading} />
      </div>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <MetricsGrid trip={state.trip} onExportTrip={handleExportTrip} onRequestReviewFix={handleRequestReviewFix} />
        <div className="relative min-h-0 flex-1 overflow-y-auto px-8">
          <ItineraryArtifact
            trip={state.trip}
            focus={state.focus}
            pendingEdit={pendingEdit}
            disabledActions={isLoading}
            onSetFocus={setEditFocus}
            onToggleDayComplete={toggleDayComplete}
            onValidateDay={validateDay}
            onAcceptPendingDay={acceptPendingDay}
            onRejectPendingDay={rejectPendingDay}
          />
        </div>
        <PreferencesSection trip={state.trip} />
      </div>
    </div>
  );
}

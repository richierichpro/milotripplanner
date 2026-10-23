import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SquadMember } from "../core/types.js";

// One JSON file per chat in .data/chats/. Message text is never stored: only
// the limits Milo extracted and the id of the message each came from.

export type Stage = "intro" | "listening" | "heard" | "questions" | "destination_vote" | "solving" | "negotiating" | "hotel_vote" | "planning" | "done";

export type ChatState = {
  chatId: number;
  stage: Stage;
  listening: boolean;
  paused: boolean;
  squad: SquadMember[];
  trip: { destination?: string; startDate?: string; endDate?: string; interests: string[] };
  /** Places people named as where to go, in order. */
  mentioned: string[];
  planItNowSent: boolean;
  tripCard?: { messageId: number; pinned: boolean };
  decisions: string[];
  pending: string[];
  /** Squad adds that can still be undone, by callback token. */
  undo: Record<string, { memberId: string; addedBy: string }>;
  /** Per-step data (questions, votes, the plan) owned by later stages. */
  data: Record<string, unknown>;
  updatedAt: string;
};

const dir = () => path.join(process.cwd(), process.env.MILO_DATA_DIR ?? ".data", "chats");
const cache = new Map<number, ChatState>();

export function freshState(chatId: number): ChatState {
  return {
    chatId,
    stage: "intro",
    listening: false,
    paused: false,
    squad: [],
    trip: { interests: [] },
    mentioned: [],
    planItNowSent: false,
    decisions: [],
    pending: [],
    undo: {},
    data: {},
    updatedAt: new Date().toISOString(),
  };
}

export async function loadState(chatId: number): Promise<ChatState> {
  const hit = cache.get(chatId);
  if (hit) return hit;
  let state: ChatState;
  try {
    const saved = JSON.parse(await readFile(path.join(dir(), `${chatId}.json`), "utf8")) as ChatState;
    state = { ...freshState(chatId), ...saved };
  } catch {
    state = freshState(chatId);
  }
  cache.set(chatId, state);
  return state;
}

/** Written to a temp file and renamed, so a crash never leaves half a file. */
export async function saveState(state: ChatState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  cache.set(state.chatId, state);
  await mkdir(dir(), { recursive: true });
  const file = path.join(dir(), `${state.chatId}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${file}.tmp`, file);
}

export function resetState(chatId: number): ChatState {
  const s = freshState(chatId);
  cache.set(chatId, s);
  return s;
}

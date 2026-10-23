import type { Bot, RawApi, Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

// A fake Telegram for the simulator and tests: every API call is recorded and
// answered locally, and updates are fed straight into the bot's handlers.

export const FAKE_BOT: UserFromGetMe = {
  id: 999_000,
  is_bot: true,
  first_name: "Milo",
  username: "MiloTripPlannerBot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export type Sent = { method: string; payload: Record<string, unknown>; messageId?: number };
type Person = { id: number; name: string };

export class FakeTelegram {
  readonly sent: Sent[] = [];
  private nextMessageId = 100;
  private nextUpdateId = 1;

  constructor(readonly chatId = -1001, readonly title = "Goa trip 🌴") {}

  private get chat() {
    return { id: this.chatId, type: "supergroup" as const, title: this.title };
  }

  private user(p: Person) {
    return { id: p.id, is_bot: false, first_name: p.name };
  }

  /** Plug into bot.api.config.use(). */
  transformer(): Transformer<RawApi> {
    return async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const msg = (extra: Record<string, unknown> = {}) => ({ message_id: ++this.nextMessageId, date: Math.floor(Date.now() / 1000), chat: this.chat, ...extra });
      let result: unknown = true;
      let messageId: number | undefined;
      switch (method) {
        case "sendMessage":
        case "sendPhoto":
        case "sendDocument": {
          const m = msg({ text: p.text, caption: p.caption, from: FAKE_BOT });
          messageId = m.message_id;
          result = m;
          break;
        }
        case "sendMediaGroup": {
          const ms = ((p.media as unknown[]) ?? []).map(() => msg({ from: FAKE_BOT }));
          messageId = ms[0]?.message_id;
          result = ms;
          break;
        }
        case "editMessageText":
        case "editMessageCaption":
        case "editMessageMedia":
        case "editMessageReplyMarkup":
          result = msg({ text: p.text });
          break;
        case "getMe":
          result = FAKE_BOT;
          break;
      }
      this.sent.push({ method, payload: p, messageId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: true, result } as any;
    };
  }

  /** Someone adds Milo to the group. */
  async addBot(bot: Bot, by: Person) {
    await bot.handleUpdate({
      update_id: this.nextUpdateId++,
      my_chat_member: {
        chat: this.chat,
        from: this.user(by),
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: "left", user: FAKE_BOT },
        new_chat_member: { status: "member", user: FAKE_BOT },
      },
    } as Update);
  }

  /** A group message; returns its id. */
  async say(bot: Bot, from: Person, text: string, replyTo?: number): Promise<number> {
    const message_id = ++this.nextMessageId;
    const reply = replyTo ? { reply_to_message: { message_id: replyTo, date: 0, chat: this.chat, from: FAKE_BOT, text: "" } } : {};
    await bot.handleUpdate({
      update_id: this.nextUpdateId++,
      message: { message_id, date: Math.floor(Date.now() / 1000), chat: this.chat, from: this.user(from), text, ...reply },
    } as Update);
    return message_id;
  }

  /** Someone taps an inline button on a message Milo sent. */
  async tap(bot: Bot, from: Person, data: string, messageId?: number) {
    await bot.handleUpdate({
      update_id: this.nextUpdateId++,
      callback_query: {
        id: String(this.nextUpdateId),
        from: this.user(from),
        chat_instance: "sim",
        data,
        message: { message_id: messageId ?? this.lastWithButton(data) ?? 0, date: 0, chat: this.chat, from: FAKE_BOT, text: "" },
      },
    } as Update);
  }

  /** The latest message Milo sent with a button carrying this callback data. */
  lastWithButton(data: string): number | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const kb = (this.sent[i].payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined)?.inline_keyboard;
      if (kb?.some((row) => row.some((b) => b.callback_data === data))) return this.sent[i].messageId ?? (this.sent[i].payload.message_id as number);
    }
    return undefined;
  }

  /** Pop-ups shown to whoever tapped. */
  popups(): string[] {
    return this.sent.filter((s) => s.method === "answerCallbackQuery" && s.payload.text).map((s) => String(s.payload.text));
  }
}

/**
 * ============================================================================
 *  home.ts — July's "🏠 Home" feature
 * ============================================================================
 *
 *  What this file gives July:
 *
 *    /connect <integration>   Connect ANY Home Assistant integration from Telegram.
 *                             July asks you, one message at a time, for every field
 *                             Home Assistant needs (e.g. your LG token), then
 *                             finishes the setup. Example: /connect lg_thinq
 *    /cancel                  Stop a /connect that is in progress.
 *    /home                    Show a control panel for your air conditioner:
 *                             on/off, temperature −/+ and mode buttons.
 *
 *  Only your Telegram account (OWNER_TELEGRAM_ID) can use any of this.
 *
 * ----------------------------------------------------------------------------
 *  PART A — ONE-TIME SETUP (do this before plugging the file into July)
 * ----------------------------------------------------------------------------
 *
 *  A1. Check that port 8123 (Home Assistant's port) is free on the Pi.
 *      This should print NOTHING:
 *
 *        sudo ss -ltnp | grep 8123
 *
 *  A2. Create Home Assistant's folder on the SSD and its compose file.
 *      Replace /mnt/ssd with your real SSD mount point:
 *
 *        mkdir -p /mnt/ssd/homeassistant/config && cd /mnt/ssd/homeassistant && nano docker-compose.yml
 *
 *      Paste this, then save (Ctrl+O, Enter, Ctrl+X):
 *
 *        services:
 *          homeassistant:
 *            image: ghcr.io/home-assistant/home-assistant:stable
 *            container_name: homeassistant
 *            network_mode: host          # HA likes to see the home network directly
 *            restart: unless-stopped
 *            environment:
 *              - TZ=Europe/Rome
 *            volumes:
 *              - /mnt/ssd/homeassistant/config:/config   # all HA data stays on the SSD
 *              - /etc/localtime:/etc/localtime:ro
 *              - /run/dbus:/run/dbus:ro                  # lets HA use Bluetooth later
 *
 *  A3. Start it and watch the logs until it settles (Ctrl+C leaves the logs,
 *      the container keeps running):
 *
 *        cd /mnt/ssd/homeassistant && docker compose up -d && docker logs -f homeassistant
 *
 *  A4. Open http://mcloud:8123 from the iPhone (over Tailscale) and complete
 *      the onboarding: create your admin user and set location to Italy.
 *
 *  A5. Create the token July will use:
 *      click your user name (bottom-left) → "Security" tab →
 *      "Long-lived access tokens" → "Create token" → name it "July".
 *      Copy it now: Home Assistant shows it only once.
 *
 *      ⚠️ This token belongs to an ADMIN user (needed for /connect), so it can
 *      control the whole house. Keep it in July's .env, never in git, and never
 *      expose port 8123 to the internet (Tailscale only).
 *
 *  A6. Add these lines to July's .env (OWNER_TELEGRAM_ID: if July already has
 *      an env var with your Telegram ID, reuse it and rename it below):
 *
 *        HA_URL=http://127.0.0.1:8123
 *        HA_TOKEN=<the token from A5>
 *        OWNER_TELEGRAM_ID=<your numeric Telegram ID>
 *
 *      If July runs INSIDE Docker, 127.0.0.1 is July's own container, not the Pi.
 *      In that case use HA_URL=http://host.docker.internal:8123 and add this to
 *      July's service in its docker-compose.yml:
 *
 *            extra_hosts:
 *              - "host.docker.internal:host-gateway"
 *
 *  A7. Get your LG token (the "code" that connects the air conditioner).
 *      Follow Home Assistant's LG ThinQ page (home-assistant.io/integrations/lg_thinq)
 *      — at the time of writing: go to https://connect-pat.lgthinq.com, log in with
 *      the SAME LG account as your ThinQ app, "Add new token", give it a name and
 *      tick all the permissions. Copy the token.
 *
 *  A8. Plug this file into July (see PART C), restart July, then in the
 *      "🏠 Home" topic of the bot chat:
 *
 *        /connect lg_thinq        → answer July's questions (token, country = IT …)
 *        /home                    → your control panel appears
 *
 * ----------------------------------------------------------------------------
 *  PART B — HOW IT ALL WORKS
 * ----------------------------------------------------------------------------
 *
 *     You (Telegram)
 *        │  taps a button / sends /connect
 *        ▼
 *     July (this file)  ── HTTP + Bearer token ──►  Home Assistant (Pi, :8123)
 *                                                       │  LG ThinQ integration
 *                                                       ▼
 *                                                   LG cloud ──► your air conditioner
 *
 *  • CONNECTING (/connect): Home Assistant's setup wizards are called
 *    "config flows". The same wizard you'd click through in the web UI is
 *    available over the REST API:
 *        POST   /api/config/config_entries/flow            start a wizard
 *        POST   /api/config/config_entries/flow/<flow_id>  answer the current form
 *        DELETE /api/config/config_entries/flow/<flow_id>  cancel it
 *    Each answer returns the NEXT thing the wizard wants: another form,
 *    a menu, "create_entry" (done!) or "abort" (failed). July never hardcodes
 *    field names: it reads them from Home Assistant's reply ("data_schema")
 *    and asks you for each one. That is what makes /connect generic.
 *
 *  • CONTROLLING (/home): Home Assistant groups devices into "domains".
 *    Your AC is a `climate` entity, e.g. climate.condizionatore. Every climate
 *    entity has the same standard pieces:
 *        state                       current mode: "off", "cool", "heat", …
 *        attributes.hvac_modes       the modes THIS device supports
 *        attributes.temperature      target temperature
 *        attributes.current_temperature   room temperature
 *        attributes.min_temp / max_temp / target_temp_step
 *    and the same services:
 *        POST /api/services/climate/turn_on | turn_off | set_temperature | set_hvac_mode
 *    So the panel works for ANY air conditioner Home Assistant knows, and the
 *    mode buttons only show the modes your LG really supports.
 *    To add another kind of device later (plug = `switch`, fan = `fan`,
 *    light = `light`), you write a new panel for that domain next to this one.
 *
 *  • Because the AC goes through LG's cloud, a change takes a moment to come
 *    back. After each button July waits CLOUD_DELAY_MS, then re-reads the state
 *    and edits the SAME message, so the topic doesn't fill up with panels.
 *
 * ----------------------------------------------------------------------------
 *  PART C — PLUGGING IT INTO JULY
 * ----------------------------------------------------------------------------
 *
 *    import { createHomeFeature } from "./home";
 *    bot.use(createHomeFeature());
 *
 *  Put that line BEFORE July's catch-all text handler (the LLM one): while a
 *  /connect is running, your answers must reach this file, not the LLM.
 *  If July already has its own /cancel registered earlier, register this file
 *  before it, or rename this file's command.
 * ============================================================================
 */

import { Composer, Context, GrammyError, InlineKeyboard } from "grammy";

// ============================================================================
// 1. Configuration
// ============================================================================

/** Where Home Assistant lives, as seen from July's process. */
const HA_URL = process.env.HA_URL ?? "http://127.0.0.1:8123";

/** Long-lived access token of the Home Assistant admin user (PART A5). */
const HA_TOKEN = process.env.HA_TOKEN ?? "";

/** Your Telegram user ID: the only account allowed to use this feature. */
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);

/** How long to wait after a command before re-reading the state (LG cloud is slow). */
const CLOUD_DELAY_MS = 2000;

/** Give up on a Home Assistant request after this long. */
const HA_TIMEOUT_MS = 15_000;

// ============================================================================
// 2. Types: the shapes of what Home Assistant sends back
// ============================================================================

/** One entity's state, as returned by GET /api/states/<entity_id>. */
interface HaState<Attributes> {
  entity_id: string; // e.g. "climate.condizionatore"
  state: string; //     for climate: the current mode, or "unavailable"
  attributes: Attributes;
}

/** The climate attributes we use. All optional: devices don't always send all of them. */
interface ClimateAttributes {
  friendly_name?: string;
  hvac_modes?: string[];
  temperature?: number | null;
  current_temperature?: number | null;
  min_temp?: number;
  max_temp?: number;
  target_temp_step?: number;
}

/** One field of a config-flow form (Home Assistant's "data_schema"). */
interface FlowField {
  name: string; // the key HA expects in the answer, e.g. "access_token"
  required?: boolean; // true for mandatory fields
  default?: unknown; // value used if you /skip
  type?: string; // "string" | "integer" | "float" | "boolean" | "select" …
  options?: Array<[string, string]>; // for type "select": [value, label] pairs
  selector?: {
    select?: { options?: Array<string | { value: string; label?: string }> };
    [kind: string]: unknown; // other selector kinds: text, number, boolean, country …
  };
}

/** What every config-flow call returns: the wizard's next step. */
interface FlowResult {
  type: string; // "form" | "menu" | "create_entry" | "abort" | "external" | …
  flow_id: string;
  handler: string; // the integration, e.g. "lg_thinq"
  data_schema?: FlowField[];
  errors?: Record<string, string> | null;
  menu_options?: string[] | Record<string, string>;
  reason?: string; // why it aborted
  title?: string; // name of the created entry
}

/** A /connect that is waiting for your answers. */
interface PendingFlow {
  flowId: string;
  handler: string;
  fields: FlowField[]; // fields of the current form
  index: number; // which field we are asking right now
  answers: Record<string, unknown>; // what you answered so far
  menuOptions?: string[]; // set instead of fields when HA shows a menu
}

// ============================================================================
// 3. Small helpers
// ============================================================================

/** Escape text for Telegram's HTML parse mode. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Wait for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Turn any thrown value into a readable message. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reply in the same topic the message came from, so everything stays
 * inside the "🏠 Home" topic of the bot chat.
 */
async function reply(
  ctx: Context,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  await ctx.reply(html, {
    parse_mode: "HTML",
    reply_markup: keyboard,
    message_thread_id: ctx.msg?.message_thread_id,
  });
}

// ============================================================================
// 4. Home Assistant client: the ONLY place that talks HTTP to Home Assistant
// ============================================================================

/**
 * Call Home Assistant's REST API.
 * Throws a readable error if HA answers with an error status.
 */
async function ha<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${HA_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(HA_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Home Assistant answered ${response.status} to ${method} ${path}: ${text.slice(0, 200)}`,
    );
  }
  // Some endpoints answer with an empty body: return undefined in that case.
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Read one climate entity's current state. */
function getClimate(entityId: string): Promise<HaState<ClimateAttributes>> {
  return ha<HaState<ClimateAttributes>>("GET", `/api/states/${entityId}`);
}

/** Call a climate service, e.g. callClimate("turn_on", { entity_id: "climate.x" }). */
async function callClimate(
  service: string,
  data: Record<string, unknown>,
): Promise<void> {
  await ha<unknown>("POST", `/api/services/climate/${service}`, data);
}

// ============================================================================
// 5. Air-conditioner actions (the `climate` domain)
// ============================================================================

/**
 * Turn the AC on.
 * Most climate entities support `turn_on`. If this one doesn't, HA returns an
 * error and we fall back to "switch to the first mode that isn't off".
 */
async function turnOn(entityId: string): Promise<void> {
  try {
    await callClimate("turn_on", { entity_id: entityId });
  } catch {
    const { attributes } = await getClimate(entityId);
    const firstMode = attributes.hvac_modes?.find((mode) => mode !== "off");
    if (!firstMode) throw new Error("This device has no mode to switch on to.");
    await callClimate("set_hvac_mode", {
      entity_id: entityId,
      hvac_mode: firstMode,
    });
  }
}

/** Turn the AC off (same fallback idea: mode "off"). */
async function turnOff(entityId: string): Promise<void> {
  try {
    await callClimate("turn_off", { entity_id: entityId });
  } catch {
    await callClimate("set_hvac_mode", {
      entity_id: entityId,
      hvac_mode: "off",
    });
  }
}

/**
 * Move the target temperature one step up (+1) or down (-1),
 * respecting the device's own step and min/max limits.
 */
async function changeTemperature(
  entityId: string,
  direction: 1 | -1,
): Promise<void> {
  const { attributes } = await getClimate(entityId);

  const target = attributes.temperature;
  if (target === null || target === undefined) {
    throw new Error(
      "No target temperature right now (the AC is off, or in a mode without one, like Fan).",
    );
  }

  const step = attributes.target_temp_step ?? 1;
  const min = attributes.min_temp ?? 16;
  const max = attributes.max_temp ?? 30;

  // Round to 1 decimal to avoid float noise like 22.499999.
  const wanted = Math.round((target + direction * step) * 10) / 10;
  const next = Math.min(max, Math.max(min, wanted));
  if (next === target) return; // already at the limit: nothing to send

  await callClimate("set_temperature", {
    entity_id: entityId,
    temperature: next,
  });
}

/** Switch mode (cool, heat, dry, …), but only to a mode this device really has. */
async function setMode(entityId: string, mode: string): Promise<void> {
  const { attributes } = await getClimate(entityId);
  if (!attributes.hvac_modes?.includes(mode)) {
    throw new Error(`This device doesn't support the mode "${mode}".`);
  }
  await callClimate("set_hvac_mode", { entity_id: entityId, hvac_mode: mode });
}

// ============================================================================
// 6. The control panel (message text + inline keyboard)
// ============================================================================

/** Friendly names for the standard Home Assistant modes. */
const MODE_LABELS: Record<string, string> = {
  off: "⚫ Off",
  cool: "❄️ Cool",
  heat: "🔥 Heat",
  dry: "💧 Dry",
  fan_only: "🌀 Fan",
  auto: "♻️ Auto",
  heat_cool: "🌗 Heat/Cool",
};

function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** 22 → "22°", 22.5 → "22.5°", missing → "–". */
function formatTemp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}°`;
}

/**
 * Build a button's callback data.
 * Format: "h:<action>:<objectId>[:<value>]"
 *   h         = "home", so July can tell these buttons apart from its others
 *   objectId  = the entity id without "climate." (saves bytes)
 * Telegram allows at most 64 bytes, so we check it here.
 */
function callbackData(
  action: string,
  objectId: string,
  value?: string,
): string {
  const data = value
    ? `h:${action}:${objectId}:${value}`
    : `h:${action}:${objectId}`;
  if (Buffer.byteLength(data) > 64) {
    throw new Error(
      `Entity id too long for a Telegram button: ${objectId}. Rename it shorter in Home Assistant.`,
    );
  }
  return data;
}

/** Turn a climate state into the panel's text and buttons. */
function buildPanel(climate: HaState<ClimateAttributes>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const a = climate.attributes;
  const objectId = climate.entity_id.replace(/^climate\./, "");
  const name = a.friendly_name ?? climate.entity_id;
  const unavailable =
    climate.state === "unavailable" || climate.state === "unknown";
  const isOn = !unavailable && climate.state !== "off";

  // The time line changes on every refresh. Besides being useful, it avoids
  // Telegram's "message is not modified" error when nothing else changed.
  const time = new Date().toLocaleTimeString("it-IT", {
    timeZone: "Europe/Rome",
  });

  const lines = [`<b>${esc(name)}</b>`];
  if (unavailable) {
    lines.push("🔌 Unavailable: check the AC's Wi-Fi or the LG cloud.");
  } else {
    lines.push(`Status: ${isOn ? "🟢 On" : "⚫ Off"}`);
    if (isOn) lines.push(`Mode: ${modeLabel(climate.state)}`);
    lines.push(
      `Target: ${formatTemp(a.temperature)}   Room: ${formatTemp(a.current_temperature)}`,
    );
  }
  lines.push(`<i>Updated ${time}</i>`);

  const keyboard = new InlineKeyboard();

  if (!unavailable) {
    // Row 1: power
    keyboard
      .text(
        isOn ? "⏻ Turn off" : "⏻ Turn on",
        callbackData(isOn ? "off" : "on", objectId),
      )
      .row();

    // Row 2: temperature
    const step = formatTemp(a.target_temp_step ?? 1);
    keyboard
      .text(`➖ ${step}`, callbackData("down", objectId))
      .text(`➕ ${step}`, callbackData("up", objectId))
      .row();

    // Rows 3+: one button per mode this device supports (3 per row).
    // "off" is skipped because the power button already does it.
    const modes = (a.hvac_modes ?? []).filter((mode) => mode !== "off");
    modes.forEach((mode, i) => {
      const label =
        mode === climate.state ? `✅ ${modeLabel(mode)}` : modeLabel(mode);
      keyboard.text(label, callbackData("mode", objectId, mode));
      if (i % 3 === 2) keyboard.row();
    });
    keyboard.row();
  }

  // Last row: refresh
  keyboard.text("🔄 Refresh", callbackData("refresh", objectId));

  return { text: lines.join("\n"), keyboard };
}

/**
 * Show the panel: as a NEW message ("new"), or by editing the message
 * whose button was tapped ("edit").
 */
async function showPanel(
  ctx: Context,
  entityId: string,
  how: "new" | "edit",
): Promise<void> {
  const { text, keyboard } = buildPanel(await getClimate(entityId));

  if (how === "new") {
    await reply(ctx, text, keyboard);
    return;
  }

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err) {
    // Telegram refuses edits that change nothing: that's fine, not an error.
    const notModified =
      err instanceof GrammyError &&
      err.description.includes("message is not modified");
    if (!notModified) throw err;
  }
}

// ============================================================================
// 7. Generic /connect: drive any Home Assistant config flow from Telegram
// ============================================================================

/** Active /connect wizards, one per chat. In memory: a restart just cancels them. */
const pendingFlows = new Map<number, PendingFlow>();

/** The choices a field accepts, if it is a "pick one of these" field. */
function fieldChoices(field: FlowField): string[] {
  if (field.options) return field.options.map(([value]) => value);
  const selectOptions = field.selector?.select?.options;
  if (selectOptions)
    return selectOptions.map((o) => (typeof o === "string" ? o : o.value));
  return [];
}

/**
 * Convert your typed text into the type HA expects for this field.
 * Returns undefined if the text can't be converted (we then ask again).
 */
function convertAnswer(field: FlowField, raw: string): unknown {
  const selector = field.selector ?? {};

  if (
    field.type === "integer" ||
    field.type === "float" ||
    "number" in selector
  ) {
    const n = Number(raw.replace(",", "."));
    if (Number.isNaN(n)) return undefined;
    return field.type === "integer" ? Math.trunc(n) : n;
  }
  if (field.type === "boolean" || "boolean" in selector) {
    const yes = ["yes", "y", "true", "1", "si", "sì"];
    const no = ["no", "n", "false", "0"];
    const lower = raw.toLowerCase();
    if (yes.includes(lower)) return true;
    if (no.includes(lower)) return false;
    return undefined;
  }
  return raw; // strings, tokens, country codes …
}

/** Ask you for the field the wizard is currently on. */
async function askCurrentField(ctx: Context, flow: PendingFlow): Promise<void> {
  const field = flow.fields[flow.index];
  const choices = fieldChoices(field);

  const lines = [
    `🔧 <b>${esc(flow.handler)}</b> · question ${flow.index + 1}/${flow.fields.length}`,
    `Send the value for <code>${esc(field.name)}</code>`,
  ];
  if (choices.length > 0)
    lines.push(
      `Choose one of: ${choices.map((c) => `<code>${esc(c)}</code>`).join(", ")}`,
    );
  if (field.default !== undefined)
    lines.push(`Default: <code>${esc(String(field.default))}</code>`);
  if (!field.required || field.default !== undefined)
    lines.push("Send /skip to use the default or leave it empty.");
  lines.push(
    "🔒 I'll delete your message right after reading it. /cancel to stop.",
  );

  await reply(ctx, lines.join("\n"));
}

/** Send answers for the current step to HA and handle whatever comes next. */
async function submitStep(
  ctx: Context,
  chatId: number,
  flow: PendingFlow,
  userInput: Record<string, unknown>,
): Promise<void> {
  pendingFlows.delete(chatId); // the step is over; handleFlowResult stores the next one
  const result = await ha<FlowResult>(
    "POST",
    `/api/config/config_entries/flow/${flow.flowId}`,
    userInput,
  );
  await handleFlowResult(ctx, chatId, result);
}

/** Cancel a wizard in Home Assistant, ignoring errors (it may already be gone). */
async function cancelFlowInHa(flowId: string): Promise<void> {
  await ha<unknown>(
    "DELETE",
    `/api/config/config_entries/flow/${flowId}`,
  ).catch(() => undefined);
}

/** React to the wizard's next step: a form, a menu, success or failure. */
async function handleFlowResult(
  ctx: Context,
  chatId: number,
  result: FlowResult,
): Promise<void> {
  switch (result.type) {
    case "create_entry": {
      await reply(
        ctx,
        `✅ Connected: <b>${esc(result.title ?? result.handler)}</b>\nSend /home to see your devices.`,
      );
      return;
    }

    case "abort": {
      await reply(
        ctx,
        `❌ Home Assistant stopped the setup: <code>${esc(result.reason ?? "unknown reason")}</code>`,
      );
      return;
    }

    case "form": {
      // If HA sent the form back with errors, your previous answers were rejected.
      if (result.errors && Object.keys(result.errors).length > 0) {
        await reply(
          ctx,
          `⚠️ Home Assistant rejected those values: <code>${esc(JSON.stringify(result.errors))}</code>\nLet's try again.`,
        );
      }

      const fields = result.data_schema ?? [];
      if (fields.length === 0) {
        // A confirm-only step ("Do you want to set up X?"): just confirm it.
        await submitStep(
          ctx,
          chatId,
          {
            flowId: result.flow_id,
            handler: result.handler,
            fields: [],
            index: 0,
            answers: {},
          },
          {},
        );
        return;
      }

      const flow: PendingFlow = {
        flowId: result.flow_id,
        handler: result.handler,
        fields,
        index: 0,
        answers: {},
      };
      pendingFlows.set(chatId, flow);
      await askCurrentField(ctx, flow);
      return;
    }

    case "menu": {
      // HA asks to pick a path, e.g. "manual" or "discovered device".
      const options = Array.isArray(result.menu_options)
        ? result.menu_options
        : Object.keys(result.menu_options ?? {});
      pendingFlows.set(chatId, {
        flowId: result.flow_id,
        handler: result.handler,
        fields: [],
        index: 0,
        answers: {},
        menuOptions: options,
      });
      await reply(
        ctx,
        `🔧 Pick one, send it as a message:\n${options.map((o) => `• <code>${esc(o)}</code>`).join("\n")}`,
      );
      return;
    }

    default: {
      // "external" = needs a browser login (OAuth), "progress" = long background task.
      // Telegram can't do those: cancel and point to the web UI.
      await cancelFlowInHa(result.flow_id);
      await reply(
        ctx,
        `ℹ️ This integration needs a step July can't do from Telegram (<code>${esc(result.type)}</code>).\n` +
          "Set it up in the Home Assistant web UI: Settings → Devices & services → Add integration.",
      );
    }
  }
}

/** Handle one message you typed while a /connect wizard is waiting. */
async function handleFlowAnswer(
  ctx: Context,
  chatId: number,
  flow: PendingFlow,
  text: string,
): Promise<void> {
  // Case 1: HA showed a menu.
  if (flow.menuOptions) {
    if (!flow.menuOptions.includes(text)) {
      await reply(
        ctx,
        `Please send one of: ${flow.menuOptions.map((o) => `<code>${esc(o)}</code>`).join(", ")}`,
      );
      return;
    }
    await submitStep(ctx, chatId, flow, { next_step_id: text });
    return;
  }

  // Case 2: HA showed a form: record the answer for the current field.
  const field = flow.fields[flow.index];

  if (text === "/skip") {
    if (field.default !== undefined) {
      flow.answers[field.name] = field.default;
    } else if (field.required) {
      await reply(
        ctx,
        `<code>${esc(field.name)}</code> is required and has no default. Send a value or /cancel.`,
      );
      return;
    }
    // optional with no default: simply leave it out
  } else {
    const choices = fieldChoices(field);
    if (choices.length > 0 && !choices.includes(text)) {
      await reply(
        ctx,
        `Please send one of: ${choices.map((c) => `<code>${esc(c)}</code>`).join(", ")}`,
      );
      return;
    }
    const value = convertAnswer(field, text);
    if (value === undefined) {
      await reply(
        ctx,
        `That doesn't look like a valid <code>${esc(field.type ?? "value")}</code>. Try again.`,
      );
      return;
    }
    flow.answers[field.name] = value;
  }

  await reply(ctx, `✔️ Got <code>${esc(field.name)}</code>.`);

  // More fields in this form? Ask the next one. Otherwise send the form to HA.
  flow.index += 1;
  if (flow.index < flow.fields.length) {
    await askCurrentField(ctx, flow);
  } else {
    await submitStep(ctx, chatId, flow, flow.answers);
  }
}

// ============================================================================
// 8. Wiring: commands and buttons
// ============================================================================

export function createHomeFeature(): Composer<Context> {
  // Fail at startup, not at the first button tap, if the config is missing.
  if (!HA_TOKEN) throw new Error("home.ts: HA_TOKEN is missing in July's .env");
  if (!Number.isInteger(OWNER_ID))
    throw new Error("home.ts: OWNER_TELEGRAM_ID is missing or not a number");

  const composer = new Composer<Context>();

  // `filter` runs everything below ONLY for your account. For anyone else
  // (e.g. the Telegram group that uses link downloads) it silently passes
  // the update on to July's other features: nothing here blocks them.
  const owner = composer.filter((ctx) => ctx.from?.id === OWNER_ID);

  // --- /connect <integration> ----------------------------------------------
  owner.command("connect", async (ctx) => {
    const handler = ctx.match.trim();

    // Integration names are lowercase letters, digits and "_" (e.g. lg_thinq).
    // Checking this also stops anything odd from reaching HA's URL.
    if (!/^[a-z0-9_]+$/.test(handler)) {
      await reply(
        ctx,
        "Usage: <code>/connect lg_thinq</code>\n" +
          "The name is the last part of the integration's docs URL: home-assistant.io/integrations/<b>lg_thinq</b>",
      );
      return;
    }

    // Starting a new wizard replaces any unfinished one.
    const previous = pendingFlows.get(ctx.chat.id);
    if (previous) {
      pendingFlows.delete(ctx.chat.id);
      await cancelFlowInHa(previous.flowId);
    }

    try {
      const result = await ha<FlowResult>(
        "POST",
        "/api/config/config_entries/flow",
        {
          handler,
          show_advanced_options: false,
        },
      );
      await handleFlowResult(ctx, ctx.chat.id, result);
    } catch (err) {
      await reply(
        ctx,
        `⚠️ Couldn't start <code>${esc(handler)}</code>: ${esc(errorMessage(err))}`,
      );
    }
  });

  // --- /cancel ---------------------------------------------------------------
  owner.command("cancel", async (ctx, next) => {
    const flow = pendingFlows.get(ctx.chat.id);
    if (!flow) return next(); // no wizard running: let July's own /cancel (if any) handle it

    pendingFlows.delete(ctx.chat.id);
    await cancelFlowInHa(flow.flowId);
    await reply(ctx, "Setup cancelled.");
  });

  // --- /home -----------------------------------------------------------------
  owner.command("home", async (ctx) => {
    try {
      // Find every climate device Home Assistant knows.
      const states = await ha<Array<HaState<ClimateAttributes>>>(
        "GET",
        "/api/states",
      );
      const climates = states.filter((s) => s.entity_id.startsWith("climate."));

      if (climates.length === 0) {
        await reply(
          ctx,
          "No air conditioners in Home Assistant yet. Connect yours with <code>/connect lg_thinq</code>.",
        );
        return;
      }

      if (climates.length === 1) {
        await showPanel(ctx, climates[0].entity_id, "new");
        return;
      }

      // Several devices: let you pick. Tapping one turns this message into its panel.
      const picker = new InlineKeyboard();
      for (const climate of climates) {
        const objectId = climate.entity_id.replace(/^climate\./, "");
        picker
          .text(
            climate.attributes.friendly_name ?? climate.entity_id,
            callbackData("refresh", objectId),
          )
          .row();
      }
      await reply(ctx, "🏠 Which device?", picker);
    } catch (err) {
      await reply(ctx, `⚠️ ${esc(errorMessage(err))}`);
    }
  });

  // --- Panel buttons ---------------------------------------------------------
  // Matches "h:<action>:<objectId>" with an optional ":<value>".
  owner.callbackQuery(/^h:(\w+):(\w+)(?::(\w+))?$/, async (ctx) => {
    const [, action, objectId, value] = ctx.match as RegExpMatchArray;
    const entityId = `climate.${objectId}`;
    const sendsCommand = action !== "refresh";

    // Answer the tap right away (stops the button's loading spinner),
    // because the LG cloud can take a few seconds.
    await ctx.answerCallbackQuery(
      sendsCommand ? { text: "⏳ Sending to the AC…" } : undefined,
    );

    try {
      switch (action) {
        case "on":
          await turnOn(entityId);
          break;
        case "off":
          await turnOff(entityId);
          break;
        case "up":
          await changeTemperature(entityId, 1);
          break;
        case "down":
          await changeTemperature(entityId, -1);
          break;
        case "mode":
          await setMode(entityId, value ?? "");
          break;
        case "refresh":
          break; // nothing to send, just re-read below
        default:
          return; // unknown button (e.g. from an older version of this file)
      }

      if (sendsCommand) await sleep(CLOUD_DELAY_MS); // give the LG cloud time to report back
      await showPanel(ctx, entityId, "edit");
    } catch (err) {
      await reply(ctx, `⚠️ ${esc(errorMessage(err))}`);
    }
  });

  // --- Answers to a running /connect ----------------------------------------
  // Registered LAST, so commands above (like /cancel) are matched first.
  owner.on("message:text", async (ctx, next) => {
    const flow = pendingFlows.get(ctx.chat.id);
    if (!flow) return next(); // no wizard running: this message is for July's other features

    const text = ctx.message.text.trim();
    if (text.startsWith("/") && text !== "/skip") return next(); // other commands pass through

    // Delete what you typed: it may be a secret (like the LG token), and
    // Telegram bot chats are not end-to-end encrypted.
    await ctx.deleteMessage().catch(() => undefined);

    try {
      await handleFlowAnswer(ctx, ctx.chat.id, flow, text);
    } catch (err) {
      pendingFlows.delete(ctx.chat.id);
      await cancelFlowInHa(flow.flowId);
      await reply(
        ctx,
        `⚠️ Setup failed and was cancelled: ${esc(errorMessage(err))}`,
      );
    }
  });

  return composer;
}

/**
 * A set of functions called "actions" for `tradingview`
 */
import { Telegraf } from "telegraf";
import { fromPairs, any } from "rambda";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// 0,1,2,3,4,5,6
function convertDayOfWeek(day) {
  const date = new Date();
  const currentDay = date.getDay();
  if (day >= currentDay) {
    return date.getDate() + (day - currentDay);
  } else {
    return date.getDate() + (7 - currentDay) + day;
  }
}

function getTimezoneOffset(configuredOffset = -2) {
  const date = new Date();
  const timezoneOffset = date.getTimezoneOffset() / 60;
  // console.log("timezoneOffset", timezoneOffset, date);
  // console.log("getTimezoneOffset", configuredOffset - timezoneOffset);
  return configuredOffset + timezoneOffset;
}

function convertDate(d) {
  const date = new Date();
  return new Date(
    d.year || date.getFullYear(),
    d.month ? d.month - 1 : date.getMonth(),
    d.day,
    d.hours + getTimezoneOffset(),
    d.minutes
  );
}

function filterDate(date) {
  const { start, end, recurring } = date;
  const currentDate = new Date();
  if (recurring) {
    start.day = convertDayOfWeek(start.day);
    end.day = convertDayOfWeek(end.day);
  }
  const startDate = convertDate(start);
  const endDate = convertDate(end);
  // return true if current date is between start and end date
  return currentDate > startDate && currentDate < endDate;
}

function checkSignalValidity(signal) {
  const { direction, alert, webhook } = signal;
  const tp1 = parseFloat(alert.tp_1);

  if (direction === "SHORT" && parseFloat(alert.low) < tp1) {
    signal.valid = false;
    signal.hasWick = true;
  }
  if (direction === "LONG" && parseFloat(alert.high) > tp1) {
    signal.valid = false;
    signal.hasWick = true;
  }
  const { filterDates = [] } = webhook;
  const hasFilteredDate = any(filterDate)(filterDates);
  if (hasFilteredDate) {
    signal.valid = false;
    signal.hasFilteredDate = true;
    signal.message = `Close ${signal.symbol}`;
  }
  return signal;
}

// symbol: OPUSDT, direction: SHORT, entry_1: {{close}}, entry_2: {{plot("Trend Line")}}, tp_1: {{plot("Take Profit")}}, tp_2: {{plot("Take Profit 2")}}, tp_3: {{plot("Take Profit 3")}}, tp_4: {{plot("Take Profit 4")}}, high: {{high}}, low: {{low}}, close: {{close}}, open: {{open}}
function parseBody(body: string): any {
  const pairs: any = body.split(", ").map((pair) => pair.split(": "));
  return fromPairs(pairs);
}

function changeTarget(
  targetPrice: string,
  targetPercentageChange: number
): number {
  const price = parseFloat(targetPrice);
  return price + (price * targetPercentageChange) / 100;
}

export default {
  parseAlert: async (ctx) => {
    const { slug } = ctx.params;
    const alert = parseBody(ctx.request.body);
    const webhooks = await strapi.entityService.findMany(
      "api::webhook.webhook",
      {
        populate: ["telegrams"],
        filters: { slug },
      }
    );
    if (!webhooks) {
      throw new Error("Webhook with a given slug not found!");
    }
    const webhook = webhooks[0];
    const symbol = alert.symbol.toUpperCase();
    const direction = alert.direction.toUpperCase();
    const targetPercentageChange =
      direction === "SHORT"
        ? -webhook.targetPercentageChange
        : webhook.targetPercentageChange;
    const message = `${symbol}, ${direction}
Entry Zone: ${alert.entry_1} - ${alert.entry_2}
TP 1: ${changeTarget(alert.tp_1, targetPercentageChange)}
TP 2: ${changeTarget(alert.tp_2, targetPercentageChange)}
TP 3: ${changeTarget(alert.tp_3, targetPercentageChange)}
TP 4: ${changeTarget(alert.tp_4, targetPercentageChange)}
Leverage: 10x cross

Trailing Configuration:
Stop: Breakeven - Trigger: Target (1)`;
    let signal = {
      symbol,
      name: webhook.name,
      direction,
      alert,
      webhook: webhook,
      message,
      price: parseFloat(alert.close),
      valid: true,
      hasFilteredDate: false,
      wick: false,
    };
    signal = checkSignalValidity(signal);
    await strapi.entityService.create("api::signal.signal", {
      data: signal,
      populate: ["webhook"],
    });
    webhook.telegrams
      .filter((t) => !!t.publishedAt)
      .forEach(
        (t) =>
          (signal.valid || signal.hasFilteredDate) &&
          bot.telegram.sendMessage(t.chatId, signal.message)
      );
    try {
      ctx.body = "ok";
    } catch (err) {
      ctx.body = err;
    }
  },
};

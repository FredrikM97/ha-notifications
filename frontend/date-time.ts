import type { HassLocale } from "./types.js";

export function formatLocalDateTime(
  value: string | undefined,
  includeSeconds = false,
  locale?: HassLocale,
): string {
  if (!value) {
    return "—";
  }

  try {
    const date = new Date(value);
    const dateLocale =
      locale?.date_format === "system" ? undefined : locale?.language;
    const timeLocale =
      locale?.time_format === "system" ? undefined : locale?.language;
    let hour12: boolean | undefined;
    if (locale?.time_format === "12") {
      hour12 = true;
    } else if (locale?.time_format === "24") {
      hour12 = false;
    }

    const dateFormatter = new Intl.DateTimeFormat(dateLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const datePart = formatDatePart(dateFormatter, date, locale?.date_format);
    const timePart = new Intl.DateTimeFormat(timeLocale, {
      hour: "numeric",
      minute: "2-digit",
      hour12,
      ...(includeSeconds ? { second: "2-digit" } : {}),
    }).format(date);
    return `${datePart}, ${timePart}`;
  } catch (_err) {
    return value;
  }
}

function formatDatePart(
  formatter: Intl.DateTimeFormat,
  date: Date,
  format: string | undefined,
): string {
  const order = {
    DMY: ["day", "month", "year"],
    MDY: ["month", "day", "year"],
    YMD: ["year", "month", "day"],
  }[format || ""];
  if (!order) {
    return formatter.format(date);
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return order.map((part) => parts[part]).join("/");
}

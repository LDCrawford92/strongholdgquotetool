import type { MeasurementEntry, MeasurementUnit } from "./types";

const numberFormatters = new Map<number, Intl.NumberFormat>();

function numberFormatter(maxFractionDigits: number) {
  const cached = numberFormatters.get(maxFractionDigits);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  numberFormatters.set(maxFractionDigits, formatter);
  return formatter;
}

export function formatNumber(value: number, maxFractionDigits = 2) {
  return numberFormatter(maxFractionDigits).format(value);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

export function formatMetres(value: number) {
  return `${formatNumber(value, 3)} m`;
}

export function formatMeasurement(entry: MeasurementEntry, unit: MeasurementUnit) {
  if (unit === "Metres" && entry.kind === "decimal") {
    return `${formatNumber(entry.value, 3)} m`;
  }

  if (unit === "Millimetres" && entry.kind === "decimal") {
    return `${formatNumber(entry.value, 2)} mm`;
  }

  if (unit === "Feet & Inches" && entry.kind === "feet_and_inches") {
    return `${entry.feet} ft ${formatNumber(entry.inches, 2)} in`;
  }

  return "Invalid measurement";
}

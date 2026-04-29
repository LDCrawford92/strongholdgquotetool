import { addOnPricing, matrices } from "./data";
import type { MeasurementEntry, MeasurementUnit, PriceMatrix, QuoteInput, QuoteResult } from "./types";

export class PricingError extends Error {
  constructor(
    message: string,
    public readonly code: "outside_matrix" | "invalid_measurement",
  ) {
    super(message);
  }
}

export type PriceMatrixCatalog = Record<string, PriceMatrix>;

export function quote(input: QuoteInput, priceMatrices: PriceMatrixCatalog = matrices): QuoteResult {
  const poleCentreMetres = measurementInMetres(input.poleCentre, input.measurementUnit);
  const dropMetres = measurementInMetres(input.drop, input.measurementUnit);
  const matrix = priceMatrices[input.priceListType];

  const poleIndex = matrix.poleCentres.findIndex((value) => value >= poleCentreMetres);
  const dropIndex = matrix.drops.findIndex((value) => value >= dropMetres);

  if (poleIndex === -1 || dropIndex === -1) {
    throw new PricingError("Outside price matrix — contact office", "outside_matrix");
  }

  const basePrice = matrix.prices[dropIndex][poleIndex];
  const printCost = input.addOns.print
    ? poleCentreMetres * dropMetres * 2 * addOnPricing.printRatePerSquareMetre
    : null;
  const tapeCost = input.addOns.conspicuityTape ? addOnPricing.conspicuityTape : null;
  const fittingCost = input.addOns.fitting ? addOnPricing.fitting : null;
  const deliveryCost = input.addOns.delivery ? addOnPricing.delivery : null;

  return {
    input,
    convertedPoleCentreMetres: poleCentreMetres,
    convertedDropMetres: dropMetres,
    roundedPoleCentre: matrix.poleCentres[poleIndex],
    roundedDrop: matrix.drops[dropIndex],
    basePrice,
    printCost,
    tapeCost,
    fittingCost,
    deliveryCost,
    totalPrice: [basePrice, printCost, tapeCost, fittingCost, deliveryCost].reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    ),
  };
}

export function measurementInMetres(measurement: MeasurementEntry, unit: MeasurementUnit) {
  let metres: number;

  if ((unit === "Metres" || unit === "Millimetres") && measurement.kind === "decimal") {
    metres = unit === "Metres" ? measurement.value : measurement.value / 1000;
  } else if (unit === "Feet & Inches" && measurement.kind === "feet_and_inches") {
    metres = (measurement.feet * 12 + measurement.inches) * 0.0254;
  } else {
    throw new PricingError("Enter valid measurements before getting a quote.", "invalid_measurement");
  }

  if (!Number.isFinite(metres) || metres <= 0) {
    throw new PricingError("Enter valid measurements before getting a quote.", "invalid_measurement");
  }

  return metres;
}

export function parseDecimal(text: string) {
  const normalized = text.trim().replace(",", ".");
  if (!normalized) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function displayValuesFromMetres(metres: number, unit: MeasurementUnit) {
  if (unit === "Metres") {
    return { primary: formatForInput(metres, 3), secondary: "" };
  }

  if (unit === "Millimetres") {
    return { primary: formatForInput(metres * 1000, 2), secondary: "" };
  }

  const totalInches = metres / 0.0254;
  let feet = Math.trunc(totalInches / 12);
  let inches = Math.round((totalInches - feet * 12) * 100) / 100;

  if (inches >= 12) {
    feet += 1;
    inches = 0;
  }

  return { primary: String(feet), secondary: formatForInput(inches, 2) };
}

export function lenientMetres(primaryText: string, secondaryText: string, unit: MeasurementUnit) {
  if (unit === "Metres") {
    const value = parseDecimal(primaryText);
    return value && value > 0 ? value : null;
  }

  if (unit === "Millimetres") {
    const value = parseDecimal(primaryText);
    return value && value > 0 ? value / 1000 : null;
  }

  const feetText = primaryText.trim();
  const inchesText = secondaryText.trim();
  if (!feetText && !inchesText) return null;

  const feet = feetText ? Number(feetText) : 0;
  const inches = inchesText ? parseDecimal(inchesText) : 0;

  if (!Number.isInteger(feet) || feet < 0 || inches === null || inches < 0) return null;

  const totalInches = feet * 12 + inches;
  return totalInches > 0 ? totalInches * 0.0254 : null;
}

function formatForInput(value: number, maxFractionDigits: number) {
  return new Intl.NumberFormat("en-GB", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

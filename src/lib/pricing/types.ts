export const priceListTypes = [
  "ENXL Body Builder",
  "ENXL Key Account",
  "ENXL Haulage",
  "Tension Body Builder",
  "Tension Key Account",
  "Tension Haulage",
] as const;

export type PriceListType = string;

export const measurementUnits = ["Metres", "Millimetres", "Feet & Inches"] as const;

export type MeasurementUnit = (typeof measurementUnits)[number];

export type MeasurementEntry =
  | { kind: "decimal"; value: number }
  | { kind: "feet_and_inches"; feet: number; inches: number };

export type AddOnSelection = {
  print: boolean;
  conspicuityTape: boolean;
  fitting: boolean;
  delivery: boolean;
};

export type AddOnPricing = {
  printRatePerSquareMetre: number;
  conspicuityTape: number;
  fitting: number;
  delivery: number;
};

export type PriceMatrix = {
  poleCentres: number[];
  drops: number[];
  prices: number[][];
};

export type QuoteInput = {
  priceListType: PriceListType;
  measurementUnit: MeasurementUnit;
  poleCentre: MeasurementEntry;
  drop: MeasurementEntry;
  addOns: AddOnSelection;
};

export type QuoteResult = {
  input: QuoteInput;
  convertedPoleCentreMetres: number;
  convertedDropMetres: number;
  roundedPoleCentre: number;
  roundedDrop: number;
  basePrice: number;
  printCost: number | null;
  tapeCost: number | null;
  fittingCost: number | null;
  deliveryCost: number | null;
  totalPrice: number;
};

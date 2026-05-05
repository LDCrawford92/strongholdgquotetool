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

export type PricingSetting = {
  category: string;
  key: string;
  label: string;
  value: number;
  unit: string | null;
};

export type CoilCarrierPricing = {
  ratePerMetre: number;
  rearDoorFee: number;
  dripSheetRatePerMetre: number;
  flickerEach: number;
  rhinoFittingFee: number;
};

export type CoilCarrierInput = {
  measurementUnit: MeasurementUnit;
  length: MeasurementEntry;
  rearDoorRequired: boolean;
  dripSheetRequired: boolean;
  flickersRequired: boolean;
  flickersPerSide: number;
  fittingRequired: boolean;
  fittingAtRhino: boolean;
};

export type CoilCarrierQuoteResult = {
  input: CoilCarrierInput;
  convertedLengthMetres: number;
  basePrice: number;
  rearDoorCost: number | null;
  dripSheetCost: number | null;
  dripSheetRatePerMetre: number | null;
  flickerQuantity: number;
  flickerCost: number | null;
  rhinoFittingCost: number | null;
  totalPrice: number;
};

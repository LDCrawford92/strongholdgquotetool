"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  FileSpreadsheet,
  Grid2X2,
  Home as HomeIcon,
  Info,
  LogOut,
  Menu,
  Package,
  Printer,
  RotateCcw,
  Ruler,
  Save,
  ScrollText,
  Settings,
  Sparkles,
  Trash2,
  Truck,
  User,
  Wrench,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { coilCarrierPricingSettingDefaults, matrices } from "@/lib/pricing/data";
import {
  displayValuesFromMetres,
  lenientMetres,
  parseDecimal,
  quote,
  quoteCoilCarrier,
} from "@/lib/pricing/engine";
import {
  formatCurrency,
  formatMeasurement,
  formatMetres,
} from "@/lib/pricing/format";
import {
  type AddOnSelection,
  type CoilCarrierPricing,
  type CoilCarrierQuoteResult,
  type MeasurementEntry,
  type MeasurementUnit,
  type PriceMatrix,
  type PricingSetting,
  type QuoteResult,
  measurementUnits,
  priceListTypes,
} from "@/lib/pricing/types";
import { isSupabaseConfigured, supabase, usernameToEmail } from "@/lib/supabase/client";

type AddOnKey = keyof AddOnSelection;
type AppSection = "dashboard" | "curtains" | "coil-carriers" | "price-sheets" | "user-management" | "history" | "settings";

type PriceSheetRecord = {
  id: string;
  sheet_key: string;
  sheet_name: string;
  sheet_data: PriceMatrix;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type PricingSettingRecord = PricingSetting & {
  id: string;
  created_at: string | null;
  updated_at: string | null;
};

type UserRole = "admin" | "user";

type AdminUserSearchResult = {
  id: string;
  username: string | null;
  fullName: string | null;
  role: UserRole;
  createdAt: string | null;
};

type UserManagementMode = "reset" | "add" | "delete" | "edit";

type PricingSheetOption =
  | { value: string; label: string; kind: "matrix"; sheetName: string }
  | { value: "coil_carrier"; label: string; kind: "coil_carrier" };

const pricingSheetOptions: PricingSheetOption[] = [
  { value: "enxl-bodybuilder", label: "ENXL Bodybuilder", kind: "matrix", sheetName: "ENXL Body Builder" },
  { value: "enxl-haulage", label: "ENXL Haulage", kind: "matrix", sheetName: "ENXL Haulage" },
  { value: "enxl-key-account", label: "ENXL Key Account", kind: "matrix", sheetName: "ENXL Key Account" },
  { value: "tension-bodybuilder", label: "Tension Bodybuilder", kind: "matrix", sheetName: "Tension Body Builder" },
  { value: "tension-haulage", label: "Tension Haulage", kind: "matrix", sheetName: "Tension Haulage" },
  { value: "tension-key-account", label: "Tension Key Account", kind: "matrix", sheetName: "Tension Key Account" },
  { value: "coil_carrier", label: "Coil Carrier", kind: "coil_carrier" },
];

type SavedQuoteRow = {
  id: string;
  user_id: string;
  customer_name: string;
  quote_reference: string;
  quote_data: QuoteResult;
  total_price: number;
  created_at: string;
  expires_at: string;
};

const emptyAddOns: AddOnSelection = {
  print: false,
  conspicuityTape: false,
  fitting: false,
  delivery: false,
};

const addOns: Array<{
  key: AddOnKey;
  title: string;
  description: string;
  icon: typeof Printer;
}> = [
  {
    key: "print",
    title: "Print",
    description: "Calculated from the print area.",
    icon: Printer,
  },
  {
    key: "conspicuityTape",
    title: "Sticky Tape",
    description: "Adds the standard sticky tape charge.",
    icon: Sparkles,
  },
  {
    key: "fitting",
    title: "Fitting",
    description: "Includes the standard fitting cost.",
    icon: Wrench,
  },
  {
    key: "delivery",
    title: "Delivery Cost",
    description: "Adds the delivery charge to the quote.",
    icon: Truck,
  },
];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(isSupabaseConfigured);
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [priceSheets, setPriceSheets] = useState<PriceSheetRecord[]>([]);
  const [isLoadingPriceSheets, setIsLoadingPriceSheets] = useState(false);
  const [priceSheetsError, setPriceSheetsError] = useState("");
  const [coilCarrierSettings, setCoilCarrierSettings] = useState<PricingSettingRecord[]>([]);
  const [isLoadingCoilCarrierSettings, setIsLoadingCoilCarrierSettings] = useState(false);
  const [coilCarrierSettingsError, setCoilCarrierSettingsError] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("user");

  const isAdmin = Boolean(session && currentUserRole === "admin");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setIsCheckingSession(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCurrentUserRole("user");
      if (!nextSession) setActiveSection("dashboard");
      setIsCheckingSession(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    setSession(null);
    setCurrentUserRole("user");
    setActiveSection("dashboard");
  }

  async function loadCurrentUserRole(currentSession: Session): Promise<UserRole> {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentSession.user.id)
      .maybeSingle();

    if (error) {
      setCurrentUserRole("user");
      return "user";
    }

    const nextRole = data?.role === "admin" ? "admin" : "user";
    setCurrentUserRole(nextRole);
    return nextRole;
  }

  async function loadPriceSheets(currentSession: Session, canSeedDefaults = false) {
    setIsLoadingPriceSheets(true);
    setPriceSheetsError("");

    const { data, error } = await supabase
      .from("price_sheets")
      .select("id,sheet_key,sheet_name,sheet_data,is_active,updated_by,updated_at,created_at")
      .order("sheet_name", { ascending: true });

    if (error) {
      setIsLoadingPriceSheets(false);
      setPriceSheets([]);
      setPriceSheetsError(error.message);
      return;
    }

    if (!data?.length) {
      if (!canSeedDefaults) {
        setPriceSheets(defaultPriceSheetRecords());
        setIsLoadingPriceSheets(false);
        return;
      }

      const now = new Date().toISOString();
      const defaults = priceListTypes.map((sheetName) => ({
        sheet_key: slugify(String(sheetName)),
        sheet_name: String(sheetName),
        sheet_data: cloneMatrix(matrices[sheetName]),
        is_active: true,
        updated_by: currentSession.user.id,
        updated_at: now,
      }));

      const { data: insertedData, error: insertError } = await supabase
        .from("price_sheets")
        .insert(defaults)
        .select("id,sheet_key,sheet_name,sheet_data,is_active,updated_by,updated_at,created_at")
        .order("sheet_name", { ascending: true });

      setIsLoadingPriceSheets(false);

      if (insertError) {
        setPriceSheets([]);
        setPriceSheetsError(insertError.message);
        return;
      }

      setPriceSheets((insertedData ?? []).map(normalizePriceSheet).filter((sheet): sheet is PriceSheetRecord => sheet !== null));
      return;
    }

    setPriceSheets(data.map(normalizePriceSheet).filter((sheet): sheet is PriceSheetRecord => sheet !== null));
    setIsLoadingPriceSheets(false);
  }

  async function loadCoilCarrierSettings() {
    setIsLoadingCoilCarrierSettings(true);
    setCoilCarrierSettingsError("");

    const { data, error } = await supabase
      .from("pricing_settings")
      .select("id,category,key,label,value,unit,created_at,updated_at")
      .eq("category", "coil_carriers")
      .order("label", { ascending: true });

    setIsLoadingCoilCarrierSettings(false);

    if (error) {
      setCoilCarrierSettings([]);
      setCoilCarrierSettingsError(error.message);
      return;
    }

    setCoilCarrierSettings(
      mergeCoilCarrierSettingDefaults(
        (data ?? []).map(normalizePricingSetting).filter((setting): setting is PricingSettingRecord => setting !== null),
      ),
    );
  }

  useEffect(() => {
    if (!session) return;
    void Promise.resolve().then(async () => {
      const role = await loadCurrentUserRole(session);
      void loadPriceSheets(session, role === "admin");
      void loadCoilCarrierSettings();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  if (isCheckingSession) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="panel w-full max-w-md text-center">
          <Image src="/stronghold-logo.png" alt="Stronghold" width={220} height={110} priority className="mx-auto h-auto w-44" />
          <p className="mt-5 text-sm font-semibold text-slate-500">Checking your session...</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="panel space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <Image src="/stronghold-logo.png" alt="Stronghold" width={260} height={130} priority className="h-auto w-40 sm:w-44" />
              <div>
                <h1 className="text-2xl font-bold tracking-normal text-ink sm:text-3xl">Stronghold Pricing</h1>
                <p className="mt-1 text-sm font-medium text-slate-500">Curtains & Coil Carrier Covers</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
              <div className="min-h-11 rounded-[16px] border border-line bg-mist px-4 py-3 text-center text-sm font-semibold text-ink sm:text-left">
                {displayUsername(session.user.email)}
              </div>
              <button type="button" onClick={logout} className="secondary-button flex min-h-11 items-center justify-center gap-2 rounded-[16px] px-4">
                <LogOut size={17} />
                Logout
              </button>
            </div>
          </div>

          <nav
            className={clsx(
              "grid rounded-[22px] border border-line bg-mist p-1.5 shadow-inner sm:grid-cols-2",
              isAdmin ? "lg:grid-cols-5" : "lg:grid-cols-3",
            )}
            aria-label="Main menu"
          >
            <MenuButton section="dashboard" activeSection={activeSection} onClick={setActiveSection} icon={HomeIcon} label="Dashboard" />
            <MenuButton section="curtains" activeSection={activeSection} onClick={setActiveSection} icon={ScrollText} label="Curtains" />
            <MenuButton section="coil-carriers" activeSection={activeSection} onClick={setActiveSection} icon={Package} label="Coil Carriers" />
            {isAdmin ? (
              <>
                <MenuButton section="price-sheets" activeSection={activeSection} onClick={setActiveSection} icon={FileSpreadsheet} label="Pricing Sheets" />
                <MenuButton section="user-management" activeSection={activeSection} onClick={setActiveSection} icon={User} label="User Management" />
              </>
            ) : null}
          </nav>
        </header>

        {activeSection === "dashboard" ? <DashboardTool isAdmin={isAdmin} onNavigate={setActiveSection} /> : null}
        {activeSection === "curtains" ? (
          <CurtainsTool
            priceSheets={priceSheets}
            priceSheetsError={priceSheetsError}
            isLoadingPriceSheets={isLoadingPriceSheets}
            session={session}
          />
        ) : null}
        {activeSection === "coil-carriers" ? (
          <CoilCarriersTool
            pricingSettings={coilCarrierSettings}
            pricingSettingsError={coilCarrierSettingsError}
            isLoadingPricingSettings={isLoadingCoilCarrierSettings}
          />
        ) : null}
        {activeSection === "price-sheets" ? (
          <PriceSheetsTool
            priceSheets={priceSheets}
            onPriceSheetsChange={setPriceSheets}
            onReload={() => loadPriceSheets(session, true)}
            isLoading={isLoadingPriceSheets}
            loadError={priceSheetsError}
            session={session}
            coilCarrierSettings={coilCarrierSettings}
            onCoilCarrierSettingsChange={setCoilCarrierSettings}
            onReloadCoilCarrierSettings={loadCoilCarrierSettings}
            isLoadingCoilCarrierSettings={isLoadingCoilCarrierSettings}
            coilCarrierSettingsError={coilCarrierSettingsError}
            isAdmin={isAdmin}
          />
        ) : null}
        {activeSection === "user-management" ? <UserManagementTool session={session} isAdmin={isAdmin} /> : null}
        {activeSection === "history" ? <HistoryTool session={session} /> : null}
        {activeSection === "settings" ? <SettingsTool session={session} /> : null}
      </div>
    </main>
  );
}

function CurtainsTool({
  priceSheets,
  priceSheetsError,
  isLoadingPriceSheets,
  session,
}: {
  priceSheets: PriceSheetRecord[];
  priceSheetsError: string;
  isLoadingPriceSheets: boolean;
  session: Session;
}) {
  const activePriceSheets = useMemo(() => priceSheets.filter((sheet) => sheet.is_active), [priceSheets]);
  const [selectedPriceSheetId, setSelectedPriceSheetId] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("Metres");
  const [poleCentrePrimary, setPoleCentrePrimary] = useState("");
  const [poleCentreSecondary, setPoleCentreSecondary] = useState("");
  const [dropPrimary, setDropPrimary] = useState("");
  const [dropSecondary, setDropSecondary] = useState("");
  const [addOnSelection, setAddOnSelection] = useState<AddOnSelection>(emptyAddOns);
  const [expandedAddOns, setExpandedAddOns] = useState<Set<AddOnKey>>(new Set());
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveModalQuote, setSaveModalQuote] = useState<QuoteResult | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const canClear = useMemo(
    () =>
      Boolean(
        selectedPriceSheetId ||
          measurementUnit !== "Metres" ||
          poleCentrePrimary ||
          poleCentreSecondary ||
          dropPrimary ||
          dropSecondary ||
          Object.values(addOnSelection).some(Boolean) ||
          result ||
          errorMessage,
      ),
    [
      selectedPriceSheetId,
      measurementUnit,
      poleCentrePrimary,
      poleCentreSecondary,
      dropPrimary,
      dropSecondary,
      addOnSelection,
      result,
      errorMessage,
    ],
  );

  function clearFeedback() {
    setResult(null);
    setErrorMessage("");
    setSuccessMessage("");
  }

  function updateUnit(nextUnit: MeasurementUnit) {
    if (nextUnit === measurementUnit) return;

    const poleMetres = lenientMetres(poleCentrePrimary, poleCentreSecondary, measurementUnit);
    const dropMetres = lenientMetres(dropPrimary, dropSecondary, measurementUnit);
    const nextPole = poleMetres ? displayValuesFromMetres(poleMetres, nextUnit) : { primary: "", secondary: "" };
    const nextDrop = dropMetres ? displayValuesFromMetres(dropMetres, nextUnit) : { primary: "", secondary: "" };

    setMeasurementUnit(nextUnit);
    setPoleCentrePrimary(nextPole.primary);
    setPoleCentreSecondary(nextPole.secondary);
    setDropPrimary(nextDrop.primary);
    setDropSecondary(nextDrop.secondary);
    clearFeedback();
  }

  function getQuote() {
    try {
      if (!selectedPriceSheetId) {
        throw new Error("Please select a pricing model.");
      }

      if (priceSheetsError) {
        throw new Error(`Price sheets could not be loaded: ${priceSheetsError}`);
      }

      const selectedSheet = activePriceSheets.find((sheet) => sheet.id === selectedPriceSheetId);
      if (!selectedSheet) {
        throw new Error("Please select an active pricing sheet.");
      }

      const poleCentre = parseMeasurement(
        poleCentrePrimary,
        poleCentreSecondary,
        "pole centre",
        measurementUnit,
      );
      const drop = parseMeasurement(dropPrimary, dropSecondary, "drop", measurementUnit);

      setResult(
        quote({
          priceListType: selectedSheet.sheet_name,
          measurementUnit,
          poleCentre,
          drop,
          addOns: addOnSelection,
        }, { [selectedSheet.sheet_name]: selectedSheet.sheet_data }),
      );
      setErrorMessage("");
      setSuccessMessage("");
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    }
  }

  function clear() {
    setSelectedPriceSheetId("");
    setMeasurementUnit("Metres");
    setPoleCentrePrimary("");
    setPoleCentreSecondary("");
    setDropPrimary("");
    setDropSecondary("");
    setAddOnSelection(emptyAddOns);
    setExpandedAddOns(new Set());
    setResult(null);
    setErrorMessage("");
    setSuccessMessage("");
    setSaveModalQuote(null);
  }

  function toggleAddOn(addOn: AddOnKey) {
    setAddOnSelection((current) => ({ ...current, [addOn]: !current[addOn] }));
    clearFeedback();
  }

  function toggleExpanded(addOn: AddOnKey) {
    setExpandedAddOns((current) => {
      const next = new Set(current);
      if (next.has(addOn)) next.delete(addOn);
      else next.add(addOn);
      return next;
    });
  }

  return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.65fr)]" data-quote-owner-user-id={session.user.id}>
        <section className="space-y-5">
          <section className="panel">
            <SectionTitle title="Select Pricing" />
            {priceSheetsError ? <div className="mt-4"><StatusBanner message={`Price sheets could not be loaded: ${priceSheetsError}`} tone="error" /></div> : null}
            <label className="field mt-4 flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent-deep to-accent text-white">
                <Grid2X2 size={18} />
              </span>
              <select
                value={selectedPriceSheetId}
                disabled={isLoadingPriceSheets || Boolean(priceSheetsError)}
                onChange={(event) => {
                  setSelectedPriceSheetId(event.target.value);
                  clearFeedback();
                }}
                className="h-14 flex-1 appearance-none bg-transparent text-sm font-semibold text-ink outline-none"
                aria-label="Select pricing"
              >
                <option value="">{isLoadingPriceSheets ? "Loading price sheets..." : "Select pricing"}</option>
                {activePriceSheets.map((priceSheet) => (
                  <option key={priceSheet.id} value={priceSheet.id}>
                    {priceSheet.sheet_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-slate-400" size={18} />
            </label>
          </section>

          <section className="panel">
            <SectionTitle title="Measurements" subtitle="Approximate measurements" />

            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-500">Units</p>
                <div className="grid grid-cols-3 gap-2 rounded-[20px] border border-line bg-mist p-1.5">
                  {measurementUnits.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => updateUnit(unit)}
                      className={clsx(
                        "min-h-11 rounded-2xl px-2 text-xs font-semibold transition sm:text-sm",
                        unit === measurementUnit
                          ? "bg-gradient-to-br from-accent-deep to-accent text-white shadow-control"
                          : "text-ink hover:bg-white",
                      )}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              {measurementUnit === "Feet & Inches" ? (
                <div className="space-y-3">
                  <CompoundMeasurementField
                    title="Pole Centre"
                    primary={poleCentrePrimary}
                    secondary={poleCentreSecondary}
                    onPrimaryChange={(value) => {
                      setPoleCentrePrimary(value);
                      clearFeedback();
                    }}
                    onSecondaryChange={(value) => {
                      setPoleCentreSecondary(value);
                      clearFeedback();
                    }}
                  />
                  <CompoundMeasurementField
                    title="Drop"
                    primary={dropPrimary}
                    secondary={dropSecondary}
                    onPrimaryChange={(value) => {
                      setDropPrimary(value);
                      clearFeedback();
                    }}
                    onSecondaryChange={(value) => {
                      setDropSecondary(value);
                      clearFeedback();
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <MeasurementField
                    title="Pole Centre"
                    placeholder={measurementUnit === "Metres" ? "e.g. 8.4" : "e.g. 8400"}
                    suffix={measurementUnit === "Metres" ? "m" : "mm"}
                    value={poleCentrePrimary}
                    onChange={(value) => {
                      setPoleCentrePrimary(value);
                      clearFeedback();
                    }}
                  />
                  <MeasurementField
                    title="Drop"
                    placeholder={measurementUnit === "Metres" ? "e.g. 3.0" : "e.g. 3000"}
                    suffix={measurementUnit === "Metres" ? "m" : "mm"}
                    value={dropPrimary}
                    onChange={(value) => {
                      setDropPrimary(value);
                      clearFeedback();
                    }}
                  />
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <SectionTitle title="Add-Ons" />
            <div className="mt-4 space-y-3">
              {addOns.map((addOn) => (
                <AddOnRow
                  key={addOn.key}
                  addOn={addOn}
                  selected={addOnSelection[addOn.key]}
                  expanded={expandedAddOns.has(addOn.key)}
                  onToggle={() => toggleAddOn(addOn.key)}
                  onExpand={() => toggleExpanded(addOn.key)}
                />
              ))}
            </div>
          </section>

          {errorMessage ? (
            <div className="flex gap-3 rounded-[20px] border border-red-200 bg-red-50 p-4 text-sm font-medium text-ink">
              <Info className="mt-0.5 shrink-0 text-red-600" size={20} />
              <span>{errorMessage}</span>
            </div>
          ) : null}
          {successMessage ? <StatusBanner message={successMessage} tone="success" /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button className="primary-button" type="button" onClick={getQuote}>
              Get Quote
            </button>
            <button className="secondary-button flex items-center justify-center gap-2" type="button" onClick={clear} disabled={!canClear}>
              <RotateCcw size={17} />
              Clear
            </button>
          </div>
        </section>

        <aside className="lg:sticky lg:top-8 lg:h-fit">
          {result ? (
            <ResultCard
              quoteResult={result}
              onDiscard={() => {
                setResult(null);
                setSaveModalQuote(null);
              }}
              onSave={() => setSaveModalQuote(result)}
            />
          ) : (
            <div className="panel flex min-h-[420px] flex-col justify-between overflow-hidden">
              <div>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Ruler />
                </span>
                <h2 className="mt-5 text-2xl font-bold text-ink">Quote Result</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                  Select a pricing list, enter measurements, choose any add-ons, then generate the final total.
                </p>
              </div>
              <div className="rounded-[24px] border border-line bg-mist p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Matrix bounds</p>
                <p className="mt-2 text-sm font-semibold text-ink">Quotes round up to the next available pole centre and drop.</p>
              </div>
            </div>
          )}
        </aside>
        {saveModalQuote ? (
          <SaveQuoteModal
            quoteResult={saveModalQuote}
            session={session}
            onClose={() => setSaveModalQuote(null)}
            onSaved={() => {
              setSaveModalQuote(null);
              setResult(null);
              setSuccessMessage("Quote saved successfully.");
            }}
          />
        ) : null}
      </div>
  );
}

function parseMeasurement(primaryText: string, secondaryText: string, label: string, unit: MeasurementUnit): MeasurementEntry {
  if (unit === "Metres" || unit === "Millimetres") {
    const trimmed = primaryText.trim();
    if (!trimmed) throw new Error(`Enter a ${label} in ${unit.toLowerCase()}.`);

    const value = parseDecimal(trimmed);
    if (value === null) throw new Error(`Enter a valid ${label} in ${unit.toLowerCase()}.`);
    if (value <= 0) throw new Error(`${capitalize(label)} must be greater than zero.`);

    return { kind: "decimal", value };
  }

  const feetText = primaryText.trim();
  const inchesText = secondaryText.trim();
  if (!feetText && !inchesText) throw new Error(`Enter a ${label} in feet and inches.`);

  const feet = feetText ? Number(feetText) : 0;
  if (!Number.isInteger(feet) || feet < 0) throw new Error(`Enter whole feet for ${label}.`);

  const inches = inchesText ? parseDecimal(inchesText) : 0;
  if (inches === null || inches < 0) throw new Error(`Enter valid inches for ${label}.`);
  if (feet <= 0 && inches <= 0) throw new Error(`${capitalize(label)} must be greater than zero.`);

  return { kind: "feet_and_inches", feet, inches };
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isSupabaseConfigured) {
      setErrorMessage("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      setErrorMessage("Enter your username.");
      return;
    }

    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(normalizedUsername),
      password,
    });

    setIsLoading(false);

    if (error || !data.session) {
      setErrorMessage(error?.message ?? "Unable to sign in. Check your username and password.");
      return;
    }

    onLogin(data.session);
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <form onSubmit={login} className="panel w-full max-w-md">
        <div className="text-center">
          <Image src="/stronghold-logo.png" alt="Stronghold" width={240} height={120} priority className="mx-auto h-auto w-48" />
          <h1 className="mt-5 text-3xl font-bold text-ink">Sign in</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">Use your Stronghold username and password.</p>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Username</span>
            <span className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErrorMessage("");
                }}
                autoCapitalize="none"
                autoComplete="username"
                placeholder="Enter Username"
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Password</span>
            <span className="field flex items-center gap-3">
              <Settings className="shrink-0 text-accent" size={18} />
              <input
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrorMessage("");
                }}
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
              />
            </span>
          </label>

          {!isSupabaseConfigured ? (
            <StatusBanner message="Supabase environment variables are missing." tone="error" />
          ) : null}
          {errorMessage ? <StatusBanner message={errorMessage} tone="error" /> : null}

          <button type="submit" className="primary-button w-full" disabled={isLoading || !isSupabaseConfigured}>
            {isLoading ? "Signing in..." : "Login"}
          </button>
        </div>
      </form>
    </main>
  );
}

function DashboardTool({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate: (section: AppSection) => void;
}) {
  return (
    <section className="space-y-5">
      <div className="panel">
        <SectionTitle title="Dashboard" subtitle="Choose a quoting tool to get started." />
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <DashboardCard
            title="Start ENXL Quote"
            description="Open the curtains quote tool and choose an ENXL pricing sheet."
            icon={ScrollText}
            onClick={() => onNavigate("curtains")}
          />
          <DashboardCard
            title="Start Tension Quote"
            description="Open the curtains quote tool and choose a Tension pricing sheet."
            icon={Ruler}
            onClick={() => onNavigate("curtains")}
          />
          <DashboardCard
            title="Start Coil Carrier Quote"
            description="Calculate a coil carrier from length and selected extras."
            icon={Package}
            onClick={() => onNavigate("coil-carriers")}
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
        <div className="panel">
          <SectionTitle title="Help" subtitle="Quick notes for using the quote tool." />
          <div className="mt-4 grid gap-3">
            <DetailTile label="Curtain quotes" value="Select a pricing sheet, enter pole centre and drop, then add any extras." />
            <DetailTile label="Coil carrier quotes" value="Length can be entered in metres, millimetres, or feet and inches." />
          </div>
        </div>

        {isAdmin ? (
          <div className="panel">
            <SectionTitle title="Admin" subtitle="Manage pricing and users." />
            <div className="mt-4 grid gap-3">
              <button type="button" onClick={() => onNavigate("price-sheets")} className="secondary-button flex items-center justify-center gap-2">
                <FileSpreadsheet size={17} />
                Price Sheets
              </button>
              <button type="button" onClick={() => onNavigate("user-management")} className="secondary-button flex items-center justify-center gap-2">
                <User size={17} />
                User Management
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DashboardCard({
  title,
  description,
  icon: Icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: typeof Menu;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[20px] border border-line bg-mist p-5 text-left transition hover:bg-white"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-deep to-accent text-white">
        <Icon size={18} />
      </span>
      <span className="mt-4 block text-base font-bold text-ink">{title}</span>
      <span className="mt-2 block text-sm font-medium leading-6 text-slate-500">{description}</span>
    </button>
  );
}

function SaveQuoteModal({
  quoteResult,
  session,
  onClose,
  onSaved,
}: {
  quoteResult: QuoteResult;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [quoteReference, setQuoteReference] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCustomerName = customerName.trim();
    const trimmedReference = quoteReference.trim();

    if (!trimmedCustomerName) {
      setErrorMessage("Enter a customer name.");
      return;
    }

    if (!trimmedReference) {
      setErrorMessage("Enter a quote reference.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("saved_quotes").insert({
      user_id: session.user.id,
      customer_name: trimmedCustomerName,
      quote_reference: trimmedReference,
      quote_data: quoteResult,
      total_price: quoteResult.totalPrice,
      expires_at: expiresAt,
    });

    setIsSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4 py-6 backdrop-blur-sm">
      <form onSubmit={saveQuote} className="panel max-h-[92vh] w-full max-w-xl overflow-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Save Quote</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Add customer details before saving to history.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Close save quote">
            <X size={16} />
          </button>
        </div>

        <QuoteTotalPanel quoteResult={quoteResult} />

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Customer name</span>
            <span className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setErrorMessage("");
                }}
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                placeholder="Customer name"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Quote reference</span>
            <span className="field flex items-center gap-3">
              <FileSpreadsheet className="shrink-0 text-accent" size={18} />
              <input
                value={quoteReference}
                onChange={(event) => {
                  setQuoteReference(event.target.value);
                  setErrorMessage("");
                }}
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                placeholder="Reference"
              />
            </span>
          </label>

          {errorMessage ? <StatusBanner message={errorMessage} tone="error" /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onClose} className="secondary-button w-full" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="primary-button w-full" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Quote"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function HistoryTool({ session }: { session: Session }) {
  const [quotes, setQuotes] = useState<SavedQuoteRow[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<SavedQuoteRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    void loadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function cleanupExpiredQuotes() {
    const { error } = await supabase
      .from("saved_quotes")
      .delete()
      .eq("user_id", session.user.id)
      .lt("expires_at", new Date().toISOString());

    if (error) {
      setMessage({ tone: "error", text: error.message });
    }
  }

  async function loadQuotes() {
    setIsLoading(true);
    setMessage(null);

    await cleanupExpiredQuotes();

    const { data, error } = await supabase
      .from("saved_quotes")
      .select("id,user_id,customer_name,quote_reference,quote_data,total_price,created_at,expires_at")
      .eq("user_id", session.user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    setIsLoading(false);

    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }

    setQuotes((data ?? []).map(normalizeSavedQuote).filter((quoteRow): quoteRow is SavedQuoteRow => quoteRow !== null));
  }

  async function deleteQuote(quoteId: string) {
    const confirmed = window.confirm("Delete this saved quote?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("saved_quotes")
      .delete()
      .eq("id", quoteId)
      .eq("user_id", session.user.id);

    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }

    setSelectedQuote(null);
    setMessage({ tone: "success", text: "Quote deleted." });
    await loadQuotes();
  }

  return (
    <section className="space-y-5">
      <div className="panel flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <SectionTitle title="History" subtitle="Saved quotes for the logged-in user." />
          <p className="mt-3 text-sm font-medium text-slate-500">Expired quotes are hidden and cleaned up when this page loads.</p>
        </div>
        <button type="button" onClick={loadQuotes} className="secondary-button flex items-center justify-center gap-2">
          <RotateCcw size={17} />
          Refresh
        </button>
      </div>

      {message ? <StatusBanner message={message.text} tone={message.tone} /> : null}

      <div className="grid gap-4">
        {isLoading ? (
          <div className="panel text-sm font-semibold text-slate-500">Loading saved quotes...</div>
        ) : null}

        {!isLoading && quotes.length === 0 ? (
          <div className="panel text-sm font-semibold text-slate-500">No saved quotes found.</div>
        ) : null}

        {quotes.map((savedQuote) => (
          <article key={savedQuote.id} className="panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-lg font-bold text-ink">{savedQuote.customer_name}</p>
                <p className="mt-1 text-sm font-semibold text-accent">Ref {savedQuote.quote_reference}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[480px]">
                <DetailTile label="Total" value={formatCurrency(savedQuote.total_price)} />
                <DetailTile label="Created" value={formatDate(savedQuote.created_at)} />
                <DetailTile label="Expires" value={formatDate(savedQuote.expires_at)} />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setSelectedQuote(savedQuote)} className="primary-button flex items-center justify-center gap-2">
                <Eye size={17} />
                View Details
              </button>
              <button type="button" onClick={() => deleteQuote(savedQuote.id)} className="secondary-button flex items-center justify-center gap-2">
                <Trash2 size={17} />
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {selectedQuote ? (
        <SavedQuoteDetailsModal savedQuote={selectedQuote} onClose={() => setSelectedQuote(null)} onDelete={() => deleteQuote(selectedQuote.id)} />
      ) : null}
    </section>
  );
}

function SavedQuoteDetailsModal({
  savedQuote,
  onClose,
  onDelete,
}: {
  savedQuote: SavedQuoteRow;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4 py-6 backdrop-blur-sm">
      <div className="panel max-h-[92vh] w-full max-w-2xl overflow-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">{savedQuote.customer_name}</h2>
            <p className="mt-1 text-sm font-semibold text-accent">Ref {savedQuote.quote_reference}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Close saved quote details">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailTile label="Created" value={formatDate(savedQuote.created_at)} />
          <DetailTile label="Expires" value={formatDate(savedQuote.expires_at)} />
        </div>

        <QuoteTotalPanel quoteResult={savedQuote.quote_data} />
        <div className="mt-4 rounded-[20px] border border-line bg-white p-4">
          <p className="text-sm font-semibold text-ink">Quote Breakdown</p>
          <QuoteBreakdown quoteResult={savedQuote.quote_data} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="secondary-button w-full">
            Close
          </button>
          <button type="button" onClick={onDelete} className="secondary-button flex w-full items-center justify-center gap-2">
            <Trash2 size={17} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsTool({ session }: { session: Session }) {
  const fallbackUsername = displayUsername(session.user.email);
  const [username, setUsername] = useState(fallbackUsername);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted) return;
        if (data?.username) setUsername(data.username);
      });

    return () => {
      mounted = false;
    };
  }, [session.user.id]);

  async function changeUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUsername = username.trim().toLowerCase();

    if (!nextUsername) {
      setUsernameStatus({ tone: "error", message: "Username cannot be empty." });
      return;
    }

    setIsSavingUsername(true);
    setUsernameStatus(null);

    const { data, error } = await supabase
      .from("profiles")
      .update({ username: nextUsername })
      .eq("id", session.user.id)
      .select("username");

    setIsSavingUsername(false);

    if (error) {
      setUsernameStatus({ tone: "error", message: error.message });
      return;
    }

    if (!data?.length) {
      setUsernameStatus({ tone: "error", message: "No profile row was found for this user." });
      return;
    }

    setUsername(nextUsername);
    setUsernameStatus({ tone: "success", message: "Username updated." });
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newPassword || !confirmPassword) {
      setPasswordStatus({ tone: "error", message: "Enter and confirm your new password." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordStatus({ tone: "error", message: "Passwords do not match." });
      return;
    }

    setIsSavingPassword(true);
    setPasswordStatus(null);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    setIsSavingPassword(false);

    if (error) {
      setPasswordStatus({ tone: "error", message: error.message });
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPasswordStatus({ tone: "success", message: "Password updated." });
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={changeUsername} className="panel">
        <SectionTitle title="Username" subtitle="Update the display username stored in public.profiles." />
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Username</span>
            <span className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setUsernameStatus(null);
                }}
                autoCapitalize="none"
                autoComplete="username"
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
              />
            </span>
          </label>

          <div className="rounded-[20px] border border-line bg-mist p-4 text-sm font-medium text-slate-500">
            Your login username is managed by Stronghold.
          </div>

          {usernameStatus ? <StatusBanner message={usernameStatus.message} tone={usernameStatus.tone} /> : null}

          <button type="submit" className="primary-button w-full" disabled={isSavingUsername}>
            {isSavingUsername ? "Saving..." : "Save Username"}
          </button>
        </div>
      </form>

      <form onSubmit={changePassword} className="panel">
        <SectionTitle title="Password" subtitle="Change the password for the current Supabase Auth user." />
        <div className="mt-5 space-y-4">
          <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField label="Confirm Password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

          {passwordStatus ? <StatusBanner message={passwordStatus.message} tone={passwordStatus.tone} /> : null}

          <button type="submit" className="primary-button w-full" disabled={isSavingPassword}>
            {isSavingPassword ? "Updating..." : "Update Password"}
          </button>
        </div>
      </form>

      <div className="panel lg:col-span-2">
        <SectionTitle title="Session" subtitle="Prepared for future saved quote ownership." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <DetailTile label="Supabase user id" value={session.user.id} />
          <DetailTile label="Login identity" value={displayUsername(session.user.email)} />
        </div>
      </div>
    </section>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-500">{label}</span>
      <span className="field flex items-center gap-3">
        <Settings className="shrink-0 text-accent" size={18} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type="password"
          autoComplete={autoComplete}
          className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
        />
      </span>
    </label>
  );
}

function StatusBanner({ message, tone }: { message: string; tone: "success" | "error" }) {
  return (
    <div
      className={clsx(
        "flex gap-3 rounded-[20px] border p-4 text-sm font-medium text-ink",
        tone === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
      )}
    >
      <Info className={clsx("mt-0.5 shrink-0", tone === "success" ? "text-emerald-600" : "text-red-600")} size={20} />
      <span>{message}</span>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-line bg-mist p-4">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function MenuButton({
  section,
  activeSection,
  onClick,
  icon: Icon,
  label,
}: {
  section: AppSection;
  activeSection: AppSection;
  onClick: (section: AppSection) => void;
  icon: typeof Menu;
  label: string;
}) {
  const selected = section === activeSection;

  return (
    <button
      type="button"
      onClick={() => onClick(section)}
      className={clsx(
        "flex min-h-12 items-center justify-center gap-2 rounded-[17px] px-3 text-sm font-semibold transition sm:px-4",
        selected
          ? "bg-gradient-to-br from-accent-deep to-accent text-white shadow-control"
          : "text-ink hover:bg-white",
      )}
    >
      <Icon className="shrink-0" size={18} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function CoilCarriersTool({
  pricingSettings,
  pricingSettingsError,
  isLoadingPricingSettings,
}: {
  pricingSettings: PricingSettingRecord[];
  pricingSettingsError: string;
  isLoadingPricingSettings: boolean;
}) {
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("Metres");
  const [lengthPrimary, setLengthPrimary] = useState("");
  const [lengthSecondary, setLengthSecondary] = useState("");
  const [rearDoorRequired, setRearDoorRequired] = useState(false);
  const [dripSheetRequired, setDripSheetRequired] = useState(false);
  const [flickersRequired, setFlickersRequired] = useState(false);
  const [flickersPerSide, setFlickersPerSide] = useState("");
  const [fittingRequired, setFittingRequired] = useState(false);
  const [fittingAtRhino, setFittingAtRhino] = useState(false);
  const [result, setResult] = useState<CoilCarrierQuoteResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const pricing = useMemo(() => coilCarrierPricingFromSettings(pricingSettings), [pricingSettings]);

  const canClear = Boolean(
    measurementUnit !== "Metres" ||
      lengthPrimary ||
      lengthSecondary ||
      rearDoorRequired ||
      dripSheetRequired ||
      flickersRequired ||
      flickersPerSide ||
      fittingRequired ||
      fittingAtRhino ||
      result ||
      errorMessage,
  );

  function clearFeedback() {
    setResult(null);
    setErrorMessage("");
  }

  function updateUnit(nextUnit: MeasurementUnit) {
    if (nextUnit === measurementUnit) return;

    const lengthMetres = lenientMetres(lengthPrimary, lengthSecondary, measurementUnit);
    const nextLength = lengthMetres ? displayValuesFromMetres(lengthMetres, nextUnit) : { primary: "", secondary: "" };

    setMeasurementUnit(nextUnit);
    setLengthPrimary(nextLength.primary);
    setLengthSecondary(nextLength.secondary);
    clearFeedback();
  }

  function getQuote() {
    try {
      const length = parseMeasurement(lengthPrimary, lengthSecondary, "total length", measurementUnit);
      const parsedFlickersPerSide = flickersRequired ? parseDecimal(flickersPerSide.trim()) : 0;

      if (parsedFlickersPerSide === null) {
        throw new Error("Enter valid flickers per side.");
      }

      if (parsedFlickersPerSide < 0) {
        throw new Error("Flickers per side must be zero or greater.");
      }

      setResult(
        quoteCoilCarrier(
          {
            measurementUnit,
            length,
            rearDoorRequired,
            dripSheetRequired,
            flickersRequired,
            flickersPerSide: parsedFlickersPerSide,
            fittingRequired,
            fittingAtRhino: fittingRequired ? fittingAtRhino : false,
          },
          pricing,
        ),
      );
      setErrorMessage("");
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    }
  }

  function clear() {
    setMeasurementUnit("Metres");
    setLengthPrimary("");
    setLengthSecondary("");
    setRearDoorRequired(false);
    setDripSheetRequired(false);
    setFlickersRequired(false);
    setFlickersPerSide("");
    setFittingRequired(false);
    setFittingAtRhino(false);
    setResult(null);
    setErrorMessage("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.65fr)]">
      <section className="space-y-5">
        <section className="panel">
          <SectionTitle title="Coil Carriers" subtitle="Calculate by total length and optional extras." />
          {pricingSettingsError ? (
            <div className="mt-4">
              <StatusBanner message="Using default Coil Carrier prices. Run the pricing_settings SQL to make these fields editable in Supabase." tone="error" />
            </div>
          ) : null}
          {isLoadingPricingSettings ? (
            <p className="mt-4 text-sm font-semibold text-slate-500">Loading editable prices...</p>
          ) : null}
        </section>

        <section className="panel">
          <SectionTitle title="Length" subtitle="Total coil carrier length" />

          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-500">Units</p>
              <div className="grid grid-cols-3 gap-2 rounded-[20px] border border-line bg-mist p-1.5">
                {measurementUnits.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => updateUnit(unit)}
                    className={clsx(
                      "min-h-11 rounded-2xl px-2 text-xs font-semibold transition sm:text-sm",
                      unit === measurementUnit
                        ? "bg-gradient-to-br from-accent-deep to-accent text-white shadow-control"
                        : "text-ink hover:bg-white",
                    )}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            {measurementUnit === "Feet & Inches" ? (
              <CompoundMeasurementField
                title="Total Length"
                primary={lengthPrimary}
                secondary={lengthSecondary}
                onPrimaryChange={(value) => {
                  setLengthPrimary(value);
                  clearFeedback();
                }}
                onSecondaryChange={(value) => {
                  setLengthSecondary(value);
                  clearFeedback();
                }}
              />
            ) : (
              <MeasurementField
                title="Total Length"
                placeholder={measurementUnit === "Metres" ? "e.g. 8.4" : "e.g. 8400"}
                suffix={measurementUnit === "Metres" ? "m" : "mm"}
                value={lengthPrimary}
                onChange={(value) => {
                  setLengthPrimary(value);
                  clearFeedback();
                }}
              />
            )}
          </div>
        </section>

        <section className="panel">
          <SectionTitle title="Extras" />
          <div className="mt-4 space-y-3">
            <OptionToggle title="Rear door required?" selected={rearDoorRequired} onToggle={() => {
              setRearDoorRequired((value) => !value);
              clearFeedback();
            }} />
            <OptionToggle title="Drip sheet required?" selected={dripSheetRequired} onToggle={() => {
              setDripSheetRequired((value) => !value);
              clearFeedback();
            }} />
            <OptionToggle title="Flickers required?" selected={flickersRequired} onToggle={() => {
              setFlickersRequired((value) => !value);
              clearFeedback();
            }} />
            {flickersRequired ? (
              <MeasurementField
                title="Flickers per side"
                placeholder="0"
                suffix="each side"
                value={flickersPerSide}
                onChange={(value) => {
                  setFlickersPerSide(value);
                  clearFeedback();
                }}
              />
            ) : null}
            <OptionToggle title="Fitting required?" selected={fittingRequired} onToggle={() => {
              setFittingRequired((value) => {
                if (value) setFittingAtRhino(false);
                return !value;
              });
              clearFeedback();
            }} />
            {fittingRequired ? (
              <div className="space-y-2">
                <OptionToggle title="Fitting at Rhino" selected={fittingAtRhino} onToggle={() => {
                  setFittingAtRhino((value) => !value);
                  clearFeedback();
                }} />
                {fittingAtRhino ? (
                  <p className="rounded-[20px] border border-blue-200 bg-accent-soft p-4 text-sm font-semibold text-accent">
                    Confirm with customer at Rhino
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {errorMessage ? <StatusBanner message={errorMessage} tone="error" /> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <button className="primary-button" type="button" onClick={getQuote}>
            Get Quote
          </button>
          <button className="secondary-button flex items-center justify-center gap-2" type="button" onClick={clear} disabled={!canClear}>
            <RotateCcw size={17} />
            Clear
          </button>
        </div>
      </section>

      <aside className="lg:sticky lg:top-8 lg:h-fit">
        {result ? (
          <CoilCarrierResultCard quoteResult={result} onDiscard={() => setResult(null)} />
        ) : (
          <div className="panel flex min-h-[420px] flex-col justify-between overflow-hidden">
            <div>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Package />
              </span>
              <h2 className="mt-5 text-2xl font-bold text-ink">Quote Result</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                Enter a length, choose any extras, then generate the coil carrier total.
              </p>
            </div>
            <div className="rounded-[24px] border border-line bg-mist p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Current rate</p>
              <p className="mt-2 text-sm font-semibold text-ink">{formatCurrency(pricing.ratePerMetre)} per metre</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function AdminAccessRequired() {
  return (
    <section className="panel">
      <div className="flex max-w-2xl flex-col gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Settings />
        </span>
        <div>
          <h2 className="text-2xl font-bold text-ink">Admin access required</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
            This area is only available to admin users. Normal users can still access the quote tools.
          </p>
        </div>
      </div>
    </section>
  );
}

function UserManagementTool({ session, isAdmin }: { session: Session; isAdmin: boolean }) {
  const [mode, setMode] = useState<UserManagementMode>("reset");
  const [users, setUsers] = useState<AdminUserSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdminUserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserSearchResult | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) {
    return <AdminAccessRequired />;
  }

  function clearUserSelection() {
    setSearchResults([]);
    setSelectedUser(null);
    setEditUsername("");
    setEditFullName("");
    setTemporaryPassword("");
    setDeleteConfirmation("");
    setStatus(null);
  }

  async function loadUsers() {
    setIsLoadingUsers(true);
    const response = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const payload = await response.json().catch(() => null) as { users?: AdminUserSearchResult[]; error?: string } | null;
    setIsLoadingUsers(false);

    if (!response.ok) {
      setStatus({ tone: "error", message: payload?.error ?? "Unable to load users." });
      return;
    }

    setUsers(payload?.users ?? []);
  }

  function chooseUser(user: AdminUserSearchResult, nextMode?: UserManagementMode) {
    if (nextMode) setMode(nextMode);
    setSelectedUser(user);
    setEditUsername(user.username ?? "");
    setEditFullName(user.fullName ?? "");
    setTemporaryPassword("");
    setDeleteConfirmation("");
    setStatus(null);
  }

  function updateMode(nextMode: UserManagementMode) {
    setMode(nextMode);
    clearUserSelection();
  }

  async function searchUsers() {
    const query = searchQuery.trim();
    clearUserSelection();

    if (query.length < 2) {
      setStatus({ tone: "error", message: "Enter at least 2 characters to search." });
      return;
    }

    setIsSearching(true);
    const response = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const payload = await response.json().catch(() => null) as { users?: AdminUserSearchResult[]; error?: string } | null;
    setIsSearching(false);

    if (!response.ok) {
      setStatus({ tone: "error", message: payload?.error ?? "Unable to search users." });
      return;
    }

    const users = payload?.users ?? [];
    setSearchResults(users);
    setStatus(users.length ? null : { tone: "error", message: "No matching users found." });
  }

  async function resetPassword() {
    if (!selectedUser) {
      setStatus({ tone: "error", message: "Select a user before resetting their password." });
      return;
    }

    if (!temporaryPassword) {
      setStatus({ tone: "error", message: "Enter a temporary password." });
      return;
    }

    if (temporaryPassword.length < 8) {
      setStatus({ tone: "error", message: "Temporary password must be at least 8 characters." });
      return;
    }

    const confirmed = window.confirm(`Reset the password for ${displayManagedUserName(selectedUser)}?`);
    if (!confirmed) return;

    setIsSubmitting(true);
    setStatus(null);
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: selectedUser.id, password: temporaryPassword }),
    });
    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus({ tone: "error", message: payload?.error ?? "Unable to update password." });
      return;
    }

    setTemporaryPassword("");
    setStatus({ tone: "success", message: payload?.message ?? "Password updated. Ask the user to log in with their temporary password." });
  }

  async function editUser() {
    if (!selectedUser) {
      setStatus({ tone: "error", message: "Select a user before editing." });
      return;
    }

    const username = editUsername.trim();
    const fullName = editFullName.trim();

    if (!username) {
      setStatus({ tone: "error", message: "Enter a username." });
      return;
    }

    if (!fullName) {
      setStatus({ tone: "error", message: "Enter a full name." });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "edit", userId: selectedUser.id, username, fullName }),
    });
    const payload = await response.json().catch(() => null) as { message?: string; error?: string; user?: AdminUserSearchResult } | null;
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus({ tone: "error", message: payload?.error ?? "Unable to update user." });
      return;
    }

    if (payload?.user) {
      setSelectedUser(payload.user);
      setUsers((current) => current.map((user) => (user.id === payload.user?.id ? payload.user : user)));
      setSearchResults((current) => current.map((user) => (user.id === payload.user?.id ? payload.user : user)));
    }

    setStatus({ tone: "success", message: payload?.message ?? "User updated." });
    await loadUsers();
  }

  async function addUser() {
    const username = newUsername.trim();
    const fullName = newFullName.trim();

    if (!username) {
      setStatus({ tone: "error", message: "Enter a username." });
      return;
    }

    if (!fullName) {
      setStatus({ tone: "error", message: "Enter a full name." });
      return;
    }

    if (!newPassword) {
      setStatus({ tone: "error", message: "Enter a temporary password." });
      return;
    }

    if (newPassword.length < 8) {
      setStatus({ tone: "error", message: "Temporary password must be at least 8 characters." });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, fullName, password: newPassword }),
    });
    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus({ tone: "error", message: payload?.error ?? "Unable to add user." });
      return;
    }

    setNewUsername("");
    setNewFullName("");
    setNewPassword("");
    setStatus({ tone: "success", message: payload?.message ?? "User created." });
    await loadUsers();
  }

  async function deleteUser() {
    if (!selectedUser) {
      setStatus({ tone: "error", message: "Select a user before deleting." });
      return;
    }

    if (selectedUser.id === session.user.id) {
      setStatus({ tone: "error", message: "You cannot delete your own currently logged-in user." });
      return;
    }

    if (deleteConfirmation.trim() !== "DELETE") {
      setStatus({ tone: "error", message: "Type DELETE to confirm." });
      return;
    }

    const confirmed = window.confirm(`Permanently delete ${displayManagedUserName(selectedUser)}?`);
    if (!confirmed) return;

    setIsSubmitting(true);
    setStatus(null);
    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: selectedUser.id, confirmation: deleteConfirmation }),
    });
    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus({ tone: "error", message: payload?.error ?? "Unable to delete user." });
      return;
    }

    setSelectedUser(null);
    setDeleteConfirmation("");
    setSearchResults((current) => current.filter((user) => user.id !== selectedUser.id));
    setStatus({ tone: "success", message: payload?.message ?? "User deleted." });
    await loadUsers();
  }

  return (
    <section className="space-y-5">
      <div className="panel">
        <SectionTitle title="User Management" subtitle="Admin-only tools for Stronghold user accounts." />
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <UserManagementModeButton mode="reset" activeMode={mode} onClick={updateMode} title="Reset Password" />
          <UserManagementModeButton mode="add" activeMode={mode} onClick={updateMode} title="Add User" />
          <UserManagementModeButton mode="delete" activeMode={mode} onClick={updateMode} title="Delete User" />
        </div>
      </div>

      {status ? <StatusBanner message={status.message} tone={status.tone} /> : null}

      <div className="panel overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">List All Users</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Admin view of Stronghold user accounts.</p>
          </div>
          <button type="button" onClick={loadUsers} className="secondary-button flex items-center justify-center gap-2" disabled={isLoadingUsers}>
            <RotateCcw size={17} />
            {isLoadingUsers ? "Loading..." : "Refresh"}
          </button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="border-b border-line bg-mist px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Username</th>
                <th className="border-b border-line bg-mist px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Full name</th>
                <th className="border-b border-line bg-mist px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Role</th>
                <th className="border-b border-line bg-mist px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Created date</th>
                <th className="border-b border-line bg-mist px-4 py-3 text-right text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="border-b border-line px-4 py-3 font-semibold text-ink">{user.username ?? "Unknown"}</td>
                  <td className="border-b border-line px-4 py-3 text-slate-500">{user.fullName ?? "Not set"}</td>
                  <td className="border-b border-line px-4 py-3 text-slate-500">{user.role}</td>
                  <td className="border-b border-line px-4 py-3 text-slate-500">{formatDate(user.createdAt ?? "")}</td>
                  <td className="border-b border-line px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => chooseUser(user, "edit")} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label={`Edit ${displayManagedUserName(user)}`}>
                        <Settings size={16} />
                      </button>
                      <button type="button" onClick={() => chooseUser(user, "reset")} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label={`Reset password for ${displayManagedUserName(user)}`}>
                        <Save size={16} />
                      </button>
                      <button type="button" onClick={() => chooseUser(user, "delete")} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label={`Delete ${displayManagedUserName(user)}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm font-semibold text-slate-500">
                    {isLoadingUsers ? "Loading users..." : "No users found."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {mode === "add" ? (
        <div className="panel">
          <SectionTitle title="Add User" subtitle="Create a standard user account with a temporary password." />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <TextField label="Username" value={newUsername} onChange={setNewUsername} placeholder="david" />
            <TextField label="Full name" value={newFullName} onChange={setNewFullName} placeholder="David Smith" />
            <PasswordInput label="Temporary password" value={newPassword} onChange={setNewPassword} />
            <DetailTile label="Login username" value={newUsername.trim().toLowerCase().replace(/\s+/g, "") || "username"} />
          </div>
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={addUser} className="primary-button flex items-center justify-center gap-2" disabled={isSubmitting}>
              <Save size={17} />
              {isSubmitting ? "Creating..." : "Add User"}
            </button>
          </div>
        </div>
      ) : (
        <div className="panel">
          <SectionTitle
            title={mode === "reset" ? "Reset Password" : mode === "edit" ? "Edit User" : "Delete User"}
            subtitle="Search by username or full name."
          />
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto]">
            <label className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  clearUserSelection();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchUsers();
                  }
                }}
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                placeholder="Username or full name"
              />
            </label>
            <button type="button" onClick={searchUsers} className="secondary-button flex items-center justify-center gap-2" disabled={isSearching}>
              <Eye size={17} />
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>

          <UserSearchResults users={searchResults} selectedUser={selectedUser} onSelect={(user) => {
            setSelectedUser(user);
            setTemporaryPassword("");
            setDeleteConfirmation("");
            setStatus(null);
          }} />

          {selectedUser ? (
            <div className="mt-4 rounded-[20px] border border-line bg-mist p-4">
              <p className="text-sm font-semibold text-ink">Selected user</p>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {displayManagedUserName(selectedUser)}
              </p>
            </div>
          ) : null}

          {mode === "edit" && selectedUser ? (
            <div className="mt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField label="Username" value={editUsername} onChange={setEditUsername} placeholder="david" />
                <TextField label="Full name" value={editFullName} onChange={setEditFullName} placeholder="David Smith" />
                <DetailTile label="Role" value={selectedUser.role} />
              </div>
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={editUser} className="primary-button flex items-center justify-center gap-2" disabled={isSubmitting}>
                  <Save size={17} />
                  {isSubmitting ? "Saving..." : "Save User"}
                </button>
              </div>
            </div>
          ) : null}

          {mode === "reset" && selectedUser ? (
            <div className="mt-4">
              <PasswordInput label="Temporary password" value={temporaryPassword} onChange={setTemporaryPassword} />
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={resetPassword} className="primary-button flex items-center justify-center gap-2" disabled={isSubmitting || !temporaryPassword}>
                  <Save size={17} />
                  {isSubmitting ? "Updating..." : "Reset Password"}
                </button>
              </div>
            </div>
          ) : null}

          {mode === "delete" && selectedUser ? (
            <div className="mt-4 space-y-4">
              <StatusBanner message="Deleting a user permanently removes their login. Type DELETE to confirm." tone="error" />
              <TextField label="Confirmation" value={deleteConfirmation} onChange={setDeleteConfirmation} placeholder="DELETE" />
              <div className="flex justify-end">
                <button type="button" onClick={deleteUser} className="primary-button flex items-center justify-center gap-2" disabled={isSubmitting || deleteConfirmation !== "DELETE"}>
                  <Trash2 size={17} />
                  {isSubmitting ? "Deleting..." : "Delete User"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function UserManagementModeButton({
  mode,
  activeMode,
  onClick,
  title,
}: {
  mode: UserManagementMode;
  activeMode: UserManagementMode;
  onClick: (mode: UserManagementMode) => void;
  title: string;
}) {
  const selected = mode === activeMode;

  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={clsx(
        "rounded-[20px] border p-5 text-left transition",
        selected ? "border-blue-200 bg-accent-soft" : "border-line bg-mist hover:bg-white",
      )}
    >
      <span className={clsx("inline-flex h-10 w-10 items-center justify-center rounded-2xl", selected ? "bg-accent text-white" : "bg-white text-accent")}>
        {mode === "delete" ? <Trash2 size={17} /> : mode === "add" ? <User size={17} /> : <Settings size={17} />}
      </span>
      <span className="mt-4 block text-sm font-bold text-ink">{title}</span>
    </button>
  );
}

function UserSearchResults({
  users,
  selectedUser,
  onSelect,
}: {
  users: AdminUserSearchResult[];
  selectedUser: AdminUserSearchResult | null;
  onSelect: (user: AdminUserSearchResult) => void;
}) {
  if (!users.length) return null;

  return (
    <div className="mt-4 grid gap-3">
      {users.map((user) => {
        const selected = selectedUser?.id === user.id;
        return (
          <button
            key={user.id}
            type="button"
            onClick={() => onSelect(user)}
            className={clsx(
              "rounded-[20px] border p-4 text-left transition",
              selected ? "border-blue-200 bg-accent-soft" : "border-line bg-mist hover:bg-white",
            )}
          >
            <span className="block text-sm font-semibold text-ink">{displayManagedUserName(user)}</span>
            <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              {user.fullName ? `${user.fullName} • ${user.role}` : user.role}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function displayManagedUserName(user: AdminUserSearchResult) {
  return user.username || user.fullName || "Unknown user";
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-500">{label}</span>
      <span className="field flex items-center gap-3">
        <User className="shrink-0 text-accent" size={18} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
          placeholder={placeholder}
        />
      </span>
    </label>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-500">{label}</span>
      <span className="field flex items-center gap-3">
        <Settings className="shrink-0 text-accent" size={18} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type="password"
          autoComplete="new-password"
          className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
          placeholder="Minimum 8 characters"
        />
      </span>
    </label>
  );
}

function PriceSheetsTool({
  priceSheets,
  onPriceSheetsChange,
  onReload,
  isLoading,
  loadError,
  session,
  coilCarrierSettings,
  onCoilCarrierSettingsChange,
  onReloadCoilCarrierSettings,
  isLoadingCoilCarrierSettings,
  coilCarrierSettingsError,
  isAdmin,
}: {
  priceSheets: PriceSheetRecord[];
  onPriceSheetsChange: Dispatch<SetStateAction<PriceSheetRecord[]>>;
  onReload: () => Promise<void>;
  isLoading: boolean;
  loadError: string;
  session: Session;
  coilCarrierSettings: PricingSettingRecord[];
  onCoilCarrierSettingsChange: Dispatch<SetStateAction<PricingSettingRecord[]>>;
  onReloadCoilCarrierSettings: () => Promise<void>;
  isLoadingCoilCarrierSettings: boolean;
  coilCarrierSettingsError: string;
  isAdmin: boolean;
}) {
  const [selectedSheetOptionValue, setSelectedSheetOptionValue] = useState("");
  const [loadedSheetOptionValue, setLoadedSheetOptionValue] = useState("");
  const [draftState, setDraftState] = useState<{ sheetId: string; matrix: PriceMatrix } | null>(null);
  const [coilCarrierDraftSettings, setCoilCarrierDraftSettings] = useState<PricingSettingRecord[] | null>(null);
  const [isEditingUnlocked, setIsEditingUnlocked] = useState(false);
  const [editPassword, setEditPassword] = useState("");
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCoilCarrierSettings, setIsSavingCoilCarrierSettings] = useState(false);

  const selectedSheetOption = pricingSheetOptions.find((option) => option.value === selectedSheetOptionValue) ?? null;
  const loadedSheetOption = pricingSheetOptions.find((option) => option.value === loadedSheetOptionValue) ?? null;
  const selectedSheet = loadedSheetOption?.kind === "matrix"
    ? priceSheets.find((sheet) => sheet.sheet_name === loadedSheetOption.sheetName) ?? null
    : null;
  const draftMatrix = selectedSheet && draftState?.sheetId === selectedSheet.id ? draftState.matrix : null;
  const matrix = draftMatrix ?? selectedSheet?.sheet_data ?? null;
  const effectiveCoilCarrierSettings = coilCarrierDraftSettings ?? mergeCoilCarrierSettingDefaults(coilCarrierSettings);
  const isCoilCarrierLoaded = loadedSheetOption?.kind === "coil_carrier";
  const isMatrixLoaded = loadedSheetOption?.kind === "matrix";

  function loadSelectedPricingSheet() {
    if (!selectedSheetOption) {
      setLoadedSheetOptionValue("");
      setDraftState(null);
      setCoilCarrierDraftSettings(null);
      setIsEditingUnlocked(false);
      setEditPassword("");
      setStatus({ tone: "error", message: "Please select a pricing sheet to load." });
      return;
    }

    setLoadedSheetOptionValue(selectedSheetOption.value);
    setDraftState(null);
    setCoilCarrierDraftSettings(null);
    setIsEditingUnlocked(false);
    setEditPassword("");
    setStatus(null);
  }

  function unlockEditing() {
    if (editPassword !== "stronghold1") {
      setStatus({ tone: "error", message: "Incorrect editing password." });
      return;
    }

    setIsEditingUnlocked(true);
    setEditPassword("");
    setStatus({ tone: "success", message: "Editing unlocked." });
  }

  function lockEditing() {
    setIsEditingUnlocked(false);
    setEditPassword("");
    setStatus(null);
  }

  function updateMatrix(updater: (matrix: PriceMatrix) => PriceMatrix) {
    if (!isEditingUnlocked) return;
    if (!isMatrixLoaded || !selectedSheet || !matrix) return;
    setDraftState({
      sheetId: selectedSheet.id,
      matrix: updater(cloneMatrix(matrix)),
    });
  }

  function updateCoilCarrierSetting(key: string, value: string) {
    if (!isEditingUnlocked) return;

    const parsed = parseDecimal(value);
    setCoilCarrierDraftSettings((current) => {
      const source = current ?? effectiveCoilCarrierSettings;
      return source.map((setting) => (setting.key === key ? { ...setting, value: parsed ?? 0 } : setting));
    });
  }

  function updatePrice(dropIndex: number, poleIndex: number, value: string) {
    const parsed = parseDecimal(value);
    updateMatrix((current) => ({
      ...current,
      prices: current.prices.map((row, rowIndex) =>
        rowIndex === dropIndex
          ? row.map((price, columnIndex) => (columnIndex === poleIndex ? parsed ?? 0 : price))
          : row,
      ),
    }));
  }

  function updatePoleCentre(index: number, value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null || parsed <= 0) return;

    updateMatrix((current) => ({
      ...current,
      poleCentres: current.poleCentres.map((poleCentre, poleIndex) => (poleIndex === index ? parsed : poleCentre)),
    }));
  }

  function updateDrop(index: number, value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null || parsed <= 0) return;

    updateMatrix((current) => ({
      ...current,
      drops: current.drops.map((drop, dropIndex) => (dropIndex === index ? parsed : drop)),
    }));
  }

  async function savePriceSheet() {
    if (!isAdmin) {
      setStatus({ tone: "error", message: "Admin access required." });
      return;
    }

    if (!selectedSheet || !matrix) return;

    setIsSaving(true);
    setStatus(null);
    const updatedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from("price_sheets")
      .update({
        sheet_data: matrix,
        updated_at: updatedAt,
        updated_by: session.user.id,
      })
      .eq("id", selectedSheet.id)
      .select("id,sheet_key,sheet_name,sheet_data,is_active,updated_by,updated_at,created_at")
      .single();

    setIsSaving(false);

    if (error) {
      setStatus({ tone: "error", message: error.message });
      return;
    }

    const updatedSheet = normalizePriceSheet(data);
    if (!updatedSheet) {
      setStatus({ tone: "error", message: "The saved sheet data was not in the expected format." });
      return;
    }

    onPriceSheetsChange((current) => current.map((sheet) => (sheet.id === updatedSheet.id ? updatedSheet : sheet)));
    setDraftState({ sheetId: updatedSheet.id, matrix: cloneMatrix(updatedSheet.sheet_data) });
    setStatus({ tone: "success", message: "Price sheet saved." });
  }

  async function saveCoilCarrierSettings() {
    if (!isAdmin) {
      setStatus({ tone: "error", message: "Admin access required." });
      return;
    }

    if (!isCoilCarrierLoaded || !effectiveCoilCarrierSettings.length) return;

    setIsSavingCoilCarrierSettings(true);
    setStatus(null);

    const payload = effectiveCoilCarrierSettings.map((setting) => ({
      category: setting.category,
      key: setting.key,
      label: setting.label,
      value: setting.value,
      unit: setting.unit,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("pricing_settings")
      .upsert(payload, { onConflict: "category,key" })
      .select("id,category,key,label,value,unit,created_at,updated_at")
      .eq("category", "coil_carriers")
      .order("label", { ascending: true });

    setIsSavingCoilCarrierSettings(false);

    if (error) {
      setStatus({ tone: "error", message: error.message });
      return;
    }

    const savedSettings = mergeCoilCarrierSettingDefaults(
      (data ?? []).map(normalizePricingSetting).filter((setting): setting is PricingSettingRecord => setting !== null),
    );
    onCoilCarrierSettingsChange(savedSettings);
    setCoilCarrierDraftSettings(null);
    setStatus({ tone: "success", message: "Coil Carrier pricing saved." });
  }

  if (!isAdmin) {
    return <AdminAccessRequired />;
  }

  return (
    <section className="space-y-5">
      <div className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionTitle
              title="Pricing Sheets"
              subtitle="Supabase-backed price matrices used by the quote generator."
            />
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-500">
              Choose a price sheet and edit a draft. The live quote calculator only updates after Save Price Sheet succeeds.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
            <label className="field flex items-center gap-3">
              <FileSpreadsheet className="shrink-0 text-accent" size={19} />
              <select
                value={selectedSheetOptionValue}
                onChange={(event) => {
                  setSelectedSheetOptionValue(event.target.value);
                  setLoadedSheetOptionValue("");
                  setDraftState(null);
                  setCoilCarrierDraftSettings(null);
                  setIsEditingUnlocked(false);
                  setEditPassword("");
                  setStatus(null);
                }}
                className="h-14 flex-1 appearance-none bg-transparent text-sm font-semibold text-ink outline-none"
                aria-label="Select price sheet"
                disabled={isLoading && !priceSheets.length}
              >
                <option value="">Select pricing sheet</option>
                {pricingSheetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-slate-400" size={18} />
            </label>

            <button type="button" onClick={loadSelectedPricingSheet} className="primary-button flex items-center justify-center gap-2">
              <ChevronDown size={17} />
              Load
            </button>
          </div>
        </div>
      </div>

      {loadError ? <StatusBanner message={`Pricing sheets could not be loaded: ${loadError}`} tone="error" /> : null}
      {coilCarrierSettingsError ? <StatusBanner message={`Coil Carrier pricing could not be loaded: ${coilCarrierSettingsError}`} tone="error" /> : null}
      {status ? <StatusBanner message={status.message} tone={status.tone} /> : null}

      {loadedSheetOption ? (
        <div className="panel">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionTitle title="Edit Lock" subtitle="Enter the internal password to edit pricing values." />
          </div>

          {isEditingUnlocked ? (
            <button type="button" onClick={lockEditing} className="secondary-button">
              Lock Editing
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
              <label className="field flex items-center gap-3">
                <Settings className="shrink-0 text-accent" size={18} />
                <input
                  value={editPassword}
                  onChange={(event) => setEditPassword(event.target.value)}
                  type="password"
                  className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                  placeholder="Editing password"
                />
              </label>
              <button type="button" onClick={unlockEditing} className="primary-button">
                Unlock Editing
              </button>
            </div>
          )}
        </div>
      </div>
      ) : null}

      {isCoilCarrierLoaded ? (
        <div className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionTitle title="Coil Carrier Pricing" subtitle="Editable rates used by the Coil Carriers quote page." />
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-500">
              These values save to public.pricing_settings under the coil_carriers category.
            </p>
          </div>

          <button type="button" onClick={onReloadCoilCarrierSettings} className="secondary-button flex items-center justify-center gap-2" disabled={isLoadingCoilCarrierSettings}>
            <RotateCcw size={17} />
            Reload
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {effectiveCoilCarrierSettings.map((setting) => (
            <label key={setting.key} className="block rounded-[20px] border border-line bg-mist p-4">
              <span className="text-sm font-semibold text-ink">{setting.label}</span>
              <span className="mt-1 block text-xs font-semibold text-slate-400">{coilCarrierDisplayKey(setting.key)}</span>
              <span className="field mt-3 flex items-center gap-3 bg-white">
                <input
                  value={setting.value}
                  onChange={(event) => updateCoilCarrierSetting(setting.key, event.target.value)}
                  className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                  inputMode="decimal"
                  disabled={!isEditingUnlocked}
                  aria-label={setting.label}
                />
                <span className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-slate-500">{setting.unit ?? "GBP"}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={saveCoilCarrierSettings}
            className="primary-button flex items-center justify-center gap-2"
            disabled={!isEditingUnlocked || isSavingCoilCarrierSettings}
          >
            <Save size={17} />
            {isSavingCoilCarrierSettings ? "Saving..." : "Save Coil Carrier Pricing"}
          </button>
        </div>
      </div>
      ) : null}

      {isMatrixLoaded ? (
        <div className="panel overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">{loadedSheetOption?.label ?? selectedSheet?.sheet_name ?? "Pricing Sheet"}</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {matrix ? `${matrix.drops.length} drops x ${matrix.poleCentres.length} pole centres` : "No sheet selected"}
            </p>
          </div>
          <button type="button" onClick={onReload} className="secondary-button flex items-center justify-center gap-2">
            <RotateCcw size={17} />
            Reload
          </button>
        </div>

        {matrix ? <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 border-b border-r border-line bg-mist px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Drop / Pole
                </th>
                {matrix.poleCentres.map((poleCentre, poleIndex) => (
                  <th key={`${selectedSheet?.id}-pole-${poleIndex}`} className="sticky top-0 z-20 border-b border-r border-line bg-mist p-2">
                    <input
                      value={poleCentre}
                      onChange={(event) => updatePoleCentre(poleIndex, event.target.value)}
                      className="w-20 rounded-xl border border-line bg-white px-2 py-2 text-center text-xs font-semibold text-ink outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                      disabled={!isEditingUnlocked}
                      aria-label={`Pole centre ${poleIndex + 1}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.drops.map((drop, dropIndex) => (
                <tr key={`${selectedSheet?.id}-drop-${dropIndex}`}>
                  <th className="sticky left-0 z-10 border-b border-r border-line bg-mist p-2">
                    <input
                      value={drop}
                      onChange={(event) => updateDrop(dropIndex, event.target.value)}
                      className="w-20 rounded-xl border border-line bg-white px-2 py-2 text-center text-xs font-semibold text-ink outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                      disabled={!isEditingUnlocked}
                      aria-label={`Drop ${dropIndex + 1}`}
                    />
                  </th>
                  {matrix.prices[dropIndex].map((price, poleIndex) => (
                    <td key={`${selectedSheet?.id}-${dropIndex}-${poleIndex}`} className="border-b border-r border-line bg-white p-2">
                      <input
                        value={price}
                        onChange={(event) => updatePrice(dropIndex, poleIndex, event.target.value)}
                        className="w-20 rounded-xl border border-transparent bg-white px-2 py-2 text-center font-semibold text-ink outline-none transition hover:border-line hover:bg-mist focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                        inputMode="decimal"
                        disabled={!isEditingUnlocked}
                        aria-label={`${selectedSheet?.sheet_name ?? "Price sheet"} price drop ${drop}, pole ${matrix.poleCentres[poleIndex]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div> : null}
      </div>
      ) : null}

      {isMatrixLoaded ? (
        <div className="flex justify-end">
        <button type="button" onClick={savePriceSheet} className="primary-button flex items-center justify-center gap-2" disabled={!isEditingUnlocked || !matrix || isSaving}>
          <Save size={17} />
          {isSaving ? "Saving..." : "Save Price Sheet"}
        </button>
      </div>
      ) : null}
    </section>
  );
}

function cloneMatrix(matrix: PriceMatrix): PriceMatrix {
  return {
    poleCentres: [...matrix.poleCentres],
    drops: [...matrix.drops],
    prices: matrix.prices.map((row) => [...row]),
  };
}

function defaultPriceSheetRecords(): PriceSheetRecord[] {
  return priceListTypes.map((sheetName) => ({
    id: `default-${slugify(String(sheetName))}`,
    sheet_key: slugify(String(sheetName)),
    sheet_name: String(sheetName),
    sheet_data: cloneMatrix(matrices[sheetName]),
    is_active: true,
    updated_by: null,
    updated_at: null,
    created_at: null,
  }));
}

function normalizePriceSheet(value: unknown): PriceSheetRecord | null {
  if (!isRecord(value) || !isPriceMatrix(value.sheet_data)) return null;

  return {
    id: String(value.id),
    sheet_key: String(value.sheet_key ?? ""),
    sheet_name: String(value.sheet_name ?? ""),
    sheet_data: cloneMatrix(value.sheet_data),
    is_active: Boolean(value.is_active),
    updated_by: typeof value.updated_by === "string" ? value.updated_by : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    created_at: typeof value.created_at === "string" ? value.created_at : null,
  };
}

function normalizePricingSetting(value: unknown): PricingSettingRecord | null {
  if (!isRecord(value)) return null;

  const numericValue = Number(value.value);
  if (!Number.isFinite(numericValue)) return null;

  return {
    id: String(value.id ?? `${value.category ?? ""}-${value.key ?? ""}`),
    category: String(value.category ?? ""),
    key: String(value.key ?? ""),
    label: String(value.label ?? ""),
    value: numericValue,
    unit: typeof value.unit === "string" ? value.unit : null,
    created_at: typeof value.created_at === "string" ? value.created_at : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
  };
}

function mergeCoilCarrierSettingDefaults(settings: PricingSettingRecord[]) {
  return coilCarrierPricingSettingDefaults.map((defaultSetting) => {
    const savedSetting = settings.find((setting) => setting.key === defaultSetting.key);
    return savedSetting ? {
      ...savedSetting,
      label: defaultSetting.label,
      unit: defaultSetting.unit,
    } : {
      ...defaultSetting,
      id: `default-coil-carriers-${defaultSetting.key}`,
      created_at: null,
      updated_at: null,
    };
  });
}

function coilCarrierPricingFromSettings(settings: PricingSettingRecord[]): CoilCarrierPricing {
  const mergedSettings = mergeCoilCarrierSettingDefaults(settings);
  const settingValue = (key: string) => mergedSettings.find((setting) => setting.key === key)?.value ?? 0;

  return {
    ratePerMetre: settingValue("rate_per_metre"),
    rearDoorFee: settingValue("rear_door_fee"),
    dripSheetRatePerMetre: settingValue("drip_sheet_fee"),
    flickerEach: settingValue("flicker_each"),
    rhinoFittingFee: settingValue("rhino_fitting_fee"),
  };
}

function coilCarrierDisplayKey(key: string) {
  return `coil_carrier_${key}`;
}

function isPriceMatrix(value: unknown): value is PriceMatrix {
  if (!isRecord(value)) return false;

  return (
    Array.isArray(value.poleCentres) &&
    value.poleCentres.every((item) => typeof item === "number") &&
    Array.isArray(value.drops) &&
    value.drops.every((item) => typeof item === "number") &&
    Array.isArray(value.prices) &&
    value.prices.every((row) => Array.isArray(row) && row.every((item) => typeof item === "number"))
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSavedQuote(value: unknown): SavedQuoteRow | null {
  if (!isRecord(value)) return null;

  const quoteData = value.quote_data;
  if (!isQuoteResult(quoteData)) return null;

  return {
    id: String(value.id),
    user_id: String(value.user_id),
    customer_name: String(value.customer_name ?? ""),
    quote_reference: String(value.quote_reference ?? ""),
    quote_data: quoteData,
    total_price: Number(value.total_price ?? quoteData.totalPrice),
    created_at: String(value.created_at ?? ""),
    expires_at: String(value.expires_at ?? ""),
  };
}

function isQuoteResult(value: unknown): value is QuoteResult {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.input) &&
    typeof value.input.priceListType === "string" &&
    typeof value.input.measurementUnit === "string" &&
    typeof value.convertedPoleCentreMetres === "number" &&
    typeof value.convertedDropMetres === "number" &&
    typeof value.roundedPoleCentre === "number" &&
    typeof value.roundedDrop === "number" &&
    typeof value.basePrice === "number" &&
    typeof value.totalPrice === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function displayUsername(email?: string) {
  const username = email?.replace("@stronghold.local", "").trim();
  if (!username) return "Signed in";

  return username.charAt(0).toUpperCase() + username.slice(1);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function MeasurementField({
  title,
  placeholder,
  suffix,
  value,
  onChange,
}: {
  title: string;
  placeholder: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-500">{title}</span>
      <span className="field flex items-center gap-3">
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
        />
        <span className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-slate-500">{suffix}</span>
      </span>
    </label>
  );
}

function CompoundMeasurementField({
  title,
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
}: {
  title: string;
  primary: string;
  secondary: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-500">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <MeasurementField title="Feet" placeholder="0" suffix="ft" value={primary} onChange={onPrimaryChange} />
        <MeasurementField title="Inches" placeholder="0" suffix="in" value={secondary} onChange={onSecondaryChange} />
      </div>
    </div>
  );
}

function AddOnRow({
  addOn,
  selected,
  expanded,
  onToggle,
  onExpand,
}: {
  addOn: (typeof addOns)[number];
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const Icon = addOn.icon;

  return (
    <div
      className={clsx(
        "rounded-[20px] border p-3 transition",
        selected ? "border-blue-200 bg-accent-soft" : "border-line bg-white",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
            selected ? "bg-gradient-to-br from-accent-deep to-accent text-white" : "bg-mist text-accent",
          )}
        >
          <Icon size={17} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{addOn.title}</p>
        <button
          type="button"
          onClick={onExpand}
          aria-label={expanded ? `Hide ${addOn.title} details` : `Show ${addOn.title} details`}
          className="grid h-8 w-8 place-items-center rounded-full bg-mist text-slate-500"
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={clsx(
            "relative h-8 w-14 rounded-full border transition",
            selected ? "border-accent bg-accent" : "border-line bg-slate-100",
          )}
        >
          <span
            className={clsx(
              "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition",
              selected ? "left-7" : "left-1",
            )}
          />
        </button>
      </div>
      {expanded ? <p className="pl-[52px] pt-3 text-sm font-medium text-slate-500">{addOn.description}</p> : null}
    </div>
  );
}

function OptionToggle({
  title,
  selected,
  onToggle,
}: {
  title: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={clsx(
        "rounded-[20px] border p-3 transition",
        selected ? "border-blue-200 bg-accent-soft" : "border-line bg-white",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
            selected ? "bg-gradient-to-br from-accent-deep to-accent text-white" : "bg-mist text-accent",
          )}
        >
          <Package size={17} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{title}</p>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={clsx(
            "relative h-8 w-14 rounded-full border transition",
            selected ? "border-accent bg-accent" : "border-line bg-slate-100",
          )}
        >
          <span
            className={clsx(
              "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition",
              selected ? "left-7" : "left-1",
            )}
          />
        </button>
      </div>
    </div>
  );
}

function CoilCarrierResultCard({
  quoteResult,
  onDiscard,
}: {
  quoteResult: CoilCarrierQuoteResult;
  onDiscard: () => void;
}) {
  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Quote Result</h2>
        <button type="button" onClick={onDiscard} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Discard quote">
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 rounded-[24px] border border-blue-200 bg-gradient-to-br from-accent-soft to-white p-5">
        <p className="text-sm font-semibold text-accent">Coil Carriers</p>
        <p className="mt-4 text-sm font-semibold text-slate-500">Final Total</p>
        <p className="mt-1 text-4xl font-bold text-ink">{formatCurrency(quoteResult.totalPrice)}</p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <MetricPill title="Length" value={formatMetres(quoteResult.convertedLengthMetres)} />
          <MetricPill title="Flickers" value={String(quoteResult.flickerQuantity)} />
        </div>
      </div>

      <div className="mt-4 rounded-[20px] border border-line bg-white p-4">
        <p className="text-sm font-semibold text-ink">Quote Breakdown</p>
        <CoilCarrierBreakdown quoteResult={quoteResult} />
      </div>

      <div className="mt-4">
        <button className="secondary-button w-full" type="button" onClick={onDiscard}>
          Disregard Quote
        </button>
      </div>
    </section>
  );
}

function CoilCarrierBreakdown({ quoteResult }: { quoteResult: CoilCarrierQuoteResult }) {
  return (
    <div className="mt-4 space-y-4">
      <BreakdownGroup title="Measurements">
        <DetailRow label="Units" value={quoteResult.input.measurementUnit} />
        <DetailRow label="Entered length" value={formatMeasurement(quoteResult.input.length, quoteResult.input.measurementUnit)} />
        <DetailRow label="Length in metres" value={formatMetres(quoteResult.convertedLengthMetres)} />
      </BreakdownGroup>

      <BreakdownGroup title="Quote Breakdown">
        <DetailRow label="Base coil carrier price" value={formatCurrency(quoteResult.basePrice)} />
        {quoteResult.rearDoorCost !== null ? <DetailRow label="Rear door" value={formatCurrency(quoteResult.rearDoorCost)} /> : null}
        {quoteResult.dripSheetCost !== null && quoteResult.dripSheetRatePerMetre !== null ? (
          <DetailRow
            label="Drip sheet"
            value={`${formatMetres(quoteResult.convertedLengthMetres)} x ${formatCurrency(quoteResult.dripSheetRatePerMetre)}/m = ${formatCurrency(quoteResult.dripSheetCost)}`}
          />
        ) : null}
        {quoteResult.flickerCost !== null ? (
          <DetailRow label={`Flickers (${quoteResult.flickerQuantity})`} value={formatCurrency(quoteResult.flickerCost)} />
        ) : null}
        {quoteResult.rhinoFittingCost !== null ? <DetailRow label="Fitting at Rhino" value={formatCurrency(quoteResult.rhinoFittingCost)} /> : null}
        <DetailRow label="Final total" value={formatCurrency(quoteResult.totalPrice)} emphasize />
      </BreakdownGroup>
    </div>
  );
}

function ResultCard({
  quoteResult,
  onDiscard,
  onSave,
}: {
  quoteResult: QuoteResult;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(true);

  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Quote Result</h2>
        <button type="button" onClick={onDiscard} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Discard quote">
          <X size={16} />
        </button>
      </div>

      <QuoteTotalPanel quoteResult={quoteResult} />

      <div className="mt-4 rounded-[20px] border border-line bg-white p-4">
        <button
          type="button"
          onClick={() => setShowBreakdown((value) => !value)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-ink"
        >
          Quote Breakdown
          {showBreakdown ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>

        {showBreakdown ? (
          <QuoteBreakdown quoteResult={quoteResult} />
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button className="secondary-button w-full" type="button" onClick={onDiscard}>
          Disregard Quote
        </button>
        <button className="primary-button w-full" type="button" onClick={onSave}>
          Save Quote
        </button>
      </div>
    </section>
  );
}

function QuoteTotalPanel({ quoteResult }: { quoteResult: QuoteResult }) {
  const selectedAddOns = addOns.filter((addOn) => quoteResult.input.addOns[addOn.key]).map((addOn) => addOn.title);

  return (
    <div className="mt-4 rounded-[24px] border border-blue-200 bg-gradient-to-br from-accent-soft to-white p-5">
      <p className="text-sm font-semibold text-accent">{quoteResult.input.priceListType}</p>
      <p className="mt-4 text-sm font-semibold text-slate-500">Final Total</p>
      <p className="mt-1 text-4xl font-bold text-ink">{formatCurrency(quoteResult.totalPrice)}</p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <MetricPill title="Pole Centre" value={formatMetres(quoteResult.roundedPoleCentre)} />
        <MetricPill title="Drop" value={formatMetres(quoteResult.roundedDrop)} />
      </div>

      {selectedAddOns.length ? (
        <p className="mt-4 text-sm font-semibold text-accent">{selectedAddOns.join(" • ")}</p>
      ) : null}
    </div>
  );
}

function QuoteBreakdown({ quoteResult }: { quoteResult: QuoteResult }) {
  return (
    <div className="mt-4 space-y-4">
      <BreakdownGroup title="Measurements">
        <DetailRow label="Selected pricing" value={quoteResult.input.priceListType} />
        <DetailRow label="Units" value={quoteResult.input.measurementUnit} />
        <DetailRow label="Entered pole centre" value={formatMeasurement(quoteResult.input.poleCentre, quoteResult.input.measurementUnit)} />
        <DetailRow label="Entered drop" value={formatMeasurement(quoteResult.input.drop, quoteResult.input.measurementUnit)} />
        <DetailRow label="Converted pole centre" value={formatMetres(quoteResult.convertedPoleCentreMetres)} />
        <DetailRow label="Converted drop" value={formatMetres(quoteResult.convertedDropMetres)} />
        <DetailRow label="Rounded pole centre" value={formatMetres(quoteResult.roundedPoleCentre)} />
        <DetailRow label="Rounded drop" value={formatMetres(quoteResult.roundedDrop)} />
      </BreakdownGroup>

      <BreakdownGroup title="Quote Breakdown">
        <DetailRow label="Base matrix price" value={formatCurrency(quoteResult.basePrice)} />
        {quoteResult.printCost !== null ? <DetailRow label="Print" value={formatCurrency(quoteResult.printCost)} /> : null}
        {quoteResult.tapeCost !== null ? <DetailRow label="Sticky Tape" value={formatCurrency(quoteResult.tapeCost)} /> : null}
        {quoteResult.fittingCost !== null ? <DetailRow label="Fitting" value={formatCurrency(quoteResult.fittingCost)} /> : null}
        {quoteResult.deliveryCost !== null ? <DetailRow label="Delivery Cost" value={formatCurrency(quoteResult.deliveryCost)} /> : null}
        <DetailRow label="Final total" value={formatCurrency(quoteResult.totalPrice)} emphasize />
      </BreakdownGroup>
    </div>
  );
}

function MetricPill({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/80 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function BreakdownGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-mist p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={clsx("text-right font-semibold", emphasize ? "text-accent" : "text-ink")}>{value}</span>
    </div>
  );
}
